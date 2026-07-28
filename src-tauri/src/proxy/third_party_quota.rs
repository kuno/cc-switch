use super::{
    rate_limit::{snapshot_from_subscription_quota, BalanceSnapshot, RateLimitSnapshot},
    server::ProxyState,
};
use crate::{
    provider::{Provider, UsageResult},
    services::{balance, coding_plan, subscription::SubscriptionQuota},
};
use futures::future::join_all;
use serde_json::Value;
use std::future::Future;

const THIRD_PARTY_QUOTA_APP_TYPES: &[&str] = &["claude", "codex", "gemini"];
const THIRD_PARTY_QUOTA_CACHE_PREFIX: &str = "third_party_coding_plan";
const THIRD_PARTY_BALANCE_CACHE_PREFIX: &str = "third_party_balance";
const CLAUDE_BASE_URL_FIELD: &str = "ANTHROPIC_BASE_URL";
const CLAUDE_DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const CLAUDE_ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";
const CODEX_TOKEN_FIELD: &str = "OPENAI_API_KEY";
const GEMINI_BASE_URL_FIELD: &str = "GOOGLE_GEMINI_BASE_URL";
const GEMINI_TOKEN_FIELD: &str = "GEMINI_API_KEY";

#[derive(Clone)]
struct ThirdPartyQuotaCandidate {
    app_type: String,
    provider: Provider,
    base_url: String,
    api_key: String,
}

fn subscription_quota_error(quota: &SubscriptionQuota) -> String {
    quota
        .error
        .clone()
        .unwrap_or_else(|| "unknown upstream error".to_string())
}

fn third_party_quota_cache_key(app_type: &str, provider_id: &str, base_url: &str) -> String {
    format!("{THIRD_PARTY_QUOTA_CACHE_PREFIX}:{app_type}:{provider_id}:{base_url}")
}

fn third_party_balance_cache_key(app_type: &str, provider_id: &str, base_url: &str) -> String {
    format!("{THIRD_PARTY_BALANCE_CACHE_PREFIX}:{app_type}:{provider_id}:{base_url}")
}

fn build_third_party_snapshot(
    app_type: &str,
    provider_id: &str,
    provider_name: &str,
    quota: &SubscriptionQuota,
    previous: Option<&RateLimitSnapshot>,
) -> Result<RateLimitSnapshot, String> {
    if !quota.success {
        return Err(subscription_quota_error(quota));
    }

    snapshot_from_subscription_quota(app_type, provider_id, provider_name, quota, previous)
        .ok_or_else(|| subscription_quota_error(quota))
}

fn build_third_party_balance_snapshot(
    app_type: &str,
    provider: &Provider,
    usage_result: &UsageResult,
    captured_at: i64,
) -> RateLimitSnapshot {
    let balances = usage_result.data.as_ref().map(|rows| {
        rows.iter()
            .map(|usage| BalanceSnapshot {
                plan_name: usage.plan_name.clone(),
                currency: usage.unit.clone(),
                total: usage.total,
                used: usage.used,
                remaining: usage.remaining,
                is_valid: usage.is_valid,
                invalid_message: usage.invalid_message.clone(),
            })
            .collect()
    });

    RateLimitSnapshot {
        app_type: app_type.to_string(),
        provider_id: provider.id.clone(),
        provider_name: provider.name.clone(),
        source: Some("balance".to_string()),
        status: None,
        windows: Vec::new(),
        representative_claim: None,
        overage_status: None,
        fallback_percentage: None,
        requests_limit: None,
        requests_remaining: None,
        tokens_limit: None,
        tokens_remaining: None,
        balances,
        captured_at,
    }
}

fn supports_coding_plan_base_url(base_url: &str) -> bool {
    let normalized = base_url.to_lowercase();
    // Xiaomi MiMo Token Plan is intentionally absent: there is no known
    // quota/balance service implementation in this daemon yet.
    normalized.contains("api.kimi.com/coding")
        || normalized.contains("open.bigmodel.cn")
        || normalized.contains("bigmodel.cn")
        || normalized.contains("api.z.ai")
        || normalized.contains("api.minimaxi.com")
        || normalized.contains("api.minimax.io")
}

fn supports_balance_base_url(base_url: &str) -> bool {
    let normalized = base_url.to_lowercase();
    normalized.contains("api.deepseek.com")
        || normalized.contains("api.stepfun.ai")
        || normalized.contains("api.stepfun.com")
        || normalized.contains("api.siliconflow.cn")
        || normalized.contains("api.siliconflow.com")
        || normalized.contains("openrouter.ai")
        || normalized.contains("api.novita.ai")
}

