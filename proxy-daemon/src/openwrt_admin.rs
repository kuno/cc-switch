use crate::app_config::AppType;
use crate::config::sanitize_provider_name;
use crate::database::Database;
use crate::error::AppError;
use crate::provider::Provider;
use crate::proxy::providers::{
    claude_oauth_store::{
        claude_auth_upload_limit_bytes, delete_claude_auth_for_provider,
        load_claude_auth_summary_for_provider, save_claude_auth_for_provider,
        ClaudeSavedAuthSummary,
    },
    codex_oauth_store::{
        codex_auth_upload_limit_bytes, delete_codex_auth_for_provider,
        load_codex_auth_summary_for_provider, save_codex_auth_for_provider, SavedAuthSummary,
    },
};
use crate::proxy::server::populate_status_active_targets;
use crate::proxy::types::{AppProxyConfig, GlobalProxyConfig, ProviderHealth, ProxyStatus};
use crate::proxy::ProviderRouter;
use crate::proxy::{CircuitBreakerStats, CircuitState};
use crate::services::stream_check::{
    HealthStatus, StreamCheckBounds, StreamCheckResult, StreamCheckService,
};
use crate::services::usage_stats::{
    LogFilters, PaginatedLogs, ProviderStats, RequestLogDetail, UsageSummary,
};
use crate::services::{model_fetch, speedtest::SpeedtestService};
use crate::version;
use anyhow::{anyhow, Context};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::str::FromStr;
use std::time::{Duration, Instant};
use uuid::Uuid;

const CLAUDE_APP_ID: &str = "claude";
const CODEX_APP_ID: &str = "codex";
const GEMINI_APP_ID: &str = "gemini";
const CLAUDE_DEFAULT_PROVIDER_ID: &str = "openwrt-claude";
const CLAUDE_PROVIDER_ID_PREFIX: &str = "openwrt-claude-";
const CLAUDE_DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const CLAUDE_ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";
const CODEX_DEFAULT_PROVIDER_ID: &str = "openwrt-codex";
const CODEX_PROVIDER_ID_PREFIX: &str = "openwrt-codex-";
const CODEX_TOKEN_FIELD: &str = "OPENAI_API_KEY";
const GEMINI_DEFAULT_PROVIDER_ID: &str = "openwrt-gemini";
const GEMINI_PROVIDER_ID_PREFIX: &str = "openwrt-gemini-";
const GEMINI_TOKEN_FIELD: &str = "GEMINI_API_KEY";
pub const OPENWRT_REQUEST_LOGS_DEFAULT_PAGE_SIZE: u32 = 20;
pub const OPENWRT_REQUEST_LOGS_MAX_PAGE_SIZE: u32 = 100;
const DEFAULT_OUTBOUND_PROXY_TEST_URL: &str = "https://www.gstatic.com/generate_204";
const OUTBOUND_PROXY_TEST_TIMEOUT: Duration = Duration::from_secs(3);
const OUTBOUND_PROXY_TEST_CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const CLAUDE_MODEL_KEYS_TO_CLEAR: [&str; 6] = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

const CLAUDE_APP_TYPE: &str = CLAUDE_APP_ID;
const DEFAULT_PROVIDER_ID: &str = CLAUDE_DEFAULT_PROVIDER_ID;
const DEFAULT_TOKEN_FIELD: &str = CLAUDE_DEFAULT_TOKEN_FIELD;

