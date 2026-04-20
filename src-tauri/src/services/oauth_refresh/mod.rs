pub mod storage;

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard, RwLock};

use crate::proxy::providers::codex_oauth_auth::{
    extract_identity_from_tokens, refresh_codex_tokens_with_client, CodexOAuthError,
};

const MIN_PLAUSIBLE_EXPIRES_AT_MS: i64 = 1_000_000_000_000;
const MAX_PLAUSIBLE_EXPIRES_AT_MS: i64 = 9_999_999_999_999;
const MIN_REFRESHED_LIFETIME_MS: i64 = 30_000;

const CLAUDE_CLIENT_ID: &str = "https://claude.ai/oauth/claude-code-client-metadata";
const CLAUDE_OAUTH_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_OAUTH_USER_AGENT: &str = "cc-switch-claude-oauth";

#[async_trait]
pub trait OAuthTokenRefresher: Send + Sync {
    async fn refresh(&self, refresh_token: &str)
        -> Result<RefreshedCredentials, OAuthRefreshError>;
}

#[derive(Debug, Clone)]
pub struct RefreshedCredentials {
    pub access_token: String,
    pub expires_at_ms: i64,
    pub refresh_token: Option<String>,
    pub extra: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OAuthRefreshError {
    #[error("refresh token invalid")]
    RefreshTokenInvalid,
    #[error("network error: {0}")]
    NetworkError(String),
    #[error("provider error: {0}")]
    ProviderError(String),
}

impl OAuthRefreshError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RefreshTokenInvalid => "refresh_token_invalid",
            Self::NetworkError(_) => "network_error",
            Self::ProviderError(_) => "provider_error",
        }
    }
}

pub trait StoredOAuthCredential: Clone {
    fn access_token(&self) -> &str;
    fn refresh_token(&self) -> Option<&str>;
    fn expires_at_ms(&self) -> Option<i64>;
}

#[derive(Clone, Default)]
pub struct OAuthRefreshLockManager {
    locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
}

impl OAuthRefreshLockManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn lock_for_provider(&self, provider_key: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let locks = self.locks.read().await;
            if let Some(lock) = locks.get(provider_key) {
                lock.clone()
            } else {
                drop(locks);
                let mut locks = self.locks.write().await;
                locks
                    .entry(provider_key.to_string())
                    .or_insert_with(|| Arc::new(Mutex::new(())))
                    .clone()
            }
        };
        lock.lock_owned().await
    }
}

pub async fn load_or_refresh_oauth_credentials<T, Load, Save, R>(
    provider_label: &str,
    provider_id: &str,
    provider_key: &str,
    refresher: &R,
    lock_manager: &OAuthRefreshLockManager,
    load: Load,
    save: Save,
) -> Option<T>
where
    T: StoredOAuthCredential,
    Load: Fn() -> anyhow::Result<Option<T>>,
    Save: Fn(&T, &RefreshedCredentials) -> anyhow::Result<T>,
    R: OAuthTokenRefresher,
{
    let Some(stored) = load_with_warn(provider_label, provider_id, &load) else {
        return None;
    };

    if !is_expired(&stored) {
        return Some(stored);
    }

    if stored.refresh_token().is_none() {
        log::warn!(
            "[Quota] stored {provider_label} auth for {provider_id} is expired and has no refresh token; skipping live quota refresh"
        );
        return None;
    }

    let _guard = lock_manager.lock_for_provider(provider_key).await;

    let Some(stored) = load_with_warn(provider_label, provider_id, &load) else {
        return None;
    };

    if !is_expired(&stored) {
        log::info!(
            "[Quota] expired {provider_label} auth for {provider_id} was refreshed by another request"
        );
        return Some(stored);
    }

    let Some(refresh_token) = stored
        .refresh_token()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        log::warn!(
            "[Quota] stored {provider_label} auth for {provider_id} is expired and has no refresh token; skipping live quota refresh"
        );
        return None;
    };

    log::info!("[Quota] refreshing expired {provider_label} auth for {provider_id}");

    let refreshed = match refresher.refresh(refresh_token).await {
        Ok(refreshed) => refreshed,
        Err(error) => {
            log::warn!(
                "[Quota] failed to refresh expired {provider_label} auth for {provider_id}; error_kind={}",
                error.kind()
            );
            return None;
        }
    };

    match save(&stored, &refreshed) {
        Ok(updated) => {
            log::info!(
                "[Quota] refreshed expired {provider_label} auth for {provider_id}; rotated_refresh_token={}",
                refreshed.refresh_token.is_some()
            );
            Some(updated)
        }
        Err(error) => {
            log::warn!(
                "[Quota] failed to persist refreshed {provider_label} auth for {provider_id}; error_kind=storage_update_failed"
            );
            log::debug!(
                "[Quota] storage update failure for {provider_label} {provider_id}: {error}"
            );
            None
        }
    }
}

