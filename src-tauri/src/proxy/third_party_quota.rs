use super::{
    rate_limit::{snapshot_from_subscription_quota, RateLimitSnapshot},
    server::ProxyState,
};
use crate::{
    provider::Provider,
    services::{coding_plan, subscription::SubscriptionQuota},
};
use futures::future::join_all;
use serde_json::Value;

const THIRD_PARTY_QUOTA_APP_TYPE: &str = "claude";
const THIRD_PARTY_QUOTA_CACHE_PREFIX: &str = "third_party_coding_plan";
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

fn supports_coding_plan_base_url(base_url: &str) -> bool {
    let normalized = base_url.to_lowercase();
    normalized.contains("api.kimi.com/coding")
        || normalized.contains("open.bigmodel.cn")
        || normalized.contains("bigmodel.cn")
        || normalized.contains("api.z.ai")
        || normalized.contains("api.minimaxi.com")
        || normalized.contains("api.minimax.io")
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

#[cfg(test)]
mod tests {
    use super::build_third_party_snapshot;
    use crate::services::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};

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
}