type ClaudeProviderPayload = OpenWrtProviderPayload;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderPayload {
    #[serde(default)]
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub website_url: Option<String>,
    #[serde(default)]
    pub token_field: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub auth_content: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtAppConfigPayload {
    pub enabled: bool,
    pub auto_failover_enabled: bool,
    pub max_retries: u32,
    pub streaming_first_byte_timeout: u32,
    pub streaming_idle_timeout: u32,
    pub non_streaming_timeout: u32,
    pub circuit_failure_threshold: u32,
    pub circuit_success_threshold: u32,
    pub circuit_timeout_seconds: u32,
    pub circuit_error_rate_threshold: f64,
    pub circuit_min_requests: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtOutboundProxyTestPayload {
    #[serde(default)]
    pub candidate_proxy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderView {
    pub configured: bool,
    pub active: bool,
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub website_url: Option<String>,
    pub token_field: String,
    pub token_configured: bool,
    pub token_masked: String,
    pub model: String,
    pub notes: String,
    pub sort_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_auth: Option<SavedAuthSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_auth: Option<ClaudeSavedAuthSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderListView {
    pub active_provider_id: Option<String>,
    pub providers: Vec<OpenWrtProviderView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderStatsView {
    pub providers: Vec<ProviderStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtRecentActivityItem {
    pub request_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub total_tokens: u32,
    pub total_cost: String,
    pub status_code: u16,
    pub latency_ms: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtRecentActivityView {
    pub entries: Vec<OpenWrtRecentActivityItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderDeleteView {
    pub deleted_provider_id: String,
    pub active_provider_id: Option<String>,
    pub providers_remaining: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtCodexAuthDeleteView {
    pub provider_id: String,
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtClaudeAuthDeleteView {
    pub provider_id: String,
    pub removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtRuntimeStatusView {
    pub service: OpenWrtServiceStatusView,
    pub runtime: ProxyStatus,
    pub apps: Vec<OpenWrtAppRuntimeStatusView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtAdminMetaView {
    pub api_version: u32,
    pub service: OpenWrtAdminServiceMetaView,
    pub apps: Vec<OpenWrtAppMetaView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtAdminServiceMetaView {
    pub daemon: &'static str,
    pub package_name: &'static str,
    pub luci_package_name: &'static str,
    pub init_script: &'static str,
    pub config_file: &'static str,
    pub admin_base_path: &'static str,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtAppMetaView {
    pub app: String,
    pub display_name: &'static str,
    pub default_provider_id: &'static str,
    pub default_token_field: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_token_field: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<&'static str>,
    pub icon: &'static str,
    pub icon_color: &'static str,
    pub supports_failover: bool,
    pub supports_claude_auth_upload: bool,
    pub supports_codex_auth_upload: bool,
    pub supports_usage_summary: bool,
    pub supports_provider_stats: bool,
    pub supports_recent_activity: bool,
    pub supports_circuit_breaker_stats: bool,
    pub supports_circuit_breaker_reset: bool,
    pub supports_endpoint_latency_check: bool,
    pub supports_model_discovery: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtServiceStatusView {
    pub running: bool,
    pub reachable: bool,
    pub listen_address: String,
    pub listen_port: u16,
    pub version: String,
    pub proxy_enabled: bool,
    pub enable_logging: bool,
    pub status_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtAppRuntimeStatusView {
    pub app: String,
    pub provider_count: usize,
    pub proxy_enabled: bool,
    pub auto_failover_enabled: bool,
    pub max_retries: u32,
    pub active_provider_id: Option<String>,
    pub active_provider: OpenWrtProviderView,
    pub active_provider_health: Option<OpenWrtProviderHealthView>,
    pub using_legacy_default: bool,
    pub failover_queue_depth: usize,
    pub failover_queue: Vec<OpenWrtFailoverQueueStatusView>,
    pub observed_provider_count: usize,
    pub healthy_provider_count: usize,
    pub unhealthy_provider_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderHealthView {
    pub provider_id: String,
    pub observed: bool,
    pub healthy: bool,
    pub consecutive_failures: u32,
    pub last_success_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtFailoverQueueStatusView {
    pub provider_id: String,
    pub provider_name: String,
    pub sort_index: Option<usize>,
    pub active: bool,
    pub health: OpenWrtProviderHealthView,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderFailoverView {
    pub provider_id: String,
    pub proxy_enabled: bool,
    pub auto_failover_enabled: bool,
    pub max_retries: u32,
    pub active_provider_id: Option<String>,
    pub in_failover_queue: bool,
    pub queue_position: Option<usize>,
    pub sort_index: Option<usize>,
    pub provider_health: OpenWrtProviderHealthView,
    pub failover_queue_depth: usize,
    pub failover_queue: Vec<OpenWrtFailoverQueueStatusView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtCircuitBreakerStateView {
    pub app: String,
    pub provider_id: String,
    pub live_runtime_reachable: bool,
    pub source: String,
    pub state: Option<CircuitState>,
    pub stats: Option<CircuitBreakerStats>,
    pub provider_health: OpenWrtProviderHealthView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtCircuitBreakerResetView {
    pub app: String,
    pub provider_id: String,
    pub provider_health: OpenWrtProviderHealthView,
    pub circuit_breaker: OpenWrtCircuitBreakerStateView,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtOutboundProxyTestView {
    pub configured: bool,
    pub http_proxy_configured: bool,
    pub https_proxy_configured: bool,
    pub source: String,
    pub proxy_url: Option<String>,
    pub test_url: String,
    pub tested: bool,
    pub success: bool,
    pub status: Option<u16>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderLatencyView {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub success: bool,
    pub latency_ms: Option<u128>,
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderModelsView {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub endpoint: String,
    pub success: bool,
    pub model_ids: Vec<String>,
    pub models: Vec<model_fetch::FetchedModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtStreamCheckResultView {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub success: bool,
    pub status: HealthStatus,
    pub message: String,
    pub response_time_ms: Option<u64>,
    pub http_status: Option<u16>,
    pub model_used: String,
    pub tested_at: i64,
    pub retry_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtStreamCheckReadView {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub check: Option<OpenWrtStreamCheckResultView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtStreamCheckRunView {
    pub app: String,
    pub provider_id: String,
    pub provider_name: String,
    pub check: OpenWrtStreamCheckResultView,
}

#[derive(Clone, Copy)]
struct OpenWrtAppProfile {
    app_id: &'static str,
    display_name: &'static str,
    default_provider_id: &'static str,
    provider_id_prefix: &'static str,
    default_token_field: &'static str,
    alt_token_field: Option<&'static str>,
    default_model: Option<&'static str>,
    icon: &'static str,
    icon_color: &'static str,
}

struct OpenWrtProviderEndpointTarget {
    profile: OpenWrtAppProfile,
    provider: Provider,
    base_url: String,
    api_key: String,
}

pub fn parse_supported_app(value: &str) -> anyhow::Result<AppType> {
    let app_type = AppType::from_str(value).map_err(|e| anyhow!(e.to_string()))?;
    openwrt_app_profile(&app_type)?;
    Ok(app_type)
}

pub fn list_providers(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderListView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let providers = db
        .get_all_providers_by_display_order(profile.app_id)
        .map_err(|e| anyhow!("failed to list {} providers: {e}", profile.app_id))?;

    Ok(provider_list_to_view(
        app_type,
        profile,
        providers,
        active_provider_id.as_deref(),
    ))
}

pub fn get_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let provider = load_provider(db, profile, provider_id)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        active_provider_id.as_deref(),
    ))
}

pub fn upload_codex_auth(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
    raw_bytes: &[u8],
) -> anyhow::Result<SavedAuthSummary> {
    let profile = openwrt_app_profile(app_type)?;
    if profile.app_id != CODEX_APP_ID {
        return Err(anyhow!("upload-codex-auth is only supported for codex"));
    }

    let provider = load_provider(db, profile, provider_id)?;
    save_codex_auth_for_provider(&provider.id, raw_bytes)
}

pub fn upload_claude_auth(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
    raw_bytes: &[u8],
) -> anyhow::Result<ClaudeSavedAuthSummary> {
    let profile = openwrt_app_profile(app_type)?;
    if profile.app_id != CLAUDE_APP_ID {
        return Err(anyhow!("upload-claude-auth is only supported for claude"));
    }

    let provider = load_provider(db, profile, provider_id)?;
    save_claude_auth_for_provider(&provider.id, raw_bytes)
}

pub fn remove_codex_auth(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtCodexAuthDeleteView> {
    let profile = openwrt_app_profile(app_type)?;
    if profile.app_id != CODEX_APP_ID {
        return Err(anyhow!("remove-codex-auth is only supported for codex"));
    }

    let provider = load_provider(db, profile, provider_id)?;
    delete_codex_auth_for_provider(&provider.id)?;

    Ok(OpenWrtCodexAuthDeleteView {
        provider_id: provider.id,
        removed: true,
    })
}

pub fn remove_claude_auth(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtClaudeAuthDeleteView> {
    let profile = openwrt_app_profile(app_type)?;
    if profile.app_id != CLAUDE_APP_ID {
        return Err(anyhow!("remove-claude-auth is only supported for claude"));
    }

    let provider = load_provider(db, profile, provider_id)?;
    delete_claude_auth_for_provider(&provider.id)?;

    Ok(OpenWrtClaudeAuthDeleteView {
        provider_id: provider.id,
        removed: true,
    })
}

fn apply_stored_auth_content(
    profile: OpenWrtAppProfile,
    provider_id: &str,
    auth_content: Option<&str>,
) -> anyhow::Result<()> {
    let Some(auth_content) = auth_content else {
        return Ok(());
    };

    match profile.app_id {
        CLAUDE_APP_ID => {
            if auth_content.is_empty() {
                return delete_claude_auth_for_provider(provider_id);
            }

            let raw_bytes = auth_content.as_bytes();
            if raw_bytes.len() > claude_auth_upload_limit_bytes() {
                return Err(anyhow!(
                    "authContent exceeds {} KiB limit",
                    claude_auth_upload_limit_bytes() / 1024
                ));
            }

            save_claude_auth_for_provider(provider_id, raw_bytes).map(|_| ())
        }
        CODEX_APP_ID => {
            if auth_content.is_empty() {
                return delete_codex_auth_for_provider(provider_id);
            }

            let raw_bytes = auth_content.as_bytes();
            if raw_bytes.len() > codex_auth_upload_limit_bytes() {
                return Err(anyhow!(
                    "authContent exceeds {} KiB limit",
                    codex_auth_upload_limit_bytes() / 1024
                ));
            }

            save_codex_auth_for_provider(provider_id, raw_bytes).map(|_| ())
        }
        _ if auth_content.is_empty() => Ok(()),
        _ => Err(anyhow!(
            "authContent is only supported for Claude and Codex providers"
        )),
    }
}

fn rollback_provider_upsert(
    db: &Database,
    profile: OpenWrtAppProfile,
    provider_id: &str,
    previous_provider: Option<&Provider>,
) -> anyhow::Result<()> {
    match previous_provider {
        Some(previous_provider) => db
            .save_provider(profile.app_id, previous_provider)
            .map_err(|e| anyhow!("failed to roll back {} provider save: {e}", profile.app_id)),
        None => db
            .delete_provider(profile.app_id, provider_id)
            .map_err(|e| {
                anyhow!(
                    "failed to roll back {} provider create: {e}",
                    profile.app_id
                )
            }),
    }
}

pub async fn get_provider_failover(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderFailoverView> {
    let profile = openwrt_app_profile(app_type)?;
    load_provider(db, profile, provider_id)?;

    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let app_config = load_proxy_config_for_app(db, profile).await?;
    let health_records = db
        .list_provider_health_records(profile.app_id)
        .await
        .map_err(|e| {
            anyhow!(
                "failed to list {} provider health records: {e}",
                profile.app_id
            )
        })?;
    let health_by_provider: HashMap<String, ProviderHealth> = health_records
        .into_iter()
        .map(|record| (record.provider_id.clone(), record))
        .collect();
    let failover_queue = load_failover_queue(db, profile)?
        .into_iter()
        .map(|item| OpenWrtFailoverQueueStatusView {
            active: active_provider_id.as_deref() == Some(item.provider_id.as_str()),
            health: build_provider_health_view(
                &item.provider_id,
                health_by_provider.get(&item.provider_id),
            ),
            provider_id: item.provider_id,
            provider_name: item.provider_name,
            sort_index: item.sort_index,
        })
        .collect::<Vec<_>>();
    let queue_entry = failover_queue
        .iter()
        .enumerate()
        .find(|(_, entry)| entry.provider_id == provider_id);

    Ok(OpenWrtProviderFailoverView {
        provider_id: provider_id.to_string(),
        proxy_enabled: app_config.enabled,
        auto_failover_enabled: app_config.auto_failover_enabled,
        max_retries: app_config.max_retries,
        active_provider_id,
        in_failover_queue: queue_entry.is_some(),
        queue_position: queue_entry.map(|(index, _)| index),
        sort_index: queue_entry.and_then(|(_, entry)| entry.sort_index),
        provider_health: build_provider_health_view(
            provider_id,
            health_by_provider.get(provider_id),
        ),
        failover_queue_depth: failover_queue.len(),
        failover_queue,
    })
}

pub async fn get_circuit_breaker_state(
    db: &Database,
    provider_router: &ProviderRouter,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtCircuitBreakerStateView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    build_circuit_breaker_state_view(
        db,
        provider_router,
        profile,
        &normalized_provider_id,
        "runtime-router",
        true,
    )
    .await
}

pub async fn reset_circuit_breaker(
    db: &Database,
    provider_router: &ProviderRouter,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtCircuitBreakerResetView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    db.update_provider_health(&normalized_provider_id, profile.app_id, true, None)
        .await
        .map_err(|e| {
            anyhow!(
                "failed to reset {} provider {normalized_provider_id} health: {e}",
                profile.app_id
            )
        })?;

    provider_router
        .reset_provider_breaker(&normalized_provider_id, profile.app_id)
        .await;

    let circuit_breaker = build_circuit_breaker_state_view(
        db,
        provider_router,
        profile,
        &normalized_provider_id,
        "runtime-router",
        true,
    )
    .await?;

    Ok(OpenWrtCircuitBreakerResetView {
        app: profile.app_id.to_string(),
        provider_id: normalized_provider_id,
        provider_health: circuit_breaker.provider_health.clone(),
        circuit_breaker,
    })
}

pub async fn test_provider_latency(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderLatencyView> {
    let target = load_provider_endpoint_target(db, app_type, provider_id)?;
    let endpoint = redact_endpoint(&target.base_url);
    let result = SpeedtestService::test_endpoints(vec![target.base_url.clone()], Some(2))
        .await
        .map_err(|e| {
            anyhow!(
                "failed to test {} provider endpoint: {e}",
                target.profile.app_id
            )
        })?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("endpoint latency test returned no result"))?;

    Ok(OpenWrtProviderLatencyView {
        app: target.profile.app_id.to_string(),
        provider_id: target.provider.id,
        provider_name: target.provider.name,
        endpoint,
        success: result.error.is_none(),
        latency_ms: result.latency,
        status: result.status,
        error: result
            .error
            .map(|error| sanitize_failure_message(&error, None)),
    })
}

pub async fn fetch_provider_models(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderModelsView> {
    let target = load_provider_endpoint_target(db, app_type, provider_id)?;
    let models_endpoint = model_fetch::models_endpoint_url(&target.base_url, false)
        .map_err(|error| anyhow!("failed to build models endpoint: {error}"))?;
    let endpoint = redact_endpoint(&models_endpoint);

    if target.api_key.trim().is_empty() {
        return Ok(OpenWrtProviderModelsView {
            app: target.profile.app_id.to_string(),
            provider_id: target.provider.id,
            provider_name: target.provider.name,
            endpoint,
            success: false,
            model_ids: Vec::new(),
            models: Vec::new(),
            error: Some("provider API key is not configured".to_string()),
        });
    }

    match model_fetch::fetch_models_with_timeout(
        &target.base_url,
        &target.api_key,
        false,
        Duration::from_secs(5),
    )
    .await
    {
        Ok(models) => {
            let model_ids = models.iter().map(|model| model.id.clone()).collect();
            Ok(OpenWrtProviderModelsView {
                app: target.profile.app_id.to_string(),
                provider_id: target.provider.id,
                provider_name: target.provider.name,
                endpoint,
                success: true,
                model_ids,
                models,
                error: None,
            })
        }
        Err(error) => Ok(OpenWrtProviderModelsView {
            app: target.profile.app_id.to_string(),
            provider_id: target.provider.id,
            provider_name: target.provider.name,
            endpoint,
            success: false,
            model_ids: Vec::new(),
            models: Vec::new(),
            error: Some(sanitize_failure_message(&error, Some(&target.api_key))),
        }),
    }
}

pub fn get_provider_stream_check(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtStreamCheckReadView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    let provider = load_provider(db, profile, &normalized_provider_id)?;
    let check = db
        .get_latest_stream_check_log(profile.app_id, &normalized_provider_id)
        .map_err(|e| {
            anyhow!(
                "failed to read {} provider {normalized_provider_id} stream check: {e}",
                profile.app_id
            )
        })?
        .map(stream_check_log_to_view);

    Ok(OpenWrtStreamCheckReadView {
        app: profile.app_id.to_string(),
        provider_id: normalized_provider_id,
        provider_name: provider.name,
        check,
    })
}

pub async fn run_provider_stream_check(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtStreamCheckRunView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    let provider = load_provider(db, profile, &normalized_provider_id)?;
    let config = db.get_stream_check_config().map_err(|e| {
        anyhow!(
            "failed to read {} provider {normalized_provider_id} stream check config: {e}",
            profile.app_id
        )
    })?;

    let result = match StreamCheckService::check_with_retry_bounded(
        app_type,
        &provider,
        &config,
        None,
        None,
        None,
        StreamCheckBounds::openwrt_conservative(),
    )
    .await
    {
        Ok(result) => sanitize_stream_check_result(result),
        Err(error) => stream_check_error_result(error),
    };

    db.save_stream_check_log(
        &normalized_provider_id,
        &provider.name,
        profile.app_id,
        &result,
    )
    .map_err(|e| {
        anyhow!(
            "failed to save {} provider {normalized_provider_id} stream check: {e}",
            profile.app_id
        )
    })?;

    let check = stream_check_result_to_view(
        profile.app_id,
        &normalized_provider_id,
        &provider.name,
        result,
    );

    Ok(OpenWrtStreamCheckRunView {
        app: profile.app_id.to_string(),
        provider_id: normalized_provider_id,
        provider_name: provider.name,
        check,
    })
}

pub fn get_active_provider(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let provider = active_provider_id
        .as_deref()
        .map(|provider_id| load_provider(db, profile, provider_id))
        .transpose()?;

    Ok(provider
        .as_ref()
        .map(|provider| provider_to_view(app_type, profile, provider, Some(provider.id.as_str())))
        .unwrap_or_else(|| empty_provider_view(profile)))
}

pub fn get_admin_meta() -> anyhow::Result<OpenWrtAdminMetaView> {
    let apps = [AppType::Claude, AppType::Codex, AppType::Gemini]
        .into_iter()
        .map(|app_type| {
            let profile = openwrt_app_profile(&app_type)?;
            Ok(OpenWrtAppMetaView {
                app: profile.app_id.to_string(),
                display_name: profile.display_name,
                default_provider_id: profile.default_provider_id,
                default_token_field: profile.default_token_field,
                alt_token_field: profile.alt_token_field,
                default_model: profile.default_model,
                icon: profile.icon,
                icon_color: profile.icon_color,
                supports_failover: true,
                supports_claude_auth_upload: profile.app_id == CLAUDE_APP_ID,
                supports_codex_auth_upload: profile.app_id == CODEX_APP_ID,
                supports_usage_summary: true,
                supports_provider_stats: true,
                supports_recent_activity: true,
                supports_circuit_breaker_stats: true,
                supports_circuit_breaker_reset: true,
                supports_endpoint_latency_check: true,
                supports_model_discovery: true,
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;

    Ok(OpenWrtAdminMetaView {
        api_version: 1,
        service: OpenWrtAdminServiceMetaView {
            daemon: "cc-switch",
            package_name: "cc-switch",
            luci_package_name: "luci-app-cc-switch",
            init_script: "/etc/init.d/ccswitch",
            config_file: "/etc/config/ccswitch",
            admin_base_path: "/openwrt/admin",
            version: version::build_version().to_string(),
        },
        apps,
    })
}

pub fn upsert_provider(
    db: &Database,
    app_type: &AppType,
    requested_provider_id: Option<&str>,
) -> anyhow::Result<OpenWrtProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_provider_with_payload(db, app_type, requested_provider_id, payload)
}

pub fn upsert_provider_from_payload(
    db: &Database,
    app_type: &AppType,
    requested_provider_id: Option<&str>,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_provider_with_payload(db, app_type, requested_provider_id, payload)
}

pub fn upsert_active_provider(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_active_provider_with_payload(db, app_type, payload)
}

pub fn upsert_active_provider_from_payload(
    db: &Database,
    app_type: &AppType,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_active_provider_with_payload(db, app_type, payload)
}

pub fn activate_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let provider_id = normalize_provider_id(provider_id)?;
    let provider = load_provider(db, profile, &provider_id)?;
    set_active_provider_id(db, app_type, profile, Some(&provider_id))?;
    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        Some(&provider_id),
    ))
}

pub fn delete_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderDeleteView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    let effective_current = resolve_active_provider_id(db, app_type)?;
    let db_current = db.get_current_provider(profile.app_id).map_err(|e| {
        anyhow!(
            "failed to read database current {} provider: {e}",
            profile.app_id
        )
    })?;

    db.delete_provider(profile.app_id, &normalized_provider_id)
        .map_err(|e| {
            anyhow!(
                "failed to delete {} provider {normalized_provider_id}: {e}",
                profile.app_id
            )
        })?;

    if let Err(error) = db.delete_rate_limit_snapshot(&normalized_provider_id) {
        log::warn!(
            "failed to delete persisted rate limit snapshot for {}: {}",
            normalized_provider_id,
            error
        );
    }

    if profile.app_id == CLAUDE_APP_ID {
        if let Err(error) = delete_claude_auth_for_provider(&normalized_provider_id) {
            log::warn!(
                "failed to remove stored Claude auth for deleted provider {}: {}",
                normalized_provider_id,
                error
            );
        }
    }

    if profile.app_id == CODEX_APP_ID {
        if let Err(error) = delete_codex_auth_for_provider(&normalized_provider_id) {
            log::warn!(
                "failed to remove stored codex auth for deleted provider {}: {}",
                normalized_provider_id,
                error
            );
        }
    }

    let remaining = db
        .get_all_providers_by_display_order(profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to reload {} providers after delete: {e}",
                profile.app_id
            )
        })?;
    let next_current = select_current_provider_after_delete(
        &remaining,
        &normalized_provider_id,
        effective_current.as_deref(),
        db_current.as_deref(),
    );
    set_active_provider_id(db, app_type, profile, next_current.as_deref())?;
    let response_active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;

    Ok(OpenWrtProviderDeleteView {
        deleted_provider_id: normalized_provider_id,
        active_provider_id: response_active_provider_id,
        providers_remaining: remaining.len(),
    })
}

pub fn reorder_providers(
    db: &Database,
    app_type: &AppType,
    provider_ids: &[String],
) -> anyhow::Result<OpenWrtProviderListView> {
    let profile = openwrt_app_profile(app_type)?;

    if provider_ids.is_empty() {
        return Err(anyhow!(
            "{} provider reorder requires at least one saved provider",
            profile.app_id
        ));
    }

    let normalized_provider_ids = provider_ids
        .iter()
        .map(|provider_id| normalize_provider_id(provider_id))
        .collect::<anyhow::Result<Vec<_>>>()?;

    db.reorder_providers(profile.app_id, &normalized_provider_ids)
        .map_err(|e| anyhow!("failed to reorder {} providers: {e}", profile.app_id))?;

    list_providers(db, app_type)
}

pub async fn get_runtime_status(db: &Database) -> anyhow::Result<OpenWrtRuntimeStatusView> {
    let service_config = db
        .get_global_proxy_config()
        .await
        .map_err(|e| anyhow!("failed to read proxy service config: {e}"))?;
    let runtime_global_proxy_enabled = db
        .get_global_proxy_url()
        .map_err(|e| anyhow!("failed to read runtime global proxy URL: {e}"))?
        .is_some();

    let apps = vec![
        build_app_runtime_status(db, &AppType::Claude).await?,
        build_app_runtime_status(db, &AppType::Codex).await?,
        build_app_runtime_status(db, &AppType::Gemini).await?,
    ];

    let (runtime, status_source, status_error, reachable) =
        match fetch_live_proxy_status(&service_config).await {
            Ok(status) => (
                hydrate_runtime_status(status, &service_config, &apps),
                "live-status".to_string(),
                None,
                true,
            ),
            Err(error) => (
                build_fallback_proxy_status(&service_config, &apps),
                "config-fallback".to_string(),
                Some(error.to_string()),
                false,
            ),
        };

    Ok(OpenWrtRuntimeStatusView {
        service: OpenWrtServiceStatusView {
            running: runtime.running,
            reachable,
            listen_address: service_config.listen_address.clone(),
            listen_port: service_config.listen_port,
            version: version::build_version().to_string(),
            proxy_enabled: runtime_global_proxy_enabled,
            enable_logging: service_config.enable_logging,
            status_source,
            status_error,
        },
        runtime,
        apps,
    })
}

pub async fn test_outbound_proxy(
    db: &Database,
    payload: OpenWrtOutboundProxyTestPayload,
) -> anyhow::Result<OpenWrtOutboundProxyTestView> {
    let db_proxy_url = db
        .get_global_proxy_url()
        .map_err(|e| anyhow!("failed to read runtime global proxy URL: {e}"))?;
    let env_proxy_url = crate::proxy::http_client::get_host_proxy_url_from_env();
    let configured_proxy_url = env_proxy_url.or(db_proxy_url);
    let configured = configured_proxy_url.is_some();
    let http_proxy_configured = host_proxy_env_present(&["http_proxy", "HTTP_PROXY"]);
    let https_proxy_configured = host_proxy_env_present(&["https_proxy", "HTTPS_PROXY"]);
    let candidate_proxy_url = normalize_optional_proxy_url(payload.candidate_proxy_url.as_deref());
    let (source, proxy_url) = match payload.candidate_proxy_url {
        Some(_) => ("candidate", candidate_proxy_url),
        None => ("configured", configured_proxy_url),
    };

    let Some(proxy_url) = proxy_url else {
        return Ok(OpenWrtOutboundProxyTestView {
            configured,
            http_proxy_configured,
            https_proxy_configured,
            source: source.to_string(),
            proxy_url: None,
            test_url: DEFAULT_OUTBOUND_PROXY_TEST_URL.to_string(),
            tested: false,
            success: false,
            status: None,
            latency_ms: None,
            error: Some("no outbound proxy configured".to_string()),
        });
    };

    let masked_proxy_url = mask_outbound_proxy_url(&proxy_url);
    let mut view = OpenWrtOutboundProxyTestView {
        configured,
        http_proxy_configured,
        https_proxy_configured,
        source: source.to_string(),
        proxy_url: Some(masked_proxy_url.clone()),
        test_url: DEFAULT_OUTBOUND_PROXY_TEST_URL.to_string(),
        tested: true,
        success: false,
        status: None,
        latency_ms: None,
        error: None,
    };

    match build_outbound_proxy_test_client(&proxy_url) {
        Ok(client) => {
            let start = Instant::now();
            match client.get(DEFAULT_OUTBOUND_PROXY_TEST_URL).send().await {
                Ok(response) => {
                    view.latency_ms = Some(start.elapsed().as_millis() as u64);
                    view.status = Some(response.status().as_u16());
                    view.success = response.status().is_success();
                    if !view.success {
                        view.error = Some(format!(
                            "test URL returned HTTP status {}",
                            response.status().as_u16()
                        ));
                    }
                }
                Err(error) => {
                    view.latency_ms = Some(start.elapsed().as_millis() as u64);
                    view.error = Some(redact_proxy_error(&error.to_string(), Some(&proxy_url)));
                }
            }
        }
        Err(error) => {
            view.error = Some(redact_proxy_error(&error, Some(&proxy_url)));
        }
    }

    Ok(view)
}

pub async fn get_app_runtime_status(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    openwrt_app_profile(app_type)?;
    build_app_runtime_status(db, app_type).await
}

pub fn get_usage_summary(db: &Database, app_type: &AppType) -> anyhow::Result<UsageSummary> {
    let profile = openwrt_app_profile(app_type)?;

    db.get_usage_summary(None, None, Some(profile.app_id))
        .map_err(|e| anyhow!("failed to read {} usage summary: {e}", profile.app_id))
}

pub fn get_provider_stats(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderStatsView> {
    let profile = openwrt_app_profile(app_type)?;
    let providers = db
        .get_provider_stats(None, None, Some(profile.app_id))
        .map_err(|e| anyhow!("failed to read {} provider stats: {e}", profile.app_id))?;

    Ok(OpenWrtProviderStatsView { providers })
}

pub fn get_recent_activity(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtRecentActivityView> {
    let profile = openwrt_app_profile(app_type)?;
    let logs = db
        .get_request_logs(
            &LogFilters {
                app_type: Some(profile.app_id.to_string()),
                ..Default::default()
            },
            0,
            6,
        )
        .map_err(|e| anyhow!("failed to read {} recent activity: {e}", profile.app_id))?;

    let entries = logs
        .data
        .into_iter()
        .map(|item| OpenWrtRecentActivityItem {
            request_id: item.request_id,
            provider_id: item.provider_id.clone(),
            provider_name: item.provider_name.unwrap_or(item.provider_id),
            model: item.model,
            total_tokens: item.input_tokens
                + item.output_tokens
                + item.cache_creation_tokens
                + item.cache_read_tokens,
            total_cost: item.total_cost_usd,
            status_code: item.status_code,
            latency_ms: item.latency_ms,
            created_at: item.created_at,
        })
        .collect();

    Ok(OpenWrtRecentActivityView { entries })
}

pub fn normalize_request_logs_pagination(page: Option<u32>, page_size: Option<u32>) -> (u32, u32) {
    let page = page.unwrap_or(0);
    let page_size = page_size
        .unwrap_or(OPENWRT_REQUEST_LOGS_DEFAULT_PAGE_SIZE)
        .clamp(1, OPENWRT_REQUEST_LOGS_MAX_PAGE_SIZE);

    (page, page_size)
}

pub fn get_request_logs(
    db: &Database,
    app_type: &AppType,
    page: Option<u32>,
    page_size: Option<u32>,
    mut filters: LogFilters,
) -> anyhow::Result<PaginatedLogs> {
    let profile = openwrt_app_profile(app_type)?;
    let (page, page_size) = normalize_request_logs_pagination(page, page_size);
    filters.app_type = Some(profile.app_id.to_string());

    db.get_request_logs(&filters, page, page_size)
        .map_err(|e| anyhow!("failed to read {} request logs: {e}", profile.app_id))
}

pub fn get_request_detail(
    db: &Database,
    app_type: &AppType,
    request_id: &str,
) -> anyhow::Result<RequestLogDetail> {
    let profile = openwrt_app_profile(app_type)?;
    let detail = db
        .get_request_detail(request_id)
        .map_err(|e| anyhow!("failed to read {} request detail: {e}", profile.app_id))?
        .ok_or_else(|| {
            anyhow!(
                "request log `{request_id}` not found for {}",
                profile.app_id
            )
        })?;

    if detail.app_type != profile.app_id {
        return Err(anyhow!(
            "request log `{request_id}` not found for {}",
            profile.app_id
        ));
    }

    Ok(detail)
}

pub async fn get_app_proxy_config(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<AppProxyConfig> {
    let profile = openwrt_app_profile(app_type)?;
    load_proxy_config_for_app(db, profile).await
}

pub async fn update_app_proxy_config(
    db: &Database,
    app_type: &AppType,
    payload: OpenWrtAppConfigPayload,
) -> anyhow::Result<AppProxyConfig> {
    let profile = openwrt_app_profile(app_type)?;
    validate_openwrt_app_config_payload(&payload)?;

    let config = AppProxyConfig {
        app_type: profile.app_id.to_string(),
        enabled: payload.enabled,
        auto_failover_enabled: payload.auto_failover_enabled,
        max_retries: payload.max_retries,
        streaming_first_byte_timeout: payload.streaming_first_byte_timeout,
        streaming_idle_timeout: payload.streaming_idle_timeout,
        non_streaming_timeout: payload.non_streaming_timeout,
        circuit_failure_threshold: payload.circuit_failure_threshold,
        circuit_success_threshold: payload.circuit_success_threshold,
        circuit_timeout_seconds: payload.circuit_timeout_seconds,
        circuit_error_rate_threshold: payload.circuit_error_rate_threshold,
        circuit_min_requests: payload.circuit_min_requests,
    };

    db.update_proxy_config_for_app(config)
        .await
        .map_err(|e| anyhow!("failed to update {} proxy config: {e}", profile.app_id))?;

    load_proxy_config_for_app(db, profile).await
}

pub fn get_available_failover_providers(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<Vec<OpenWrtProviderView>> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let providers = db
        .get_available_providers_for_failover(profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to list available {} failover providers: {e}",
                profile.app_id
            )
        })?;

    Ok(providers
        .iter()
        .map(|provider| {
            provider_to_view(app_type, profile, provider, active_provider_id.as_deref())
        })
        .collect())
}

pub async fn add_to_failover_queue(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    db.add_to_failover_queue(profile.app_id, &normalized_provider_id)
        .map_err(|e| {
            anyhow!(
                "failed to add {} provider {normalized_provider_id} to failover queue: {e}",
                profile.app_id
            )
        })?;

    build_app_runtime_status(db, app_type).await
}

pub async fn remove_from_failover_queue(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;
    prevent_empty_failover_queue_while_enabled(db, profile, &normalized_provider_id).await?;

    db.remove_from_failover_queue(profile.app_id, &normalized_provider_id)
        .map_err(|e| {
            anyhow!(
                "failed to remove {} provider {normalized_provider_id} from failover queue: {e}",
                profile.app_id
            )
        })?;

    build_app_runtime_status(db, app_type).await
}

pub async fn reorder_failover_queue(
    db: &Database,
    app_type: &AppType,
    provider_ids: &[String],
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;

    if provider_ids.is_empty() {
        return Err(anyhow!(
            "{} failover queue reorder requires at least one queued provider",
            profile.app_id
        ));
    }

    db.reorder_failover_queue(profile.app_id, provider_ids)
        .map_err(|e| anyhow!("failed to reorder {} failover queue: {e}", profile.app_id))?;

    build_app_runtime_status(db, app_type).await
}

pub async fn set_auto_failover_enabled(
    db: &Database,
    app_type: &AppType,
    enabled: bool,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;
    let p1_provider_id = if enabled {
        Some(ensure_failover_queue_ready_for_enable(db, app_type, profile).await?)
    } else {
        None
    };

    let mut config = load_proxy_config_for_app(db, profile).await?;
    config.auto_failover_enabled = enabled;
    db.update_proxy_config_for_app(config).await.map_err(|e| {
        anyhow!(
            "failed to update {} auto failover setting: {e}",
            profile.app_id
        )
    })?;

    if let Some(p1_provider_id) = p1_provider_id.as_deref() {
        set_active_provider_id(db, app_type, profile, Some(p1_provider_id))?;
    }

    build_app_runtime_status(db, app_type).await
}

pub async fn set_max_retries(
    db: &Database,
    app_type: &AppType,
    value: u32,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;
    let mut config = load_proxy_config_for_app(db, profile).await?;
    config.max_retries = value;
    db.update_proxy_config_for_app(config)
        .await
        .map_err(|e| anyhow!("failed to update {} max retries: {e}", profile.app_id))?;

    build_app_runtime_status(db, app_type).await
}

pub fn list_claude_providers(db: &Database) -> anyhow::Result<OpenWrtProviderListView> {
    list_providers(db, &AppType::Claude)
}

pub fn get_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    get_provider(db, &AppType::Claude, provider_id)
}

pub fn get_active_claude_provider(db: &Database) -> anyhow::Result<OpenWrtProviderView> {
    get_active_provider(db, &AppType::Claude)
}

pub fn upsert_claude_provider(
    db: &Database,
    requested_provider_id: Option<&str>,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_provider(db, &AppType::Claude, requested_provider_id)
}

pub fn upsert_active_claude_provider(db: &Database) -> anyhow::Result<OpenWrtProviderView> {
    upsert_active_provider(db, &AppType::Claude)
}

pub fn activate_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    activate_provider(db, &AppType::Claude, provider_id)
}

pub fn delete_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderDeleteView> {
    delete_provider(db, &AppType::Claude, provider_id)
}

fn upsert_claude_provider_with_payload(
    db: &Database,
    requested_provider_id: Option<&str>,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_provider_with_payload(db, &AppType::Claude, requested_provider_id, payload)
}

fn upsert_active_claude_provider_with_payload(
    db: &Database,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_active_provider_with_payload(db, &AppType::Claude, payload)
}

fn resolve_claude_active_provider_id(db: &Database) -> anyhow::Result<Option<String>> {
    resolve_active_provider_id(db, &AppType::Claude)
}

fn extract_claude_token(provider: &Provider) -> Option<(&'static str, &str)> {
    let profile = openwrt_app_profile(&AppType::Claude).ok()?;
    extract_token(profile, provider)
}

fn upsert_provider_with_payload(
    db: &Database,
    app_type: &AppType,
    requested_provider_id: Option<&str>,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let requested_auth_content = payload.auth_content.clone();
    let payload_provider_id = normalize_requested_provider_id(payload.provider_id.as_deref())?;
    let requested_provider_id = normalize_requested_provider_id(requested_provider_id)?;
    ensure_matching_provider_ids(
        requested_provider_id.as_deref(),
        payload_provider_id.as_deref(),
    )?;

    let target_provider_id = requested_provider_id
        .or(payload_provider_id)
        .unwrap_or_else(|| generate_provider_id(profile));
    let existing = db
        .get_provider_by_id(&target_provider_id, profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to load {} provider {target_provider_id}: {e}",
                profile.app_id
            )
        })?;
    let previous_provider = existing.clone();
    let provider = build_provider(
        app_type,
        profile,
        existing,
        target_provider_id.clone(),
        payload,
    )?;

    db.save_provider(profile.app_id, &provider)
        .map_err(|e| anyhow!("failed to save {} provider: {e}", profile.app_id))?;
    if let Err(auth_error) =
        apply_stored_auth_content(profile, &provider.id, requested_auth_content.as_deref())
    {
        rollback_provider_upsert(db, profile, &provider.id, previous_provider.as_ref()).map_err(
            |rollback_error| {
                anyhow!("{auth_error}; provider rollback also failed: {rollback_error}")
            },
        )?;
        return Err(auth_error);
    }

    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        active_provider_id.as_deref(),
    ))
}

fn upsert_active_provider_with_payload(
    db: &Database,
    app_type: &AppType,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id(db, app_type)?;
    let requested_auth_content = payload.auth_content.clone();
    let payload_provider_id = normalize_requested_provider_id(payload.provider_id.as_deref())?;

    if let (Some(active_provider_id), Some(payload_provider_id)) = (
        active_provider_id.as_deref(),
        payload_provider_id.as_deref(),
    ) {
        if active_provider_id != payload_provider_id {
            return Err(anyhow!(
                "upsert-active-provider targets the current active provider; use upsert-provider to edit a different provider"
            ));
        }
    }

    let target_provider_id =
        active_provider_id.unwrap_or_else(|| profile.default_provider_id.to_string());
    let existing = db
        .get_provider_by_id(&target_provider_id, profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to load {} provider {target_provider_id}: {e}",
                profile.app_id
            )
        })?;
    let previous_provider = existing.clone();
    let provider = build_provider(
        app_type,
        profile,
        existing,
        target_provider_id.clone(),
        payload,
    )?;

    db.save_provider(profile.app_id, &provider)
        .map_err(|e| anyhow!("failed to save {} provider: {e}", profile.app_id))?;
    if let Err(auth_error) =
        apply_stored_auth_content(profile, &provider.id, requested_auth_content.as_deref())
    {
        rollback_provider_upsert(db, profile, &provider.id, previous_provider.as_ref()).map_err(
            |rollback_error| {
                anyhow!("{auth_error}; provider rollback also failed: {rollback_error}")
            },
        )?;
        return Err(auth_error);
    }
    set_active_provider_id(db, app_type, profile, Some(&provider.id))?;

    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        Some(&provider.id),
    ))
}

fn openwrt_app_profile(app_type: &AppType) -> anyhow::Result<OpenWrtAppProfile> {
    match app_type {
        AppType::Claude => Ok(OpenWrtAppProfile {
            app_id: CLAUDE_APP_ID,
            display_name: "Claude",
            default_provider_id: CLAUDE_DEFAULT_PROVIDER_ID,
            provider_id_prefix: CLAUDE_PROVIDER_ID_PREFIX,
            default_token_field: CLAUDE_DEFAULT_TOKEN_FIELD,
            alt_token_field: Some(CLAUDE_ALT_TOKEN_FIELD),
            default_model: None,
            icon: "anthropic",
            icon_color: "#D4915D",
        }),
        AppType::Codex => Ok(OpenWrtAppProfile {
            app_id: CODEX_APP_ID,
            display_name: "Codex",
            default_provider_id: CODEX_DEFAULT_PROVIDER_ID,
            provider_id_prefix: CODEX_PROVIDER_ID_PREFIX,
            default_token_field: CODEX_TOKEN_FIELD,
            alt_token_field: None,
            default_model: Some("gpt-5.4"),
            icon: "openai",
            icon_color: "#00A67E",
        }),
        AppType::Gemini => Ok(OpenWrtAppProfile {
            app_id: GEMINI_APP_ID,
            display_name: "Gemini",
            default_provider_id: GEMINI_DEFAULT_PROVIDER_ID,
            provider_id_prefix: GEMINI_PROVIDER_ID_PREFIX,
            default_token_field: GEMINI_TOKEN_FIELD,
            alt_token_field: None,
            default_model: Some("gemini-3.1-pro"),
            icon: "gemini",
            icon_color: "#4285F4",
        }),
        AppType::Hermes => Err(anyhow!("Hermes is not supported in proxy-daemon")),
        AppType::OpenCode | AppType::OpenClaw => Err(anyhow!(
            "OpenWrt provider management is not implemented for {} yet",
            app_type.as_str()
        )),
    }
}

fn read_payload_from_stdin() -> anyhow::Result<OpenWrtProviderPayload> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read provider payload from stdin")?;

    if input.trim().is_empty() {
        return Err(anyhow!("provider payload is required on stdin"));
    }

    serde_json::from_str(&input).context("failed to parse provider payload JSON")
}

fn load_provider(
    db: &Database,
    profile: OpenWrtAppProfile,
    provider_id: &str,
) -> anyhow::Result<Provider> {
    let provider_id = normalize_provider_id(provider_id)?;
    db.get_provider_by_id(&provider_id, profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to load {} provider {provider_id}: {e}",
                profile.app_id
            )
        })?
        .ok_or_else(|| anyhow!("{} provider {provider_id} does not exist", profile.app_id))
}

fn load_provider_endpoint_target(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderEndpointTarget> {
    let profile = openwrt_app_profile(app_type)?;
    let provider = load_provider(db, profile, provider_id)?;
    let base_url = extract_base_url(profile, &provider)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            anyhow!(
                "{} provider {} has no endpoint configured",
                profile.app_id,
                provider.id
            )
        })?;
    let api_key = extract_token(profile, &provider)
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();

    Ok(OpenWrtProviderEndpointTarget {
        profile,
        provider,
        base_url,
        api_key,
    })
}

async fn build_app_runtime_status(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtAppRuntimeStatusView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let explicit_active_provider_id = resolve_active_provider_id(db, app_type)?;
    let using_legacy_default = explicit_active_provider_id.is_none()
        && active_provider_id.as_deref() == Some(profile.default_provider_id);

    let providers = db.get_all_providers(profile.app_id).map_err(|e| {
        anyhow!(
            "failed to list {} providers for runtime status: {e}",
            profile.app_id
        )
    })?;
    let app_config = load_proxy_config_for_app(db, profile).await?;
    let health_records = db
        .list_provider_health_records(profile.app_id)
        .await
        .map_err(|e| {
            anyhow!(
                "failed to list {} provider health records: {e}",
                profile.app_id
            )
        })?;
    let health_by_provider: HashMap<String, ProviderHealth> = health_records
        .into_iter()
        .map(|record| (record.provider_id.clone(), record))
        .collect();

    let active_provider = active_provider_id
        .as_deref()
        .and_then(|provider_id| providers.get(provider_id))
        .map(|provider| {
            provider_to_view(app_type, profile, provider, active_provider_id.as_deref())
        })
        .unwrap_or_else(|| empty_provider_view(profile));
    let active_provider_health = active_provider_id.as_deref().map(|provider_id| {
        build_provider_health_view(provider_id, health_by_provider.get(provider_id))
    });

    let failover_queue = db
        .get_failover_queue(profile.app_id)
        .map_err(|e| anyhow!("failed to list {} failover queue: {e}", profile.app_id))?
        .into_iter()
        .map(|item| OpenWrtFailoverQueueStatusView {
            active: active_provider_id.as_deref() == Some(item.provider_id.as_str()),
            health: build_provider_health_view(
                &item.provider_id,
                health_by_provider.get(&item.provider_id),
            ),
            provider_id: item.provider_id,
            provider_name: item.provider_name,
            sort_index: item.sort_index,
        })
        .collect::<Vec<_>>();

    let observed_provider_count = providers
        .keys()
        .filter(|provider_id| health_by_provider.contains_key(*provider_id))
        .count();
    let unhealthy_provider_count = providers
        .keys()
        .filter(|provider_id| {
            matches!(
                health_by_provider.get(*provider_id),
                Some(record) if !record.is_healthy
            )
        })
        .count();
    let healthy_provider_count = observed_provider_count.saturating_sub(unhealthy_provider_count);

    Ok(OpenWrtAppRuntimeStatusView {
        app: profile.app_id.to_string(),
        provider_count: providers.len(),
        proxy_enabled: app_config.enabled,
        auto_failover_enabled: app_config.auto_failover_enabled,
        max_retries: app_config.max_retries,
        active_provider_id: active_provider_id.clone(),
        active_provider,
        active_provider_health,
        using_legacy_default,
        failover_queue_depth: failover_queue.len(),
        failover_queue,
        observed_provider_count,
        healthy_provider_count,
        unhealthy_provider_count,
    })
}

async fn load_proxy_config_for_app(
    db: &Database,
    profile: OpenWrtAppProfile,
) -> anyhow::Result<AppProxyConfig> {
    db.get_proxy_config_for_app(profile.app_id)
        .await
        .map_err(|e| anyhow!("failed to read {} proxy config: {e}", profile.app_id))
}

fn load_failover_queue(
    db: &Database,
    profile: OpenWrtAppProfile,
) -> anyhow::Result<Vec<crate::database::FailoverQueueItem>> {
    db.get_failover_queue(profile.app_id)
        .map_err(|e| anyhow!("failed to list {} failover queue: {e}", profile.app_id))
}

fn validate_openwrt_app_config_payload(payload: &OpenWrtAppConfigPayload) -> anyhow::Result<()> {
    if payload.max_retries == 0 {
        return Err(anyhow!("maxRetries must be greater than 0"));
    }
    if payload.streaming_first_byte_timeout == 0 {
        return Err(anyhow!("streamingFirstByteTimeout must be greater than 0"));
    }
    if payload.non_streaming_timeout == 0 {
        return Err(anyhow!("nonStreamingTimeout must be greater than 0"));
    }
    if payload.circuit_failure_threshold == 0 {
        return Err(anyhow!("circuitFailureThreshold must be greater than 0"));
    }
    if payload.circuit_success_threshold == 0 {
        return Err(anyhow!("circuitSuccessThreshold must be greater than 0"));
    }
    if payload.circuit_timeout_seconds == 0 {
        return Err(anyhow!("circuitTimeoutSeconds must be greater than 0"));
    }
    if !payload.circuit_error_rate_threshold.is_finite()
        || !(0.0..=1.0).contains(&payload.circuit_error_rate_threshold)
    {
        return Err(anyhow!(
            "circuitErrorRateThreshold must be a finite value between 0 and 1"
        ));
    }
    if payload.circuit_min_requests == 0 {
        return Err(anyhow!("circuitMinRequests must be greater than 0"));
    }

    Ok(())
}

async fn ensure_failover_queue_ready_for_enable(
    db: &Database,
    app_type: &AppType,
    profile: OpenWrtAppProfile,
) -> anyhow::Result<String> {
    let mut queue = load_failover_queue(db, profile)?;

    if queue.is_empty() {
        let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
        let Some(active_provider_id) = active_provider_id else {
            return Err(anyhow!(
                "{} auto failover requires a current provider or a non-empty failover queue",
                profile.app_id
            ));
        };

        load_provider(db, profile, &active_provider_id)?;
        db.add_to_failover_queue(profile.app_id, &active_provider_id)
            .map_err(|e| {
                anyhow!(
                    "failed to seed {} failover queue with active provider {active_provider_id}: {e}",
                    profile.app_id
                )
            })?;
        queue = load_failover_queue(db, profile)?;
    }

    queue
        .first()
        .map(|entry| entry.provider_id.clone())
        .ok_or_else(|| anyhow!("{} failover queue is empty", profile.app_id))
}

async fn prevent_empty_failover_queue_while_enabled(
    db: &Database,
    profile: OpenWrtAppProfile,
    provider_id: &str,
) -> anyhow::Result<()> {
    let config = load_proxy_config_for_app(db, profile).await?;
    if !config.auto_failover_enabled {
        return Ok(());
    }

    let queue = load_failover_queue(db, profile)?;
    let removing_last_provider = queue.len() == 1
        && queue
            .first()
            .map(|entry| entry.provider_id.as_str() == provider_id)
            .unwrap_or(false);

    if removing_last_provider {
        return Err(anyhow!(
            "{} auto failover requires at least one queued provider; disable auto failover before removing the last queued provider",
            profile.app_id
        ));
    }

    Ok(())
}

fn build_provider_health_view(
    provider_id: &str,
    health: Option<&ProviderHealth>,
) -> OpenWrtProviderHealthView {
    match health {
        Some(health) => OpenWrtProviderHealthView {
            provider_id: provider_id.to_string(),
            observed: true,
            healthy: health.is_healthy,
            consecutive_failures: health.consecutive_failures,
            last_success_at: health.last_success_at.clone(),
            last_failure_at: health.last_failure_at.clone(),
            last_error: health.last_error.clone(),
            updated_at: Some(health.updated_at.clone()),
        },
        None => OpenWrtProviderHealthView {
            provider_id: provider_id.to_string(),
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

fn stream_check_log_to_view(
    entry: crate::database::StreamCheckLogEntry,
) -> OpenWrtStreamCheckResultView {
    stream_check_result_to_view(
        &entry.app_type,
        &entry.provider_id,
        &entry.provider_name,
        sanitize_stream_check_result(entry.result),
    )
}

fn stream_check_result_to_view(
    app: &str,
    provider_id: &str,
    provider_name: &str,
    result: StreamCheckResult,
) -> OpenWrtStreamCheckResultView {
    OpenWrtStreamCheckResultView {
        app: app.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        success: result.success,
        status: result.status,
        message: redact_stream_check_message(&result.message),
        response_time_ms: result.response_time_ms,
        http_status: result.http_status,
        model_used: result.model_used,
        tested_at: result.tested_at,
        retry_count: result.retry_count,
        error_category: result.error_category,
    }
}

fn sanitize_stream_check_result(mut result: StreamCheckResult) -> StreamCheckResult {
    result.message = redact_stream_check_message(&result.message);
    result
}

fn stream_check_error_result(error: AppError) -> StreamCheckResult {
    let (http_status, message) = match error {
        AppError::HttpStatus { status, body } => (Some(status), body),
        other => (None, other.to_string()),
    };

    StreamCheckResult {
        status: HealthStatus::Failed,
        success: false,
        message: redact_stream_check_message(&message),
        response_time_ms: None,
        http_status,
        model_used: String::new(),
        tested_at: chrono::Utc::now().timestamp(),
        retry_count: 0,
        error_category: None,
    }
}

static STREAM_CHECK_SECRET_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (
            Regex::new(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+")
                .expect("auth regex"),
            "${1}[REDACTED]",
        ),
        (
            Regex::new(r#"(?i)((?:api[_-]?key|token|access[_-]?token|refresh[_-]?token)\s*["']?\s*[:=]\s*["']?)[^"',\s&}]+"#)
                .expect("token regex"),
            "${1}[REDACTED]",
        ),
        (
            Regex::new(r"sk-[A-Za-z0-9_-]{8,}").expect("sk regex"),
            "[REDACTED]",
        ),
    ]
});

fn redact_stream_check_message(message: &str) -> String {
    let mut redacted = message.to_string();
    for (pattern, replacement) in STREAM_CHECK_SECRET_PATTERNS.iter() {
        redacted = pattern.replace_all(&redacted, *replacement).into_owned();
    }

    redacted
}

async fn load_provider_health_view(
    db: &Database,
    profile: OpenWrtAppProfile,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderHealthView> {
    let health_records = db
        .list_provider_health_records(profile.app_id)
        .await
        .map_err(|e| {
            anyhow!(
                "failed to list {} provider health records: {e}",
                profile.app_id
            )
        })?;
    let health = health_records
        .iter()
        .find(|record| record.provider_id == provider_id);

    Ok(build_provider_health_view(provider_id, health))
}

async fn build_circuit_breaker_state_view(
    db: &Database,
    provider_router: &ProviderRouter,
    profile: OpenWrtAppProfile,
    provider_id: &str,
    source: &str,
    live_runtime_reachable: bool,
) -> anyhow::Result<OpenWrtCircuitBreakerStateView> {
    let stats = provider_router
        .get_circuit_breaker_stats(provider_id, profile.app_id)
        .await;
    let state = stats.as_ref().map(|stats| stats.state);
    let provider_health = load_provider_health_view(db, profile, provider_id).await?;

    Ok(OpenWrtCircuitBreakerStateView {
        app: profile.app_id.to_string(),
        provider_id: provider_id.to_string(),
        live_runtime_reachable,
        source: source.to_string(),
        state,
        stats,
        provider_health,
    })
}

fn build_fallback_proxy_status(
    service_config: &GlobalProxyConfig,
    apps: &[OpenWrtAppRuntimeStatusView],
) -> ProxyStatus {
    let mut status = ProxyStatus {
        running: false,
        address: service_config.listen_address.clone(),
        port: service_config.listen_port,
        ..Default::default()
    };

    let current_targets = build_current_targets_map(apps);
    populate_status_active_targets(&mut status, &current_targets);
    status
}

fn hydrate_runtime_status(
    mut status: ProxyStatus,
    service_config: &GlobalProxyConfig,
    apps: &[OpenWrtAppRuntimeStatusView],
) -> ProxyStatus {
    if status.address.trim().is_empty() {
        status.address = service_config.listen_address.clone();
    }
    if status.port == 0 {
        status.port = service_config.listen_port;
    }
    if status.active_targets.is_empty() {
        let current_targets = build_current_targets_map(apps);
        populate_status_active_targets(&mut status, &current_targets);
    }

    status
}

fn build_current_targets_map(
    apps: &[OpenWrtAppRuntimeStatusView],
) -> HashMap<String, (String, String)> {
    apps.iter()
        .filter_map(|app| {
            app.active_provider_id.as_ref().map(|provider_id| {
                (
                    app.app.clone(),
                    (provider_id.clone(), app.active_provider.name.clone()),
                )
            })
        })
        .collect()
}

fn host_proxy_env_present(keys: &[&str]) -> bool {
    keys.iter()
        .filter_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .any(|value| !value.is_empty())
}

fn normalize_optional_proxy_url(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn build_outbound_proxy_test_client(proxy_url: &str) -> Result<reqwest::Client, String> {
    let parsed = url::Url::parse(proxy_url).map_err(|error| {
        format!(
            "invalid proxy URL '{}': {}",
            mask_outbound_proxy_url(proxy_url),
            error
        )
    })?;
    let scheme = parsed.scheme();

    if !["http", "https", "socks5", "socks5h"].contains(&scheme) {
        return Err(format!(
            "invalid proxy scheme '{}' in URL '{}'. Supported: http, https, socks5, socks5h",
            scheme,
            mask_outbound_proxy_url(proxy_url)
        ));
    }

    let proxy = reqwest::Proxy::all(proxy_url).map_err(|error| {
        format!(
            "invalid proxy URL '{}': {}",
            mask_outbound_proxy_url(proxy_url),
            error
        )
    })?;

    reqwest::Client::builder()
        .proxy(proxy)
        .timeout(OUTBOUND_PROXY_TEST_TIMEOUT)
        .connect_timeout(OUTBOUND_PROXY_TEST_CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("failed to build proxy test client: {error}"))
}

fn redact_proxy_error(error: &str, proxy_url: Option<&str>) -> String {
    let mut redacted = error.to_string();

    if let Some(proxy_url) = proxy_url {
        redacted = redacted.replace(proxy_url, &mask_outbound_proxy_url(proxy_url));
    }

    redacted
        .split_whitespace()
        .map(redact_error_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_error_token(token: &str) -> String {
    let leading_len = token
        .chars()
        .take_while(|ch| ch.is_ascii_punctuation() && *ch != '/' && *ch != ':')
        .map(char::len_utf8)
        .sum::<usize>();
    let trailing_len = token
        .chars()
        .rev()
        .take_while(|ch| ch.is_ascii_punctuation() && *ch != '/' && *ch != ':')
        .map(char::len_utf8)
        .sum::<usize>();
    let core_end = token.len().saturating_sub(trailing_len);

    if leading_len >= core_end {
        return token.to_string();
    }

    let leading = &token[..leading_len];
    let core = &token[leading_len..core_end];
    let trailing = &token[core_end..];

    if let Ok(parsed) = url::Url::parse(core) {
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return format!("{}{}{}", leading, mask_outbound_proxy_url(core), trailing);
        }
    }

    token.to_string()
}

fn mask_outbound_proxy_url(proxy_url: &str) -> String {
    if url::Url::parse(proxy_url).is_ok() {
        return crate::proxy::http_client::mask_url(proxy_url);
    }

    if let Some(scheme_end) = proxy_url.find("://") {
        let after_scheme_start = scheme_end + 3;
        if let Some(at_offset) = proxy_url[after_scheme_start..].find('@') {
            let host_start = after_scheme_start + at_offset + 1;
            let host_end = proxy_url[host_start..]
                .find(|ch: char| ch == '/' || ch == '?' || ch == '#' || ch.is_whitespace())
                .map(|offset| host_start + offset)
                .unwrap_or(proxy_url.len());

            if host_start < host_end {
                return format!(
                    "{}://{}",
                    &proxy_url[..scheme_end],
                    &proxy_url[host_start..host_end]
                );
            }

            return "<redacted proxy URL>".to_string();
        }
    }

    if proxy_url.contains('@') {
        return "<redacted proxy URL>".to_string();
    }

    if proxy_url.len() > 64 {
        format!("{}...", &proxy_url[..64])
    } else {
        proxy_url.to_string()
    }
}

async fn fetch_live_proxy_status(
    service_config: &GlobalProxyConfig,
) -> anyhow::Result<ProxyStatus> {
    let status_url = format!(
        "{}/status",
        build_proxy_status_origin(&service_config.listen_address, service_config.listen_port)
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(800))
        .build()
        .context("failed to build daemon status HTTP client")?;
    let response = client
        .get(&status_url)
        .send()
        .await
        .map_err(|e| anyhow!("failed to query daemon status endpoint {status_url}: {e}"))?;

    if !response.status().is_success() {
        let response_status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body = body.trim();
        let body_suffix = if body.is_empty() {
            String::new()
        } else {
            format!(": {body}")
        };

        return Err(anyhow!(
            "daemon status endpoint returned {}{}",
            response_status,
            body_suffix
        ));
    }

    response
        .json::<ProxyStatus>()
        .await
        .map_err(|e| anyhow!("failed to decode daemon status from {status_url}: {e}"))
}

pub async fn get_live_circuit_breaker_state(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<Value> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    call_live_admin_json(
        db,
        "GET",
        &circuit_breaker_admin_path(profile, &normalized_provider_id),
    )
    .await
}

pub async fn reset_live_circuit_breaker(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<Value> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    call_live_admin_json(
        db,
        "POST",
        &format!(
            "{}/reset",
            circuit_breaker_admin_path(profile, &normalized_provider_id)
        ),
    )
    .await
}

async fn call_live_admin_json(db: &Database, method: &str, path: &str) -> anyhow::Result<Value> {
    let service_config = db
        .get_global_proxy_config()
        .await
        .map_err(|e| anyhow!("failed to read proxy service config: {e}"))?;
    let url = format!(
        "{}{}",
        build_proxy_status_origin(&service_config.listen_address, service_config.listen_port),
        path
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(1200))
        .build()
        .context("failed to build daemon admin HTTP client")?;
    let request = match method {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => return Err(anyhow!("unsupported daemon admin HTTP method {method}")),
    };
    let response = request
        .send()
        .await
        .map_err(|e| anyhow!("live daemon admin endpoint unavailable at {url}: {e}"))?;

    if !response.status().is_success() {
        let response_status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body = body.trim();
        let body_suffix = if body.is_empty() {
            String::new()
        } else {
            format!(": {body}")
        };

        return Err(anyhow!(
            "live daemon admin endpoint returned {}{}",
            response_status,
            body_suffix
        ));
    }

    let mut value = response
        .json::<Value>()
        .await
        .map_err(|e| anyhow!("failed to decode daemon admin response from {url}: {e}"))?;

    if let Value::Object(map) = &mut value {
        if map.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = map
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("daemon admin request failed");
            return Err(anyhow!(error.to_string()));
        }
        map.remove("ok");
    }

    Ok(value)
}

fn circuit_breaker_admin_path(profile: OpenWrtAppProfile, provider_id: &str) -> String {
    format!(
        "/openwrt/admin/apps/{}/providers/{}/circuit-breaker",
        percent_encode_path_segment(profile.app_id),
        percent_encode_path_segment(provider_id)
    )
}

fn percent_encode_path_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn build_proxy_status_origin(listen_address: &str, listen_port: u16) -> String {
    let connect_host = match listen_address {
        "0.0.0.0" => "127.0.0.1".to_string(),
        "::" => "::1".to_string(),
        _ => listen_address.to_string(),
    };
    let connect_host = if connect_host.contains(':') && !connect_host.starts_with('[') {
        format!("[{connect_host}]")
    } else {
        connect_host
    };

    format!("http://{connect_host}:{listen_port}")
}

fn resolve_active_provider_id(db: &Database, app_type: &AppType) -> anyhow::Result<Option<String>> {
    crate::settings::get_effective_current_provider(db, app_type).map_err(|e| {
        anyhow!(
            "failed to resolve active {} provider: {e}",
            app_type.as_str()
        )
    })
}

fn resolve_active_provider_id_for_read(
    db: &Database,
    app_type: &AppType,
    profile: OpenWrtAppProfile,
) -> anyhow::Result<Option<String>> {
    if let Some(provider_id) = resolve_active_provider_id(db, app_type)? {
        return Ok(Some(provider_id));
    }

    let has_legacy_default = db
        .get_provider_by_id(profile.default_provider_id, profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to load {} provider {}: {e}",
                profile.app_id,
                profile.default_provider_id
            )
        })?
        .is_some();

    Ok(has_legacy_default.then(|| profile.default_provider_id.to_string()))
}

fn set_active_provider_id(
    db: &Database,
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    provider_id: Option<&str>,
) -> anyhow::Result<()> {
    match provider_id {
        Some(provider_id) => {
            let provider_id = normalize_provider_id(provider_id)?;
            db.set_current_provider(profile.app_id, &provider_id)
                .map_err(|e| anyhow!("failed to set active {} provider: {e}", profile.app_id))?;
            crate::settings::set_current_provider(app_type, Some(&provider_id)).map_err(|e| {
                anyhow!(
                    "failed to persist local {} provider selection: {e}",
                    profile.app_id
                )
            })?;
        }
        None => {
            crate::settings::set_current_provider(app_type, None).map_err(|e| {
                anyhow!(
                    "failed to clear local {} provider selection: {e}",
                    profile.app_id
                )
            })?;
        }
    }

    Ok(())
}

fn select_current_provider_after_delete(
    providers: &indexmap::IndexMap<String, Provider>,
    deleted_provider_id: &str,
    effective_current: Option<&str>,
    db_current: Option<&str>,
) -> Option<String> {
    let deleted_was_current = [effective_current, db_current]
        .into_iter()
        .flatten()
        .any(|candidate| candidate == deleted_provider_id);

    for candidate in [effective_current, db_current] {
        if let Some(candidate) = candidate
            .filter(|candidate| *candidate != deleted_provider_id)
            .and_then(|candidate| {
                providers
                    .contains_key(candidate)
                    .then(|| candidate.to_string())
            })
        {
            return Some(candidate);
        }
    }

    if deleted_was_current {
        providers.keys().next().cloned()
    } else {
        None
    }
}

fn provider_list_to_view(
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    providers: indexmap::IndexMap<String, Provider>,
    active_provider_id: Option<&str>,
) -> OpenWrtProviderListView {
    let providers = providers
        .values()
        .enumerate()
        .map(|(index, provider)| {
            let mut view = provider_to_view(app_type, profile, provider, active_provider_id);
            view.sort_index = Some(index);
            view
        })
        .collect();

    OpenWrtProviderListView {
        active_provider_id: active_provider_id.map(str::to_string),
        providers,
    }
}

fn build_provider(
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    match app_type {
        AppType::Claude => build_claude_provider(profile, existing, provider_id, payload),
        AppType::Codex => build_codex_provider(profile, existing, provider_id, payload),
        AppType::Gemini => build_gemini_provider(profile, existing, provider_id, payload),
        AppType::Hermes => Err(anyhow!("Hermes is not supported in proxy-daemon")),
        AppType::OpenCode | AppType::OpenClaw => Err(anyhow!(
            "OpenWrt provider management is not implemented for {} yet",
            app_type.as_str()
        )),
    }
}

fn build_claude_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let token_field = normalize_token_field(profile, &payload.token_field)?;
    let is_passthrough = is_claude_passthrough_auth_mode(payload.auth_mode.as_deref());
    let token_value = if is_passthrough {
        resolve_optional_token_value(profile, existing.as_ref(), &payload.token)
    } else {
        resolve_token_value(profile, existing.as_ref(), &payload.token)?
    };
    let mut provider = init_provider(
        existing,
        provider_id,
        name,
        payload.notes,
        payload.website_url,
        profile,
    );

    let root = ensure_settings_object(&mut provider, "Claude provider settings")?;

    if is_claude_oauth_auth_mode(payload.auth_mode.as_deref()) {
        root.insert("auth_mode".to_string(), json!("claude_oauth"));
    } else if payload.auth_mode.as_deref() == Some("client_passthrough") {
        root.insert("auth_mode".to_string(), json!("client_passthrough"));
    } else {
        root.remove("auth_mode");
    }

    let env = ensure_child_object(root, "env", "Claude provider env")?;

    env.insert("ANTHROPIC_BASE_URL".to_string(), json!(base_url));
    env.remove(CLAUDE_DEFAULT_TOKEN_FIELD);
    env.remove(CLAUDE_ALT_TOKEN_FIELD);
    env.remove("OPENROUTER_API_KEY");
    env.remove("OPENAI_API_KEY");
    if !token_value.is_empty() {
        env.insert(token_field.to_string(), json!(token_value));
    }

    for key in CLAUDE_MODEL_KEYS_TO_CLEAR {
        env.remove(key);
    }
    match normalize_optional(payload.model) {
        Some(model) => {
            env.insert("ANTHROPIC_MODEL".to_string(), json!(model));
        }
        None => {
            env.remove("ANTHROPIC_MODEL");
        }
    }

    Ok(provider)
}

fn is_claude_passthrough_auth_mode(auth_mode: Option<&str>) -> bool {
    matches!(auth_mode, Some("client_passthrough" | "claude_oauth"))
}

fn is_claude_oauth_auth_mode(auth_mode: Option<&str>) -> bool {
    matches!(auth_mode, Some("claude_oauth"))
}

fn is_codex_oauth_auth_mode(auth_mode: Option<&str>) -> bool {
    matches!(auth_mode, Some("codex_oauth" | "client_passthrough"))
}

fn build_codex_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let _token_field = normalize_token_field(profile, &payload.token_field)?;
    let is_passthrough = is_codex_oauth_auth_mode(payload.auth_mode.as_deref());
    let token_value = if is_passthrough {
        resolve_optional_token_value(profile, existing.as_ref(), &payload.token)
    } else {
        resolve_token_value(profile, existing.as_ref(), &payload.token)?
    };
    let mut provider = init_provider(
        existing,
        provider_id,
        name,
        payload.notes,
        payload.website_url,
        profile,
    );
    let model = resolve_model_value(profile, &provider, &payload.model);
    let provider_id_for_default = provider.id.clone();
    let provider_name_for_default = provider.name.clone();

    let root = ensure_settings_object(&mut provider, "Codex provider settings")?;

    if is_passthrough {
        root.insert("auth_mode".to_string(), json!("codex_oauth"));
    } else if payload.auth_mode.as_deref() == Some("api_key") {
        root.insert("auth_mode".to_string(), json!("api_key"));
    } else {
        root.remove("auth_mode");
    }

    let auth = ensure_child_object(root, "auth", "Codex provider auth")?;
    auth.insert(CODEX_TOKEN_FIELD.to_string(), json!(token_value));
    root.insert("base_url".to_string(), json!(base_url));

    match model.as_ref() {
        Some(value) => {
            root.insert("model".to_string(), json!(value));
        }
        None => {
            root.remove("model");
        }
    }

    let config_seed = root
        .get("config")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            default_codex_config(
                &provider_id_for_default,
                &provider_name_for_default,
                base_url,
                model.as_deref(),
            )
        });
    let updated_base_url =
        crate::codex_config::update_codex_toml_field(&config_seed, "base_url", base_url)
            .map_err(|e| anyhow!("failed to update Codex config base_url: {e}"))?;
    let updated_config = crate::codex_config::update_codex_toml_field(
        &updated_base_url,
        "model",
        model.as_deref().unwrap_or(""),
    )
    .map_err(|e| anyhow!("failed to update Codex config model: {e}"))?;
    root.insert("config".to_string(), json!(updated_config));

    Ok(provider)
}

fn build_gemini_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let _token_field = normalize_token_field(profile, &payload.token_field)?;
    let token_value = resolve_token_value(profile, existing.as_ref(), &payload.token)?;
    let mut provider = init_provider(
        existing,
        provider_id,
        name,
        payload.notes,
        payload.website_url,
        profile,
    );
    let model = resolve_model_value(profile, &provider, &payload.model);

    let root = ensure_settings_object(&mut provider, "Gemini provider settings")?;
    let env = ensure_child_object(root, "env", "Gemini provider env")?;
    env.insert("GOOGLE_GEMINI_BASE_URL".to_string(), json!(base_url));
    env.insert(GEMINI_TOKEN_FIELD.to_string(), json!(token_value));
    match model.as_ref() {
        Some(value) => {
            env.insert("GEMINI_MODEL".to_string(), json!(value));
            root.insert("model".to_string(), json!(value));
        }
        None => {
            env.remove("GEMINI_MODEL");
            root.remove("model");
        }
    }
    root.insert("base_url".to_string(), json!(base_url));

    Ok(provider)
}

fn init_provider(
    existing: Option<Provider>,
    provider_id: String,
    name: &str,
    notes: String,
    website_url: Option<String>,
    profile: OpenWrtAppProfile,
) -> Provider {
    let mut provider = match existing {
        Some(existing) => existing,
        None => {
            let mut provider = Provider::with_id(provider_id, name.to_string(), json!({}), None);
            provider.in_failover_queue = false;
            provider
        }
    };

    provider.name = name.to_string();
    provider.notes = normalize_optional(notes);
    if let Some(website_url) = website_url {
        provider.website_url = normalize_optional(website_url);
    }
    if provider.created_at.is_none() {
        provider.created_at = Some(chrono::Utc::now().timestamp_millis());
    }
    if provider.icon.is_none() {
        provider.icon = Some(profile.icon.to_string());
    }
    if provider.icon_color.is_none() {
        provider.icon_color = Some(profile.icon_color.to_string());
    }

    provider
}

fn ensure_settings_object<'a>(
    provider: &'a mut Provider,
    context_label: &str,
) -> anyhow::Result<&'a mut serde_json::Map<String, Value>> {
    if !provider.settings_config.is_object() {
        provider.settings_config = json!({});
    }

    provider
        .settings_config
        .as_object_mut()
        .ok_or_else(|| anyhow!("{context_label} must be a JSON object"))
}

fn ensure_child_object<'a>(
    parent: &'a mut serde_json::Map<String, Value>,
    key: &str,
    context_label: &str,
) -> anyhow::Result<&'a mut serde_json::Map<String, Value>> {
    let child_value = parent.entry(key.to_string()).or_insert_with(|| json!({}));
    if !child_value.is_object() {
        *child_value = json!({});
    }
    child_value
        .as_object_mut()
        .ok_or_else(|| anyhow!("{context_label} must be a JSON object"))
}

fn require_trimmed<'a>(label: &str, value: &'a str) -> anyhow::Result<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{label} is required"));
    }
    Ok(trimmed)
}

fn ensure_matching_provider_ids(
    requested_provider_id: Option<&str>,
    payload_provider_id: Option<&str>,
) -> anyhow::Result<()> {
    if let (Some(requested_provider_id), Some(payload_provider_id)) =
        (requested_provider_id, payload_provider_id)
    {
        if requested_provider_id != payload_provider_id {
            return Err(anyhow!(
                "providerId in payload does not match the provider ID in the command"
            ));
        }
    }

    Ok(())
}

fn normalize_requested_provider_id(value: Option<&str>) -> anyhow::Result<Option<String>> {
    value.map(normalize_provider_id).transpose()
}

fn normalize_provider_id(value: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider ID is required"));
    }

    Ok(trimmed.to_string())
}

