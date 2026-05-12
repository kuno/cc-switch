//! 请求处理器
//!
//! 处理各种API端点的HTTP请求
//!
//! 重构后的结构：
//! - 通用逻辑提取到 `handler_context` 和 `response_processor` 模块
//! - 各 handler 只保留独特的业务逻辑
//! - Claude 的格式转换逻辑保留在此文件（用于 OpenRouter 旧接口回退）

use super::{
    error_mapper::{get_error_message, map_proxy_error_to_status},
    forwarder::ActiveConnectionGuard,
    handler_config::{
        claude_stream_usage_event_filter, codex_stream_usage_event_filter, CLAUDE_PARSER_CONFIG,
        CODEX_PARSER_CONFIG, GEMINI_PARSER_CONFIG, OPENAI_PARSER_CONFIG,
    },
    handler_context::RequestContext,
    providers::{
        codex_chat_history::record_responses_sse_stream, get_adapter, get_claude_api_format,
        streaming::create_anthropic_sse_stream,
        streaming_codex_chat::create_responses_sse_stream_from_chat,
        streaming_gemini::create_anthropic_sse_stream_from_gemini,
        streaming_responses::create_anthropic_sse_stream_from_responses, transform,
        transform_codex_chat, transform_gemini, transform_responses,
    },
    response_processor::{
        create_logged_passthrough_stream, process_response, read_decoded_body,
        strip_entity_headers_for_rebuilt_body, strip_hop_by_hop_response_headers,
        usage_logging_enabled, SseUsageCollector,
    },
    server::{populate_status_active_targets, ProxyState},
    sse::{strip_sse_field, take_sse_block},
    types::*,
    usage::parser::TokenUsage,
    ProxyError,
};
use crate::app_config::AppType;
use crate::proxy::circuit_breaker::CircuitBreakerStats;
use crate::proxy::rate_limit::{
    quota_exhausted_reset, BalanceSnapshot, RateLimitSnapshot, RateLimitWindow,
};
use crate::services::oauth_refresh::storage::{
    load_codex_refresh_auth_for_provider, save_refreshed_codex_auth_for_provider,
};
use crate::services::oauth_refresh::{
    load_or_refresh_oauth_credentials, ClaudeTokenRefresher, CodexTokenRefresher,
    OAuthTokenRefresher,
};
use crate::services::subscription::{query_claude_quota, query_codex_quota, SubscriptionQuota};
use crate::services::usage_stats::{ProviderStats, UsageSummary};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use bytes::Bytes;
use futures::future::join_all;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};

const CODEX_OFFICIAL_PROVIDER_ID: &str = "codex-official";
const CODEX_OAUTH_AUTH_MODE: &str = "codex_oauth";
const CODEX_LEGACY_CLIENT_PASSTHROUGH_AUTH_MODE: &str = "client_passthrough";
const CLAUDE_OAUTH_AUTH_MODE: &str = "claude_oauth";
const CLAUDE_DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const CLAUDE_ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";
const CODEX_TOKEN_FIELD: &str = "OPENAI_API_KEY";
const GEMINI_TOKEN_FIELD: &str = "GEMINI_API_KEY";

#[cfg(test)]
static LIVE_QUOTA_REFRESH_CALLS: AtomicUsize = AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn record_live_quota_refresh_call() {
    LIVE_QUOTA_REFRESH_CALLS.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
fn reset_live_quota_refresh_call_count() {
    LIVE_QUOTA_REFRESH_CALLS.store(0, Ordering::SeqCst);
}

#[cfg(test)]
fn live_quota_refresh_call_count() -> usize {
    LIVE_QUOTA_REFRESH_CALLS.load(Ordering::SeqCst)
}

// ============================================================================
// 健康检查和状态查询（简单端点）
// ============================================================================

/// 健康检查
pub async fn health_check() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "healthy",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

fn is_codex_oauth_provider(provider: &crate::provider::Provider) -> bool {
    provider.id == CODEX_OFFICIAL_PROVIDER_ID
        || provider
            .meta
            .as_ref()
            .and_then(|meta| meta.provider_type.as_deref())
            == Some(CODEX_OAUTH_AUTH_MODE)
        || provider
            .settings_config
            .get("auth_mode")
            .and_then(Value::as_str)
            .is_some_and(|auth_mode| {
                matches!(
                    auth_mode,
                    CODEX_OAUTH_AUTH_MODE | CODEX_LEGACY_CLIENT_PASSTHROUGH_AUTH_MODE
                )
            })
}

fn is_claude_oauth_provider(provider: &crate::provider::Provider) -> bool {
    provider
        .settings_config
        .get("auth_mode")
        .and_then(Value::as_str)
        == Some(CLAUDE_OAUTH_AUTH_MODE)
}

fn quota_cache_key(app_type: &str, provider_id: &str) -> String {
    format!("{app_type}:{provider_id}")
}

fn subscription_quota_error(quota: &SubscriptionQuota) -> String {
    quota
        .error
        .clone()
        .unwrap_or_else(|| "unknown upstream error".to_string())
}

async fn build_subscription_quota_snapshot(
    state: &ProxyState,
    app_type: &str,
    provider_id: &str,
    provider_name: &str,
    quota: SubscriptionQuota,
) -> Result<super::rate_limit::RateLimitSnapshot, String> {
    if !quota.success {
        return Err(subscription_quota_error(&quota));
    }

    let previous = {
        let store = state.rate_limits.read().await;
        store.get(provider_id).cloned()
    };

    super::rate_limit::snapshot_from_subscription_quota(
        app_type,
        provider_id,
        provider_name,
        &quota,
        previous.as_ref(),
    )
    .ok_or_else(|| subscription_quota_error(&quota))
}

async fn refresh_cached_quota_snapshot<F, Fut>(
    state: &ProxyState,
    app_type: &str,
    provider_id: String,
    provider_name: String,
    refresh: F,
) -> Option<super::rate_limit::RateLimitSnapshot>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<super::rate_limit::RateLimitSnapshot, String>>,
{
    match state
        .quota_snapshot_cache
        .get_or_refresh(&quota_cache_key(app_type, &provider_id), refresh)
        .await
    {
        Ok(mut snapshot) => {
            snapshot.app_type = app_type.to_string();
            snapshot.provider_id = provider_id;
            snapshot.provider_name = provider_name;
            Some(snapshot)
        }
        Err(_) => None,
    }
}

async fn refresh_codex_quota_snapshots_with_query_and_refresher<F, Fut, R>(
    state: &ProxyState,
    query_quota: F,
    refresher: &R,
) where
    F: Fn(String, Option<String>) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
    R: OAuthTokenRefresher,
{
    #[cfg(test)]
    record_live_quota_refresh_call();

    let providers = match state.db.get_all_providers("codex") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!("[Quota] failed to list codex providers for live quota refresh: {error}");
            return;
        }
    };

    let mut live_refresh_provider_ids = HashSet::new();
    let mut live_fetches = Vec::new();

    for provider in providers.into_values().filter(is_codex_oauth_provider) {
        let auth_provider_id = provider.id.clone();
        let provider_key = format!("codex:{auth_provider_id}");
        let Some(auth) = load_or_refresh_oauth_credentials(
            "Codex",
            &auth_provider_id,
            &provider_key,
            refresher,
            &state.oauth_refresh_locks,
            || load_codex_refresh_auth_for_provider(&auth_provider_id),
            |stored, refreshed| {
                save_refreshed_codex_auth_for_provider(&auth_provider_id, stored, refreshed)
            },
        )
        .await
        else {
            continue;
        };
        let query_quota = query_quota.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();

        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(refresh_cached_quota_snapshot(
            state,
            "codex",
            provider_id.clone(),
            provider_name.clone(),
            move || async move {
                let quota = query_quota(auth.access_token.clone(), auth.account_id.clone()).await;

                build_subscription_quota_snapshot(
                    state,
                    "codex",
                    &provider_id,
                    &provider_name,
                    quota,
                )
                .await
            },
        ));
    }

    {
        let mut store = state.rate_limits.write().await;
        store.retain(|_, snapshot| {
            !(snapshot.app_type == "codex"
                && snapshot.source.as_deref() == Some("subscription_quota")
                && !live_refresh_provider_ids.contains(&snapshot.provider_id))
        });
    }

    if live_fetches.is_empty() {
        return;
    }

    let refreshed = join_all(live_fetches).await;
    let mut store = state.rate_limits.write().await;
    for snapshot in refreshed.into_iter().flatten() {
        store.insert(snapshot.provider_id.clone(), snapshot);
    }
}

async fn refresh_codex_quota_snapshots(state: &ProxyState) {
    let refresher = CodexTokenRefresher::new();
    refresh_codex_quota_snapshots_with_query_and_refresher(
        state,
        |access_token: String, account_id: Option<String>| async move {
            query_codex_quota(
                &access_token,
                account_id.as_deref(),
                "codex_oauth",
                "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
            )
            .await
        },
        &refresher,
    )
    .await;
}

/// Reconcile stored Claude rate-limit snapshots before serving `/api/quota`.
///
/// Retain rules:
/// - keep non-Claude snapshots untouched;
/// - evict Claude snapshots whose provider no longer exists in the DB;
/// - keep header-captured Claude snapshots (`source != "subscription_quota"`);
/// - evict `subscription_quota` snapshots for providers that will not be
///   refreshed in this cycle.
async fn refresh_claude_quota_snapshots_with_query_and_refresher<F, Fut, R>(
    state: &ProxyState,
    query_quota: F,
    refresher: &R,
) where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
    R: OAuthTokenRefresher,
{
    #[cfg(test)]
    record_live_quota_refresh_call();

    let providers = match state.db.get_all_providers("claude") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[Quota] failed to list claude providers for stale snapshot cleanup: {error}"
            );
            return;
        }
    };

    let live_claude_provider_ids: HashSet<String> = providers.keys().cloned().collect();
    let mut live_refresh_provider_ids = HashSet::new();
    let mut live_fetches = Vec::new();

    for provider in providers.into_values().filter(is_claude_oauth_provider) {
        let auth_provider_id = provider.id.clone();
        let Some(access_token) = state
            .claude_uploaded_auth
            .get_valid_access_token(&auth_provider_id, refresher)
            .await
        else {
            continue;
        };

        let query_quota = query_quota.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(refresh_cached_quota_snapshot(
            state,
            "claude",
            provider_id.clone(),
            provider_name.clone(),
            move || async move {
                let quota = query_quota(access_token.clone()).await;
                build_subscription_quota_snapshot(
                    state,
                    "claude",
                    &provider_id,
                    &provider_name,
                    quota,
                )
                .await
            },
        ));
    }

    let mut store = state.rate_limits.write().await;
    store.retain(|_, snapshot| {
        if snapshot.app_type != "claude" {
            return true;
        }

        if !live_claude_provider_ids.contains(&snapshot.provider_id) {
            return false;
        }

        if snapshot.source.as_deref() != Some("subscription_quota") {
            return true;
        }

        live_refresh_provider_ids.contains(&snapshot.provider_id)
    });

    drop(store);

    if live_fetches.is_empty() {
        return;
    }

    let refreshed = join_all(live_fetches).await;
    let mut store = state.rate_limits.write().await;
    for snapshot in refreshed.into_iter().flatten() {
        store.insert(snapshot.provider_id.clone(), snapshot);
    }
}

async fn refresh_claude_quota_snapshots_with_query<F, Fut>(state: &ProxyState, query_quota: F)
where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
{
    let refresher = ClaudeTokenRefresher::new();
    refresh_claude_quota_snapshots_with_query_and_refresher(state, query_quota, &refresher).await;
}

async fn refresh_claude_quota_snapshots(state: &ProxyState) {
    refresh_claude_quota_snapshots_with_query(state, |access_token: String| async move {
        query_claude_quota(&access_token).await
    })
    .await;
}

async fn refresh_live_quota_snapshots(state: &ProxyState) {
    refresh_codex_quota_snapshots(&state).await;
    refresh_claude_quota_snapshots(&state).await;
    super::third_party_quota::refresh_third_party_coding_plan_snapshots(&state).await;
    super::third_party_quota::refresh_third_party_balance_snapshots(&state).await;
}