fn normalize_base_url(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_direct_string(root: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| root.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_env_string(root: &Value, keys: &[&str]) -> Option<String> {
    let env = root.get("env")?.as_object()?;
    keys.iter()
        .find_map(|key| env.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_codex_base_url_from_toml(config: &str) -> Option<String> {
    let table = toml::from_str::<toml::Table>(config).ok()?;

    if let Some(provider_key) = table
        .get("model_provider")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Some(url) = table
            .get("model_providers")
            .and_then(|value| value.as_table())
            .and_then(|providers| providers.get(provider_key))
            .and_then(|value| value.as_table())
            .and_then(|provider| provider.get("base_url"))
            .and_then(|value| value.as_str())
            .and_then(normalize_base_url)
        {
            return Some(url);
        }
    }

    table
        .get("base_url")
        .and_then(|value| value.as_str())
        .and_then(normalize_base_url)
}

fn extract_third_party_credentials(
    app_type: &str,
    provider: &Provider,
) -> Option<(String, String)> {
    match app_type {
        "claude" => {
            let base_url = extract_env_string(&provider.settings_config, &[CLAUDE_BASE_URL_FIELD])
                .and_then(|value| normalize_base_url(&value))?;
            let api_key = extract_env_string(
                &provider.settings_config,
                &[CLAUDE_DEFAULT_TOKEN_FIELD, CLAUDE_ALT_TOKEN_FIELD],
            )?;
            Some((base_url, api_key))
        }
        "codex" => {
            let config_toml = provider
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or("");
            let base_url =
                extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])
                    .and_then(|value| normalize_base_url(&value))
                    .or_else(|| extract_codex_base_url_from_toml(config_toml))?;
            let api_key = crate::codex_config::extract_codex_api_key(
                provider.settings_config.get("auth"),
                Some(config_toml),
            )
            .or_else(|| extract_direct_string(&provider.settings_config, &[CODEX_TOKEN_FIELD]))?;
            Some((base_url, api_key))
        }
        "gemini" => {
            let base_url = extract_env_string(&provider.settings_config, &[GEMINI_BASE_URL_FIELD])
                .and_then(|value| normalize_base_url(&value))
                .or_else(|| {
                    extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])
                        .and_then(|value| normalize_base_url(&value))
                })?;
            let api_key = extract_env_string(&provider.settings_config, &[GEMINI_TOKEN_FIELD])
                .or_else(|| {
                    extract_direct_string(&provider.settings_config, &[GEMINI_TOKEN_FIELD])
                })?;
            Some((base_url, api_key))
        }
        _ => None,
    }
}

fn list_third_party_quota_candidates(state: &ProxyState) -> Vec<ThirdPartyQuotaCandidate> {
    let mut candidates = Vec::new();

    for app_type in THIRD_PARTY_QUOTA_APP_TYPES {
        let providers = match state.db.get_all_providers(app_type) {
            Ok(providers) => providers,
            Err(error) => {
                log::warn!(
                    "[Quota] failed to list {app_type} providers for third-party quota refresh: {error}"
                );
                continue;
            }
        };

        for provider in providers.into_values() {
            let Some((base_url, api_key)) = extract_third_party_credentials(app_type, &provider)
            else {
                continue;
            };

            candidates.push(ThirdPartyQuotaCandidate {
                app_type: (*app_type).to_string(),
                provider,
                base_url,
                api_key,
            });
        }
    }

    candidates
}