fn generate_provider_id(profile: OpenWrtAppProfile) -> String {
    format!("{}{}", profile.provider_id_prefix, Uuid::new_v4().simple())
}

fn normalize_token_field(profile: OpenWrtAppProfile, value: &str) -> anyhow::Result<&'static str> {
    let trimmed = value.trim();

    if trimmed.is_empty() || trimmed == profile.default_token_field {
        return Ok(profile.default_token_field);
    }

    if let Some(alt) = profile.alt_token_field {
        if trimmed == alt {
            return Ok(alt);
        }
    }

    Err(anyhow!("unsupported token field: {trimmed}"))
}

fn normalize_optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_token_value(
    profile: OpenWrtAppProfile,
    existing: Option<&Provider>,
    payload_token: &str,
) -> anyhow::Result<String> {
    let existing_token = existing
        .and_then(|provider| extract_token(profile, provider))
        .map(|(_, token)| token.to_string());

    match payload_token.trim() {
        "" => existing_token.ok_or_else(|| anyhow!("token is required for the first save")),
        token => Ok(token.to_string()),
    }
}

fn resolve_optional_token_value(
    profile: OpenWrtAppProfile,
    existing: Option<&Provider>,
    payload_token: &str,
) -> String {
    match payload_token.trim() {
        "" => existing
            .and_then(|provider| extract_token(profile, provider))
            .map(|(_, token)| token.to_string())
            .unwrap_or_default(),
        token => token.to_string(),
    }
}