pub async fn get_quota(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
    refresh_live_quota_snapshots(&state).await;
    let store = state.rate_limits.read().await;
    let providers: Vec<_> = store.values().cloned().collect();
    (
        StatusCode::OK,
        Json(json!({
            "providers": providers,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

struct StatusSnapshots {
    proxy_status: ProxyStatus,
    _current_providers: HashMap<String, (String, String)>,
    rate_limits: HashMap<String, RateLimitSnapshot>,
    checked_at: String,
    now_secs: i64,
}

struct FailoverStatusContext<'a> {
    auto_failover_enabled: bool,
    active_provider_id: Option<&'a str>,
    queue_positions: &'a HashMap<String, usize>,
    health_records: &'a HashMap<String, ProviderHealth>,
    circuit_stats: &'a HashMap<String, Option<CircuitBreakerStats>>,
    rate_limits: &'a HashMap<String, RateLimitSnapshot>,
    now_secs: i64,
}

async fn capture_status_snapshots(state: &ProxyState) -> StatusSnapshots {
    let mut proxy_status = { state.status.read().await.clone() };

    if let Some(start) = *state.start_time.read().await {
        proxy_status.uptime_seconds = start.elapsed().as_secs();
    }

    let current_providers = { state.current_providers.read().await.clone() };
    let rate_limits = { state.rate_limits.read().await.clone() };
    let now = chrono::Utc::now();

    StatusSnapshots {
        proxy_status,
        _current_providers: current_providers,
        rate_limits,
        checked_at: now.to_rfc3339(),
        now_secs: now.timestamp(),
    }
}

async fn build_api_status_response(state: &ProxyState) -> Result<ApiStatusResponse, ProxyError> {
    let snapshots = capture_status_snapshots(state).await;
    let daemon = ApiStatusDaemon {
        health: snapshots.proxy_status.running,
        running: snapshots.proxy_status.running,
        uptime_seconds: snapshots.proxy_status.uptime_seconds,
        last_error: snapshots.proxy_status.last_error.clone(),
        checked_at: snapshots.checked_at.clone(),
    };

    let mut apps = BTreeMap::new();
    for app_type in [AppType::Claude, AppType::Codex, AppType::Gemini] {
        apps.insert(
            app_type.as_str().to_string(),
            build_app_status(state, app_type, &snapshots).await?,
        );
    }

    Ok(ApiStatusResponse { daemon, apps })
}

async fn build_app_status(
    state: &ProxyState,
    app_type: AppType,
    snapshots: &StatusSnapshots,
) -> Result<ApiStatusApp, ProxyError> {
    let app_key = app_type.as_str().to_string();
    let config = state
        .db
        .get_proxy_config_for_app(&app_key)
        .await
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?;
    let providers = state
        .db
        .get_all_providers_by_display_order(&app_key)
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?;
    // Inline precedence — §8 requires read-only; get_effective_current_provider clears stale settings.
    let active_provider_id = if let Some(local_id) =
        crate::settings::get_current_provider(&app_type).filter(|id| providers.contains_key(id))
    {
        Some(local_id)
    } else {
        state
            .db
            .get_current_provider(&app_key)
            .map_err(|e| ProxyError::DatabaseError(e.to_string()))?
    };
    let active_provider = active_provider_id
        .as_ref()
        .and_then(|provider_id| {
            providers
                .get(provider_id)
                .map(|provider| (provider_id, provider))
        })
        .map(|(provider_id, provider)| ApiStatusActiveProvider {
            provider_id: provider_id.clone(),
            name: provider.name.clone(),
        });

    let health_records: HashMap<String, ProviderHealth> = state
        .db
        .list_provider_health_records(&app_key)
        .await
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?
        .into_iter()
        .map(|record| (record.provider_id.clone(), record))
        .collect();

    let db_failover_queue = state
        .db
        .get_failover_queue(&app_key)
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?;
    let queue_positions: HashMap<String, usize> = db_failover_queue
        .iter()
        .enumerate()
        .map(|(position, item)| (item.provider_id.clone(), position))
        .collect();
    let failover_queue = db_failover_queue
        .iter()
        .enumerate()
        .map(|(position, item)| ApiStatusFailoverQueueItem {
            provider_id: item.provider_id.clone(),
            name: item.provider_name.clone(),
            position,
        })
        .collect();

    let usage = build_usage(
        state
            .db
            .get_usage_summary(None, None, Some(&app_key))
            .map_err(|e| ProxyError::DatabaseError(e.to_string()))?,
    );
    let provider_stats: HashMap<String, ProviderStats> = state
        .db
        .get_provider_stats(None, None, Some(&app_key))
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?
        .into_iter()
        .map(|stats| (stats.provider_id.clone(), stats))
        .collect();

    let mut circuit_stats = HashMap::new();
    for provider_id in providers.keys() {
        circuit_stats.insert(
            provider_id.clone(),
            state
                .provider_router
                .get_circuit_breaker_stats(provider_id, &app_key)
                .await,
        );
    }

    let failover_context = FailoverStatusContext {
        auto_failover_enabled: config.auto_failover_enabled,
        active_provider_id: active_provider_id.as_deref(),
        queue_positions: &queue_positions,
        health_records: &health_records,
        circuit_stats: &circuit_stats,
        rate_limits: &snapshots.rate_limits,
        now_secs: snapshots.now_secs,
    };

    let mut failover_status = BTreeMap::new();
    for provider_id in providers.keys() {
        failover_status.insert(
            provider_id.clone(),
            build_failover_status(provider_id, &failover_context),
        );
    }

    let mut provider_views = BTreeMap::new();
    for provider in providers.values() {
        let base_url = extract_status_provider_base_url(&app_key, &provider.settings_config);
        let token_field = extract_status_provider_token_field(&app_key, &provider.settings_config);
        provider_views.insert(
            provider.id.clone(),
            ApiStatusProvider {
                name: provider.name.clone(),
                configured: true,
                base_url,
                icon: provider.icon.clone(),
                icon_color: provider.icon_color.clone(),
                token_field,
                stats: build_provider_stats(provider_stats.get(&provider.id)),
                quota: build_provider_quota(snapshots.rate_limits.get(&provider.id)),
            },
        );
    }

    let (health, health_reason) = derive_app_health(
        provider_views.is_empty(),
        config.enabled,
        config.auto_failover_enabled,
        active_provider_id.as_deref(),
        &failover_status,
    );

    Ok(ApiStatusApp {
        mode: if config.auto_failover_enabled {
            "failover".to_string()
        } else {
            "normal".to_string()
        },
        proxy_enabled: config.enabled,
        health,
        health_reason,
        max_retries: config.max_retries,
        usage,
        active_provider,
        providers: provider_views,
        failover_queue,
        failover_status,
    })
}

fn build_usage(summary: UsageSummary) -> ApiStatusUsage {
    ApiStatusUsage {
        window: ApiStatusUsageWindow {
            preset: "all_time".to_string(),
            start: None,
            end: None,
        },
        total_requests: summary.total_requests,
        total_cost: summary.total_cost,
        total_input_tokens: summary.total_input_tokens,
        total_output_tokens: summary.total_output_tokens,
        total_cache_creation_tokens: summary.total_cache_creation_tokens,
        total_cache_read_tokens: summary.total_cache_read_tokens,
        success_rate: summary.success_rate,
    }
}

fn build_provider_quota(snapshot: Option<&RateLimitSnapshot>) -> Option<ApiStatusQuota> {
    snapshot.map(|snapshot| ApiStatusQuota {
        source: snapshot.source.clone(),
        status: snapshot.status.clone(),
        windows: snapshot.windows.iter().map(build_quota_window).collect(),
        representative_claim: snapshot.representative_claim.clone(),
        overage_status: snapshot.overage_status.clone(),
        fallback_percentage: snapshot.fallback_percentage,
        requests_limit: snapshot.requests_limit,
        requests_remaining: snapshot.requests_remaining,
        tokens_limit: snapshot.tokens_limit,
        tokens_remaining: snapshot.tokens_remaining,
        balances: snapshot
            .balances
            .as_ref()
            .map(|balances| balances.iter().map(build_balance_snapshot).collect()),
        captured_at: snapshot.captured_at,
    })
}

fn build_quota_window(window: &RateLimitWindow) -> ApiStatusQuotaWindow {
    ApiStatusQuotaWindow {
        name: window.name.clone(),
        status: window.status.clone(),
        utilization: window.utilization,
        reset: window.reset,
    }
}

fn build_balance_snapshot(balance: &BalanceSnapshot) -> ApiStatusBalanceSnapshot {
    ApiStatusBalanceSnapshot {
        plan_name: balance.plan_name.clone(),
        currency: balance.currency.clone(),
        total: balance.total,
        used: balance.used,
        remaining: balance.remaining,
        is_valid: balance.is_valid,
        invalid_message: balance.invalid_message.clone(),
    }
}

fn build_provider_stats(stats: Option<&ProviderStats>) -> Option<ApiStatusProviderStats> {
    stats.map(|stats| ApiStatusProviderStats {
        request_count: stats.request_count,
        total_tokens: stats.total_tokens,
        total_cost: stats.total_cost.clone(),
        success_rate: stats.success_rate,
        avg_latency_ms: stats.avg_latency_ms,
    })
}

fn extract_status_provider_base_url(app_key: &str, settings_config: &Value) -> String {
    match app_key {
        "claude" => settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| extract_status_direct_string(settings_config, &["base_url", "baseURL"]))
            .unwrap_or_default(),
        "codex" => extract_status_direct_string(settings_config, &["base_url", "baseURL"])
            .or_else(|| {
                settings_config
                    .get("config")
                    .and_then(Value::as_str)
                    .and_then(extract_status_codex_base_url_from_toml)
            })
            .unwrap_or_default(),
        "gemini" => settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("GOOGLE_GEMINI_BASE_URL"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| extract_status_direct_string(settings_config, &["base_url", "baseURL"]))
            .unwrap_or_default(),
        _ => extract_status_direct_string(settings_config, &["base_url", "baseURL"])
            .unwrap_or_default(),
    }
}

fn extract_status_provider_token_field(app_key: &str, settings_config: &Value) -> String {
    if let Some(value) =
        extract_status_direct_string(settings_config, &["tokenField", "token_field"])
    {
        return value;
    }

    match app_key {
        "claude" => settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| {
                if env.contains_key(CLAUDE_DEFAULT_TOKEN_FIELD) {
                    Some(CLAUDE_DEFAULT_TOKEN_FIELD)
                } else if env.contains_key(CLAUDE_ALT_TOKEN_FIELD) {
                    Some(CLAUDE_ALT_TOKEN_FIELD)
                } else {
                    None
                }
            })
            .unwrap_or(CLAUDE_DEFAULT_TOKEN_FIELD)
            .to_string(),
        "codex" => CODEX_TOKEN_FIELD.to_string(),
        "gemini" => GEMINI_TOKEN_FIELD.to_string(),
        _ => String::new(),
    }
}

fn extract_status_direct_string(root: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| root.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_status_codex_base_url_from_toml(config: &str) -> Option<String> {
    if let Ok(table) = toml::from_str::<toml::Table>(config) {
        if let Some(provider_key) = table
            .get("model_provider")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
        {
            if let Some(url) = table
                .get("model_providers")
                .and_then(|value| value.as_table())
                .and_then(|providers| providers.get(provider_key))
                .and_then(|value| value.as_table())
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(url.to_string());
            }
        }

        if let Some(url) = table
            .get("base_url")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(url.to_string());
        }
    }

    None
}

fn build_failover_status(
    provider_id: &str,
    context: &FailoverStatusContext<'_>,
) -> ApiStatusFailoverProviderStatus {
    let queue_position = context.queue_positions.get(provider_id).copied();
    let in_failover_queue = queue_position.is_some();
    let is_active = context.active_provider_id == Some(provider_id);
    let health = build_provider_health(context.health_records.get(provider_id));
    let circuit = build_provider_circuit(
        context
            .circuit_stats
            .get(provider_id)
            .and_then(Option::as_ref),
    );
    let quota = build_quota_gate(context.rate_limits.get(provider_id), context.now_secs);

    let mut unavailable_reasons = Vec::new();
    if context.auto_failover_enabled {
        if !in_failover_queue {
            unavailable_reasons.push("not_in_failover_queue".to_string());
        }
    } else if !is_active {
        unavailable_reasons.push("not_active_in_normal_mode".to_string());
    }
    if !health.healthy {
        unavailable_reasons.push("unhealthy".to_string());
    }
    if circuit.state.as_deref() == Some("open") {
        unavailable_reasons.push("circuit_open".to_string());
    }
    if quota.exhausted {
        unavailable_reasons.push("quota_exhausted".to_string());
    }

    let current_role = if context.auto_failover_enabled {
        if is_active {
            "active"
        } else if in_failover_queue {
            "standby"
        } else {
            "skipped"
        }
    } else if is_active {
        "active"
    } else {
        "skipped"
    }
    .to_string();

    ApiStatusFailoverProviderStatus {
        in_failover_queue,
        queue_position,
        current_role,
        available: unavailable_reasons.is_empty(),
        unavailable_reasons,
        health,
        circuit,
        quota,
    }
}

fn build_provider_health(record: Option<&ProviderHealth>) -> ApiStatusProviderHealth {
    match record {
        Some(record) => ApiStatusProviderHealth {
            observed: true,
            healthy: record.is_healthy,
            consecutive_failures: record.consecutive_failures,
            last_success_at: record.last_success_at.clone(),
            last_failure_at: record.last_failure_at.clone(),
            last_error: record.last_error.clone(),
            updated_at: Some(record.updated_at.clone()),
        },
        None => ApiStatusProviderHealth {
            observed: false,
            healthy: true,
            consecutive_failures: 0,
            last_success_at: None,
            last_failure_at: None,
            last_error: None,
            updated_at: None,
        },
    }
}

fn build_provider_circuit(stats: Option<&CircuitBreakerStats>) -> ApiStatusCircuit {
    match stats {
        Some(stats) => ApiStatusCircuit {
            observed: true,
            state: Some(stats.state.to_string()),
            consecutive_failures: Some(stats.consecutive_failures),
            consecutive_successes: Some(stats.consecutive_successes),
            total_requests: Some(stats.total_requests),
            failed_requests: Some(stats.failed_requests),
        },
        None => ApiStatusCircuit {
            observed: false,
            state: None,
            consecutive_failures: None,
            consecutive_successes: None,
            total_requests: None,
            failed_requests: None,
        },
    }
}

fn build_quota_gate(snapshot: Option<&RateLimitSnapshot>, now_secs: i64) -> ApiStatusQuotaGate {
    let reset_at = snapshot.and_then(|snapshot| quota_exhausted_reset(snapshot, now_secs));
    ApiStatusQuotaGate {
        exhausted: reset_at.is_some(),
        reset_at,
    }
}

fn derive_app_health(
    no_configured_providers: bool,
    proxy_enabled: bool,
    auto_failover_enabled: bool,
    active_provider_id: Option<&str>,
    failover_status: &BTreeMap<String, ApiStatusFailoverProviderStatus>,
) -> (Option<bool>, String) {
    if no_configured_providers {
        return (None, "no_provider_configured".to_string());
    }

    if !proxy_enabled {
        return (None, "proxy_disabled".to_string());
    }

    if auto_failover_enabled {
        let has_available_provider = failover_status
            .values()
            .any(|status| status.in_failover_queue && status.available);
        if has_available_provider {
            (Some(true), "route_has_available_provider".to_string())
        } else {
            (
                Some(false),
                "all_failover_providers_unavailable".to_string(),
            )
        }
    } else if active_provider_id
        .and_then(|provider_id| failover_status.get(provider_id))
        .is_some_and(|status| status.available)
    {
        (Some(true), "active_provider_healthy".to_string())
    } else {
        (Some(false), "active_provider_unhealthy".to_string())
    }
}

pub async fn get_api_status(
    State(state): State<ProxyState>,
) -> Result<Json<ApiStatusResponse>, ProxyError> {
    refresh_live_quota_snapshots(&state).await;
    Ok(Json(build_api_status_response(&state).await?))
}

/// 获取服务状态
pub async fn get_status(State(state): State<ProxyState>) -> Result<Json<ProxyStatus>, ProxyError> {
    let mut status = state.status.read().await.clone();

    if let Some(start) = *state.start_time.read().await {
        status.uptime_seconds = start.elapsed().as_secs();
    }

    let current_providers = state.current_providers.read().await;
    populate_status_active_targets(&mut status, &current_providers);

    Ok(Json(status))
}

// ============================================================================
// Claude API 处理器（包含格式转换逻辑）
// ============================================================================

/// 处理 /v1/messages 请求（Claude API）
///
/// Claude 处理器包含独特的格式转换逻辑：
/// - 过去用于 OpenRouter 的 OpenAI Chat Completions 兼容接口（Anthropic ↔ OpenAI 转换）
/// - 现在 OpenRouter 已推出 Claude Code 兼容接口，默认不再启用该转换（逻辑保留以备回退）
pub async fn handle_messages(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    handle_messages_for_app(state, request, AppType::Claude, "Claude", "claude", None).await
}

pub async fn handle_claude_desktop_messages(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    validate_claude_desktop_gateway_auth(&state, request.headers())?;
    handle_messages_for_app(
        state,
        request,
        AppType::ClaudeDesktop,
        "Claude Desktop",
        "claude-desktop",
        Some("/claude-desktop"),
    )
    .await
}

pub async fn handle_claude_desktop_models(
    State(state): State<ProxyState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, ProxyError> {
    validate_claude_desktop_gateway_auth(&state, &headers)?;
    let providers = state
        .provider_router
        .select_providers("claude-desktop")
        .await
        .map_err(|e| ProxyError::DatabaseError(e.to_string()))?;
    let provider = providers.first().ok_or(ProxyError::NoAvailableProvider)?;
    let response = crate::claude_desktop_config::model_list_response(provider)
        .map_err(|e| ProxyError::ConfigError(e.to_string()))?;
    Ok(Json(response))
}

async fn handle_messages_for_app(
    state: ProxyState,
    request: axum::extract::Request,
    app_type: AppType,
    tag: &'static str,
    app_type_str: &'static str,
    strip_prefix: Option<&'static str>,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, body) = request.into_parts();
    let method = parts.method.clone();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, app_type.clone(), tag, app_type_str).await?;

    let raw_endpoint = uri
        .path_and_query()
        .map(|path_and_query| path_and_query.as_str())
        .unwrap_or(uri.path());
    let endpoint = strip_prefix
        .and_then(|prefix| raw_endpoint.strip_prefix(prefix))
        .unwrap_or(raw_endpoint);

    let is_stream = body
        .get("stream")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);

    // 转发请求
    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &app_type,
            method,
            endpoint,
            body.clone(),
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    let connection_guard = result.connection_guard.take();
    ctx.provider = result.provider;
    let api_format = result
        .claude_api_format
        .as_deref()
        .unwrap_or_else(|| get_claude_api_format(&ctx.provider))
        .to_string();
    let response = result.response;

    // 检查是否需要格式转换（OpenRouter 等中转服务）
    let adapter = get_adapter(&app_type);
    let needs_transform = adapter.needs_transform(&ctx.provider);

    // Claude 特有：格式转换处理
    if needs_transform {
        return handle_claude_transform(
            response,
            &ctx,
            &state,
            &body,
            is_stream,
            &api_format,
            connection_guard,
        )
        .await;
    }

    // 通用响应处理（透传模式）
    process_response(
        response,
        &ctx,
        &state,
        &CLAUDE_PARSER_CONFIG,
        connection_guard,
        is_stream,
    )
    .await
}

