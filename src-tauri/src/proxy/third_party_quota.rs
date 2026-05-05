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

const THIRD_PARTY_QUOTA_APP_TYPE: &str = "claude";
const THIRD_PARTY_QUOTA_CACHE_PREFIX: &str = "third_party_coding_plan";
const THIRD_PARTY_BALANCE_CACHE_PREFIX: &str = "third_party_balance";
const CLAUDE_BASE_URL_FIELD: &str = "ANTHROPIC_BASE_URL";
const CLAUDE_DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const CLAUDE_ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";

fn subscription_quota_error(quota: &SubscriptionQuota) -> String {
    quota
        .error
        .clone()
        .unwrap_or_else(|| "unknown upstream error".to_string())
}

fn third_party_quota_cache_key(provider_id: &str, base_url: &str) -> String {
    format!("{THIRD_PARTY_QUOTA_CACHE_PREFIX}:{provider_id}:{base_url}")
}

fn third_party_balance_cache_key(provider_id: &str, base_url: &str) -> String {
    format!("{THIRD_PARTY_BALANCE_CACHE_PREFIX}:{provider_id}:{base_url}")
}

fn build_third_party_snapshot(
    provider_id: &str,
    provider_name: &str,
    quota: &SubscriptionQuota,
    previous: Option<&RateLimitSnapshot>,
) -> Result<RateLimitSnapshot, String> {
    if !quota.success {
        return Err(subscription_quota_error(quota));
    }

    snapshot_from_subscription_quota(
        THIRD_PARTY_QUOTA_APP_TYPE,
        provider_id,
        provider_name,
        quota,
        previous,
    )
    .ok_or_else(|| subscription_quota_error(quota))
}

fn build_third_party_balance_snapshot(
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
        app_type: THIRD_PARTY_QUOTA_APP_TYPE.to_string(),
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

fn extract_coding_plan_credentials(provider: &Provider) -> Option<(String, String)> {
    let env = provider.settings_config.get("env")?.as_object()?;

    let base_url = env
        .get(CLAUDE_BASE_URL_FIELD)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .trim_end_matches('/')
        .to_string();

    let api_key = env
        .get(CLAUDE_DEFAULT_TOKEN_FIELD)
        .or_else(|| env.get(CLAUDE_ALT_TOKEN_FIELD))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();

    Some((base_url, api_key))
}

pub(super) async fn refresh_third_party_coding_plan_snapshots(state: &ProxyState) {
    #[cfg(test)]
    super::handlers::record_live_quota_refresh_call();

    let providers = match state.db.get_all_providers(THIRD_PARTY_QUOTA_APP_TYPE) {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[Quota] failed to list claude providers for third-party coding-plan refresh: {error}"
            );
            return;
        }
    };

    let mut live_fetches = Vec::new();

    for provider in providers.into_values() {
        let Some((base_url, api_key)) = extract_coding_plan_credentials(&provider) else {
            continue;
        };

        if !supports_coding_plan_base_url(&base_url) {
            continue;
        }

        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        let cache_key = third_party_quota_cache_key(&provider_id, &base_url);
        let refresh_provider_id = provider_id.clone();
        let refresh_provider_name = provider_name.clone();

        live_fetches.push(async move {
            match state
                .quota_snapshot_cache
                .get_or_refresh(&cache_key, move || async move {
                    let quota = coding_plan::get_coding_plan_quota(&base_url, &api_key).await?;
                    let previous = {
                        let store = state.rate_limits.read().await;
                        store.get(&refresh_provider_id).cloned()
                    };

                    build_third_party_snapshot(
                        &refresh_provider_id,
                        &refresh_provider_name,
                        &quota,
                        previous.as_ref(),
                    )
                })
                .await
            {
                Ok(mut snapshot) => {
                    snapshot.app_type = THIRD_PARTY_QUOTA_APP_TYPE.to_string();
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

pub(super) async fn refresh_third_party_balance_snapshots(state: &ProxyState) {
    #[cfg(test)]
    super::handlers::record_live_quota_refresh_call();

    let providers = match state.db.get_all_providers(THIRD_PARTY_QUOTA_APP_TYPE) {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[Quota] failed to list claude providers for third-party balance refresh: {error}"
            );
            return;
        }
    };

    let mut live_fetches = Vec::new();

    for provider in providers.into_values() {
        let Some((base_url, api_key)) = extract_coding_plan_credentials(&provider) else {
            continue;
        };

        if !supports_balance_base_url(&base_url) {
            continue;
        }

        let provider_for_refresh = provider.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        let cache_key = third_party_balance_cache_key(&provider_id, &base_url);

        live_fetches.push(async move {
            match state
                .quota_snapshot_cache
                .get_or_refresh(&cache_key, move || async move {
                    let usage_result = balance::get_balance(&base_url, &api_key).await?;
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
                        &provider_for_refresh,
                        &usage_result,
                        chrono::Utc::now().timestamp_millis(),
                    ))
                })
                .await
            {
                Ok(mut snapshot) => {
                    snapshot.app_type = THIRD_PARTY_QUOTA_APP_TYPE.to_string();
                    snapshot.provider_id = provider_id;
                    snapshot.provider_name = provider_name;
                    Some(snapshot)
                }
                Err(_) => None,
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

#[cfg(test)]
mod tests {
    use super::{build_third_party_balance_snapshot, build_third_party_snapshot};
    use crate::{
        provider::{Provider, UsageData, UsageResult},
        services::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota},
    };
    use serde_json::json;

    #[test]
    fn build_third_party_snapshot_maps_subscription_quota() {
        let quota = SubscriptionQuota {
            tool: "coding_plan".to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![QuotaTier {
                name: "monthly".to_string(),
                utilization: 37.5,
                resets_at: Some("2026-05-01T00:00:00Z".to_string()),
            }],
            extra_usage: None,
            error: None,
            queried_at: Some(1_744_000_000_000),
        };

        let snapshot = build_third_party_snapshot("kimi-main", "Kimi Main", &quota, None)
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

        let snapshot =
            build_third_party_balance_snapshot(&openrouter_provider, &openrouter_usage, 123_456);

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

        let snapshot =
            build_third_party_balance_snapshot(&deepseek_provider, &deepseek_usage, 789_012);

        assert_eq!(snapshot.source.as_deref(), Some("balance"));
        assert!(snapshot.windows.is_empty());
        let balances = snapshot.balances.as_ref().expect("balances");
        assert_eq!(balances.len(), 2);
        assert_eq!(balances[0].currency.as_deref(), Some("CNY"));
        assert_eq!(balances[1].currency.as_deref(), Some("USD"));
    }
}