#[derive(Clone)]
pub struct CodexTokenRefresher {
    http_client: Client,
}

impl CodexTokenRefresher {
    pub fn new() -> Self {
        Self {
            http_client: Client::new(),
        }
    }

    #[cfg(test)]
    fn with_http_client(http_client: Client) -> Self {
        Self { http_client }
    }
}

#[async_trait]
impl OAuthTokenRefresher for CodexTokenRefresher {
    async fn refresh(
        &self,
        refresh_token: &str,
    ) -> Result<RefreshedCredentials, OAuthRefreshError> {
        let tokens = refresh_codex_tokens_with_client(&self.http_client, refresh_token)
            .await
            .map_err(map_codex_refresh_error)?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let expires_at_ms = now_ms.saturating_add(tokens.expires_in.unwrap_or(3600) * 1000);
        validate_refreshed_expires_at_ms(expires_at_ms, now_ms)?;

        let (account_id, _) = extract_identity_from_tokens(&tokens);
        let mut extra = Map::new();
        if let Some(id_token) = tokens.id_token {
            extra.insert("id_token".to_string(), Value::String(id_token));
        }
        if let Some(account_id) = account_id {
            extra.insert("account_id".to_string(), Value::String(account_id));
        }

        Ok(RefreshedCredentials {
            access_token: tokens.access_token,
            expires_at_ms,
            refresh_token: tokens.refresh_token,
            extra: Value::Object(extra),
        })
    }
}

#[derive(Clone)]
pub struct ClaudeTokenRefresher {
    http_client: Client,
    token_url: String,
}

impl ClaudeTokenRefresher {
    pub fn new() -> Self {
        Self {
            http_client: Client::new(),
            token_url: CLAUDE_OAUTH_TOKEN_URL.to_string(),
        }
    }

    #[cfg(test)]
    fn with_client_and_url(http_client: Client, token_url: String) -> Self {
        Self {
            http_client,
            token_url,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ClaudeTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default, alias = "expiresIn")]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    scopes: Option<Vec<String>>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[async_trait]
impl OAuthTokenRefresher for ClaudeTokenRefresher {
    async fn refresh(
        &self,
        refresh_token: &str,
    ) -> Result<RefreshedCredentials, OAuthRefreshError> {
        let response = self
            .http_client
            .post(&self.token_url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .header("User-Agent", CLAUDE_OAUTH_USER_AGENT)
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
                ("client_id", CLAUDE_CLIENT_ID),
            ])
            .send()
            .await
            .map_err(|error| OAuthRefreshError::NetworkError(error.to_string()))?;

        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|error| OAuthRefreshError::NetworkError(error.to_string()))?;

        if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
            || body_indicates_invalid_refresh_token(&body)
        {
            return Err(OAuthRefreshError::RefreshTokenInvalid);
        }

        if !status.is_success() {
            return Err(OAuthRefreshError::ProviderError(format!(
                "refresh failed with status {status}"
            )));
        }

        let token_response: ClaudeTokenResponse =
            serde_json::from_slice(&body).map_err(|error| {
                OAuthRefreshError::ProviderError(format!(
                    "failed to parse refresh response: {error}"
                ))
            })?;

        let now_ms = chrono::Utc::now().timestamp_millis();
        let expires_at_ms = now_ms.saturating_add(token_response.expires_in.unwrap_or(3600) * 1000);
        validate_refreshed_expires_at_ms(expires_at_ms, now_ms)?;

