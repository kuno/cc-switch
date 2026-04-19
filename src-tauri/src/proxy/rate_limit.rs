use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::services::subscription::SubscriptionQuota;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RateLimitWindow {
    pub name: String,
    pub status: Option<String>,
    pub utilization: Option<f64>,
    pub reset: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RateLimitSnapshot {
    pub app_type: String,
    pub provider_id: String,
    pub provider_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub status: Option<String>,
    pub windows: Vec<RateLimitWindow>,
    pub representative_claim: Option<String>,
    pub overage_status: Option<String>,
    pub fallback_percentage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests_remaining: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_remaining: Option<u64>,
    pub captured_at: i64,
}

pub type RateLimitStore = Arc<RwLock<HashMap<String, RateLimitSnapshot>>>;

pub fn new_rate_limit_store() -> RateLimitStore {
    Arc::new(RwLock::new(HashMap::new()))
}

fn quota_reset_iso_to_unix_ts(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp())
}

fn quota_utilization_to_ratio(value: f64) -> f64 {
    if value > 1.0 {
        (value / 100.0).clamp(0.0, 1.0)
    } else {
        value.clamp(0.0, 1.0)
    }
}

pub fn snapshot_from_subscription_quota(
    app_type: &str,
    provider_id: &str,
    provider_name: &str,
    quota: &SubscriptionQuota,
    previous: Option<&RateLimitSnapshot>,
) -> Option<RateLimitSnapshot> {
    if !quota.success {
        return None;
    }

    let windows = quota
        .tiers
        .iter()
        .map(|tier| RateLimitWindow {
            name: tier.name.clone(),
            status: None,
            utilization: Some(quota_utilization_to_ratio(tier.utilization)),
            reset: tier
                .resets_at
                .as_deref()
                .and_then(quota_reset_iso_to_unix_ts),
        })
        .collect();

    Some(RateLimitSnapshot {
        app_type: app_type.to_string(),
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        source: Some("subscription_quota".to_string()),
        status: None,
        windows,
        representative_claim: None,
        overage_status: None,
        fallback_percentage: None,
        requests_limit: previous.and_then(|snapshot| snapshot.requests_limit),
        requests_remaining: previous.and_then(|snapshot| snapshot.requests_remaining),
        tokens_limit: previous.and_then(|snapshot| snapshot.tokens_limit),
        tokens_remaining: previous.and_then(|snapshot| snapshot.tokens_remaining),
        captured_at: chrono::Utc::now().timestamp_millis(),
    })
}