fn validate_claude_desktop_gateway_auth(
    state: &ProxyState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ProxyError> {
    let expected = crate::claude_desktop_config::get_or_create_gateway_token(state.db.as_ref())
        .map_err(|e| ProxyError::AuthError(e.to_string()))?;
    let Some(value) = headers.get(axum::http::header::AUTHORIZATION) else {
        return Err(ProxyError::AuthError(
            "Claude Desktop gateway 缺少 Authorization 头".to_string(),
        ));
    };
    let value = value
        .to_str()
        .map_err(|_| ProxyError::AuthError("Authorization 头格式无效".to_string()))?;
    let token = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .unwrap_or("")
        .trim();
    if token != expected {
        return Err(ProxyError::AuthError(
            "Claude Desktop gateway token 无效".to_string(),
        ));
    }
    Ok(())
}

/// Claude 格式转换处理（独有逻辑）
///
/// 支持 OpenAI Chat Completions 和 Responses API 两种格式的转换
async fn handle_claude_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    original_body: &Value,
    is_stream: bool,
    api_format: &str,
    connection_guard: Option<ActiveConnectionGuard>,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    let is_codex_oauth = ctx
        .provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        == Some("codex_oauth");
    // Codex OAuth 会把 openai_responses 响应强制升级为 SSE，即使客户端发的是 stream:false。
    // should_use_claude_transform_streaming 默认会把这个组合路由到流式转换器——虽然能避免
    // JSON parse 报 422，但会让非流客户端收到 text/event-stream，违反 Anthropic 非流语义。
    // 这里为这个特定组合打开 override：把上游 SSE 聚合成 Anthropic JSON 回给客户端，其它
    // 场景（任意上游 is_sse、非 Codex OAuth 等）仍沿用原有流式兜底。
    let aggregate_codex_oauth_responses_sse =
        !is_stream && is_codex_oauth && api_format == "openai_responses";
    let use_streaming = if aggregate_codex_oauth_responses_sse {
        false
    } else {
        should_use_claude_transform_streaming(
            is_stream,
            response.is_sse(),
            api_format,
            is_codex_oauth,
        )
    };
    let tool_schema_hints = transform_gemini::extract_anthropic_tool_schema_hints(original_body);
    let tool_schema_hints = (!tool_schema_hints.is_empty()).then_some(tool_schema_hints);

    if use_streaming {
        // 根据 api_format 选择流式转换器
        let stream = response.bytes_stream();
        let sse_stream: Box<
            dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send + Unpin,
        > = if api_format == "openai_responses" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_responses(stream)))
        } else if api_format == "gemini_native" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_gemini(
                stream,
                Some(state.gemini_shadow.clone()),
                Some(ctx.provider.id.clone()),
                Some(ctx.session_id.clone()),
                tool_schema_hints.clone(),
            )))
        } else {
            Box::new(Box::pin(create_anthropic_sse_stream(stream)))
        };

        // 创建使用量收集器；关闭 usage logging 时不要再解析转换后的 SSE。
        let usage_collector = if usage_logging_enabled(state) {
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = ctx.request_model.clone();
            let status_code = status.as_u16();
            let start_time = ctx.start_time;
            let session_id = ctx.session_id.clone();

            Some(SseUsageCollector::new(
                start_time,
                Some(claude_stream_usage_event_filter),
                move |events, first_token_ms| {
                    if let Some(usage) = TokenUsage::from_claude_stream_events(&events) {
                        let latency_ms = start_time.elapsed().as_millis() as u64;
                        let state = state.clone();
                        let provider_id = provider_id.clone();
                        let model = model.clone();
                        let session_id = session_id.clone();

                        tokio::spawn(async move {
                            log_usage(
                                &state,
                                &provider_id,
                                "claude",
                                &model,
                                &model,
                                usage,
                                latency_ms,
                                first_token_ms,
                                true,
                                status_code,
                                Some(session_id),
                            )
                            .await;
                        });
                    } else {
                        log::debug!("[Claude] OpenRouter 流式响应缺少 usage 统计，跳过消费记录");
                    }
                },
            ))
        } else {
            None
        };

        // 获取流式超时配置
        let timeout_config = ctx.streaming_timeout_config();

        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            "Claude/OpenRouter",
            usage_collector,
            timeout_config,
            connection_guard,
        );

        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "Content-Type",
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            "Cache-Control",
            axum::http::HeaderValue::from_static("no-cache"),
        );

        let body = axum::body::Body::from_stream(logged_stream);
        return Ok((headers, body).into_response());
    }

    // 非流式响应转换 (OpenAI/Responses → Anthropic)
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, _status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    let body_str = String::from_utf8_lossy(&body_bytes);

    let upstream_response: Value = if aggregate_codex_oauth_responses_sse {
        responses_sse_to_response_value(&body_str)?
    } else {
        serde_json::from_slice(&body_bytes).map_err(|e| {
            log::error!("[Claude] 解析上游响应失败: {e}, body: {body_str}");
            ProxyError::TransformError(format!("Failed to parse upstream response: {e}"))
        })?
    };

    // 根据 api_format 选择非流式转换器
    let anthropic_response = if api_format == "openai_responses" {
        transform_responses::responses_to_anthropic(upstream_response)
    } else if api_format == "gemini_native" {
        transform_gemini::gemini_to_anthropic_with_shadow_and_hints(
            upstream_response,
            Some(state.gemini_shadow.as_ref()),
            Some(&ctx.provider.id),
            Some(&ctx.session_id),
            tool_schema_hints.as_ref(),
        )
    } else {
        transform::openai_to_anthropic(upstream_response)
    }
    .map_err(|e| {
        log::error!("[Claude] 转换响应失败: {e}");
        e
    })?;

    // 记录使用量
    if let Some(usage) = TokenUsage::from_claude_response(&anthropic_response) {
        let model = anthropic_response
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        let latency_ms = ctx.latency_ms();

        let request_model = ctx.request_model.clone();
        tokio::spawn({
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = model.to_string();
            let session_id = ctx.session_id.clone();
            async move {
                log_usage(
                    &state,
                    &provider_id,
                    "claude",
                    &model,
                    &request_model,
                    usage,
                    latency_ms,
                    None,
                    false,
                    status.as_u16(),
                    Some(session_id),
                )
                .await;
            }
        });
    }

    // 构建响应
    let mut builder = axum::response::Response::builder().status(status);
    strip_entity_headers_for_rebuilt_body(&mut response_headers);
    strip_hop_by_hop_response_headers(&mut response_headers);
    // Builder::header 是 append 语义；不先 remove 会和上游 Content-Type 双发。
    response_headers.remove(axum::http::header::CONTENT_TYPE);

    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }

    builder = builder.header(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );

    let response_body = serde_json::to_vec(&anthropic_response).map_err(|e| {
        log::error!("[Claude] 序列化响应失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize response: {e}"))
    })?;

    let body = axum::body::Body::from(response_body);
    builder.body(body).map_err(|e| {
        log::error!("[Claude] 构建响应失败: {e}");
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
}

fn endpoint_with_query(uri: &axum::http::Uri, endpoint: &str) -> String {
    match uri.query() {
        Some(query) => format!("{endpoint}?{query}"),
        None => endpoint.to_string(),
    }
}

// ============================================================================
// Codex API 处理器
// ============================================================================

/// 处理 /v1/chat/completions 请求（OpenAI Chat Completions API - Codex CLI）
pub async fn handle_chat_completions(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let method = parts.method.clone();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/chat/completions");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            method,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    let connection_guard = result.connection_guard.take();
    ctx.provider = result.provider;
    let response = result.response;

    process_response(
        response,
        &ctx,
        &state,
        &OPENAI_PARSER_CONFIG,
        connection_guard,
        is_stream,
    )
    .await
}

/// 处理 /v1/responses 请求（OpenAI Responses API - Codex CLI 透传）
pub async fn handle_responses(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let method = parts.method.clone();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            method,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    let connection_guard = result.connection_guard.take();
    ctx.provider = result.provider;
    let response = result.response;

    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            connection_guard,
        )
        .await;
    }

    process_response(
        response,
        &ctx,
        &state,
        &CODEX_PARSER_CONFIG,
        connection_guard,
        is_stream,
    )
    .await
}

