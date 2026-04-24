use super::storage::{
    load_claude_refresh_auth_for_provider, save_refreshed_claude_auth_for_provider,
    StoredClaudeRefreshAuth,
};
use super::{
    load_or_refresh_oauth_credentials, OAuthRefreshLockManager, OAuthTokenRefresher,
    RefreshedCredentials, StoredOAuthCredential,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedAccessToken {
    pub access_token: String,
    pub expires_at_ms: Option<i64>,
}

impl StoredOAuthCredential for CachedAccessToken {
    fn access_token(&self) -> &str {
        &self.access_token
    }

    fn refresh_token(&self) -> Option<&str> {
        None
    }

    fn expires_at_ms(&self) -> Option<i64> {
        self.expires_at_ms
    }
}

#[derive(Clone, Default)]
pub struct ClaudeUploadedAuthManager {
    cached_access_tokens: Arc<RwLock<HashMap<String, CachedAccessToken>>>,
    refresh_locks: OAuthRefreshLockManager,
}

impl ClaudeUploadedAuthManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn refresh_locks(&self) -> OAuthRefreshLockManager {
        self.refresh_locks.clone()
    }

    pub async fn get_valid_access_token<R: OAuthTokenRefresher + ?Sized>(
        &self,
        provider_id: &str,
        refresher: &R,
    ) -> Option<String> {
        self.get_valid_access_token_with_storage(
            provider_id,
            refresher,
            {
                let provider_id = provider_id.to_string();
                move || load_claude_refresh_auth_for_provider(&provider_id)
            },
            {
                let provider_id = provider_id.to_string();
                move |stored, refreshed| {
                    save_refreshed_claude_auth_for_provider(&provider_id, stored, refreshed)
                }
            },
        )
        .await
    }

    pub(crate) async fn get_valid_access_token_with_storage<Load, Save, R>(
        &self,
        provider_id: &str,
        refresher: &R,
        load: Load,
        save: Save,
    ) -> Option<String>
    where
        Load: Fn() -> anyhow::Result<Option<StoredClaudeRefreshAuth>>,
        Save: Fn(
            &StoredClaudeRefreshAuth,
            &RefreshedCredentials,
        ) -> anyhow::Result<StoredClaudeRefreshAuth>,
        R: OAuthTokenRefresher + ?Sized,
    {
        if let Some(cached) = self.get_cached_access_token(provider_id).await {
            if !super::should_refresh(&cached) {
                return Some(cached.access_token);
            }

            self.evict_cached_access_token(provider_id).await;
        }

        let provider_key = format!("claude:{provider_id}");
        let auth = load_or_refresh_oauth_credentials(
            "Claude",
            provider_id,
            &provider_key,
            refresher,
            &self.refresh_locks,
            load,
            save,
        )
        .await?;

        let access_token = auth.access_token.clone();
        self.cache_access_token(
            provider_id,
            CachedAccessToken {
                access_token: access_token.clone(),
                expires_at_ms: auth.expires_at_ms,
            },
        )
        .await;

        Some(access_token)
    }

    pub async fn invalidate(&self, provider_id: &str) {
        self.evict_cached_access_token(provider_id).await;
    }

    async fn get_cached_access_token(&self, provider_id: &str) -> Option<CachedAccessToken> {
        let cached_access_tokens = self.cached_access_tokens.read().await;
        cached_access_tokens.get(provider_id).cloned()
    }

    async fn cache_access_token(&self, provider_id: &str, cached: CachedAccessToken) {
        let mut cached_access_tokens = self.cached_access_tokens.write().await;
        cached_access_tokens.insert(provider_id.to_string(), cached);
    }

    async fn evict_cached_access_token(&self, provider_id: &str) {
        let mut cached_access_tokens = self.cached_access_tokens.write().await;
        cached_access_tokens.remove(provider_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proxy::providers::claude_oauth_store::save_claude_auth_for_provider;
    use crate::services::oauth_refresh::{OAuthRefreshError, RefreshedCredentials};
    use async_trait::async_trait;
    use serde_json::json;
    use serial_test::serial;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex, OnceLock};
    use tokio::sync::Notify;

    use crate::services::oauth_refresh::storage::{
        load_claude_refresh_auth_for_provider, save_refreshed_claude_auth_for_provider,
    };

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        _tmp: tempfile::TempDir,
    }

    impl TestEnv {
        fn new() -> Self {
            let guard = env_lock().lock().expect("lock env");
            let tmp = tempfile::TempDir::new().expect("create temp dir");
            let data = tmp.path().join("data");
            std::fs::create_dir_all(&data).expect("create data dir");
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);
            Self {
                _guard: guard,
                _tmp: tmp,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            std::env::remove_var("CC_SWITCH_DATA_DIR");
        }
    }

    fn sample_claude_auth_json(
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at_ms: i64,
    ) -> Vec<u8> {
        json!({
            "claudeAiOauth": {
                "accessToken": access_token,
                "refreshToken": refresh_token,
                "expiresAt": expires_at_ms,
                "scopes": ["user:inference"]
            }
        })
        .to_string()
        .into_bytes()
    }

    struct NeverRefresher;

    #[async_trait]
    impl OAuthTokenRefresher for NeverRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            panic!("refresh should not be called");
        }
    }

    struct QueueRefresher {
        calls: Arc<Mutex<usize>>,
        results: Arc<Mutex<VecDeque<RefreshedCredentials>>>,
    }

    #[async_trait]
    impl OAuthTokenRefresher for QueueRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            *self.calls.lock().expect("lock refresh calls") += 1;
            self.results
                .lock()
                .expect("lock refresh queue")
                .pop_front()
                .ok_or_else(|| {
                    OAuthRefreshError::ProviderError("missing queued refresh".to_string())
                })
        }
    }

    #[derive(Clone)]
    struct BlockingRefresher {
        calls: Arc<Mutex<usize>>,
        entered: Arc<Notify>,
        release: Arc<Notify>,
        result: RefreshedCredentials,
    }

    #[async_trait]
    impl OAuthTokenRefresher for BlockingRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            *self.calls.lock().expect("lock refresh calls") += 1;
            self.entered.notify_waiters();
            self.release.notified().await;
            Ok(self.result.clone())
        }
    }

    #[tokio::test]
    #[serial]
    async fn memory_cache_hit_avoids_disk_read_after_first_resolution() {
        let _env = TestEnv::new();
        let manager = ClaudeUploadedAuthManager::new();
        let provider_id = "provider-1";
        let expires_at_ms = chrono::Utc::now().timestamp_millis() + 10 * 60_000;
        save_claude_auth_for_provider(
            provider_id,
            &sample_claude_auth_json("cached-token", Some("refresh-token"), expires_at_ms),
        )
        .expect("save auth");

        let disk_reads = Arc::new(Mutex::new(0usize));

        let first = manager
            .get_valid_access_token_with_storage(
                provider_id,
                &NeverRefresher,
                {
                    let disk_reads = disk_reads.clone();
                    move || {
                        *disk_reads.lock().expect("lock disk reads") += 1;
                        load_claude_refresh_auth_for_provider(provider_id)
                    }
                },
                move |stored, refreshed| {
                    save_refreshed_claude_auth_for_provider(provider_id, stored, refreshed)
                },
            )
            .await;
        let second = manager
            .get_valid_access_token_with_storage(
                provider_id,
                &NeverRefresher,
                {
                    let disk_reads = disk_reads.clone();
                    move || {
                        *disk_reads.lock().expect("lock disk reads") += 1;
                        load_claude_refresh_auth_for_provider(provider_id)
                    }
                },
                move |stored, refreshed| {
                    save_refreshed_claude_auth_for_provider(provider_id, stored, refreshed)
                },
            )
            .await;

        assert_eq!(first.as_deref(), Some("cached-token"));
        assert_eq!(second.as_deref(), Some("cached-token"));
        assert_eq!(*disk_reads.lock().expect("lock disk reads"), 1);
    }

    #[tokio::test]
    #[serial]
    async fn cache_reloads_and_refreshes_tokens_within_skew_window() {
        let _env = TestEnv::new();
        let manager = ClaudeUploadedAuthManager::new();
        let provider_id = "provider-1";
        save_claude_auth_for_provider(
            provider_id,
            &sample_claude_auth_json(
                "expired-token",
                Some("refresh-token"),
                chrono::Utc::now().timestamp_millis() - 60_000,
            ),
        )
        .expect("save auth");

        let refresh_calls = Arc::new(Mutex::new(0usize));
        let refresher = QueueRefresher {
            calls: refresh_calls.clone(),
            results: Arc::new(Mutex::new(VecDeque::from(vec![
                RefreshedCredentials {
                    access_token: "fresh-soon".to_string(),
                    expires_at_ms: chrono::Utc::now().timestamp_millis() + 4 * 60_000,
                    refresh_token: Some("rotated-refresh-1".to_string()),
                    extra: json!({}),
                },
                RefreshedCredentials {
                    access_token: "fresh-later".to_string(),
                    expires_at_ms: chrono::Utc::now().timestamp_millis() + 30 * 60_000,
                    refresh_token: Some("rotated-refresh-2".to_string()),
                    extra: json!({}),
                },
            ]))),
        };

        let first = manager
            .get_valid_access_token(provider_id, &refresher)
            .await;
        let second = manager
            .get_valid_access_token(provider_id, &refresher)
            .await;

        assert_eq!(first.as_deref(), Some("fresh-soon"));
        assert_eq!(second.as_deref(), Some("fresh-later"));
        assert_eq!(*refresh_calls.lock().expect("lock refresh calls"), 2);

        let stored = load_claude_refresh_auth_for_provider(provider_id)
            .expect("load stored auth")
            .expect("stored auth");
        assert_eq!(stored.access_token, "fresh-later");
        assert_eq!(stored.refresh_token.as_deref(), Some("rotated-refresh-2"));
    }

    #[tokio::test]
    #[serial]
    async fn concurrent_same_provider_refreshes_only_fire_one_upstream_refresh() {
        let _env = TestEnv::new();
        let manager = ClaudeUploadedAuthManager::new();
        let provider_id = "provider-1".to_string();
        save_claude_auth_for_provider(
            &provider_id,
            &sample_claude_auth_json(
                "expired-token",
                Some("refresh-token"),
                chrono::Utc::now().timestamp_millis() - 60_000,
            ),
        )
        .expect("save auth");

        let refresh_calls = Arc::new(Mutex::new(0usize));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let refresher = BlockingRefresher {
            calls: refresh_calls.clone(),
            entered: entered.clone(),
            release: release.clone(),
            result: RefreshedCredentials {
                access_token: "refreshed-token".to_string(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh".to_string()),
                extra: json!({}),
            },
        };

        let first = tokio::spawn({
            let manager = manager.clone();
            let refresher = refresher.clone();
            let provider_id = provider_id.clone();
            async move {
                manager
                    .get_valid_access_token_with_storage(
                        &provider_id,
                        &refresher,
                        {
                            let provider_id = provider_id.clone();
                            move || load_claude_refresh_auth_for_provider(&provider_id)
                        },
                        {
                            let provider_id = provider_id.clone();
                            move |stored, refreshed| {
                                save_refreshed_claude_auth_for_provider(
                                    &provider_id,
                                    stored,
                                    refreshed,
                                )
                            }
                        },
                    )
                    .await
            }
        });

        entered.notified().await;

        let second = tokio::spawn({
            let manager = manager.clone();
            let refresher = refresher.clone();
            let provider_id = provider_id.clone();
            async move {
                manager
                    .get_valid_access_token_with_storage(
                        &provider_id,
                        &refresher,
                        {
                            let provider_id = provider_id.clone();
                            move || load_claude_refresh_auth_for_provider(&provider_id)
                        },
                        {
                            let provider_id = provider_id.clone();
                            move |stored, refreshed| {
                                save_refreshed_claude_auth_for_provider(
                                    &provider_id,
                                    stored,
                                    refreshed,
                                )
                            }
                        },
                    )
                    .await
            }
        });

        release.notify_waiters();

        let first = first.await.expect("first task").expect("first token");
        let second = second.await.expect("second task").expect("second token");

        assert_eq!(first, "refreshed-token");
        assert_eq!(second, "refreshed-token");
        assert_eq!(*refresh_calls.lock().expect("lock refresh calls"), 1);
    }
}