fn header_str(headers: &http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

fn header_f64(headers: &http::HeaderMap, name: &str) -> Option<f64> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

fn header_i64(headers: &http::HeaderMap, name: &str) -> Option<i64> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

fn header_u64(headers: &http::HeaderMap, name: &str) -> Option<u64> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

struct ExtractedRaw {
    status: Option<String>,
    windows: Vec<RateLimitWindow>,
    representative_claim: Option<String>,
    overage_status: Option<String>,
    fallback_percentage: Option<f64>,
    requests_limit: Option<u64>,
    requests_remaining: Option<u64>,
    tokens_limit: Option<u64>,
    tokens_remaining: Option<u64>,
}

fn extract_anthropic_unified(headers: &http::HeaderMap) -> Option<ExtractedRaw> {
    let has_unified = headers
        .keys()
        .any(|k| k.as_str().starts_with("anthropic-ratelimit-unified"));
    if !has_unified {
        return None;
    }

    let status = header_str(headers, "anthropic-ratelimit-unified-status");
    let representative_claim =
        header_str(headers, "anthropic-ratelimit-unified-representative-claim");
    let overage_status = header_str(headers, "anthropic-ratelimit-unified-overage-status");
    let fallback_percentage =
        header_f64(headers, "anthropic-ratelimit-unified-fallback-percentage");

    let window_prefixes = [
        ("5h", "anthropic-ratelimit-unified-5h"),
        ("7d", "anthropic-ratelimit-unified-7d"),
    ];
    let mut windows = Vec::new();
    for (name, prefix) in &window_prefixes {
        let w_status = header_str(headers, &format!("{prefix}-status"));
        let w_util = header_f64(headers, &format!("{prefix}-utilization"));
        let w_reset = header_i64(headers, &format!("{prefix}-reset"));
        if w_status.is_some() || w_util.is_some() || w_reset.is_some() {
            windows.push(RateLimitWindow {
                name: name.to_string(),
                status: w_status,
                utilization: w_util,
                reset: w_reset,
            });
        }
    }

    Some(ExtractedRaw {
        status,
        windows,
        representative_claim,
        overage_status,
        fallback_percentage,
        requests_limit: None,
        requests_remaining: None,
        tokens_limit: None,
        tokens_remaining: None,
    })
}

fn extract_anthropic_legacy(headers: &http::HeaderMap) -> Option<ExtractedRaw> {
    let has_any = headers.keys().any(|k| {
        k.as_str().starts_with("anthropic-ratelimit-")
            && !k.as_str().starts_with("anthropic-ratelimit-unified")
    });
    if !has_any {
        return None;
    }
    Some(ExtractedRaw {
        status: None,
        windows: Vec::new(),
        representative_claim: None,
        overage_status: None,
        fallback_percentage: None,
        requests_limit: header_u64(headers, "anthropic-ratelimit-requests-limit"),
        requests_remaining: header_u64(headers, "anthropic-ratelimit-requests-remaining"),
        tokens_limit: header_u64(headers, "anthropic-ratelimit-tokens-limit"),
        tokens_remaining: header_u64(headers, "anthropic-ratelimit-tokens-remaining"),
    })
}

fn extract_openai(headers: &http::HeaderMap) -> Option<ExtractedRaw> {
    let has_any = headers
        .keys()
        .any(|k| k.as_str().starts_with("x-ratelimit-"));
    if !has_any {
        return None;
    }
    Some(ExtractedRaw {
        status: None,
        windows: Vec::new(),
        representative_claim: None,
        overage_status: None,
        fallback_percentage: None,
        requests_limit: header_u64(headers, "x-ratelimit-limit-requests"),
        requests_remaining: header_u64(headers, "x-ratelimit-remaining-requests"),
        tokens_limit: header_u64(headers, "x-ratelimit-limit-tokens"),
        tokens_remaining: header_u64(headers, "x-ratelimit-remaining-tokens"),
    })
}

fn extract_rate_limits(headers: &http::HeaderMap) -> Option<ExtractedRaw> {
    extract_anthropic_unified(headers)
        .or_else(|| extract_anthropic_legacy(headers))
        .or_else(|| extract_openai(headers))
}

pub async fn capture_rate_limits(
    store: &RateLimitStore,
    headers: &http::HeaderMap,
    app_type: &str,
    provider_id: &str,
    provider_name: &str,
) {
    let now = chrono::Utc::now().timestamp_millis();
    if let Some(raw) = extract_rate_limits(headers) {
        let snapshot = RateLimitSnapshot {
            app_type: app_type.to_string(),
            provider_id: provider_id.to_string(),
            provider_name: provider_name.to_string(),
            source: Some("response_headers".to_string()),
            status: raw.status,
            windows: raw.windows,
            representative_claim: raw.representative_claim,
            overage_status: raw.overage_status,
            fallback_percentage: raw.fallback_percentage,
            requests_limit: raw.requests_limit,
            requests_remaining: raw.requests_remaining,
            tokens_limit: raw.tokens_limit,
            tokens_remaining: raw.tokens_remaining,
            captured_at: now,
        };
        log::debug!(
            "[RateLimit] captured for {}: status={:?} windows={}",
            provider_id,
            snapshot.status,
            snapshot.windows.len(),
        );
        store
            .write()
            .await
            .insert(provider_id.to_string(), snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::subscription::{CredentialStatus, QuotaTier};
    use http::HeaderMap;

    #[test]
    fn extract_anthropic_unified_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "anthropic-ratelimit-unified-status",
            "allowed".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-5h-status",
            "allowed".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-5h-utilization",
            "0.33".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-5h-reset",
            "1776312000".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-7d-status",
            "allowed".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-7d-utilization",
            "0.75".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-7d-reset",
            "1776607200".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-representative-claim",
            "five_hour".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-overage-status",
            "rejected".parse().unwrap(),
        );
        headers.insert(
            "anthropic-ratelimit-unified-fallback-percentage",
            "0.5".parse().unwrap(),
        );

        let raw = extract_rate_limits(&headers).expect("should extract");
        assert_eq!(raw.status.as_deref(), Some("allowed"));
        assert_eq!(raw.windows.len(), 2);
        assert_eq!(raw.windows[0].name, "5h");
        assert_eq!(raw.windows[0].utilization, Some(0.33));
        assert_eq!(raw.windows[0].reset, Some(1776312000));
        assert_eq!(raw.windows[1].name, "7d");
        assert_eq!(raw.windows[1].utilization, Some(0.75));
        assert_eq!(raw.representative_claim.as_deref(), Some("five_hour"));
        assert_eq!(raw.overage_status.as_deref(), Some("rejected"));
        assert_eq!(raw.fallback_percentage, Some(0.5));
    }

    #[test]
    fn extract_anthropic_legacy_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("anthropic-ratelimit-requests-limit", "50".parse().unwrap());
        headers.insert(
            "anthropic-ratelimit-requests-remaining",
            "42".parse().unwrap(),
        );
        headers.insert("anthropic-ratelimit-tokens-limit", "80000".parse().unwrap());
        headers.insert(
            "anthropic-ratelimit-tokens-remaining",
            "63200".parse().unwrap(),
        );

        let raw = extract_rate_limits(&headers).expect("should extract");
        assert_eq!(raw.requests_limit, Some(50));
        assert_eq!(raw.requests_remaining, Some(42));
        assert_eq!(raw.tokens_limit, Some(80000));
        assert_eq!(raw.tokens_remaining, Some(63200));
    }

    #[test]
    fn extract_openai_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-ratelimit-limit-requests", "100".parse().unwrap());
        headers.insert("x-ratelimit-remaining-requests", "88".parse().unwrap());
        headers.insert("x-ratelimit-limit-tokens", "100000".parse().unwrap());
        headers.insert("x-ratelimit-remaining-tokens", "91000".parse().unwrap());

        let raw = extract_rate_limits(&headers).expect("should extract");
        assert_eq!(raw.requests_limit, Some(100));
        assert_eq!(raw.requests_remaining, Some(88));
        assert_eq!(raw.tokens_limit, Some(100000));
        assert_eq!(raw.tokens_remaining, Some(91000));
    }

    #[test]
    fn no_rate_limit_headers_returns_none() {
        let headers = HeaderMap::new();
        assert!(extract_rate_limits(&headers).is_none());
    }

    #[test]
    fn snapshot_from_subscription_quota_converts_percentages_and_resets() {
        let quota = SubscriptionQuota {
            tool: "codex_oauth".to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![
                QuotaTier {
                    name: "five_hour".to_string(),
                    utilization: 33.0,
                    resets_at: Some("2026-04-17T12:00:00+00:00".to_string()),
                },
                QuotaTier {
                    name: "seven_day".to_string(),
                    utilization: 75.0,
                    resets_at: None,
                },
            ],
            extra_usage: None,
            error: None,
            queried_at: Some(1_713_357_200_000),
        };

        let snapshot =
            snapshot_from_subscription_quota("codex", "provider-a", "Provider A", &quota, None)
                .expect("snapshot");

        assert_eq!(snapshot.app_type, "codex");
        assert_eq!(snapshot.provider_id, "provider-a");
        assert_eq!(snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].name, "five_hour");
        assert_eq!(snapshot.windows[0].utilization, Some(0.33));
        assert_eq!(snapshot.windows[0].reset, Some(1_776_427_200));
        assert_eq!(snapshot.windows[1].name, "seven_day");
        assert_eq!(snapshot.windows[1].utilization, Some(0.75));
        assert_eq!(snapshot.windows[1].reset, None);
    }

    #[test]
    fn snapshot_from_subscription_quota_preserves_existing_scalar_limits() {
        let previous = RateLimitSnapshot {
            app_type: "codex".to_string(),
            provider_id: "provider-a".to_string(),
            provider_name: "Provider A".to_string(),
            source: Some("response_headers".to_string()),
            status: None,
            windows: Vec::new(),
            representative_claim: None,
            overage_status: None,
            fallback_percentage: None,
            requests_limit: Some(1_000),
            requests_remaining: Some(900),
            tokens_limit: Some(100_000),
            tokens_remaining: Some(80_000),
            captured_at: 0,
        };
        let quota = SubscriptionQuota {
            tool: "codex_oauth".to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![QuotaTier {
                name: "five_hour".to_string(),
                utilization: 20.0,
                resets_at: None,
            }],
            extra_usage: None,
            error: None,
            queried_at: Some(1_713_357_200_000),
        };

        let snapshot = snapshot_from_subscription_quota(
            "codex",
            "provider-a",
            "Provider A",
            &quota,
            Some(&previous),
        )
        .expect("snapshot");

        assert_eq!(snapshot.requests_limit, Some(1_000));
        assert_eq!(snapshot.requests_remaining, Some(900));
        assert_eq!(snapshot.tokens_limit, Some(100_000));
        assert_eq!(snapshot.tokens_remaining, Some(80_000));
        assert_eq!(snapshot.windows[0].utilization, Some(0.2));
    }
}