fn resolve_model_value(
    profile: OpenWrtAppProfile,
    provider: &Provider,
    payload_model: &str,
) -> Option<String> {
    if let Some(model) = normalize_optional(payload_model.to_string()) {
        return Some(model);
    }

    match profile.app_id {
        "claude" => None,
        _ => extract_model(profile, provider).or_else(|| profile.default_model.map(str::to_string)),
    }
}

fn empty_provider_view(profile: OpenWrtAppProfile) -> OpenWrtProviderView {
    OpenWrtProviderView {
        configured: false,
        active: false,
        provider_id: None,
        name: String::new(),
        base_url: String::new(),
        website_url: None,
        token_field: profile.default_token_field.to_string(),
        token_configured: false,
        token_masked: String::new(),
        model: String::new(),
        notes: String::new(),
        sort_index: None,
        auth_mode: None,
        codex_auth: None,
        claude_auth: None,
    }
}

fn provider_to_view(
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    provider: &Provider,
    active_provider_id: Option<&str>,
) -> OpenWrtProviderView {
    let (token_field, token_value) =
        extract_token(profile, provider).unwrap_or((profile.default_token_field, ""));

    let auth_mode = provider
        .settings_config
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(|auth_mode| {
            if matches!(app_type, AppType::Codex) && is_codex_oauth_auth_mode(Some(auth_mode)) {
                "codex_oauth".to_string()
            } else {
                auth_mode.to_string()
            }
        });

    let codex_auth = if matches!(app_type, AppType::Codex) {
        match load_codex_auth_summary_for_provider(&provider.id) {
            Ok(summary) => summary,
            Err(error) => {
                log::warn!(
                    "failed to load stored codex auth summary for {}: {}",
                    provider.id,
                    error
                );
                None
            }
        }
    } else {
        None
    };
    let claude_auth = if matches!(app_type, AppType::Claude) {
        match load_claude_auth_summary_for_provider(&provider.id) {
            Ok(summary) => summary,
            Err(error) => {
                log::warn!(
                    "failed to load stored Claude auth summary for {}: {}",
                    provider.id,
                    error
                );
                None
            }
        }
    } else {
        None
    };

    OpenWrtProviderView {
        configured: true,
        active: active_provider_id == Some(provider.id.as_str()),
        provider_id: Some(provider.id.clone()),
        name: provider.name.clone(),
        base_url: extract_base_url(profile, provider).unwrap_or_default(),
        website_url: provider.website_url.clone(),
        token_field: token_field.to_string(),
        token_configured: !token_value.is_empty()
            || claude_auth
                .as_ref()
                .is_some_and(|a| a.refresh_token_present),
        token_masked: mask_secret(token_value),
        model: extract_model(profile, provider).unwrap_or_default(),
        notes: provider.notes.clone().unwrap_or_default(),
        sort_index: provider.sort_index,
        auth_mode,
        codex_auth,
        claude_auth,
    }
}