        let access_token = token_response.access_token.clone();
        let refresh_token = token_response.refresh_token.clone();
        Ok(RefreshedCredentials {
            access_token,
            expires_at_ms,
            refresh_token,
            extra: Value::Object(normalize_claude_extra(token_response)),
        })
    }
}

fn load_with_warn<T, Load>(provider_label: &str, provider_id: &str, load: &Load) -> Option<T>
where
    Load: Fn() -> anyhow::Result<Option<T>>,
{
    match load() {
        Ok(value) => value,
        Err(error) => {
            log::warn!(
                "[Quota] failed to load {provider_label} auth for {provider_id}; error_kind=storage_read_failed"
            );
            log::debug!("[Quota] auth load failure for {provider_label} {provider_id}: {error}");
            None
        }
    }
}

fn is_expired<T: StoredOAuthCredential>(stored: &T) -> bool {
    let now_ms = chrono::Utc::now().timestamp_millis();
    stored
        .expires_at_ms()
        .is_some_and(|expires_at_ms| expires_at_ms <= now_ms)
}

fn validate_refreshed_expires_at_ms(
    expires_at_ms: i64,
    now_ms: i64,
) -> Result<(), OAuthRefreshError> {
    if !(MIN_PLAUSIBLE_EXPIRES_AT_MS..=MAX_PLAUSIBLE_EXPIRES_AT_MS).contains(&expires_at_ms) {
        return Err(OAuthRefreshError::ProviderError(
            "refreshed token expires_at is not a plausible unix-milliseconds timestamp".to_string(),
        ));
    }

    if expires_at_ms <= now_ms.saturating_add(MIN_REFRESHED_LIFETIME_MS) {
        return Err(OAuthRefreshError::ProviderError(
            "refreshed token expires too soon".to_string(),
        ));
    }

    Ok(())
}

fn map_codex_refresh_error(error: CodexOAuthError) -> OAuthRefreshError {
    match error {
        CodexOAuthError::RefreshTokenInvalid => OAuthRefreshError::RefreshTokenInvalid,
        CodexOAuthError::NetworkError(message) => OAuthRefreshError::NetworkError(message),
        other => OAuthRefreshError::ProviderError(other.to_string()),
    }
}

fn body_indicates_invalid_refresh_token(body: &[u8]) -> bool {
    let Ok(parsed) = serde_json::from_slice::<Value>(body) else {
        return false;
    };

    let error_type = parsed
        .get("error")
        .and_then(Value::as_object)
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .or_else(|| parsed.get("error").and_then(Value::as_str));

    matches!(error_type, Some("invalid_grant" | "refresh_token_expired"))
}

fn normalize_claude_extra(response: ClaudeTokenResponse) -> Map<String, Value> {
    let mut extra = response.extra;

    let scopes = response
        .scopes
        .unwrap_or_else(|| parse_scope_string(response.scope.as_deref()));
    if !scopes.is_empty() {
        extra.insert(
            "scopes".to_string(),
            Value::Array(scopes.into_iter().map(Value::String).collect()),
        );
    }

    normalize_string_alias(
        &mut extra,
        "subscriptionType",
        &["subscriptionType", "subscription_type"],
    );
    normalize_string_alias(
        &mut extra,
        "rateLimitTier",
        &["rateLimitTier", "rate_limit_tier"],
    );
    normalize_string_alias(&mut extra, "billingType", &["billingType", "billing_type"]);
    normalize_string_alias(&mut extra, "displayName", &["displayName", "display_name"]);
    normalize_bool_alias(
        &mut extra,
        "hasExtraUsageEnabled",
        &["hasExtraUsageEnabled", "has_extra_usage_enabled"],
    );

    extra
}