async fn refresh_third_party_coding_plan_snapshots_with_query<F, Fut>(
    state: &ProxyState,
    query_quota: F,
) where
    F: Fn(String, String) -> Fut + Clone,
    Fut: Future<Output = Result<SubscriptionQuota, String>>,
{
    #[cfg(test)]
    super::handlers::record_live_quota_refresh_call();

    let mut live_fetches = Vec::new();

    for candidate in list_third_party_quota_candidates(state) {
        if !supports_coding_plan_base_url(&candidate.base_url) {
            continue;
        }

        let app_type = candidate.app_type;
        let provider = candidate.provider;
        let base_url = candidate.base_url;
        let api_key = candidate.api_key;
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        let cache_key = third_party_quota_cache_key(&app_type, &provider_id, &base_url);
        let refresh_app_type = app_type.clone();
        let refresh_provider_id = provider_id.clone();
        let refresh_provider_name = provider_name.clone();
        let query_quota = query_quota.clone();

        live_fetches.push(async move {
            match state
                .quota_snapshot_cache
                .get_or_refresh(&cache_key, move || async move {
                    let quota = query_quota(base_url.clone(), api_key.clone()).await?;
                    let previous = {
                        let store = state.rate_limits.read().await;
                        store.get(&refresh_provider_id).cloned()
                    };

                    build_third_party_snapshot(
                        &refresh_app_type,
                        &refresh_provider_id,
                        &refresh_provider_name,
                        &quota,
                        previous.as_ref(),
                    )
                })
                .await
            {
                Ok(mut snapshot) => {
                    snapshot.app_type = app_type;
                    snapshot.provider_id = provider_id;
                    snapshot.provider_name = provider_name;
                    Some(snapshot)
                }
                Err(error) => {
                    log::warn!(
                        "[Quota] failed to refresh third-party coding-plan quota for {} ({}): {}",
                        provider_name,
                        provider_id,
                        error
                    );
                    None
                }
            }
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

async fn refresh_third_party_balance_snapshots_with_query<F, Fut>(
    state: &ProxyState,
    query_balance: F,
) where
    F: Fn(String, String) -> Fut + Clone,
    Fut: Future<Output = Result<UsageResult, String>>,
{
    #[cfg(test)]
    super::handlers::record_live_quota_refresh_call();

    let mut live_fetches = Vec::new();

    for candidate in list_third_party_quota_candidates(state) {
        if !supports_balance_base_url(&candidate.base_url) {
            continue;
        }

        let app_type = candidate.app_type;
        let provider = candidate.provider;
        let base_url = candidate.base_url;
        let api_key = candidate.api_key;
        let provider_for_refresh = provider.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        let cache_key = third_party_balance_cache_key(&app_type, &provider_id, &base_url);
        let refresh_app_type = app_type.clone();
        let query_balance = query_balance.clone();

        live_fetches.push(async move {
            match state
                .quota_snapshot_cache
                .get_or_refresh(&cache_key, move || async move {
                    let usage_result = query_balance(base_url.clone(), api_key.clone()).await?;
                    if !usage_result.success {
                        return Err(usage_result
                            .error
                            .clone()
                            .unwrap_or_else(|| "unknown upstream error".to_string()));
                    }

                    let Some(data) = usage_result.data.as_ref() else {
                        return Err("balance provider returned no balance rows".to_string());
                    };

                    if data.is_empty() {
                        return Err("balance provider returned no balance rows".to_string());
                    }

                    Ok(build_third_party_balance_snapshot(
                        &refresh_app_type,
                        &provider_for_refresh,
                        &usage_result,
                        chrono::Utc::now().timestamp_millis(),
                    ))
                })
                .await
            {
                Ok(mut snapshot) => {
                    snapshot.app_type = app_type;
                    snapshot.provider_id = provider_id;
                    snapshot.provider_name = provider_name;
                    Some(snapshot)
                }
                Err(error) => {
                    log::warn!(
                        "[Quota] failed to refresh third-party balance for {} ({}): {}",
                        provider_name,
                        provider_id,
                        error
                    );
                    None
                }
            }
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

pub(super) async fn refresh_third_party_coding_plan_snapshots(state: &ProxyState) {
    refresh_third_party_coding_plan_snapshots_with_query(
        state,
        |base_url: String, api_key: String| async move {
            coding_plan::get_coding_plan_quota(&base_url, &api_key, None, None, None, None, None)
                .await
        },
    )
    .await;
}

pub(super) async fn refresh_third_party_balance_snapshots(state: &ProxyState) {
    refresh_third_party_balance_snapshots_with_query(
        state,
        |base_url: String, api_key: String| async move {
            balance::get_balance(&base_url, &api_key).await
        },
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::{
        build_third_party_balance_snapshot, build_third_party_snapshot,
        extract_third_party_credentials, refresh_third_party_balance_snapshots_with_query,
        refresh_third_party_coding_plan_snapshots_with_query,
    };
    use crate::{
        database::Database,
        provider::{Provider, UsageData, UsageResult},
        proxy::{
            failover_switch::FailoverSwitchManager,
            provider_router::ProviderRouter,
            providers::{
                codex_chat_history::CodexChatHistoryStore, gemini_shadow::GeminiShadowStore,
            },
            rate_limit::new_rate_limit_store,
            server::ProxyState,
            types::{ProxyConfig, ProxyStatus},
        },
        services::{
            oauth_refresh::{ClaudeUploadedAuthManager, OAuthRefreshLockManager},
            subscription::{CredentialStatus, QuotaTier, SubscriptionQuota},
        },
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::sync::RwLock;

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
            codex_chat_history: Arc::new(CodexChatHistoryStore::default()),
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

    fn successful_quota(tool: &str) -> SubscriptionQuota {
        SubscriptionQuota {
            tool: tool.to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![QuotaTier {
                name: "monthly".to_string(),
                utilization: 37.5,
                resets_at: Some("2026-05-01T00:00:00Z".to_string()),
                used_value_usd: None,
                max_value_usd: None,
            }],
            extra_usage: None,
            error: None,
            queried_at: Some(1_744_000_000_000),
        }
    }

    #[test]
    fn extract_third_party_credentials_supports_codex_and_gemini_shapes() {
        let codex = Provider::with_id(
            "codex-kimi".to_string(),
            "Kimi Codex".to_string(),
            json!({
                "auth": { "OPENAI_API_KEY": "sk-kimi" },
                "config": r#"model_provider = "kimi"

[model_providers.kimi]
name = "Kimi"
base_url = "https://api.kimi.com/coding/v1/"
"#
            }),
            None,
        );
        assert_eq!(
            extract_third_party_credentials("codex", &codex),
            Some((
                "https://api.kimi.com/coding/v1".to_string(),
                "sk-kimi".to_string()
            ))
        );

        let gemini = Provider::with_id(
            "gemini-openrouter".to_string(),
            "OpenRouter Gemini".to_string(),
            json!({
                "base_url": "https://openrouter.ai/api/",
                "GEMINI_API_KEY": "sk-openrouter"
            }),
            None,
        );
        assert_eq!(
            extract_third_party_credentials("gemini", &gemini),
            Some((
                "https://openrouter.ai/api".to_string(),
                "sk-openrouter".to_string()
            ))
        );
    }

    #[test]
    fn xiaomi_mimo_token_plan_is_not_marked_supported_without_known_quota_api() {
        assert!(!super::supports_coding_plan_base_url(
            "https://token-plan-cn.xiaomimimo.com/v1"
        ));
    }

    #[tokio::test]
    async fn coding_plan_refresh_includes_non_claude_codex_provider() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "codex",
            &Provider::with_id(
                "codex-kimi".to_string(),
                "Kimi Codex".to_string(),
                json!({
                    "base_url": "https://api.kimi.com/coding/v1",
                    "auth": { "OPENAI_API_KEY": "sk-kimi" },
                    "config": ""
                }),
                None,
            ),
        )
        .expect("save provider");
        let state = test_proxy_state(db);
        let seen = Arc::new(Mutex::new(Vec::new()));

        refresh_third_party_coding_plan_snapshots_with_query(&state, {
            let seen = seen.clone();
            move |base_url: String, api_key: String| {
                let seen = seen.clone();
                async move {
                    seen.lock().expect("seen").push((base_url, api_key));
                    Ok(successful_quota("coding_plan"))
                }
            }
        })
        .await;

        assert_eq!(
            seen.lock().expect("seen").as_slice(),
            [(
                "https://api.kimi.com/coding/v1".to_string(),
                "sk-kimi".to_string()
            )]
        );
        let store = state.rate_limits.read().await;
        let snapshot = store.get("codex-kimi").expect("snapshot");
        assert_eq!(snapshot.app_type, "codex");
        assert_eq!(snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(snapshot.windows[0].name, "monthly");
    }

    #[tokio::test]
    async fn balance_refresh_includes_non_claude_gemini_provider() {
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "gemini",
            &Provider::with_id(
                "gemini-openrouter".to_string(),
                "OpenRouter Gemini".to_string(),
                json!({
                    "base_url": "https://openrouter.ai/api",
                    "GEMINI_API_KEY": "sk-openrouter"
                }),
                None,
            ),
        )
        .expect("save provider");
        let state = test_proxy_state(db);

        refresh_third_party_balance_snapshots_with_query(
            &state,
            |base_url: String, api_key: String| async move {
                assert_eq!(base_url, "https://openrouter.ai/api");
                assert_eq!(api_key, "sk-openrouter");
                Ok(UsageResult {
                    success: true,
                    data: Some(vec![UsageData {
                        plan_name: Some("OpenRouter".to_string()),
                        extra: None,
                        is_valid: Some(true),
                        invalid_message: None,
                        total: Some(25.0),
                        used: Some(5.0),
                        remaining: Some(20.0),
                        unit: Some("USD".to_string()),
                    }]),
                    error: None,
                })
            },
        )
        .await;

        let store = state.rate_limits.read().await;
        let snapshot = store.get("gemini-openrouter").expect("snapshot");
        assert_eq!(snapshot.app_type, "gemini");
        assert_eq!(snapshot.source.as_deref(), Some("balance"));
        assert_eq!(
            snapshot.balances.as_ref().expect("balances")[0].remaining,
            Some(20.0)
        );
    }

    #[test]
    fn build_third_party_snapshot_maps_subscription_quota() {
        let quota = successful_quota("coding_plan");

        let snapshot = build_third_party_snapshot("claude", "kimi-main", "Kimi Main", &quota, None)
            .expect("snapshot should be produced");

        assert_eq!(snapshot.provider_id, "kimi-main");
        assert_eq!(snapshot.provider_name, "Kimi Main");
        assert_eq!(snapshot.app_type, "claude");
        assert_eq!(snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.windows[0].name, "monthly");
        assert_eq!(snapshot.windows[0].utilization, Some(0.375));
        assert_eq!(snapshot.windows[0].reset, Some(1_777_593_600));
    }

    #[test]
    fn build_third_party_balance_snapshot_maps_usage_rows() {
        let openrouter_provider = Provider::with_id(
            "openrouter-main".to_string(),
            "OpenRouter Main".to_string(),
            json!({}),
            None,
        );
        let openrouter_usage = UsageResult {
            success: true,
            data: Some(vec![UsageData {
                plan_name: Some("OpenRouter".to_string()),
                extra: None,
                is_valid: Some(true),
                invalid_message: None,
                total: Some(25.0),
                used: Some(5.5),
                remaining: Some(19.5),
                unit: Some("USD".to_string()),
            }]),
            error: None,
        };

        let snapshot = build_third_party_balance_snapshot(
            "claude",
            &openrouter_provider,
            &openrouter_usage,
            123_456,
        );

        assert_eq!(snapshot.source.as_deref(), Some("balance"));
        assert!(snapshot.windows.is_empty());
        assert_eq!(snapshot.balances.as_ref().expect("balances").len(), 1);
        let balance = &snapshot.balances.as_ref().expect("balances")[0];
        assert_eq!(balance.plan_name.as_deref(), Some("OpenRouter"));
        assert_eq!(balance.currency.as_deref(), Some("USD"));
        assert_eq!(balance.total, Some(25.0));
        assert_eq!(balance.used, Some(5.5));
        assert_eq!(balance.remaining, Some(19.5));
        assert_eq!(balance.is_valid, Some(true));
        assert_eq!(balance.invalid_message, None);

        let deepseek_provider = Provider::with_id(
            "deepseek-main".to_string(),
            "DeepSeek Main".to_string(),
            json!({}),
            None,
        );
        let deepseek_usage = UsageResult {
            success: true,
            data: Some(vec![
                UsageData {
                    plan_name: Some("CNY".to_string()),
                    extra: None,
                    is_valid: Some(true),
                    invalid_message: None,
                    total: Some(100.0),
                    used: Some(10.0),
                    remaining: Some(90.0),
                    unit: Some("CNY".to_string()),
                },
                UsageData {
                    plan_name: Some("USD".to_string()),
                    extra: None,
                    is_valid: Some(true),
                    invalid_message: None,
                    total: Some(20.0),
                    used: Some(1.0),
                    remaining: Some(19.0),
                    unit: Some("USD".to_string()),
                },
            ]),
            error: None,
        };

        let snapshot = build_third_party_balance_snapshot(
            "claude",
            &deepseek_provider,
            &deepseek_usage,
            789_012,
        );

        assert_eq!(snapshot.source.as_deref(), Some("balance"));
        assert!(snapshot.windows.is_empty());
        let balances = snapshot.balances.as_ref().expect("balances");
        assert_eq!(balances.len(), 2);
        assert_eq!(balances[0].currency.as_deref(), Some("CNY"));
        assert_eq!(balances[1].currency.as_deref(), Some("USD"));
    }
}