/// 处理 /v1/responses/compact 请求（OpenAI Responses Compact API - Codex CLI 透传）
pub async fn handle_responses_compact(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let method = parts.method.clone();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses/compact");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            method,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    let connection_guard = result.connection_guard.take();
    ctx.provider = result.provider;
    let response = result.response;

    if super::providers::should_convert_codex_responses_to_chat(&ctx.provider, &endpoint) {
        return handle_codex_chat_to_responses_transform(
            response,
            &ctx,
            &state,
            is_stream,
            connection_guard,
        )
        .await;
    }

    process_response(
        response,
        &ctx,
        &state,
        &CODEX_PARSER_CONFIG,
        connection_guard,
        is_stream,
    )
    .await
}

async fn handle_codex_chat_to_responses_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    is_stream: bool,
    connection_guard: Option<ActiveConnectionGuard>,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();

    if !status.is_success() {
        // 上游 Chat 错误体形状与 Responses 不一致（如 MiniMax 的 base_resp、自定义 detail 字段）；
        // 直接透传会让 Codex 客户端无法识别错误码。这里统一转换为 Responses 风格
        // `{"error": {message, type, code, param}}`，保留原始 HTTP 状态码。
        return handle_codex_chat_error_response(response, ctx, status).await;
    }

    if is_stream || response.is_sse() {
        let stream = response.bytes_stream();
        let sse_stream = create_responses_sse_stream_from_chat(stream);
        let sse_stream = record_responses_sse_stream(sse_stream, state.codex_chat_history.clone());

        let usage_collector = if usage_logging_enabled(state) {
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let request_model = ctx.request_model.clone();
            let start_time = ctx.start_time;
            let session_id = ctx.session_id.clone();

            Some(SseUsageCollector::new(
                start_time,
                Some(codex_stream_usage_event_filter),
                move |events, first_token_ms| {
                    let usage =
                        TokenUsage::from_codex_stream_events_auto(&events).unwrap_or_default();
                    let model = usage.model.clone().unwrap_or_else(|| request_model.clone());
                    let latency_ms = start_time.elapsed().as_millis() as u64;

                    let state = state.clone();
                    let provider_id = provider_id.clone();
                    let request_model = request_model.clone();
                    let session_id = session_id.clone();

                    tokio::spawn(async move {
                        log_usage(
                            &state,
                            &provider_id,
                            "codex",
                            &model,
                            &request_model,
                            usage,
                            latency_ms,
                            first_token_ms,
                            true,
                            status.as_u16(),
                            Some(session_id),
                        )
                        .await;
                    });
                },
            ))
        } else {
            None
        };

        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            ctx.tag,
            usage_collector,
            ctx.streaming_timeout_config(),
            connection_guard,
        );

        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "Content-Type",
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            "Cache-Control",
            axum::http::HeaderValue::from_static("no-cache"),
        );

        let body = axum::body::Body::from_stream(logged_stream);
        return Ok((headers, body).into_response());
    }

    let _connection_guard = connection_guard;
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;
    let body_str = String::from_utf8_lossy(&body_bytes);
    let chat_response: Value = serde_json::from_slice(&body_bytes).map_err(|e| {
        log::error!("[Codex] 解析 Chat 上游响应失败: {e}, body: {body_str}");
        ProxyError::TransformError(format!("Failed to parse upstream chat response: {e}"))
    })?;
    let responses_response = transform_codex_chat::chat_completion_to_response(chat_response)
        .map_err(|e| {
            log::error!("[Codex] Chat → Responses 响应转换失败: {e}");
            e
        })?;
    state
        .codex_chat_history
        .record_response(&responses_response)
        .await;

    if let Some(usage) = TokenUsage::from_codex_response_auto(&responses_response) {
        let model = responses_response
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&ctx.request_model);
        let request_model = ctx.request_model.clone();
        tokio::spawn({
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = model.to_string();
            let session_id = ctx.session_id.clone();
            let latency_ms = ctx.latency_ms();
            async move {
                log_usage(
                    &state,
                    &provider_id,
                    "codex",
                    &model,
                    &request_model,
                    usage,
                    latency_ms,
                    None,
                    false,
                    status.as_u16(),
                    Some(session_id),
                )
                .await;
            }
        });
    }

    strip_entity_headers_for_rebuilt_body(&mut response_headers);
    strip_hop_by_hop_response_headers(&mut response_headers);
    // Builder::header 是 append 语义；不先 remove 会和上游 Content-Type 双发。
    response_headers.remove(axum::http::header::CONTENT_TYPE);

    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }
    builder = builder.header(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );

    let response_body = serde_json::to_vec(&responses_response).map_err(|e| {
        log::error!("[Codex] 序列化 Responses 响应失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize responses response: {e}"))
    })?;

    builder
        .body(axum::body::Body::from(response_body))
        .map_err(|e| {
            log::error!("[Codex] 构建 Responses 响应失败: {e}");
            ProxyError::Internal(format!("Failed to build response: {e}"))
        })
}

/// 把上游 Chat Completions 的错误响应转换为 Responses API 错误形状。
///
/// 与正常响应分支配套：正常响应已经被改写成 Responses 形式，错误响应若仍保留
/// Chat 错误体（如 MiniMax 的 `{"base_resp": {"status_code": 2013}}`），Codex
/// 客户端的错误处理就无法对齐字段。这里读取上游 body、规整成
/// `{"error": {message, type, code, param}}` 并保留原始 HTTP 状态码。
async fn handle_codex_chat_error_response(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    status: axum::http::StatusCode,
) -> Result<axum::response::Response, ProxyError> {
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, _status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    // 非 JSON 上游错误体（Cloudflare HTML、纯文本 "Unauthorized" 等）若丢成 None，
    // 客户端就看不到原始诊断信息；包成 Value::String 走转换函数的字符串分支。
    let parsed_value: Value = match serde_json::from_slice::<Value>(&body_bytes) {
        Ok(value) => value,
        Err(_) => {
            const MAX_RAW_ERROR_BYTES: usize = 1024;
            let lossy = String::from_utf8_lossy(&body_bytes);
            let truncated = if lossy.len() > MAX_RAW_ERROR_BYTES {
                let mut end = MAX_RAW_ERROR_BYTES;
                while end > 0 && !lossy.is_char_boundary(end) {
                    end -= 1;
                }
                format!("{}…(truncated)", &lossy[..end])
            } else {
                lossy.into_owned()
            };
            log::warn!("[Codex] Chat 错误响应不是合法 JSON，按文本透传: {truncated}");
            Value::String(truncated)
        }
    };

    let responses_error = transform_codex_chat::chat_error_to_response_error(Some(&parsed_value));

    strip_entity_headers_for_rebuilt_body(&mut response_headers);
    strip_hop_by_hop_response_headers(&mut response_headers);
    // Builder::header 是 append 语义；不先 remove 会和上游 Content-Type 双发。
    response_headers.remove(axum::http::header::CONTENT_TYPE);

    let mut builder = axum::response::Response::builder().status(status);
    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }
    builder = builder.header(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );

    let body = serde_json::to_vec(&responses_error).map_err(|e| {
        log::error!("[Codex] 序列化 Responses 错误体失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize responses error: {e}"))
    })?;

    builder.body(axum::body::Body::from(body)).map_err(|e| {
        log::error!("[Codex] 构建 Responses 错误响应失败: {e}");
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
}

// ============================================================================
// Gemini API 处理器
// ============================================================================

/// 处理 Gemini API 请求（透传，包括查询参数）
pub async fn handle_gemini(
    State(state): State<ProxyState>,
    uri: axum::http::Uri,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let method = parts.method.clone();
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    // GET 类只读端点（/v1beta/models、/v1beta/models/<model> 等）没有请求体，
    // 不能强制 parse 为 JSON —— 否则空 body 会被拒绝。
    let body: Value = if body_bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body_bytes)
            .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?
    };

    // Gemini 的模型名称在 URI 中
    let mut ctx = RequestContext::new(&state, &body, &headers, AppType::Gemini, "Gemini", "gemini")
        .await?
        .with_model_from_uri(&uri);

    // 提取完整的路径和查询参数
    let endpoint = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(uri.path());

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let mut result = match forwarder
        .forward_with_retry(
            &AppType::Gemini,
            method,
            endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    let connection_guard = result.connection_guard.take();
    ctx.provider = result.provider;
    let response = result.response;

    process_response(
        response,
        &ctx,
        &state,
        &GEMINI_PARSER_CONFIG,
        connection_guard,
        is_stream,
    )
    .await
}

fn should_use_claude_transform_streaming(
    requested_streaming: bool,
    upstream_is_sse: bool,
    api_format: &str,
    is_codex_oauth: bool,
) -> bool {
    requested_streaming || upstream_is_sse || (is_codex_oauth && api_format == "openai_responses")
}