fn extract_token(profile: OpenWrtAppProfile, provider: &Provider) -> Option<(&'static str, &str)> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(extract_claude_token_from_env),
        "codex" => extract_token_with_fallbacks(provider, CODEX_TOKEN_FIELD, &["auth", "env"]),
        "gemini" => extract_token_with_fallbacks(provider, GEMINI_TOKEN_FIELD, &["env"]),
        _ => None,
    }
}

fn extract_claude_token_from_env(
    env: &serde_json::Map<String, Value>,
) -> Option<(&'static str, &str)> {
    for key in [CLAUDE_DEFAULT_TOKEN_FIELD, CLAUDE_ALT_TOKEN_FIELD] {
        if let Some(value) = env
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((key, value));
        }
    }

    if env.contains_key(CLAUDE_DEFAULT_TOKEN_FIELD) {
        return Some((CLAUDE_DEFAULT_TOKEN_FIELD, ""));
    }
    if env.contains_key(CLAUDE_ALT_TOKEN_FIELD) {
        return Some((CLAUDE_ALT_TOKEN_FIELD, ""));
    }

    None
}

fn extract_token_with_fallbacks<'a>(
    provider: &'a Provider,
    token_field: &'static str,
    object_keys: &[&str],
) -> Option<(&'static str, &'a str)> {
    for object_key in object_keys {
        if let Some(object) = provider
            .settings_config
            .get(*object_key)
            .and_then(Value::as_object)
        {
            if let Some(value) = object.get(token_field).and_then(Value::as_str) {
                return Some((token_field, value.trim()));
            }
            if object.contains_key(token_field) {
                return Some((token_field, ""));
            }
        }
    }

    if let Some(value) = provider
        .settings_config
        .get("apiKey")
        .or_else(|| provider.settings_config.get("api_key"))
        .and_then(Value::as_str)
    {
        return Some((token_field, value.trim()));
    }

    None
}

fn extract_base_url(profile: OpenWrtAppProfile, provider: &Provider) -> Option<String> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])),
        "codex" => extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])
            .or_else(|| {
                provider
                    .settings_config
                    .get("config")
                    .and_then(Value::as_str)
                    .and_then(extract_codex_base_url_from_toml)
            }),
        "gemini" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("GOOGLE_GEMINI_BASE_URL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])),
        _ => None,
    }
}

fn extract_model(profile: OpenWrtAppProfile, provider: &Provider) -> Option<String> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("ANTHROPIC_MODEL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string()),
        "codex" => extract_direct_string(&provider.settings_config, &["model"]).or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .and_then(extract_codex_model_from_toml)
        }),
        "gemini" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("GEMINI_MODEL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["model"])),
        _ => None,
    }
}