fn parse_scope_string(scope: Option<&str>) -> Vec<String> {
    scope
        .unwrap_or_default()
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn normalize_string_alias(extra: &mut Map<String, Value>, canonical: &str, aliases: &[&str]) {
    for alias in aliases {
        let Some(value) = extra.remove(*alias) else {
            continue;
        };

        match value {
            Value::String(text) if !text.trim().is_empty() => {
                extra.insert(canonical.to_string(), Value::String(text));
                return;
            }
            other => {
                extra.insert(canonical.to_string(), other);
                return;
            }
        }
    }
}

fn normalize_bool_alias(extra: &mut Map<String, Value>, canonical: &str, aliases: &[&str]) {
    for alias in aliases {
        let Some(value) = extra.remove(*alias) else {
            continue;
        };

        extra.insert(canonical.to_string(), value);
        return;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{extract::State, routing::post, Json, Router};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct TestStoredAuth {
        access_token: String,
        refresh_token: Option<String>,
        expires_at_ms: Option<i64>,
    }

    impl StoredOAuthCredential for TestStoredAuth {
        fn access_token(&self) -> &str {
            &self.access_token
        }

        fn refresh_token(&self) -> Option<&str> {
            self.refresh_token.as_deref()
        }

        fn expires_at_ms(&self) -> Option<i64> {
            self.expires_at_ms
        }
    }

    struct TestRefresher {
        calls: Arc<Mutex<usize>>,
        result: RefreshedCredentials,
    }

    #[async_trait]
    impl OAuthTokenRefresher for TestRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            *self.calls.lock().expect("lock refresher calls") += 1;
            Ok(self.result.clone())
        }
    }

    #[tokio::test]
    async fn load_or_refresh_returns_unexpired_auth_without_refresh() {
        let calls = Arc::new(Mutex::new(0usize));
        let refresher = TestRefresher {
            calls: calls.clone(),
            result: RefreshedCredentials {
                access_token: "new-access".to_string(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("new-refresh".to_string()),
                extra: Value::Null,
            },
        };
        let stored = TestStoredAuth {
            access_token: "current-access".to_string(),
            refresh_token: Some("current-refresh".to_string()),
            expires_at_ms: Some(chrono::Utc::now().timestamp_millis() + 60_000),
        };

        let refreshed = load_or_refresh_oauth_credentials(
            "Claude",
            "provider-1",
            "claude:provider-1",
            &refresher,
            &OAuthRefreshLockManager::new(),
            || Ok(Some(stored.clone())),
            |_stored, _refreshed| unreachable!("save should not be called for unexpired auth"),
        )
        .await
        .expect("auth should be returned");

        assert_eq!(refreshed.access_token, "current-access");
        assert_eq!(*calls.lock().expect("lock calls"), 0);
    }

    #[tokio::test]
    async fn load_or_refresh_refreshes_expired_auth_and_saves_it() {
        let stored = Arc::new(Mutex::new(TestStoredAuth {
            access_token: "expired-access".to_string(),
            refresh_token: Some("current-refresh".to_string()),
            expires_at_ms: Some(chrono::Utc::now().timestamp_millis() - 60_000),
        }));

        let calls = Arc::new(Mutex::new(0usize));
        let refresher = TestRefresher {
            calls: calls.clone(),
            result: RefreshedCredentials {
                access_token: "new-access".to_string(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("new-refresh".to_string()),
                extra: Value::Null,
            },
        };

        let result = load_or_refresh_oauth_credentials(
            "Claude",
            "provider-1",
            "claude:provider-1",
            &refresher,
            &OAuthRefreshLockManager::new(),
            {
                let stored = stored.clone();
                move || Ok(Some(stored.lock().expect("lock stored auth").clone()))
            },
            {
                let stored = stored.clone();
                move |_current, refreshed| {
                    let mut state = stored.lock().expect("lock stored auth");
                    *state = TestStoredAuth {
                        access_token: refreshed.access_token.clone(),
                        refresh_token: refreshed.refresh_token.clone(),
                        expires_at_ms: Some(refreshed.expires_at_ms),
                    };
                    Ok(state.clone())
                }
            },
        )
        .await
        .expect("refreshed auth should be returned");

        assert_eq!(result.access_token, "new-access");
        assert_eq!(result.refresh_token.as_deref(), Some("new-refresh"));
        assert_eq!(*calls.lock().expect("lock calls"), 1);
    }

    #[tokio::test]
    async fn claude_refresher_normalizes_scopes_and_extra_fields() {
        #[derive(Clone)]
        struct TestState {
            requests: Arc<Mutex<Vec<String>>>,
        }

        async fn refresh_handler(State(state): State<TestState>, body: String) -> Json<Value> {
            state.requests.lock().expect("lock requests").push(body);
            Json(json!({
                "access_token": "refreshed-access",
                "refresh_token": "refreshed-rt",
                "expires_in": 3600,
                "scope": "user:profile user:inference",
                "subscription_type": "pro",
                "rate_limit_tier": "max_20x"
            }))
        }

        let requests = Arc::new(Mutex::new(Vec::new()));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test listener");
        let port = listener.local_addr().expect("listener addr").port();
        let app = Router::new()
            .route("/v1/oauth/token", post(refresh_handler))
            .with_state(TestState {
                requests: requests.clone(),
            });

        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test refresher");
        });

        let refresher = ClaudeTokenRefresher::with_client_and_url(
            Client::new(),
            format!("http://127.0.0.1:{port}/v1/oauth/token"),
        );

        let refreshed = refresher
            .refresh("refresh-token")
            .await
            .expect("refresh should succeed");

        server.abort();

        let body = requests
            .lock()
            .expect("lock recorded requests")
            .first()
            .cloned()
            .expect("request body");
        assert!(body.contains("grant_type=refresh_token"));
        assert!(body
            .contains("client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclaude-code-client-metadata"));
        assert!(body.contains("refresh_token=refresh-token"));
        assert_eq!(refreshed.access_token, "refreshed-access");
        assert_eq!(refreshed.refresh_token.as_deref(), Some("refreshed-rt"));
        assert_eq!(
            refreshed
                .extra
                .get("subscriptionType")
                .and_then(Value::as_str),
            Some("pro")
        );
        assert_eq!(
            refreshed.extra.get("rateLimitTier").and_then(Value::as_str),
            Some("max_20x")
        );
        assert_eq!(
            refreshed.extra.get("scopes"),
            Some(&json!(["user:profile", "user:inference"]))
        );
    }

    #[tokio::test]
    async fn codex_refresher_sends_expected_form_fields() {
        #[derive(Clone)]
        struct TestState {
            requests: Arc<Mutex<Vec<String>>>,
        }

        async fn refresh_handler(State(state): State<TestState>, body: String) -> Json<Value> {
            state.requests.lock().expect("lock requests").push(body);
            Json(json!({
                "access_token": "header.eyJleHAiOjQxMDI0NDQ4MDB9.sig",
                "refresh_token": "rotated-refresh-token",
                "id_token": "header.eyJjaGF0Z3B0X2FjY291bnRfaWQiOiJhY2MtMTIzIiwiZXhwIjo0MTAyNDQ0ODAwfQ.sig",
                "expires_in": 3600
            }))
        }

        let requests = Arc::new(Mutex::new(Vec::new()));
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test listener");
        let port = listener.local_addr().expect("listener addr").port();
        let app = Router::new()
            .route("/oauth/token", post(refresh_handler))
            .with_state(TestState {
                requests: requests.clone(),
            });

        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve test refresher");
        });

        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build client");
        let refresher = CodexTokenRefresher::with_http_client(client);
        let result =
            crate::proxy::providers::codex_oauth_auth::refresh_codex_tokens_with_client_at_url(
                &refresher.http_client,
                "refresh-token",
                &format!("http://127.0.0.1:{port}/oauth/token"),
            )
            .await
            .expect("refresh request should succeed");

        server.abort();

        let body = requests
            .lock()
            .expect("lock recorded requests")
            .first()
            .cloned()
            .expect("request body");
        assert!(body.contains("grant_type=refresh_token"));
        assert!(body.contains("scope=openid+profile+email"));
        assert!(body.contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
        assert!(body.contains("refresh_token=refresh-token"));
        assert_eq!(result.access_token, "header.eyJleHAiOjQxMDI0NDQ4MDB9.sig");
        assert_eq!(
            result.refresh_token.as_deref(),
            Some("rotated-refresh-token")
        );
    }
}