/// 把 OpenAI Responses SSE 流聚合成一个完整的 Responses JSON 对象，供下游转成 Anthropic
/// 非流响应。仅在 Codex OAuth 把 `stream:false` 强制升级为 SSE 的场景下调用。
///
/// 复用 `proxy::sse` 的 `take_sse_block`/`strip_sse_field`：`take_sse_block` 同时支持
/// `\n\n` 与 `\r\n\r\n` 两种分隔符，`strip_sse_field` 兼容带/不带空格的字段写法。
fn responses_sse_to_response_value(body: &str) -> Result<Value, ProxyError> {
    let mut buffer = body.to_string();
    let mut completed_response: Option<Value> = None;
    let mut output_items = Vec::new();

    while let Some(block) = take_sse_block(&mut buffer) {
        let mut event_name = "";
        let mut data_lines: Vec<&str> = Vec::new();

        for line in block.lines() {
            if let Some(evt) = strip_sse_field(line, "event") {
                event_name = evt.trim();
            } else if let Some(d) = strip_sse_field(line, "data") {
                data_lines.push(d);
            }
        }

        if data_lines.is_empty() {
            continue;
        }

        let data_str = data_lines.join("\n");
        if data_str.trim() == "[DONE]" {
            continue;
        }

        let data: Value = serde_json::from_str(&data_str).map_err(|e| {
            ProxyError::TransformError(format!("Failed to parse upstream SSE event: {e}"))
        })?;

        match event_name {
            "response.output_item.done" => {
                if let Some(item) = data.get("item") {
                    output_items.push(item.clone());
                }
            }
            "response.completed" => {
                completed_response = Some(data.get("response").cloned().unwrap_or(data));
            }
            "response.failed" => {
                let message = data
                    .pointer("/response/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("response.failed event received");
                return Err(ProxyError::TransformError(message.to_string()));
            }
            _ => {}
        }
    }

    let mut response = completed_response.ok_or_else(|| {
        ProxyError::TransformError("No response.completed event in upstream SSE".to_string())
    })?;

    if !output_items.is_empty() {
        if let Some(obj) = response.as_object_mut() {
            obj.insert("output".to_string(), Value::Array(output_items));
        } else {
            return Err(ProxyError::TransformError(
                "response.completed payload is not an object".to_string(),
            ));
        }
    }

    Ok(response)
}

// ============================================================================
// 使用量记录（保留用于 Claude 转换逻辑）
// ============================================================================

fn log_forward_error(
    state: &ProxyState,
    ctx: &RequestContext,
    is_streaming: bool,
    error: &ProxyError,
) {
    use super::usage::logger::UsageLogger;

    let logger = UsageLogger::new(&state.db);
    let status_code = map_proxy_error_to_status(error);
    let error_message = get_error_message(error);
    let request_id = uuid::Uuid::new_v4().to_string();

    if let Err(e) = logger.log_error_with_context(
        request_id,
        ctx.provider.id.clone(),
        ctx.app_type_str.to_string(),
        ctx.request_model.clone(),
        status_code,
        error_message,
        ctx.latency_ms(),
        is_streaming,
        Some(ctx.session_id.clone()),
        None,
    ) {
        log::warn!("记录失败请求日志失败: {e}");
    }
}

/// 记录请求使用量
#[allow(clippy::too_many_arguments)]
async fn log_usage(
    state: &ProxyState,
    provider_id: &str,
    app_type: &str,
    model: &str,
    request_model: &str,
    usage: TokenUsage,
    latency_ms: u64,
    first_token_ms: Option<u64>,
    is_streaming: bool,
    status_code: u16,
    session_id: Option<String>,
) {
    use super::usage::logger::UsageLogger;

    if !usage_logging_enabled(state) {
        return;
    }

    let logger = UsageLogger::new(&state.db);

    let (multiplier, pricing_model_source) =
        logger.resolve_pricing_config(provider_id, app_type).await;
    let pricing_model = if pricing_model_source == PRICING_SOURCE_REQUEST {
        request_model
    } else {
        model
    };

    let request_id = usage.dedup_request_id();

    if let Err(e) = logger.log_with_calculation(
        request_id,
        provider_id.to_string(),
        app_type.to_string(),
        model.to_string(),
        request_model.to_string(),
        pricing_model.to_string(),
        usage,
        multiplier,
        latency_ms,
        first_token_ms,
        status_code,
        session_id,
        None, // provider_type
        is_streaming,
    ) {
        log::warn!("[USG-001] 记录使用量失败: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_api_status_response, build_provider_quota, get_api_status, is_claude_oauth_provider,
        is_codex_oauth_provider, live_quota_refresh_call_count,
        refresh_claude_quota_snapshots_with_query,
        refresh_claude_quota_snapshots_with_query_and_refresher,
        refresh_codex_quota_snapshots_with_query_and_refresher,
        reset_live_quota_refresh_call_count, responses_sse_to_response_value,
        should_use_claude_transform_streaming,
    };
    use crate::app_config::AppType;
    use crate::database::Database;
    use crate::provider::Provider;
    use crate::proxy::{
        failover_switch::FailoverSwitchManager,
        handler_context::RequestContext,
        provider_router::ProviderRouter,
        providers::{
            claude_oauth_store::save_claude_auth_for_provider, gemini_shadow::GeminiShadowStore,
        },
        rate_limit::{new_rate_limit_store, BalanceSnapshot, RateLimitSnapshot, RateLimitWindow},
        server::ProxyState,
        types::{ProxyConfig, ProxyStatus},
        ProxyError,
    };
    use crate::services::oauth_refresh::storage::{
        load_claude_refresh_auth_for_provider, load_codex_refresh_auth_for_provider,
    };
    use crate::services::oauth_refresh::{
        ClaudeUploadedAuthManager, OAuthRefreshError, OAuthRefreshLockManager, OAuthTokenRefresher,
        RefreshedCredentials,
    };
    use crate::services::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};
    use axum::extract::State;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use serial_test::serial;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;
    use tokio::sync::RwLock;

    #[test]
    fn codex_oauth_responses_force_streaming_even_if_client_sent_false() {
        assert!(should_use_claude_transform_streaming(
            false,
            false,
            "openai_responses",
            true,
        ));
    }

    #[test]
    fn upstream_sse_response_always_uses_streaming_path() {
        assert!(should_use_claude_transform_streaming(
            false,
            true,
            "openai_chat",
            false,
        ));
    }

    #[test]
    fn non_streaming_response_stays_non_streaming_for_regular_openai_responses() {
        assert!(!should_use_claude_transform_streaming(
            false,
            false,
            "openai_responses",
            false,
        ));
    }

    #[test]
    fn responses_sse_to_response_value_collects_output_items() {
        let sse = r#"event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_1");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hello");
    }

    #[test]
    fn responses_sse_to_response_value_handles_crlf_delimiters() {
        // 真实 HTTP SSE 按规范使用 \r\n\r\n 分隔事件；take_sse_block 必须同时处理两种分隔符，
        // 否则此路径在任何标准上游（含 Codex OAuth HTTPS 后端）下都会 TransformError。
        let sse = "event: response.output_item.done\r\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hi\"}]}}\r\n\
\r\n\
event: response.completed\r\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_crlf\",\"status\":\"completed\",\"model\":\"gpt-5.4\",\"output\":[],\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}\r\n\
\r\n";

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_crlf");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hi");
    }

    #[test]
    fn responses_sse_to_response_value_returns_err_on_response_failed() {
        let sse = "event: response.failed\n\
data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"upstream blew up\"}}}\n\n";

        let err = responses_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => assert!(msg.contains("upstream blew up")),
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn responses_sse_to_response_value_errors_when_no_completed_event() {
        let sse = "event: response.output_item.done\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\"}}\n\n";

        assert!(responses_sse_to_response_value(sse).is_err());
    }

    #[test]
    fn official_codex_seed_counts_as_codex_oauth_provider() {
        let provider = Provider::with_id(
            "codex-official".to_string(),
            "OpenAI Official".to_string(),
            json!({ "auth": {}, "config": "" }),
            None,
        );

        assert!(is_codex_oauth_provider(&provider));
    }

    #[test]
    fn claude_oauth_mode_counts_as_claude_oauth_provider() {
        let provider = Provider::with_id(
            "claude-oauth".to_string(),
            "Claude Official".to_string(),
            json!({ "auth_mode": "claude_oauth", "env": {} }),
            None,
        );

        assert!(is_claude_oauth_provider(&provider));
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        _tmp: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
        original_data_dir: Option<String>,
    }

    impl TestEnv {
        fn new() -> Self {
            let guard = env_lock()
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let tmp = TempDir::new().expect("create temp dir");
            let home = tmp.path().join("home");
            let data = tmp.path().join("data");

            std::fs::create_dir_all(&home).expect("create home");
            std::fs::create_dir_all(&data).expect("create data");

            let original_home = std::env::var("HOME").ok();
            let original_userprofile = std::env::var("USERPROFILE").ok();
            let original_test_home = std::env::var("CC_SWITCH_TEST_HOME").ok();
            let original_data_dir = std::env::var("CC_SWITCH_DATA_DIR").ok();

            std::env::set_var("HOME", &home);
            std::env::set_var("USERPROFILE", &home);
            std::env::set_var("CC_SWITCH_TEST_HOME", &home);
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);

            Self {
                _guard: guard,
                _tmp: tmp,
                original_home,
                original_userprofile,
                original_test_home,
                original_data_dir,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            match &self.original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match &self.original_userprofile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            match &self.original_test_home {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            match &self.original_data_dir {
                Some(value) => std::env::set_var("CC_SWITCH_DATA_DIR", value),
                None => std::env::remove_var("CC_SWITCH_DATA_DIR"),
            }
            let _ = crate::settings::reload_settings();
        }
    }

    fn test_proxy_state(db: Arc<Database>) -> ProxyState {
        let current_providers = Arc::new(RwLock::new(HashMap::new()));

        ProxyState {
            db: db.clone(),
            config: Arc::new(RwLock::new(ProxyConfig::default())),
            status: Arc::new(RwLock::new(ProxyStatus::default())),
            start_time: Arc::new(RwLock::new(None)),
            current_providers: current_providers.clone(),
            provider_router: Arc::new(ProviderRouter::new(db.clone())),
            gemini_shadow: Arc::new(GeminiShadowStore::default()),
            copilot_auth: None,
            codex_oauth_auth: None,
            failover_manager: Arc::new(FailoverSwitchManager::new(db, current_providers)),
            rate_limits: new_rate_limit_store(),
            quota_snapshot_cache: crate::proxy::quota_cache::RateLimitSnapshotCache::new(),
            claude_uploaded_auth: ClaudeUploadedAuthManager::new(),
            oauth_refresh_locks: OAuthRefreshLockManager::new(),
            #[cfg(feature = "tauri-desktop")]
            app_handle: None,
        }
    }

    fn claude_provider(provider_id: &str, auth_mode: &str, name: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            name.to_string(),
            json!({
                "auth_mode": auth_mode,
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
                }
            }),
            None,
        )
    }

    fn codex_provider(provider_id: &str, auth_mode: &str, name: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            name.to_string(),
            json!({
                "auth_mode": auth_mode,
                "env": {}
            }),
            None,
        )
    }

    fn test_provider(provider_id: &str, name: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            name.to_string(),
            json!({ "env": {} }),
            None,
        )
    }

    async fn set_proxy_flags(
        db: &Database,
        app_type: &str,
        enabled: bool,
        auto_failover_enabled: bool,
    ) {
        let mut config = db
            .get_proxy_config_for_app(app_type)
            .await
            .expect("proxy config");
        config.enabled = enabled;
        config.auto_failover_enabled = auto_failover_enabled;
        db.update_proxy_config_for_app(config)
            .await
            .expect("update proxy config");
    }

    async fn set_circuit_failure_threshold(db: &Database, app_type: &str, threshold: u32) {
        let mut config = db
            .get_proxy_config_for_app(app_type)
            .await
            .expect("proxy config");
        config.circuit_failure_threshold = threshold;
        db.update_proxy_config_for_app(config)
            .await
            .expect("update proxy config");
    }

    async fn status_response(state: &ProxyState) -> crate::proxy::types::ApiStatusResponse {
        build_api_status_response(state)
            .await
            .expect("build api status")
    }

    #[tokio::test]
    async fn disabled_app_proxy_rejects_requests_before_provider_selection() {
        let db = Arc::new(Database::memory().expect("database"));
        db.save_provider("claude", &test_provider("claude-primary", "Claude Primary"))
            .expect("save claude provider");
        db.add_to_failover_queue("claude", "claude-primary")
            .expect("queue claude provider");
        set_proxy_flags(&db, "claude", false, true).await;
        let state = test_proxy_state(db);

        let result = RequestContext::new(
            &state,
            &json!({ "model": "claude-opus-4-7", "messages": [] }),
            &axum::http::HeaderMap::new(),
            AppType::Claude,
            "Claude",
            "claude",
        )
        .await;

        assert!(matches!(result, Err(ProxyError::ProxyDisabled(app)) if app == "claude"));
        assert!(
            state
                .provider_router
                .get_circuit_breaker_stats("claude-primary", "claude")
                .await
                .is_none(),
            "disabled app must stop before provider selection creates circuit state"
        );
        assert!(
            state
                .db
                .list_provider_health_records("claude")
                .await
                .expect("health records")
                .is_empty(),
            "disabled app must not update provider health"
        );
    }

    #[tokio::test]
    async fn disabled_app_proxy_does_not_affect_other_apps() {
        let db = Arc::new(Database::memory().expect("database"));
        db.save_provider("codex", &test_provider("codex-primary", "Codex Primary"))
            .expect("save codex provider");
        db.add_to_failover_queue("codex", "codex-primary")
            .expect("queue codex provider");
        set_proxy_flags(&db, "claude", false, true).await;
        set_proxy_flags(&db, "codex", true, true).await;
        let state = test_proxy_state(db);

        let result = RequestContext::new(
            &state,
            &json!({ "model": "gpt-5.4", "messages": [] }),
            &axum::http::HeaderMap::new(),
            AppType::Codex,
            "Codex",
            "codex",
        )
        .await;

        let context = result.expect("enabled codex app should still build a request context");
        assert_eq!(context.provider.id, "codex-primary");
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_usage_log(
        db: &Database,
        request_id: &str,
        provider_id: &str,
        app_type: &str,
        input_tokens: u64,
        output_tokens: u64,
        cache_creation_tokens: u64,
        cache_read_tokens: u64,
        total_cost: &str,
        latency_ms: u64,
        status_code: u16,
        created_at: i64,
    ) {
        let conn = db.conn.lock().expect("db lock");
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                total_cost_usd, latency_ms, status_code, created_at
            ) VALUES (?1, ?2, ?3, 'test-model', 'requested-model',
                ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                request_id,
                provider_id,
                app_type,
                input_tokens as i64,
                output_tokens as i64,
                cache_read_tokens as i64,
                cache_creation_tokens as i64,
                total_cost,
                latency_ms as i64,
                status_code as i64,
                created_at,
            ],
        )
        .expect("insert usage log");
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_rollup(
        db: &Database,
        date: &str,
        provider_id: &str,
        app_type: &str,
        request_count: u64,
        success_count: u64,
        input_tokens: u64,
        output_tokens: u64,
        total_cost: &str,
        avg_latency_ms: u64,
    ) {
        let conn = db.conn.lock().expect("db lock");
        conn.execute(
            "INSERT OR REPLACE INTO usage_daily_rollups (
                date, app_type, provider_id, model, request_count, success_count,
                input_tokens, output_tokens, total_cost_usd, avg_latency_ms
            ) VALUES (?1, ?2, ?3, 'test-model', ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                date,
                app_type,
                provider_id,
                request_count as i64,
                success_count as i64,
                input_tokens as i64,
                output_tokens as i64,
                total_cost,
                avg_latency_ms as i64,
            ],
        )
        .expect("insert rollup");
    }

    fn insert_provider_health(
        db: &Database,
        provider_id: &str,
        app_type: &str,
        is_healthy: bool,
        consecutive_failures: u32,
        last_success_at: Option<&str>,
        last_failure_at: Option<&str>,
        last_error: Option<&str>,
        updated_at: &str,
    ) {
        let conn = db.conn.lock().expect("db lock");
        conn.execute(
            "INSERT OR REPLACE INTO provider_health (
                provider_id, app_type, is_healthy, consecutive_failures,
                last_success_at, last_failure_at, last_error, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                provider_id,
                app_type,
                is_healthy as i64,
                consecutive_failures as i64,
                last_success_at,
                last_failure_at,
                last_error,
                updated_at,
            ],
        )
        .expect("insert provider health");
    }

    fn quota_snapshot(app_type: &str, provider_id: &str, provider_name: &str) -> RateLimitSnapshot {
        RateLimitSnapshot {
            app_type: app_type.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider_name.to_string(),
            source: Some("subscription_quota".to_string()),
            status: Some("allowed".to_string()),
            windows: vec![RateLimitWindow {
                name: "five_hour".to_string(),
                status: None,
                utilization: Some(0.42),
                reset: Some(4_102_444_800),
            }],
            representative_claim: Some("claim".to_string()),
            overage_status: Some("allowed".to_string()),
            fallback_percentage: Some(0.5),
            requests_limit: Some(100),
            requests_remaining: Some(20),
            tokens_limit: Some(10_000),
            tokens_remaining: Some(5_000),
            balances: Some(vec![BalanceSnapshot {
                plan_name: Some("pro".to_string()),
                currency: Some("USD".to_string()),
                total: Some(20.0),
                used: Some(5.0),
                remaining: Some(15.0),
                is_valid: Some(true),
                invalid_message: None,
            }]),
            captured_at: 1_777_971_123_456,
        }
    }

    fn make_jwt(payload: serde_json::Value) -> String {
        format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(payload.to_string())
        )
    }

    fn sample_claude_auth_json(expires_at_ms: i64) -> Vec<u8> {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-uploaded",
                "refreshToken": "refresh-token",
                "expiresAt": expires_at_ms,
                "scopes": ["user:profile"],
                "subscriptionType": "pro"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_codex_auth_json(exp_secs: i64) -> Vec<u8> {
        serde_json::json!({
            "tokens": {
                "access_token": make_jwt(json!({
                    "exp": exp_secs,
                    "https://api.openai.com/auth": {
                        "chatgpt_account_id": "acc-123"
                    }
                })),
                "refresh_token": "refresh-token",
                "account_id": "acc-123"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_quota(tool: &str, tier_name: &str, utilization: f64) -> SubscriptionQuota {
        SubscriptionQuota {
            tool: tool.to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![QuotaTier {
                name: tier_name.to_string(),
                utilization,
                resets_at: Some("2026-04-30T12:00:00Z".to_string()),
            }],
            extra_usage: None,
            error: None,
            queried_at: Some(chrono::Utc::now().timestamp_millis()),
        }
    }

    #[tokio::test]
    async fn api_status_empty_db_includes_supported_apps_with_empty_state() {
        let db = Arc::new(Database::memory().expect("db"));
        let state = test_proxy_state(db);

        let response = status_response(&state).await;

        for app_key in ["claude", "codex", "gemini"] {
            let app = response.apps.get(app_key).expect("supported app");
            assert_eq!(app.health, None);
            assert_eq!(app.health_reason, "no_provider_configured");
            assert_eq!(app.active_provider, None);
            assert!(app.providers.is_empty());
            assert!(app.failover_queue.is_empty());
            assert!(app.failover_status.is_empty());
        }
    }

    #[tokio::test]
    #[serial]
    async fn api_status_normal_mode_uses_settings_active_provider_and_skips_non_active() {
        let _env = TestEnv::new();
        crate::settings::reload_settings().expect("reload test settings");
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("p1", "Provider One"))
            .expect("save p1");
        db.save_provider("claude", &test_provider("p2", "Provider Two"))
            .expect("save p2");
        db.set_current_provider("claude", "p1").expect("db current");
        crate::settings::set_current_provider(&AppType::Claude, Some("p2"))
            .expect("settings current");
        set_proxy_flags(&db, "claude", true, false).await;

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");

        assert_eq!(app.mode, "normal");
        assert_eq!(
            app.active_provider
                .as_ref()
                .map(|provider| provider.provider_id.as_str()),
            Some("p2")
        );
        assert_eq!(
            app.failover_status["p2"].current_role, "active",
            "settings-selected provider should be active"
        );
        assert_eq!(app.failover_status["p1"].current_role, "skipped");
        assert!(app.failover_status["p1"]
            .unavailable_reasons
            .contains(&"not_active_in_normal_mode".to_string()));
    }

    #[tokio::test]
    async fn api_status_provider_view_includes_endpoint_and_icon_metadata() {
        let db = Arc::new(Database::memory().expect("db"));
        let mut provider = Provider::with_id(
            "p_meta".to_string(),
            "Provider Metadata".to_string(),
            json!({
                "base_url": "https://example.test/v1",
                "tokenField": "apiKey"
            }),
            None,
        );
        provider.icon = Some("custom-provider".to_string());
        provider.icon_color = Some("#336699".to_string());
        db.save_provider("claude", &provider)
            .expect("save provider");
        db.save_provider(
            "claude",
            &Provider::with_id(
                "p_env".to_string(),
                "Provider Env".to_string(),
                json!({
                    "env": {
                        "ANTHROPIC_BASE_URL": "https://env.example.test",
                        "ANTHROPIC_API_KEY": "sk-test"
                    }
                }),
                None,
            ),
        )
        .expect("save env provider");
        db.set_current_provider("claude", "p_meta")
            .expect("set current");
        set_proxy_flags(&db, "claude", true, false).await;

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");
        let provider_view = app.providers.get("p_meta").expect("provider view");

        assert_eq!(provider_view.base_url, "https://example.test/v1");
        assert_eq!(provider_view.icon.as_deref(), Some("custom-provider"));
        assert_eq!(provider_view.icon_color.as_deref(), Some("#336699"));
        assert_eq!(provider_view.token_field, "apiKey");

        let env_provider_view = app.providers.get("p_env").expect("env provider view");
        assert_eq!(env_provider_view.base_url, "https://env.example.test");
        assert_eq!(env_provider_view.token_field, "ANTHROPIC_API_KEY");

        let serialized = serde_json::to_value(provider_view).expect("serialize provider view");
        assert_eq!(serialized["baseUrl"], "https://example.test/v1");
        assert_eq!(serialized["icon"], "custom-provider");
        assert_eq!(serialized["iconColor"], "#336699");
        assert_eq!(serialized["tokenField"], "apiKey");
        assert!(serialized.get("base_url").is_none());
        assert!(serialized.get("icon_color").is_none());
        assert!(serialized.get("token_field").is_none());
    }

    #[tokio::test]
    async fn api_status_failover_mode_uses_queue_order_and_roles() {
        let db = Arc::new(Database::memory().expect("db"));
        let desired_order = ["p_charlie", "p_alpha", "p_delta", "p_bravo"];
        for (provider_id, sort_index) in [
            ("p_bravo", 3),
            ("p_unqueued", 4),
            ("p_delta", 2),
            ("p_alpha", 1),
            ("p_charlie", 0),
        ] {
            let mut provider = test_provider(provider_id, provider_id);
            provider.sort_index = Some(sort_index);
            db.save_provider("claude", &provider)
                .expect("save provider");
        }
        db.set_current_provider("claude", "p_charlie")
            .expect("set current");
        for provider_id in desired_order {
            db.add_to_failover_queue("claude", provider_id)
                .expect("queue provider");
        }
        set_proxy_flags(&db, "claude", true, true).await;

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");

        assert_eq!(app.mode, "failover");
        let observed_order = app
            .failover_queue
            .iter()
            .map(|item| item.provider_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(observed_order, desired_order);
        for (position, provider_id) in desired_order.iter().enumerate() {
            assert_eq!(app.failover_queue[position].position, position);
            assert_eq!(
                app.failover_status[*provider_id].queue_position,
                Some(position)
            );
        }
        assert_eq!(app.failover_status["p_charlie"].current_role, "active");
        assert_eq!(app.failover_status["p_alpha"].current_role, "standby");
        assert_eq!(app.failover_status["p_delta"].current_role, "standby");
        assert_eq!(app.failover_status["p_bravo"].current_role, "standby");
        assert!(!app
            .failover_queue
            .iter()
            .any(|item| item.provider_id == "p_unqueued"));
        assert_eq!(app.failover_status["p_unqueued"].current_role, "skipped");
        assert!(app.failover_status["p_unqueued"]
            .unavailable_reasons
            .contains(&"not_in_failover_queue".to_string()));
    }

    #[tokio::test]
    async fn api_status_failover_role_follows_resolved_active_provider() {
        let db = Arc::new(Database::memory().expect("db"));
        for provider_id in ["p_primary", "p_failover"] {
            db.save_provider("claude", &test_provider(provider_id, provider_id))
                .expect("save provider");
            db.add_to_failover_queue("claude", provider_id)
                .expect("queue provider");
        }
        db.set_current_provider("claude", "p_failover")
            .expect("set current");
        set_proxy_flags(&db, "claude", true, true).await;

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");

        assert_eq!(
            app.active_provider
                .as_ref()
                .map(|provider| provider.provider_id.as_str()),
            Some("p_failover")
        );
        assert_eq!(app.failover_status["p_primary"].current_role, "standby");
        assert_eq!(app.failover_status["p_failover"].current_role, "active");
    }

    #[tokio::test]
    async fn api_status_provider_health_maps_observed_and_missing_rows() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("observed", "Observed"))
            .expect("save observed");
        db.save_provider("claude", &test_provider("missing", "Missing"))
            .expect("save missing");
        db.set_current_provider("claude", "observed")
            .expect("set current");
        set_proxy_flags(&db, "claude", true, false).await;
        insert_provider_health(
            &db,
            "observed",
            "claude",
            false,
            4,
            Some("2026-05-05T10:00:00Z"),
            Some("2026-05-05T11:00:00Z"),
            Some("upstream 500"),
            "2026-05-05T11:00:00Z",
        );

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");
        let observed = &app.failover_status["observed"].health;
        let missing = &app.failover_status["missing"].health;

        assert!(observed.observed);
        assert!(!observed.healthy);
        assert_eq!(observed.consecutive_failures, 4);
        assert_eq!(
            observed.last_success_at.as_deref(),
            Some("2026-05-05T10:00:00Z")
        );
        assert_eq!(
            observed.last_failure_at.as_deref(),
            Some("2026-05-05T11:00:00Z")
        );
        assert_eq!(observed.last_error.as_deref(), Some("upstream 500"));
        assert_eq!(observed.updated_at.as_deref(), Some("2026-05-05T11:00:00Z"));

        assert!(!missing.observed);
        assert!(missing.healthy);
        assert_eq!(missing.updated_at, None);
        assert_eq!(missing.last_success_at, None);
        assert_eq!(missing.last_failure_at, None);
    }

    #[tokio::test]
    async fn api_status_circuit_stats_map_observed_and_missing_breakers() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("open", "Open Circuit"))
            .expect("save open provider");
        db.save_provider("claude", &test_provider("missing", "Missing Circuit"))
            .expect("save missing provider");
        db.set_current_provider("claude", "open")
            .expect("set current");
        set_proxy_flags(&db, "claude", true, false).await;
        set_circuit_failure_threshold(&db, "claude", 1).await;

        let state = test_proxy_state(db);
        state
            .provider_router
            .record_result("open", "claude", false, false, Some("boom".to_string()))
            .await
            .expect("record failure");

        let response = status_response(&state).await;
        let app = response.apps.get("claude").expect("claude app");
        let open = &app.failover_status["open"].circuit;
        let missing = &app.failover_status["missing"].circuit;

        assert!(open.observed);
        assert_eq!(open.state.as_deref(), Some("open"));
        assert_eq!(open.total_requests, Some(1));
        assert_eq!(open.failed_requests, Some(1));
        assert!(!missing.observed);
        assert_eq!(missing.state, None);
        assert_eq!(missing.total_requests, None);
        assert_eq!(missing.failed_requests, None);
    }

    #[test]
    fn api_status_quota_mapping_trims_identity_and_uses_camel_case() {
        let snapshot = quota_snapshot("claude", "quota-provider", "Quota Provider");
        let quota = build_provider_quota(Some(&snapshot)).expect("quota");
        let value = serde_json::to_value(&quota).expect("serialize quota");

        assert_eq!(value["source"], "subscription_quota");
        assert_eq!(value["representativeClaim"], "claim");
        assert_eq!(value["overageStatus"], "allowed");
        assert_eq!(value["fallbackPercentage"], 0.5);
        assert_eq!(value["requestsLimit"], 100);
        assert_eq!(value["requestsRemaining"], 20);
        assert_eq!(value["tokensLimit"], 10_000);
        assert_eq!(value["tokensRemaining"], 5_000);
        assert_eq!(value["capturedAt"], 1_777_971_123_456i64);
        assert_eq!(value["windows"][0]["name"], "five_hour");
        assert_eq!(value["balances"][0]["planName"], "pro");
        assert_eq!(value["balances"][0]["isValid"], true);
        assert!(value.get("appType").is_none());
        assert!(value.get("providerId").is_none());
        assert!(value.get("providerName").is_none());
    }

    #[tokio::test]
    async fn api_status_quota_exhaustion_sets_gate_and_reset() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("quota", "Quota Provider"))
            .expect("save provider");
        db.set_current_provider("claude", "quota")
            .expect("set current");
        set_proxy_flags(&db, "claude", true, false).await;
        let state = test_proxy_state(db);
        let reset_at = chrono::Utc::now().timestamp() + 3600;
        let mut snapshot = quota_snapshot("claude", "quota", "Quota Provider");
        snapshot.requests_remaining = Some(0);
        snapshot.windows[0].reset = Some(reset_at);
        state
            .rate_limits
            .write()
            .await
            .insert("quota".to_string(), snapshot);

        let response = status_response(&state).await;
        let quota = &response.apps["claude"].failover_status["quota"].quota;

        assert!(quota.exhausted);
        assert_eq!(quota.reset_at, Some(reset_at));
        assert!(response.apps["claude"].failover_status["quota"]
            .unavailable_reasons
            .contains(&"quota_exhausted".to_string()));
    }

    #[tokio::test]
    async fn api_status_refreshes_live_quota_snapshots_before_rendering() {
        reset_live_quota_refresh_call_count();
        let db = Arc::new(Database::memory().expect("db"));
        let state = test_proxy_state(db);

        let _response = get_api_status(State(state)).await.expect("api status");

        assert_eq!(
            live_quota_refresh_call_count(),
            4,
            "/api/status should run the same cached quota refresh pass as /api/quota"
        );
    }

    #[tokio::test]
    async fn api_status_usage_mapping_preserves_summary_fields_and_window() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("usage", "Usage Provider"))
            .expect("save provider");
        db.set_current_provider("claude", "usage")
            .expect("set current");
        insert_usage_log(
            &db,
            "usage-success",
            "usage",
            "claude",
            100,
            50,
            5,
            7,
            "1.234567",
            100,
            200,
            100,
        );
        insert_usage_log(
            &db,
            "usage-fail",
            "usage",
            "claude",
            20,
            10,
            2,
            3,
            "0.000001",
            200,
            500,
            101,
        );

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let usage = &response.apps["claude"].usage;

        assert_eq!(usage.window.preset, "all_time");
        assert_eq!(usage.window.start, None);
        assert_eq!(usage.window.end, None);
        assert_eq!(usage.total_requests, 2);
        assert_eq!(usage.total_cost, "1.234568");
        assert_eq!(usage.total_input_tokens, 120);
        assert_eq!(usage.total_output_tokens, 60);
        assert_eq!(usage.total_cache_creation_tokens, 7);
        assert_eq!(usage.total_cache_read_tokens, 10);
        assert_eq!(usage.success_rate, 50.0);
    }

    #[tokio::test]
    async fn api_status_usage_scope_is_all_time() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("codex", &test_provider("ancient", "Ancient Provider"))
            .expect("save provider");
        insert_usage_log(
            &db,
            "ancient-log",
            "ancient",
            "codex",
            1,
            2,
            0,
            0,
            "0.010000",
            10,
            200,
            1,
        );

        let state = test_proxy_state(db);
        let response = status_response(&state).await;

        assert_eq!(response.apps["codex"].usage.total_requests, 1);
        assert_eq!(response.apps["codex"].usage.total_cost, "0.010000");
    }

    #[tokio::test]
    async fn api_status_provider_stats_mapping_omits_duplicate_identity() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("stats", "Stats Provider"))
            .expect("save provider");
        insert_usage_log(
            &db,
            "stats-success",
            "stats",
            "claude",
            100,
            50,
            0,
            0,
            "1.000000",
            100,
            200,
            100,
        );
        insert_usage_log(
            &db,
            "stats-fail",
            "stats",
            "claude",
            20,
            10,
            0,
            0,
            "2.000000",
            200,
            500,
            101,
        );

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let stats = response.apps["claude"].providers["stats"]
            .stats
            .as_ref()
            .expect("provider stats");
        let value = serde_json::to_value(stats).expect("serialize stats");

        assert_eq!(stats.request_count, 2);
        assert_eq!(stats.total_tokens, 180);
        assert_eq!(stats.total_cost, "3.000000");
        assert_eq!(stats.success_rate, 50.0);
        assert_eq!(stats.avg_latency_ms, 150);
        assert_eq!(value["requestCount"], 2);
        assert_eq!(value["totalTokens"], 180);
        assert!(value.get("providerId").is_none());
        assert!(value.get("providerName").is_none());
    }

    #[tokio::test]
    async fn api_status_provider_with_no_stats_keeps_provider_with_null_stats() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("gemini", &test_provider("no-stats", "No Stats"))
            .expect("save provider");

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let provider = response.apps["gemini"]
            .providers
            .get("no-stats")
            .expect("configured provider");

        assert_eq!(provider.name, "No Stats");
        assert!(provider.configured);
        assert_eq!(provider.stats, None);
    }

    #[tokio::test]
    async fn api_status_duplicate_provider_names_are_keyed_by_provider_id() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider("claude", &test_provider("dup-a", "Duplicate"))
            .expect("save dup a");
        db.save_provider("claude", &test_provider("dup-b", "Duplicate"))
            .expect("save dup b");

        let state = test_proxy_state(db);
        let response = status_response(&state).await;
        let app = &response.apps["claude"];

        assert_eq!(app.providers["dup-a"].name, "Duplicate");
        assert_eq!(app.providers["dup-b"].name, "Duplicate");
        assert!(app.failover_status.contains_key("dup-a"));
        assert!(app.failover_status.contains_key("dup-b"));
    }

    #[tokio::test]
    #[serial]
    async fn api_status_has_no_failover_active_health_circuit_or_quota_refresh_side_effects() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "codex",
            &codex_provider("codex-oauth", "codex_oauth", "Codex OAuth"),
        )
        .expect("save codex provider");
        db.save_provider(
            "codex",
            &codex_provider("codex-standby", "codex_oauth", "Codex Standby"),
        )
        .expect("save standby provider");
        db.set_current_provider("codex", "codex-oauth")
            .expect("set current");
        db.add_to_failover_queue("codex", "codex-oauth")
            .expect("queue provider");
        db.add_to_failover_queue("codex", "codex-standby")
            .expect("queue standby");
        set_proxy_flags(&db, "codex", true, true).await;

        let state = test_proxy_state(db.clone());
        state
            .provider_router
            .record_result("codex-oauth", "codex", false, true, None)
            .await
            .expect("seed circuit and health");
        state
            .provider_router
            .record_result("codex-standby", "codex", false, true, None)
            .await
            .expect("seed standby circuit and health");
        {
            let mut store = state.rate_limits.write().await;
            store.insert(
                "codex-oauth".to_string(),
                quota_snapshot("codex", "codex-oauth", "Codex OAuth"),
            );
            store.insert(
                "codex-standby".to_string(),
                quota_snapshot("codex", "codex-standby", "Codex Standby"),
            );
        }

        let provider_ids = ["codex-oauth", "codex-standby"];
        reset_live_quota_refresh_call_count();
        let current_before = db.get_current_provider("codex").expect("current before");
        let queue_before =
            serde_json::to_value(db.get_failover_queue("codex").expect("queue before"))
                .expect("serialize queue before");
        let health_before = serde_json::to_value(
            futures::future::join_all(
                provider_ids
                    .iter()
                    .map(|provider_id| db.get_provider_health(provider_id, "codex")),
            )
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .expect("health before"),
        )
        .expect("serialize health before");
        let circuit_before = serde_json::to_value(
            futures::future::join_all(provider_ids.iter().map(|provider_id| {
                state
                    .provider_router
                    .get_circuit_breaker_stats(provider_id, "codex")
            }))
            .await,
        )
        .expect("serialize circuit before");
        let quota_store_before = serde_json::to_value(state.rate_limits.read().await.clone())
            .expect("serialize quota store before");
        let refresh_calls_before = live_quota_refresh_call_count();

        let _response = status_response(&state).await;

        assert_eq!(
            db.get_current_provider("codex").expect("current after"),
            current_before
        );
        assert_eq!(
            serde_json::to_value(db.get_failover_queue("codex").expect("queue after"))
                .expect("serialize queue after"),
            queue_before
        );
        assert_eq!(
            serde_json::to_value(
                futures::future::join_all(
                    provider_ids
                        .iter()
                        .map(|provider_id| { db.get_provider_health(provider_id, "codex") })
                )
                .await
                .into_iter()
                .collect::<Result<Vec<_>, _>>()
                .expect("health after"),
            )
            .expect("serialize health after"),
            health_before
        );
        assert_eq!(
            serde_json::to_value(
                futures::future::join_all(provider_ids.iter().map(|provider_id| {
                    state
                        .provider_router
                        .get_circuit_breaker_stats(provider_id, "codex")
                }))
                .await,
            )
            .expect("serialize circuit after"),
            circuit_before
        );
        assert_eq!(
            serde_json::to_value(state.rate_limits.read().await.clone())
                .expect("serialize quota store after"),
            quota_store_before,
            "status endpoint must not mutate quota snapshots"
        );
        assert_eq!(
            live_quota_refresh_call_count(),
            refresh_calls_before,
            "status endpoint must not invoke live quota refresh helpers"
        );
    }

    #[tokio::test]
    async fn api_status_seeded_usage_across_supported_apps_completes_within_poll_budget() {
        const PROVIDERS_PER_APP: usize = 4;
        const REQUEST_LOGS_PER_PROVIDER: usize = 75;
        const ROLLUP_REQUESTS_PER_PROVIDER: u64 = 25;
        const CALLS: usize = 5;
        // Defends a 60s LuCI poll cadence + swiftbar tick; measured worst over 5 calls: ~3ms.
        // 250ms leaves ~80x headroom for slower routers and DB cache misses.
        const POLL_BUDGET: Duration = Duration::from_millis(250);

        let db = Arc::new(Database::memory().expect("db"));
        for app_type in ["claude", "codex", "gemini"] {
            for provider_index in 0..PROVIDERS_PER_APP {
                let provider_id = format!("{app_type}-provider-{provider_index}");
                db.save_provider(app_type, &test_provider(&provider_id, "Provider"))
                    .expect("save provider");
                for row_index in 0..REQUEST_LOGS_PER_PROVIDER {
                    insert_usage_log(
                        &db,
                        &format!("{app_type}-{provider_index}-log-{row_index}"),
                        &provider_id,
                        app_type,
                        10,
                        5,
                        0,
                        0,
                        "0.001000",
                        20,
                        200,
                        1_700_000_000 + row_index as i64,
                    );
                }
                insert_usage_log(
                    &db,
                    &format!("{app_type}-{provider_index}-failed-log"),
                    &provider_id,
                    app_type,
                    10,
                    5,
                    0,
                    0,
                    "0.001000",
                    20,
                    500,
                    1_700_000_100 + provider_index as i64,
                );
                insert_rollup(
                    &db,
                    "2026-05-01",
                    &provider_id,
                    app_type,
                    ROLLUP_REQUESTS_PER_PROVIDER,
                    ROLLUP_REQUESTS_PER_PROVIDER,
                    250,
                    125,
                    "0.025000",
                    20,
                );
            }
        }

        let state = test_proxy_state(db);
        let expected_total_requests = PROVIDERS_PER_APP as u64
            * (REQUEST_LOGS_PER_PROVIDER as u64 + 1 + ROLLUP_REQUESTS_PER_PROVIDER);

        let mut worst_elapsed = Duration::ZERO;
        for call in 0..CALLS {
            let started = Instant::now();
            let response = status_response(&state).await;
            let elapsed = started.elapsed();
            worst_elapsed = worst_elapsed.max(elapsed);

            assert!(
                elapsed < POLL_BUDGET,
                "call {call} elapsed {elapsed:?}, worst {worst_elapsed:?}, budget {POLL_BUDGET:?}"
            );
            for app_type in ["claude", "codex", "gemini"] {
                assert_eq!(
                    response.apps[app_type].usage.total_requests,
                    expected_total_requests
                );
            }
        }
    }

    #[derive(Clone)]
    struct FakeRefresher {
        calls: Arc<Mutex<usize>>,
        result: Result<RefreshedCredentials, OAuthRefreshError>,
    }

    #[async_trait::async_trait]
    impl OAuthTokenRefresher for FakeRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            *self.calls.lock().expect("lock refresh calls") += 1;
            self.result.clone()
        }
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_uses_uploaded_auth_and_preserves_header_snapshots() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        db.save_provider(
            "claude",
            &claude_provider("claude-pass", "client_passthrough", "Claude Passthrough"),
        )
        .expect("save passthrough provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() + 10 * 60_000),
        )
        .expect("save uploaded auth");

        let state = test_proxy_state(db);
        {
            let mut store = state.rate_limits.write().await;
            store.insert(
                "claude-oauth".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-oauth".to_string(),
                    provider_name: "Claude OAuth".to_string(),
                    source: Some("subscription_quota".to_string()),
                    status: None,
                    windows: vec![RateLimitWindow {
                        name: "seven_day".to_string(),
                        status: None,
                        utilization: Some(0.9),
                        reset: Some(1_700_000_000),
                    }],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: Some(50),
                    requests_remaining: Some(10),
                    tokens_limit: Some(1_000),
                    tokens_remaining: Some(500),
                    balances: None,
                    captured_at: 1_700_000_000_000,
                },
            );
            store.insert(
                "claude-pass".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-pass".to_string(),
                    provider_name: "Claude Passthrough".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: vec![RateLimitWindow {
                        name: "7d".to_string(),
                        status: None,
                        utilization: Some(0.4),
                        reset: Some(1_700_000_500),
                    }],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 1_700_000_000_100,
                },
            );
            store.insert(
                "ghost-claude".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "ghost-claude".to_string(),
                    provider_name: "Ghost Claude".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: vec![],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 1_700_000_000_200,
                },
            );
        }

        let seen_tokens = Arc::new(Mutex::new(Vec::new()));
        refresh_claude_quota_snapshots_with_query(&state, {
            let seen_tokens = seen_tokens.clone();
            move |access_token: String| {
                let seen_tokens = seen_tokens.clone();
                async move {
                    seen_tokens
                        .lock()
                        .expect("lock seen tokens")
                        .push(access_token);
                    sample_quota("claude", "seven_day_claude_design", 42.0)
                }
            }
        })
        .await;

        assert_eq!(
            seen_tokens.lock().expect("lock seen tokens").as_slice(),
            ["sk-ant-oat01-uploaded"]
        );

        let store = state.rate_limits.read().await;
        let oauth_snapshot = store.get("claude-oauth").expect("oauth snapshot");
        assert_eq!(oauth_snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(oauth_snapshot.windows.len(), 1);
        assert_eq!(oauth_snapshot.windows[0].name, "seven_day_claude_design");
        assert_eq!(oauth_snapshot.requests_limit, Some(50));
        assert_eq!(oauth_snapshot.tokens_limit, Some(1_000));
        assert_eq!(
            store
                .get("claude-pass")
                .and_then(|snapshot| snapshot.source.as_deref()),
            Some("response_headers")
        );
        assert!(!store.contains_key("ghost-claude"));
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_refreshes_expired_uploaded_auth() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() - 60_000),
        )
        .expect("save expired auth");

        let state = test_proxy_state(db);

        let calls = Arc::new(Mutex::new(0usize));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Ok(RefreshedCredentials {
                access_token: "sk-ant-oat01-refreshed".to_string(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh".to_string()),
                extra: json!({
                    "scopes": ["user:profile", "user:inference"],
                    "subscriptionType": "max",
                    "rateLimitTier": "priority"
                }),
            }),
        };
        let seen_tokens = Arc::new(Mutex::new(Vec::new()));
        refresh_claude_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let seen_tokens = seen_tokens.clone();
                move |_access_token: String| {
                    let seen_tokens = seen_tokens.clone();
                    async move {
                        seen_tokens
                            .lock()
                            .expect("lock seen tokens")
                            .push(_access_token);
                        sample_quota("claude", "seven_day_claude_design", 42.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock calls"), 1);
        assert_eq!(
            seen_tokens.lock().expect("lock seen tokens").as_slice(),
            ["sk-ant-oat01-refreshed"]
        );

        let refreshed_auth = load_claude_refresh_auth_for_provider("claude-oauth")
            .expect("load refreshed auth")
            .expect("refreshed auth");
        assert_eq!(refreshed_auth.access_token, "sk-ant-oat01-refreshed");
        assert_eq!(
            refreshed_auth.refresh_token.as_deref(),
            Some("rotated-refresh")
        );
        assert_eq!(refreshed_auth.subscription_type.as_deref(), Some("max"));
        assert_eq!(refreshed_auth.rate_limit_tier.as_deref(), Some("priority"));

        let snapshot = state
            .rate_limits
            .read()
            .await
            .get("claude-oauth")
            .cloned()
            .expect("claude quota snapshot");
        assert_eq!(snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(snapshot.windows[0].name, "seven_day_claude_design");
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_skips_live_fetch_when_refresh_fails() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() - 60_000),
        )
        .expect("save expired auth");

        let state = test_proxy_state(db);
        {
            let mut store = state.rate_limits.write().await;
            store.insert(
                "claude-oauth".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-oauth".to_string(),
                    provider_name: "Claude OAuth".to_string(),
                    source: Some("subscription_quota".to_string()),
                    status: None,
                    windows: vec![],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 1_700_000_000_000,
                },
            );
        }

        let calls = Arc::new(Mutex::new(0usize));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Err(OAuthRefreshError::RefreshTokenInvalid),
        };
        let query_calls = Arc::new(Mutex::new(0usize));
        refresh_claude_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let query_calls = query_calls.clone();
                move |_access_token: String| {
                    let query_calls = query_calls.clone();
                    async move {
                        *query_calls.lock().expect("lock query calls") += 1;
                        sample_quota("claude", "seven_day_claude_design", 42.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock refresh calls"), 1);
        assert_eq!(*query_calls.lock().expect("lock query calls"), 0);
        assert!(state.rate_limits.read().await.get("claude-oauth").is_none());
    }

    #[tokio::test]
    #[serial]
    async fn refresh_codex_quota_snapshots_refreshes_expired_uploaded_auth() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "codex",
            &codex_provider("codex-oauth", "codex_oauth", "Codex OAuth"),
        )
        .expect("save oauth provider");
        let expired_secs = (chrono::Utc::now().timestamp_millis() / 1000) - 60;
        crate::proxy::providers::codex_oauth_store::save_codex_auth_for_provider(
            "codex-oauth",
            &sample_codex_auth_json(expired_secs),
        )
        .expect("save expired codex auth");

        let state = test_proxy_state(db);
        let calls = Arc::new(Mutex::new(0usize));
        let refreshed_access = make_jwt(json!({
            "exp": 4_102_444_800i64,
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "acc-999"
            }
        }));
        let refreshed_id_token = make_jwt(json!({
            "chatgpt_account_id": "acc-999",
            "exp": 4_102_444_800i64
        }));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Ok(RefreshedCredentials {
                access_token: refreshed_access.clone(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh".to_string()),
                extra: json!({
                    "id_token": refreshed_id_token,
                    "account_id": "acc-999"
                }),
            }),
        };
        let seen_requests = Arc::new(Mutex::new(Vec::new()));
        refresh_codex_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let seen_requests = seen_requests.clone();
                move |access_token: String, account_id: Option<String>| {
                    let seen_requests = seen_requests.clone();
                    async move {
                        seen_requests
                            .lock()
                            .expect("lock codex requests")
                            .push((access_token, account_id));
                        sample_quota("codex", "five_hour", 12.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock refresh calls"), 1);
        assert_eq!(
            seen_requests
                .lock()
                .expect("lock codex requests")
                .as_slice(),
            &[(refreshed_access.clone(), Some("acc-999".to_string()))]
        );

        let refreshed_auth = load_codex_refresh_auth_for_provider("codex-oauth")
            .expect("load refreshed codex auth")
            .expect("refreshed auth");
        assert_eq!(refreshed_auth.refresh_token, "rotated-refresh");
        assert_eq!(refreshed_auth.account_id.as_deref(), Some("acc-999"));
    }
}