fn extract_direct_string(root: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| root.get(*key).and_then(Value::as_str))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_codex_base_url_from_toml(config: &str) -> Option<String> {
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
            {
                let trimmed = url.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        if let Some(url) = table.get("base_url").and_then(|value| value.as_str()) {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn extract_codex_model_from_toml(config: &str) -> Option<String> {
    toml::from_str::<toml::Table>(config)
        .ok()
        .and_then(|table| {
            table
                .get("model")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .filter(|value| !value.trim().is_empty())
}

fn default_codex_config(
    provider_id: &str,
    provider_name: &str,
    base_url: &str,
    model: Option<&str>,
) -> String {
    let provider_key = sanitize_codex_provider_key(provider_name, provider_id);
    let display_name = provider_name.replace('"', "'");
    let model_line = model
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("model = \"{}\"\n", value.replace('"', "'")))
        .unwrap_or_default();

    format!(
        "model_provider = \"{provider_key}\"\n\
{model_line}model_reasoning_effort = \"high\"\n\
disable_response_storage = true\n\
\n\
[model_providers.{provider_key}]\n\
name = \"{display_name}\"\n\
base_url = \"{base_url}\"\n\
wire_api = \"responses\"\n\
requires_openai_auth = true\n"
    )
}

fn sanitize_codex_provider_key(provider_name: &str, provider_id: &str) -> String {
    let source = if provider_name.trim().is_empty() {
        provider_id
    } else {
        provider_name
    };

    let sanitized = sanitize_provider_name(source)
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "custom".to_string()
    } else {
        sanitized
    }
}

fn mask_secret(secret: &str) -> String {
    if secret.is_empty() {
        return String::new();
    }

    let suffix: String = secret
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("********{suffix}")
}

fn redact_endpoint(endpoint: &str) -> String {
    let Ok(mut url) = url::Url::parse(endpoint) else {
        return sanitize_failure_message(endpoint, None);
    };

    if url.password().is_some() {
        let _ = url.set_password(Some("redacted"));
    }

    if url.query().is_some() {
        let pairs = url
            .query_pairs()
            .map(|(key, value)| {
                let key_string = key.into_owned();
                let lower = key_string.to_ascii_lowercase();
                let value_string = if lower.contains("key")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("auth")
                {
                    "redacted".to_string()
                } else {
                    value.into_owned()
                };
                (key_string, value_string)
            })
            .collect::<Vec<_>>();
        url.set_query(None);
        {
            let mut query = url.query_pairs_mut();
            for (key, value) in pairs {
                query.append_pair(&key, &value);
            }
        }
    }

    url.set_fragment(None);
    url.to_string()
}

fn sanitize_failure_message(message: &str, secret: Option<&str>) -> String {
    let mut sanitized = message.to_string();

    if let Some(secret) = secret.map(str::trim).filter(|secret| !secret.is_empty()) {
        sanitized = sanitized.replace(secret, "[redacted]");
    }

    for marker in ["Authorization: Bearer ", "Bearer "] {
        if let Some(index) = sanitized.find(marker) {
            let start = index + marker.len();
            let end = sanitized[start..]
                .find(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'')
                .map(|offset| start + offset)
                .unwrap_or(sanitized.len());
            sanitized.replace_range(start..end, "[redacted]");
        }
    }

    const MAX_ERROR_CHARS: usize = 500;
    if sanitized.chars().count() > MAX_ERROR_CHARS {
        sanitized = sanitized.chars().take(MAX_ERROR_CHARS).collect::<String>();
        sanitized.push_str("...");
    }

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::get, Json, Router};
    use serial_test::serial;
    use tempfile::TempDir;

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        tmp: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
        original_data_dir: Option<String>,
    }

    impl TestEnv {
        fn new() -> Self {
            let guard = crate::settings::test_env_lock()
                .lock()
                .expect("lock test env");
            let tmp = TempDir::new().expect("create temp dir");
            let home = tmp.path().join("home");
            let data = tmp.path().join("data");

            std::fs::create_dir_all(home.join(".cc-switch")).expect("create home dir");
            std::fs::create_dir_all(&data).expect("create data dir");

            let original_home = std::env::var("HOME").ok();
            let original_userprofile = std::env::var("USERPROFILE").ok();
            let original_test_home = std::env::var("CC_SWITCH_TEST_HOME").ok();
            let original_data_dir = std::env::var("CC_SWITCH_DATA_DIR").ok();

            std::env::set_var("HOME", &home);
            std::env::set_var("USERPROFILE", &home);
            std::env::set_var("CC_SWITCH_TEST_HOME", &home);
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);
            crate::settings::reload_settings().expect("reload settings");

            Self {
                _guard: guard,
                tmp,
                original_home,
                original_userprofile,
                original_test_home,
                original_data_dir,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            if let Some(value) = &self.original_home {
                std::env::set_var("HOME", value);
            } else {
                std::env::remove_var("HOME");
            }

            if let Some(value) = &self.original_userprofile {
                std::env::set_var("USERPROFILE", value);
            } else {
                std::env::remove_var("USERPROFILE");
            }

            if let Some(value) = &self.original_test_home {
                std::env::set_var("CC_SWITCH_TEST_HOME", value);
            } else {
                std::env::remove_var("CC_SWITCH_TEST_HOME");
            }

            if let Some(value) = &self.original_data_dir {
                std::env::set_var("CC_SWITCH_DATA_DIR", value);
            } else {
                std::env::remove_var("CC_SWITCH_DATA_DIR");
            }

            crate::settings::reload_settings().expect("reload settings after restore");
            let _ = &self.tmp;
        }
    }

    struct ProxyEnvGuard {
        original: Vec<(&'static str, Option<String>)>,
    }

    impl ProxyEnvGuard {
        fn clear() -> Self {
            let keys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"];
            let original = keys
                .into_iter()
                .map(|key| {
                    let value = std::env::var(key).ok();
                    std::env::remove_var(key);
                    (key, value)
                })
                .collect();

            Self { original }
        }
    }

    impl Drop for ProxyEnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.original {
                if let Some(value) = value {
                    std::env::set_var(key, value);
                } else {
                    std::env::remove_var(key);
                }
            }
        }
    }

    fn sample_payload(name: &str, token: &str) -> ClaudeProviderPayload {
        ClaudeProviderPayload {
            provider_id: None,
            name: name.to_string(),
            base_url: "https://example.test".to_string(),
            website_url: None,
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: token.to_string(),
            model: "claude-sonnet".to_string(),
            notes: "notes".to_string(),
            auth_mode: None,
            auth_content: None,
        }
    }

    fn codex_payload(name: &str, token: &str, auth_mode: Option<&str>) -> OpenWrtProviderPayload {
        OpenWrtProviderPayload {
            provider_id: None,
            name: name.to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            website_url: None,
            token_field: CODEX_TOKEN_FIELD.to_string(),
            token: token.to_string(),
            model: "gpt-5.4".to_string(),
            notes: "codex".to_string(),
            auth_mode: auth_mode.map(str::to_string),
            auth_content: None,
        }
    }

    fn codex_auth_path(env: &TestEnv, provider_id: &str) -> std::path::PathBuf {
        env.tmp
            .path()
            .join("data")
            .join("codex_auth")
            .join(format!("{provider_id}.json"))
    }

    fn claude_auth_path(env: &TestEnv, provider_id: &str) -> std::path::PathBuf {
        env.tmp
            .path()
            .join("data")
            .join("claude_auth")
            .join(format!("{provider_id}.json"))
    }

    async fn spawn_test_server(router: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("test server addr");
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("serve test server");
        });

        format!("http://{addr}")
    }

    fn save_codex_provider(db: &Database, provider_id: &str, base_url: &str, api_key: &str) {
        let provider = Provider::with_id(
            provider_id.to_string(),
            "Codex Provider".to_string(),
            json!({
                "base_url": base_url,
                "auth": {
                    CODEX_TOKEN_FIELD: api_key,
                },
                "model": "gpt-5.4",
            }),
            None,
        );
        db.save_provider(CODEX_APP_ID, &provider)
            .expect("save codex provider");
    }

    #[tokio::test]
    async fn provider_latency_check_returns_success_status_and_latency() {
        let db = Database::memory().expect("db");
        let base_url =
            spawn_test_server(Router::new().route("/health", get(|| async { "ok" }))).await;
        let endpoint = format!("{base_url}/health");
        save_codex_provider(&db, "provider-a", &endpoint, "sk-latency-secret");

        let view = test_provider_latency(&db, &AppType::Codex, "provider-a")
            .await
            .expect("latency view");

        assert_eq!(view.app, CODEX_APP_ID);
        assert_eq!(view.provider_id, "provider-a");
        assert_eq!(view.endpoint, endpoint);
        assert!(view.success);
        assert_eq!(view.status, Some(200));
        assert!(view.latency_ms.is_some());
        assert!(view.error.is_none());
    }

    #[tokio::test]
    async fn provider_models_returns_sorted_ids_without_secret() {
        let db = Database::memory().expect("db");
        let base_url = spawn_test_server(Router::new().route(
            "/v1/models",
            get(|| async {
                Json(json!({
                    "object": "list",
                    "data": [
                        { "id": "z-model", "owned_by": "vendor" },
                        { "id": "a-model", "owned_by": "vendor" }
                    ]
                }))
            }),
        ))
        .await;
        save_codex_provider(&db, "provider-a", &base_url, "sk-model-secret");

        let view = fetch_provider_models(&db, &AppType::Codex, "provider-a")
            .await
            .expect("models view");

        assert_eq!(view.app, CODEX_APP_ID);
        assert_eq!(view.provider_id, "provider-a");
        assert_eq!(view.endpoint, format!("{base_url}/v1/models"));
        assert!(view.success);
        assert_eq!(view.model_ids, vec!["a-model", "z-model"]);
        assert_eq!(view.models.len(), 2);
        assert!(!serde_json::to_string(&view)
            .expect("serialize view")
            .contains("sk-model-secret"));
    }

    #[tokio::test]
    async fn provider_models_redacts_failure_body() {
        let db = Database::memory().expect("db");
        let base_url = spawn_test_server(Router::new().route(
            "/v1/models",
            get(|| async {
                (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "upstream rejected sk-redacted-secret",
                )
            }),
        ))
        .await;
        save_codex_provider(&db, "provider-a", &base_url, "sk-redacted-secret");

        let view = fetch_provider_models(&db, &AppType::Codex, "provider-a")
            .await
            .expect("models failure view");

        assert!(!view.success);
        assert!(view.model_ids.is_empty());
        let error = view.error.expect("redacted error");
        assert!(!error.contains("sk-redacted-secret"));
        assert!(error.contains("[redacted]"));
    }

    #[tokio::test]
    async fn provider_endpoint_actions_reject_unsupported_app_and_missing_provider() {
        let db = Database::memory().expect("db");

        let unsupported = fetch_provider_models(&db, &AppType::Hermes, "provider-a")
            .await
            .expect_err("Hermes should be unsupported");
        assert!(unsupported.to_string().contains("Hermes is not supported"));

        let missing = test_provider_latency(&db, &AppType::Codex, "missing-provider")
            .await
            .expect_err("missing provider should fail");
        assert!(missing
            .to_string()
            .contains("codex provider missing-provider does not exist"));
    }

    fn sample_claude_auth_json() -> Vec<u8> {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-access-token",
                "refreshToken": "refresh-token",
                "expiresAt": 1_738_000_000_123i64,
                "scopes": ["user:profile", "user:inference"],
                "subscriptionType": "pro"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_codex_auth_json() -> Vec<u8> {
        serde_json::json!({
            "tokens": {
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "account_id": "acc-123"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn status_for_app<'a>(
        status: &'a OpenWrtRuntimeStatusView,
        app: &str,
    ) -> &'a OpenWrtAppRuntimeStatusView {
        status
            .apps
            .iter()
            .find(|entry| entry.app == app)
            .expect("status entry for app")
    }

    fn insert_request_log(
        db: &Database,
        request_id: &str,
        provider_id: &str,
        app_type: &str,
        model: &str,
        status_code: u16,
        created_at: i64,
    ) {
        let conn = db.conn.lock().expect("lock conn");
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model,
                input_tokens, output_tokens, total_cost_usd,
                latency_ms, status_code, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                request_id,
                provider_id,
                app_type,
                model,
                120,
                48,
                "0.012300",
                245,
                status_code,
                created_at
            ],
        )
        .expect("insert request log");
    }

    async fn spawn_status_server(mut status: ProxyStatus) -> (u16, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind status listener");
        let port = listener.local_addr().expect("status listener addr").port();
        status.port = port;

        let app = Router::new().route(
            "/status",
            get({
                let status = status.clone();
                move || {
                    let status = status.clone();
                    async move { Json(status) }
                }
            }),
        );

        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve runtime status");
        });

        (port, handle)
    }

    #[tokio::test]
    #[serial]
    async fn outbound_proxy_test_reports_no_proxy_without_network_request() {
        let _env = TestEnv::new();
        let _proxy_env = ProxyEnvGuard::clear();
        let db = Database::memory().expect("db");

        let result = test_outbound_proxy(&db, OpenWrtOutboundProxyTestPayload::default())
            .await
            .expect("proxy test");

        assert!(!result.configured);
        assert!(!result.http_proxy_configured);
        assert!(!result.https_proxy_configured);
        assert_eq!(result.source, "configured");
        assert_eq!(result.proxy_url, None);
        assert_eq!(result.test_url, DEFAULT_OUTBOUND_PROXY_TEST_URL);
        assert!(!result.tested);
        assert!(!result.success);
        assert_eq!(result.status, None);
        assert_eq!(result.latency_ms, None);
        assert_eq!(
            result.error.as_deref(),
            Some("no outbound proxy configured")
        );
    }

    #[tokio::test]
    #[serial]
    async fn outbound_proxy_test_rejects_invalid_configured_proxy_without_leaking_credentials() {
        let _env = TestEnv::new();
        let _proxy_env = ProxyEnvGuard::clear();
        let db = Database::memory().expect("db");
        db.set_global_proxy_url(Some("ftp://alice:super-secret@proxy.example:21"))
            .expect("set configured proxy");

        let result = test_outbound_proxy(&db, OpenWrtOutboundProxyTestPayload::default())
            .await
            .expect("proxy test");

        assert!(result.configured);
        assert_eq!(result.source, "configured");
        assert_eq!(result.proxy_url.as_deref(), Some("ftp://proxy.example"));
        assert!(result.tested);
        assert!(!result.success);

        let error = result.error.as_deref().expect("error");
        assert!(error.contains("invalid proxy scheme"));
        assert!(!error.contains("super-secret"));
        assert!(!error.contains("alice:"));
    }

    #[tokio::test]
    #[serial]
    async fn outbound_proxy_test_rejects_invalid_candidate_without_leaking_credentials() {
        let _env = TestEnv::new();
        let _proxy_env = ProxyEnvGuard::clear();
        let db = Database::memory().expect("db");

        let result = test_outbound_proxy(
            &db,
            OpenWrtOutboundProxyTestPayload {
                candidate_proxy_url: Some("ftp://alice:super-secret@proxy.example:21".to_string()),
            },
        )
        .await
        .expect("proxy test");

        assert!(!result.configured);
        assert_eq!(result.source, "candidate");
        assert_eq!(result.proxy_url.as_deref(), Some("ftp://proxy.example"));
        assert!(result.tested);
        assert!(!result.success);

        let error = result.error.as_deref().expect("error");
        assert!(error.contains("invalid proxy scheme"));
        assert!(!error.contains("super-secret"));
        assert!(!error.contains("alice:"));
    }

    #[test]
    fn outbound_proxy_error_redaction_masks_embedded_proxy_credentials() {
        let redacted = redact_proxy_error(
            "connect failed for http://alice:super-secret@proxy.example:8080 via socks5://admin:s3cr3t@proxy2.example:1080",
            Some("http://alice:super-secret@proxy.example:8080"),
        );

        assert!(redacted.contains("http://proxy.example:8080"));
        assert!(redacted.contains("socks5://proxy2.example:1080"));
        assert!(!redacted.contains("super-secret"));
        assert!(!redacted.contains("s3cr3t"));
        assert!(!redacted.contains("alice:"));
        assert!(!redacted.contains("admin:"));
    }

    #[test]
    fn get_provider_stream_check_returns_latest_redacted_result() {
        let db = Database::memory().expect("db");
        let provider = Provider::with_id(
            "provider-a".to_string(),
            "Provider A".to_string(),
            json!({}),
            None,
        );
        db.save_provider(CLAUDE_APP_TYPE, &provider)
            .expect("save provider");

        let result = StreamCheckResult {
            status: HealthStatus::Failed,
            success: false,
            message: "Authorization: Bearer sk-secret-token and api_key: visible-secret"
                .to_string(),
            response_time_ms: Some(42),
            http_status: Some(401),
            model_used: "claude-test".to_string(),
            tested_at: 1234,
            retry_count: 1,
            error_category: Some("auth".to_string()),
        };
        db.save_stream_check_log("provider-a", "Provider A", CLAUDE_APP_TYPE, &result)
            .expect("save stream check");

        let view = get_provider_stream_check(&db, &AppType::Claude, "provider-a")
            .expect("stream check view");
        let check = view.check.expect("latest check");

        assert_eq!(check.app, CLAUDE_APP_TYPE);
        assert_eq!(check.provider_id, "provider-a");
        assert_eq!(check.response_time_ms, Some(42));
        assert_eq!(check.error_category.as_deref(), Some("auth"));
        assert!(!check.message.contains("sk-secret-token"));
        assert!(!check.message.contains("visible-secret"));
        assert!(check.message.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn run_provider_stream_check_returns_structured_failure_and_persists_it() {
        let db = Database::memory().expect("db");
        let provider = Provider::with_id(
            "provider-a".to_string(),
            "Provider A".to_string(),
            json!({}),
            None,
        );
        db.save_provider(CLAUDE_APP_TYPE, &provider)
            .expect("save provider");

        let view = run_provider_stream_check(&db, &AppType::Claude, "provider-a")
            .await
            .expect("run stream check");

        assert_eq!(view.app, CLAUDE_APP_TYPE);
        assert_eq!(view.provider_id, "provider-a");
        assert!(!view.check.success);
        assert_eq!(view.check.status, HealthStatus::Failed);
        assert!(view.check.tested_at > 0);

        let latest = get_provider_stream_check(&db, &AppType::Claude, "provider-a")
            .expect("latest stream check");
        assert!(latest.check.is_some());
    }

    #[test]
    #[serial]
    fn upsert_provider_masks_reads_and_preserves_blank_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let created = upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-1234"),
        )
        .expect("create provider");
        assert_eq!(created.provider_id.as_deref(), Some("provider-a"));
        assert!(created.token_configured);
        assert_eq!(created.token_masked, "********1234");
        assert!(!created.active);

        let mut update = sample_payload("A updated", "");
        update.provider_id = Some("provider-a".to_string());
        update.base_url = "https://updated.example.test".to_string();
        update.model = "claude-opus".to_string();
        let updated =
            upsert_claude_provider_with_payload(&db, None, update).expect("update provider");

        assert_eq!(updated.provider_id.as_deref(), Some("provider-a"));
        assert_eq!(updated.base_url, "https://updated.example.test");
        assert_eq!(updated.model, "claude-opus");
        assert_eq!(updated.token_masked, "********1234");
        assert!(updated.token_configured);

        let stored = db
            .get_provider_by_id("provider-a", CLAUDE_APP_TYPE)
            .expect("load stored provider")
            .expect("stored provider");
        let (_, token) = extract_claude_token(&stored).expect("stored token");
        assert_eq!(token, "secret-1234");
    }

    #[test]
    #[serial]
    fn activate_provider_updates_settings_and_database_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        let activated = activate_claude_provider(&db, "provider-b").expect("activate provider");
        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("provider-b"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn get_request_logs_scopes_results_to_app_and_applies_pagination() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        insert_request_log(
            &db,
            "req-claude-older",
            "provider-a",
            "claude",
            "claude-sonnet",
            200,
            100,
        );
        insert_request_log(&db, "req-codex", "provider-b", "codex", "gpt-5.4", 200, 200);
        insert_request_log(
            &db,
            "req-claude-newer",
            "provider-c",
            "claude",
            "claude-opus",
            502,
            300,
        );

        let page = get_request_logs(
            &db,
            &AppType::Claude,
            Some(0),
            Some(1),
            LogFilters::default(),
        )
        .expect("claude request logs");

        assert_eq!(page.total, 2);
        assert_eq!(page.page, 0);
        assert_eq!(page.page_size, 1);
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].request_id, "req-claude-newer");
        assert_eq!(page.data[0].app_type, "claude");

        let failures = get_request_logs(
            &db,
            &AppType::Claude,
            Some(0),
            Some(10),
            LogFilters {
                status_code: Some(502),
                ..Default::default()
            },
        )
        .expect("filtered request logs");

        assert_eq!(failures.total, 1);
        assert_eq!(failures.data[0].request_id, "req-claude-newer");
    }

    #[test]
    #[serial]
    fn get_request_logs_can_filter_by_provider_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        insert_request_log(
            &db,
            "req-claude-a",
            "provider-a",
            "claude",
            "claude-sonnet",
            200,
            100,
        );
        insert_request_log(
            &db,
            "req-claude-b",
            "provider-b",
            "claude",
            "claude-opus",
            200,
            200,
        );

        let page = get_request_logs(
            &db,
            &AppType::Claude,
            Some(0),
            Some(20),
            LogFilters {
                provider_id: Some("provider-b".to_string()),
                ..Default::default()
            },
        )
        .expect("provider-filtered request logs");

        assert_eq!(page.total, 1);
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].request_id, "req-claude-b");
        assert_eq!(page.data[0].provider_id, "provider-b");
    }

    #[test]
    #[serial]
    fn get_request_detail_rejects_cross_app_lookup() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        insert_request_log(&db, "req-codex", "provider-b", "codex", "gpt-5.4", 200, 200);

        let detail =
            get_request_detail(&db, &AppType::Codex, "req-codex").expect("codex request detail");
        assert_eq!(detail.request_id, "req-codex");
        assert_eq!(detail.app_type, "codex");

        let error = get_request_detail(&db, &AppType::Claude, "req-codex")
            .expect_err("cross-app lookup should fail");
        assert!(error
            .to_string()
            .contains("request log `req-codex` not found for claude"));
    }

    #[test]
    #[serial]
    fn admin_meta_reports_supported_apps_and_codex_capability() {
        let _env = TestEnv::new();

        let meta = get_admin_meta().expect("admin meta");
        assert_eq!(meta.api_version, 1);
        assert_eq!(meta.service.daemon, "cc-switch");
        assert_eq!(meta.service.package_name, "cc-switch");
        assert_eq!(meta.service.luci_package_name, "luci-app-cc-switch");
        assert_eq!(meta.service.version, version::build_version());
        assert_eq!(meta.apps.len(), 3);

        let claude = meta
            .apps
            .iter()
            .find(|entry| entry.app == "claude")
            .expect("claude meta");
        let codex = meta
            .apps
            .iter()
            .find(|entry| entry.app == "codex")
            .expect("codex meta");
        let gemini = meta
            .apps
            .iter()
            .find(|entry| entry.app == "gemini")
            .expect("gemini meta");

        assert_eq!(claude.display_name, "Claude");
        assert!(claude.supports_claude_auth_upload);
        assert!(!claude.supports_codex_auth_upload);
        assert_eq!(codex.default_token_field, CODEX_TOKEN_FIELD);
        assert!(!codex.supports_claude_auth_upload);
        assert!(codex.supports_codex_auth_upload);
        assert_eq!(gemini.display_name, "Gemini");
        assert!(gemini.supports_failover);
    }

    #[test]
    #[serial]
    fn activate_provider_trims_whitespace_padded_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");

        let activated =
            activate_claude_provider(&db, "  provider-a  ").expect("activate trimmed provider");
        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-a")
        );
    }

    #[test]
    #[serial]
    fn delete_active_provider_promotes_remaining_provider() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");

        let deleted = delete_claude_provider(&db, "provider-a").expect("delete provider a");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id.as_deref(), Some("provider-b"));
        assert_eq!(deleted.providers_remaining, 1);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn delete_codex_provider_removes_stored_auth_file() {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_provider_from_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            codex_payload("Codex", "", Some("codex_oauth")),
        )
        .expect("create codex provider");
        upload_codex_auth(
            &db,
            &AppType::Codex,
            "provider-codex",
            &sample_codex_auth_json(),
        )
        .expect("upload auth");
        assert!(codex_auth_path(&env, "provider-codex").exists());

        delete_provider(&db, &AppType::Codex, "provider-codex").expect("delete codex provider");
        assert!(!codex_auth_path(&env, "provider-codex").exists());
    }

    #[test]
    #[serial]
    fn delete_claude_provider_removes_stored_auth_file() {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_provider_with_payload(
            &db,
            &AppType::Claude,
            Some("provider-claude"),
            OpenWrtProviderPayload {
                provider_id: None,
                name: "Claude Official".to_string(),
                base_url: "https://api.anthropic.com".to_string(),
                website_url: None,
                token_field: DEFAULT_TOKEN_FIELD.to_string(),
                token: String::new(),
                model: String::new(),
                notes: String::new(),
                auth_mode: Some("claude_oauth".to_string()),
                auth_content: None,
            },
        )
        .expect("create claude oauth provider");
        upload_claude_auth(
            &db,
            &AppType::Claude,
            "provider-claude",
            &sample_claude_auth_json(),
        )
        .expect("upload auth");
        assert!(claude_auth_path(&env, "provider-claude").exists());

        delete_provider(&db, &AppType::Claude, "provider-claude").expect("delete claude provider");
        assert!(!claude_auth_path(&env, "provider-claude").exists());
    }

    #[test]
    #[serial]
    fn switching_codex_provider_to_api_key_preserves_stored_auth_file_without_auth_content() {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_provider_from_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            codex_payload("Codex", "", Some("codex_oauth")),
        )
        .expect("create codex provider");
        upload_codex_auth(
            &db,
            &AppType::Codex,
            "provider-codex",
            &sample_codex_auth_json(),
        )
        .expect("upload auth");
        assert!(codex_auth_path(&env, "provider-codex").exists());

        upsert_provider_from_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            codex_payload("Codex", "api-key", Some("api_key")),
        )
        .expect("switch to api_key");

        assert!(codex_auth_path(&env, "provider-codex").exists());
    }

    #[test]
    #[serial]
    fn switching_claude_provider_away_from_claude_oauth_preserves_stored_auth_file_without_auth_content(
    ) {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_provider_with_payload(
            &db,
            &AppType::Claude,
            Some("provider-claude"),
            OpenWrtProviderPayload {
                provider_id: None,
                name: "Claude Official".to_string(),
                base_url: "https://api.anthropic.com".to_string(),
                website_url: None,
                token_field: DEFAULT_TOKEN_FIELD.to_string(),
                token: String::new(),
                model: String::new(),
                notes: String::new(),
                auth_mode: Some("claude_oauth".to_string()),
                auth_content: None,
            },
        )
        .expect("create claude oauth provider");
        upload_claude_auth(
            &db,
            &AppType::Claude,
            "provider-claude",
            &sample_claude_auth_json(),
        )
        .expect("upload auth");
        assert!(claude_auth_path(&env, "provider-claude").exists());

        upsert_provider_with_payload(
            &db,
            &AppType::Claude,
            Some("provider-claude"),
            sample_payload("Claude Official", "sk-ant-api-key"),
        )
        .expect("switch away from claude_oauth");

        assert!(claude_auth_path(&env, "provider-claude").exists());
    }

    #[test]
    #[serial]
    fn codex_auth_content_replace_clear_and_preserve_behave_as_requested() {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");
        let initial_auth =
            String::from_utf8(sample_codex_auth_json()).expect("sample codex auth should be utf8");
        let replacement_auth = format!(
            r#"{{"tokens":{{"access_token":"access-two","refresh_token":"refresh-two","account_id":"acct-two"}}}}"#
        );

        let mut create_payload = codex_payload("Codex", "", Some("codex_oauth"));
        create_payload.auth_content = Some(initial_auth.clone());
        upsert_provider_with_payload(&db, &AppType::Codex, Some("provider-codex"), create_payload)
            .expect("create codex provider with auth");
        assert_eq!(
            std::fs::read_to_string(codex_auth_path(&env, "provider-codex"))
                .expect("read initial auth"),
            initial_auth
        );

        let mut replace_payload = codex_payload("Codex Updated", "", Some("codex_oauth"));
        replace_payload.auth_content = Some(replacement_auth.clone());
        upsert_provider_with_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            replace_payload,
        )
        .expect("replace stored auth");
        assert_eq!(
            std::fs::read_to_string(codex_auth_path(&env, "provider-codex"))
                .expect("read replaced auth"),
            replacement_auth
        );

        upsert_provider_with_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            codex_payload("Codex Preserve", "", Some("api_key")),
        )
        .expect("preserve stored auth");
        assert_eq!(
            std::fs::read_to_string(codex_auth_path(&env, "provider-codex"))
                .expect("read preserved auth"),
            replacement_auth
        );

        let mut clear_payload = codex_payload("Codex Cleared", "", Some("api_key"));
        clear_payload.auth_content = Some(String::new());
        upsert_provider_with_payload(&db, &AppType::Codex, Some("provider-codex"), clear_payload)
            .expect("clear stored auth");
        assert!(!codex_auth_path(&env, "provider-codex").exists());
    }

    #[test]
    #[serial]
    fn provider_upsert_rolls_back_when_auth_content_save_fails() {
        let env = TestEnv::new();
        let db = Database::memory().expect("db");
        let initial_auth =
            String::from_utf8(sample_codex_auth_json()).expect("sample codex auth should be utf8");

        let mut initial_payload = codex_payload("Codex Stable", "", Some("codex_oauth"));
        initial_payload.auth_content = Some(initial_auth.clone());
        upsert_provider_with_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            initial_payload,
        )
        .expect("create baseline provider");

        let oversized_auth = "x".repeat(codex_auth_upload_limit_bytes() + 1);
        let mut failing_payload = codex_payload("Codex Broken", "sk-broken", Some("api_key"));
        failing_payload.base_url = "https://broken.example/v1".to_string();
        failing_payload.model = "gpt-5.5".to_string();
        failing_payload.auth_content = Some(oversized_auth);

        let error = upsert_provider_with_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            failing_payload,
        )
        .expect_err("oversized auth should fail");
        assert!(error.to_string().contains("authContent exceeds"));

        let reloaded = get_provider(&db, &AppType::Codex, "provider-codex")
            .expect("reload provider after rollback");
        assert_eq!(reloaded.name, "Codex Stable");
        assert_eq!(reloaded.base_url, "https://api.openai.com/v1");
        assert_eq!(reloaded.model, "gpt-5.4");
        assert_eq!(
            std::fs::read_to_string(codex_auth_path(&env, "provider-codex"))
                .expect("read auth after rollback"),
            initial_auth
        );
    }

    #[test]
    #[serial]
    fn delete_last_active_provider_clears_current_selection() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_active_claude_provider_with_payload(&db, sample_payload("Only", "secret-only"))
            .expect("create active provider");

        let deleted =
            delete_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("delete last provider");
        assert_eq!(deleted.active_provider_id, None);
        assert_eq!(deleted.providers_remaining, 0);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn delete_inactive_provider_preserves_no_active_selection() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        assert_eq!(
            resolve_claude_active_provider_id(&db).expect("resolve active"),
            None
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );

        let deleted = delete_claude_provider(&db, "provider-a").expect("delete inactive provider");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id, None);
        assert_eq!(deleted.providers_remaining, 1);
        assert_eq!(
            resolve_claude_active_provider_id(&db).expect("resolve active"),
            None
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn delete_provider_trims_whitespace_padded_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");

        let deleted =
            delete_claude_provider(&db, "  provider-a  ").expect("delete trimmed provider a");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id.as_deref(), Some("provider-b"));
        assert_eq!(deleted.providers_remaining, 1);
        assert!(db
            .get_provider_by_id("provider-a", CLAUDE_APP_TYPE)
            .expect("load deleted provider")
            .is_none());
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn legacy_get_active_provider_falls_back_to_default_slot_when_no_provider_is_marked_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");

        assert!(active.configured);
        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(active.name, "Phase1");
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn legacy_read_surfaces_fall_back_to_default_slot_when_no_provider_is_marked_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");
        let provider = get_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("read provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert!(provider.active);
        assert_eq!(provider.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(
            list.active_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(list.providers.len(), 1);
        assert_eq!(
            list.providers[0].provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert!(list.providers[0].active);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn reorder_providers_persists_full_provider_order_and_preserves_active() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Provider B", "secret-b"),
        )
        .expect("create provider b");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-c"),
            sample_payload("Provider C", "secret-c"),
        )
        .expect("create provider c");
        activate_claude_provider(&db, "provider-b").expect("activate provider b");

        let reordered = reorder_providers(
            &db,
            &AppType::Claude,
            &[
                "provider-c".to_string(),
                "provider-a".to_string(),
                "provider-b".to_string(),
            ],
        )
        .expect("reorder providers");
        let ids = reordered
            .providers
            .iter()
            .filter_map(|provider| provider.provider_id.as_deref())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["provider-c", "provider-a", "provider-b"]);
        assert_eq!(reordered.active_provider_id.as_deref(), Some("provider-b"));
        assert!(reordered.providers[2].active);
        assert_eq!(reordered.providers[0].sort_index, Some(0));
        assert_eq!(reordered.providers[1].sort_index, Some(1));
        assert_eq!(reordered.providers[2].sort_index, Some(2));

        let reloaded = list_claude_providers(&db).expect("reload provider list");
        let reloaded_ids = reloaded
            .providers
            .iter()
            .filter_map(|provider| provider.provider_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(reloaded_ids, ids);
    }

    #[test]
    #[serial]
    fn reorder_providers_updates_failover_queue_priority_for_mixed_provider_list() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Provider B", "secret-b"),
        )
        .expect("create provider b");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-c"),
            sample_payload("Provider C", "secret-c"),
        )
        .expect("create provider c");
        db.add_to_failover_queue(CLAUDE_APP_TYPE, "provider-a")
            .expect("queue provider a");
        db.add_to_failover_queue(CLAUDE_APP_TYPE, "provider-c")
            .expect("queue provider c");

        let display_order_before = list_claude_providers(&db).expect("list before reorder");
        assert_eq!(
            display_order_before
                .providers
                .iter()
                .filter_map(|provider| provider.provider_id.as_deref())
                .collect::<Vec<_>>(),
            vec!["provider-a", "provider-b", "provider-c"]
        );

        let queue_before = db
            .get_failover_queue(CLAUDE_APP_TYPE)
            .expect("queue before reorder");
        assert_eq!(
            queue_before
                .iter()
                .map(|entry| entry.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["provider-a", "provider-c"]
        );

        let reordered = reorder_providers(
            &db,
            &AppType::Claude,
            &[
                "provider-c".to_string(),
                "provider-b".to_string(),
                "provider-a".to_string(),
            ],
        )
        .expect("reorder providers");
        assert_eq!(
            reordered
                .providers
                .iter()
                .filter_map(|provider| provider.provider_id.as_deref())
                .collect::<Vec<_>>(),
            vec!["provider-c", "provider-b", "provider-a"]
        );

        let queue_after = db
            .get_failover_queue(CLAUDE_APP_TYPE)
            .expect("queue after provider reorder");
        assert_eq!(
            queue_after
                .iter()
                .map(|entry| (entry.provider_id.as_str(), entry.sort_index))
                .collect::<Vec<_>>(),
            vec![("provider-c", Some(0)), ("provider-a", Some(1))]
        );
    }

    #[test]
    #[serial]
    fn reorder_providers_rejects_partial_provider_order() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Provider B", "secret-b"),
        )
        .expect("create provider b");

        let error = reorder_providers(&db, &AppType::Claude, &["provider-b".to_string()])
            .expect_err("partial provider order should fail");
        assert!(error
            .to_string()
            .contains("provider reorder must include every saved provider exactly once"));

        let list = list_claude_providers(&db).expect("list after failed reorder");
        let ids = list
            .providers
            .iter()
            .filter_map(|provider| provider.provider_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["provider-a", "provider-b"]);
    }

    #[test]
    #[serial]
    fn legacy_upsert_active_provider_uses_phase_one_default_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let active =
            upsert_active_claude_provider_with_payload(&db, sample_payload("Phase1", "secret"))
                .expect("upsert active provider");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
    }

    #[test]
    #[serial]
    fn legacy_upsert_active_provider_ignores_payload_provider_id_when_no_provider_is_active() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let mut payload = sample_payload("Phase1", "secret");
        payload.provider_id = Some("provider-b".to_string());

        let active = upsert_active_claude_provider_with_payload(&db, payload)
            .expect("upsert active provider with payload provider id");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert!(db
            .get_provider_by_id("provider-b", CLAUDE_APP_TYPE)
            .expect("load payload-selected provider")
            .is_none());
        assert!(db
            .get_provider_by_id(DEFAULT_PROVIDER_ID, CLAUDE_APP_TYPE)
            .expect("load default provider")
            .is_some());
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
    }

    #[test]
    #[serial]
    fn legacy_upsert_provider_response_matches_follow_up_reads_when_default_slot_is_effectively_active(
    ) {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let mut payload = sample_payload("Phase1 updated", "secret-updated");
        payload.provider_id = Some(DEFAULT_PROVIDER_ID.to_string());
        let upserted = upsert_claude_provider_with_payload(&db, Some(DEFAULT_PROVIDER_ID), payload)
            .expect("update default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");
        let provider = get_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("read provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert!(upserted.active);
        assert_eq!(upserted.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(active.provider_id, upserted.provider_id);
        assert!(provider.active);
        assert_eq!(provider.provider_id, upserted.provider_id);
        assert_eq!(list.active_provider_id, upserted.provider_id);
        assert_eq!(list.providers.len(), 1);
        assert!(list.providers[0].active);
        assert_eq!(list.providers[0].provider_id, upserted.provider_id);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn legacy_delete_provider_response_matches_follow_up_reads_when_default_slot_is_effectively_active(
    ) {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        let deleted = delete_claude_provider(&db, "provider-b").expect("delete provider b");
        let active = get_active_claude_provider(&db).expect("read active provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert_eq!(deleted.deleted_provider_id, "provider-b");
        assert_eq!(
            deleted.active_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(deleted.providers_remaining, 1);
        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(list.active_provider_id, deleted.active_provider_id);
        assert_eq!(list.providers.len(), 1);
        assert!(list.providers[0].active);
        assert_eq!(
            list.providers[0].provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn codex_provider_round_trip_uses_openai_token_and_toml_config() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Codex Relay".to_string(),
            base_url: "https://codex.example/v1".to_string(),
            website_url: Some("https://codex.example".to_string()),
            token_field: CODEX_TOKEN_FIELD.to_string(),
            token: "sk-codex-secret".to_string(),
            model: "gpt-5.4".to_string(),
            notes: "codex-notes".to_string(),
            auth_mode: None,
            auth_content: None,
        };

        let created = upsert_provider_with_payload(&db, &AppType::Codex, Some("codex-a"), payload)
            .expect("create codex provider");

        assert_eq!(created.provider_id.as_deref(), Some("codex-a"));
        assert_eq!(created.token_field, CODEX_TOKEN_FIELD);
        assert_eq!(created.base_url, "https://codex.example/v1");
        assert_eq!(
            created.website_url.as_deref(),
            Some("https://codex.example")
        );
        assert_eq!(created.model, "gpt-5.4");
        assert_eq!(created.token_masked, "********cret");

        let stored = db
            .get_provider_by_id("codex-a", CODEX_APP_ID)
            .expect("load stored codex provider")
            .expect("stored codex provider");
        assert_eq!(
            stored
                .settings_config
                .get("auth")
                .and_then(|value| value.get(CODEX_TOKEN_FIELD))
                .and_then(Value::as_str),
            Some("sk-codex-secret")
        );
        assert_eq!(
            stored
                .settings_config
                .get("base_url")
                .and_then(Value::as_str),
            Some("https://codex.example/v1")
        );
        assert_eq!(stored.website_url.as_deref(), Some("https://codex.example"));
        assert!(stored
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("base_url = \"https://codex.example/v1\""));
    }

    #[test]
    #[serial]
    fn claude_client_passthrough_provider_allows_empty_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Claude Official".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            website_url: None,
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: String::new(),
            model: String::new(),
            notes: String::new(),
            auth_mode: Some("client_passthrough".to_string()),
            auth_content: None,
        };

        let created =
            upsert_provider_with_payload(&db, &AppType::Claude, Some("claude-pt"), payload)
                .expect("create passthrough provider");

        assert!(created.configured);
        assert!(!created.token_configured);
        assert_eq!(created.auth_mode.as_deref(), Some("client_passthrough"));

        let view =
            get_provider(&db, &AppType::Claude, "claude-pt").expect("reload passthrough provider");
        assert_eq!(view.auth_mode.as_deref(), Some("client_passthrough"));
    }

    #[test]
    #[serial]
    fn claude_claude_oauth_provider_allows_empty_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Claude Official".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            website_url: None,
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: String::new(),
            model: String::new(),
            notes: String::new(),
            auth_mode: Some("claude_oauth".to_string()),
            auth_content: None,
        };

        let created =
            upsert_provider_with_payload(&db, &AppType::Claude, Some("claude-oauth"), payload)
                .expect("create claude oauth provider");

        assert!(created.configured);
        assert!(!created.token_configured);
        assert_eq!(created.auth_mode.as_deref(), Some("claude_oauth"));

        let stored = db
            .get_provider_by_id("claude-oauth", CLAUDE_APP_ID)
            .expect("db lookup")
            .expect("provider exists");
        assert_eq!(
            stored
                .settings_config
                .get("auth_mode")
                .and_then(Value::as_str),
            Some("claude_oauth")
        );
    }

    #[test]
    #[serial]
    fn claude_oauth_provider_with_uploaded_auth_is_token_configured() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Claude Official".to_string(),
            base_url: "https://api.anthropic.com".to_string(),
            website_url: None,
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: String::new(),
            model: String::new(),
            notes: String::new(),
            auth_mode: Some("claude_oauth".to_string()),
            auth_content: None,
        };
        upsert_provider_with_payload(&db, &AppType::Claude, Some("claude-oauth"), payload)
            .expect("create claude oauth provider");

        // Before auth upload: no refresh token on disk, so token_configured = false.
        let view_before = get_provider(&db, &AppType::Claude, "claude-oauth")
            .expect("get provider before upload");
        assert!(!view_before.token_configured, "no auth on disk yet");

        // Upload auth with a refresh_token present.
        upload_claude_auth(
            &db,
            &AppType::Claude,
            "claude-oauth",
            &sample_claude_auth_json(),
        )
        .expect("upload auth");

        // After upload: refresh_token_present = true → token_configured = true.
        let view_after =
            get_provider(&db, &AppType::Claude, "claude-oauth").expect("get provider after upload");
        assert!(
            view_after.token_configured,
            "refresh_token present should make token_configured true"
        );
        assert_eq!(
            view_after
                .claude_auth
                .as_ref()
                .map(|a| a.refresh_token_present),
            Some(true)
        );
    }

    #[test]
    #[serial]
    fn upload_claude_auth_rejects_non_claude_app() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_provider_from_payload(
            &db,
            &AppType::Codex,
            Some("provider-codex"),
            codex_payload("Codex", "api-key", Some("api_key")),
        )
        .expect("create codex provider");

        let error = upload_claude_auth(
            &db,
            &AppType::Codex,
            "provider-codex",
            &sample_claude_auth_json(),
        )
        .expect_err("non-claude upload should fail");
        assert!(error
            .to_string()
            .contains("upload-claude-auth is only supported for claude"));
    }

    #[test]
    #[serial]
    fn codex_codex_oauth_provider_allows_empty_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "OpenAI Official".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            website_url: None,
            token_field: CODEX_TOKEN_FIELD.to_string(),
            token: String::new(),
            model: "gpt-5.4".to_string(),
            notes: String::new(),
            auth_mode: Some("codex_oauth".to_string()),
            auth_content: None,
        };

        let created =
            upsert_provider_with_payload(&db, &AppType::Codex, Some("codex-oauth"), payload)
                .expect("create codex oauth provider");

        assert!(created.configured);
        assert!(!created.token_configured);
        assert_eq!(created.auth_mode.as_deref(), Some("codex_oauth"));

        let stored = db
            .get_provider_by_id("codex-oauth", CODEX_APP_ID)
            .expect("db lookup")
            .expect("provider exists");
        assert_eq!(
            stored
                .settings_config
                .get("auth_mode")
                .and_then(Value::as_str),
            Some("codex_oauth")
        );
    }

    #[test]
    #[serial]
    fn codex_legacy_client_passthrough_view_is_normalized_to_codex_oauth() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let provider = Provider {
            id: "legacy-codex".to_string(),
            name: "Legacy Codex".to_string(),
            settings_config: json!({
                "auth_mode": "client_passthrough",
                "base_url": "https://api.openai.com/v1",
                "auth": {
                    "OPENAI_API_KEY": ""
                }
            }),
            website_url: None,
            category: Some("codex".to_string()),
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        db.save_provider(CODEX_APP_ID, &provider)
            .expect("insert provider");

        let view = get_provider(&db, &AppType::Codex, "legacy-codex")
            .expect("reload legacy codex provider");
        assert_eq!(view.auth_mode.as_deref(), Some("codex_oauth"));
    }

    #[test]
    #[serial]
    fn claude_non_passthrough_provider_requires_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/anthropic".to_string(),
            website_url: None,
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: String::new(),
            model: "DeepSeek-V3.2".to_string(),
            notes: String::new(),
            auth_mode: None,
            auth_content: None,
        };

        let result = upsert_provider_with_payload(&db, &AppType::Claude, None, payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("token is required"));
    }

    #[test]
    #[serial]
    fn gemini_provider_activation_updates_database_and_settings_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload_a = OpenWrtProviderPayload {
            provider_id: None,
            name: "Gemini A".to_string(),
            base_url: "https://gemini-a.example/v1beta".to_string(),
            website_url: None,
            token_field: GEMINI_TOKEN_FIELD.to_string(),
            token: "gemini-a-secret".to_string(),
            model: "gemini-3.1-pro".to_string(),
            notes: String::new(),
            auth_mode: None,
            auth_content: None,
        };
        let payload_b = OpenWrtProviderPayload {
            provider_id: None,
            name: "Gemini B".to_string(),
            base_url: "https://gemini-b.example/v1beta".to_string(),
            website_url: None,
            token_field: GEMINI_TOKEN_FIELD.to_string(),
            token: "gemini-b-secret".to_string(),
            model: "gemini-3.1-pro".to_string(),
            notes: String::new(),
            auth_mode: None,
            auth_content: None,
        };

        upsert_provider_with_payload(&db, &AppType::Gemini, Some("gemini-a"), payload_a)
            .expect("create gemini a");
        upsert_provider_with_payload(&db, &AppType::Gemini, Some("gemini-b"), payload_b)
            .expect("create gemini b");

        let activated =
            activate_provider(&db, &AppType::Gemini, "gemini-b").expect("activate gemini provider");

        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("gemini-b"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Gemini).as_deref(),
            Some("gemini-b")
        );
        assert_eq!(
            db.get_current_provider(GEMINI_APP_ID)
                .expect("load gemini db current")
                .as_deref(),
            Some("gemini-b")
        );
    }

    #[test]
    #[serial]
    fn available_failover_providers_reject_unsupported_apps() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let error = get_available_failover_providers(&db, &AppType::OpenCode)
            .expect_err("unsupported app should fail");

        assert!(error
            .to_string()
            .contains("OpenWrt provider management is not implemented"));

        let hermes_error =
            parse_supported_app("hermes").expect_err("Hermes should stay unsupported");
        assert!(hermes_error
            .to_string()
            .contains("Hermes is not supported in proxy-daemon"));
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn add_to_failover_queue_rejects_provider_ids_from_other_apps() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Codex Relay".to_string(),
            base_url: "https://codex.example/v1".to_string(),
            website_url: None,
            token_field: CODEX_TOKEN_FIELD.to_string(),
            token: "sk-codex-secret".to_string(),
            model: "gpt-5.4".to_string(),
            notes: String::new(),
            auth_mode: None,
            auth_content: None,
        };

        upsert_provider_with_payload(&db, &AppType::Codex, Some("shared-id"), payload)
            .expect("create codex provider");

        let error = add_to_failover_queue(&db, &AppType::Claude, "shared-id")
            .await
            .expect_err("cross-app provider should fail");

        assert!(error
            .to_string()
            .contains("claude provider shared-id does not exist"));
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn failover_queue_mutations_refresh_available_providers_and_clear_health_on_remove() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Provider B", "secret-b"),
        )
        .expect("create provider b");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-c"),
            sample_payload("Provider C", "secret-c"),
        )
        .expect("create provider c");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");
        add_to_failover_queue(&db, &AppType::Claude, "provider-a")
            .await
            .expect("queue provider a");
        set_auto_failover_enabled(&db, &AppType::Claude, true)
            .await
            .expect("enable auto failover");

        let queued = add_to_failover_queue(&db, &AppType::Claude, "provider-b")
            .await
            .expect("queue provider b");

        assert_eq!(queued.failover_queue_depth, 2);
        assert_eq!(queued.failover_queue[0].provider_id, "provider-a");
        assert_eq!(queued.failover_queue[1].provider_id, "provider-b");
        assert_eq!(queued.active_provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load current provider after queue add")
                .as_deref(),
            Some("provider-a")
        );

        let available_after_add = get_available_failover_providers(&db, &AppType::Claude)
            .expect("list available providers after add");
        let available_ids_after_add = available_after_add
            .iter()
            .filter_map(|provider| provider.provider_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(available_ids_after_add, vec!["provider-c"]);

        let mut updated_payload = sample_payload("Provider B Updated", "");
        updated_payload.provider_id = Some("provider-b".to_string());
        upsert_claude_provider_with_payload(&db, None, updated_payload)
            .expect("update queued provider");

        let queue_after_update = db
            .get_failover_queue(CLAUDE_APP_TYPE)
            .expect("queue after provider update");
        assert_eq!(queue_after_update.len(), 2);
        assert_eq!(queue_after_update[0].provider_id, "provider-a");
        assert_eq!(queue_after_update[1].provider_id, "provider-b");

        db.update_provider_health(
            "provider-b",
            CLAUDE_APP_TYPE,
            false,
            Some("timeout".to_string()),
        )
        .await
        .expect("record provider b health");

        let removed = remove_from_failover_queue(&db, &AppType::Claude, "provider-b")
            .await
            .expect("remove provider b from queue");

        assert_eq!(removed.failover_queue_depth, 1);
        assert_eq!(removed.failover_queue[0].provider_id, "provider-a");
        assert_eq!(removed.active_provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load current provider after queue removal")
                .as_deref(),
            Some("provider-a")
        );

        let available_after_remove = get_available_failover_providers(&db, &AppType::Claude)
            .expect("list available providers after remove");
        let available_ids_after_remove = available_after_remove
            .iter()
            .filter_map(|provider| provider.provider_id.as_deref())
            .collect::<Vec<_>>();
        assert_eq!(available_ids_after_remove, vec!["provider-b", "provider-c"]);

        let health_records = db
            .list_provider_health_records(CLAUDE_APP_TYPE)
            .await
            .expect("health records after queue removal");
        assert!(health_records
            .into_iter()
            .all(|record| record.provider_id != "provider-b"));
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn set_auto_failover_enabled_seeds_queue_from_current_provider_and_preserves_queue_on_disable(
    ) {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");

        let enabled = set_auto_failover_enabled(&db, &AppType::Claude, true)
            .await
            .expect("enable auto failover");

        assert!(enabled.auto_failover_enabled);
        assert_eq!(enabled.failover_queue_depth, 1);
        assert_eq!(enabled.failover_queue[0].provider_id, "provider-a");
        assert!(enabled.failover_queue[0].active);
        assert_eq!(enabled.active_provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load database current provider")
                .as_deref(),
            Some("provider-a")
        );

        let disabled = set_auto_failover_enabled(&db, &AppType::Claude, false)
            .await
            .expect("disable auto failover");

        assert!(!disabled.auto_failover_enabled);
        assert_eq!(disabled.failover_queue_depth, 1);
        assert_eq!(disabled.failover_queue[0].provider_id, "provider-a");
        assert_eq!(disabled.active_provider_id.as_deref(), Some("provider-a"));
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn set_auto_failover_enabled_switches_active_provider_to_queue_head() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Provider B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-b").expect("activate provider b");
        add_to_failover_queue(&db, &AppType::Claude, "provider-a")
            .await
            .expect("queue provider a");

        let enabled = set_auto_failover_enabled(&db, &AppType::Claude, true)
            .await
            .expect("enable auto failover");

        assert!(enabled.auto_failover_enabled);
        assert_eq!(enabled.failover_queue_depth, 1);
        assert_eq!(enabled.failover_queue[0].provider_id, "provider-a");
        assert!(enabled.failover_queue[0].active);
        assert_eq!(enabled.active_provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load database current provider")
                .as_deref(),
            Some("provider-a")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn remove_from_failover_queue_rejects_removing_the_last_provider_while_enabled() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Provider A", "secret-a"),
        )
        .expect("create provider a");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");
        set_auto_failover_enabled(&db, &AppType::Claude, true)
            .await
            .expect("enable auto failover");

        let error = remove_from_failover_queue(&db, &AppType::Claude, "provider-a")
            .await
            .expect_err("removing last queued provider should fail");

        assert!(error
            .to_string()
            .contains("disable auto failover before removing the last queued provider"));
        assert_eq!(
            db.get_failover_queue(CLAUDE_APP_TYPE)
                .expect("queue after failed removal")
                .len(),
            1
        );
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn runtime_status_falls_back_to_database_context_when_daemon_is_unreachable() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Claude A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("Claude B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");
        db.add_to_failover_queue(CLAUDE_APP_TYPE, "provider-b")
            .expect("queue provider b");
        db.update_provider_health("provider-a", CLAUDE_APP_TYPE, true, None)
            .await
            .expect("record healthy provider a");
        db.update_provider_health_with_threshold(
            "provider-b",
            CLAUDE_APP_TYPE,
            false,
            Some("upstream timeout".to_string()),
            1,
        )
        .await
        .expect("record unhealthy provider b");

        let mut app_config = db
            .get_proxy_config_for_app(CLAUDE_APP_TYPE)
            .await
            .expect("claude app config");
        app_config.enabled = true;
        app_config.auto_failover_enabled = true;
        app_config.max_retries = 4;
        db.update_proxy_config_for_app(app_config)
            .await
            .expect("update claude app config");

        let mut global_config = db.get_global_proxy_config().await.expect("global config");
        global_config.listen_address = "127.0.0.1".to_string();
        global_config.listen_port = 59999;
        db.update_global_proxy_config(global_config)
            .await
            .expect("update global config");
        db.set_global_proxy_url(Some("http://127.0.0.1:7890"))
            .expect("set runtime global proxy url");

        let status = get_runtime_status(&db).await.expect("runtime status");
        let claude = status_for_app(&status, CLAUDE_APP_TYPE);

        assert!(!status.service.running);
        assert!(!status.service.reachable);
        assert_eq!(status.service.status_source, "config-fallback");
        assert_eq!(
            status.runtime.current_provider_id.as_deref(),
            Some("provider-a")
        );
        assert_eq!(status.runtime.active_targets.len(), 1);
        assert_eq!(status.runtime.active_targets[0].app_type, CLAUDE_APP_TYPE);
        assert_eq!(status.runtime.active_targets[0].provider_id, "provider-a");

        assert_eq!(claude.provider_count, 2);
        assert!(claude.proxy_enabled);
        assert!(claude.auto_failover_enabled);
        assert_eq!(claude.max_retries, 4);
        assert_eq!(claude.active_provider_id.as_deref(), Some("provider-a"));
        assert_eq!(claude.active_provider.name, "Claude A");
        assert!(claude.active_provider.active);
        assert_eq!(claude.failover_queue_depth, 1);
        assert_eq!(claude.failover_queue[0].provider_id, "provider-b");
        assert!(claude.failover_queue[0].health.observed);
        assert!(!claude.failover_queue[0].health.healthy);
        assert_eq!(
            claude.failover_queue[0].health.last_error.as_deref(),
            Some("upstream timeout")
        );
        assert_eq!(claude.observed_provider_count, 2);
        assert_eq!(claude.healthy_provider_count, 1);
        assert_eq!(claude.unhealthy_provider_count, 1);
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn app_runtime_status_marks_legacy_default_slot_as_active_context() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let status = get_app_runtime_status(&db, &AppType::Claude)
            .await
            .expect("app runtime status");

        assert!(status.using_legacy_default);
        assert_eq!(
            status.active_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert!(status.active_provider.active);
        assert_eq!(status.active_provider.name, "Phase1");
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn runtime_status_prefers_live_daemon_status_endpoint_when_available() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let (port, handle) = spawn_status_server(ProxyStatus {
            running: true,
            address: "127.0.0.1".to_string(),
            total_requests: 7,
            success_requests: 6,
            failed_requests: 1,
            success_rate: 85.7,
            uptime_seconds: 42,
            current_provider: Some("Live Provider".to_string()),
            current_provider_id: Some("provider-live".to_string()),
            failover_count: 2,
            active_targets: vec![crate::proxy::types::ActiveTarget {
                app_type: CLAUDE_APP_TYPE.to_string(),
                provider_name: "Live Provider".to_string(),
                provider_id: "provider-live".to_string(),
            }],
            ..Default::default()
        })
        .await;

        let mut global_config = db.get_global_proxy_config().await.expect("global config");
        global_config.listen_address = "127.0.0.1".to_string();
        global_config.listen_port = port;
        db.update_global_proxy_config(global_config)
            .await
            .expect("update global config");
        db.set_global_proxy_url(Some("http://127.0.0.1:7890"))
            .expect("set runtime global proxy url");

        tokio::time::sleep(std::time::Duration::from_millis(25)).await;

        let status = get_runtime_status(&db).await.expect("runtime status");

        handle.abort();
        let _ = handle.await;

        assert!(status.service.running);
        assert!(status.service.reachable);
        assert!(status.service.proxy_enabled);
        assert_eq!(status.service.status_source, "live-status");
        assert_eq!(status.runtime.total_requests, 7);
        assert_eq!(status.runtime.success_requests, 6);
        assert_eq!(status.runtime.failed_requests, 1);
        assert_eq!(status.runtime.failover_count, 2);
        assert_eq!(
            status.runtime.current_provider.as_deref(),
            Some("Live Provider")
        );
        assert_eq!(
            status.runtime.current_provider_id.as_deref(),
            Some("provider-live")
        );
        assert_eq!(status.runtime.active_targets.len(), 1);
        assert_eq!(
            status.runtime.active_targets[0].provider_id,
            "provider-live"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn runtime_status_reports_runtime_global_proxy_truth_from_database() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let status_without_proxy = get_runtime_status(&db).await.expect("runtime status");
        assert!(!status_without_proxy.service.proxy_enabled);

        db.set_global_proxy_url(Some("http://127.0.0.1:7890"))
            .expect("set runtime global proxy url");

        let status_with_proxy = get_runtime_status(&db).await.expect("runtime status");
        assert!(status_with_proxy.service.proxy_enabled);
    }

    #[tokio::test(flavor = "current_thread")]
    #[serial]
    async fn live_circuit_breaker_state_errors_when_daemon_runtime_is_unavailable() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("Claude A", "secret-a"),
        )
        .expect("create provider a");

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind unused listener");
        let port = listener.local_addr().expect("listener addr").port();
        drop(listener);

        let mut global_config = db.get_global_proxy_config().await.expect("global config");
        global_config.listen_address = "127.0.0.1".to_string();
        global_config.listen_port = port;
        db.update_global_proxy_config(global_config)
            .await
            .expect("update global config");

        let error = get_live_circuit_breaker_state(&db, &AppType::Claude, "provider-a")
            .await
            .expect_err("daemon runtime unavailable");

        assert!(error
            .to_string()
            .contains("live daemon admin endpoint unavailable"));
    }
}
