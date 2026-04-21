use super::rate_limit::RateLimitSnapshot;
use std::{
    collections::{hash_map::Entry, HashMap},
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, OnceCell};

pub const DEFAULT_QUOTA_TTL_SECS: u64 = 60;
pub const DEFAULT_QUOTA_TTL: Duration = Duration::from_secs(DEFAULT_QUOTA_TTL_SECS);
pub const QUOTA_TTL_SECS_ENV_VAR: &str = "CCSWITCH_QUOTA_TTL_SECS";

type InflightResult<T> = Arc<OnceCell<Result<T, String>>>;

#[derive(Clone)]
pub struct QuotaCache<T> {
    state: Arc<Mutex<QuotaCacheState<T>>>,
}

struct QuotaCacheState<T> {
    entries: HashMap<String, CachedEntry<T>>,
    inflight: HashMap<String, InflightResult<T>>,
}

#[derive(Clone)]
struct CachedEntry<T> {
    value: T,
    refreshed_at: Instant,
}

pub type RateLimitSnapshotCache = QuotaCache<RateLimitSnapshot>;

impl<T> Default for QuotaCache<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Default for QuotaCacheState<T> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
            inflight: HashMap::new(),
        }
    }
}

impl<T> CachedEntry<T> {
    fn new(value: T) -> Self {
        Self {
            value,
            refreshed_at: Instant::now(),
        }
    }

    fn is_fresh(&self, ttl: Duration) -> bool {
        self.refreshed_at.elapsed() < ttl
    }
}

impl<T> QuotaCache<T> {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(QuotaCacheState::default())),
        }
    }
}

impl<T> QuotaCache<T>
where
    T: Clone + Send + Sync + 'static,
{
    pub async fn get_or_refresh<F, Fut>(&self, provider_id: &str, refresh: F) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let ttl = quota_cache_ttl();
        let provider_id = provider_id.to_string();

        if let Some(value) = self.get_fresh(&provider_id, ttl).await {
            return Ok(value);
        }

        let inflight = {
            let mut state = self.state.lock().await;

            if let Some(entry) = state.entries.get(&provider_id) {
                if entry.is_fresh(ttl) {
                    return Ok(entry.value.clone());
                }
            }

            match state.inflight.entry(provider_id.clone()) {
                Entry::Occupied(existing) => existing.get().clone(),
                Entry::Vacant(vacant) => {
                    // A per-provider OnceCell coalesces concurrent refreshes so every waiter
                    // observes the same upstream result instead of issuing a duplicate call.
                    let cell = Arc::new(OnceCell::new());
                    vacant.insert(cell.clone());
                    cell
                }
            }
        };

        let result = inflight
            .get_or_init(|| {
                let provider_id = provider_id.clone();
                async move {
                    let stale = {
                        let state = self.state.lock().await;
                        state.entries.get(&provider_id).map(|entry| entry.value.clone())
                    };

                    match refresh().await {
                        Ok(value) => {
                            let mut state = self.state.lock().await;
                            state
                                .entries
                                .insert(provider_id.clone(), CachedEntry::new(value.clone()));
                            Ok(value)
                        }
                        Err(error) => {
                            if let Some(value) = stale {
                                log::warn!(
                                    "[Quota] live quota refresh failed for {}: {}; reusing last good snapshot",
                                    provider_id,
                                    error
                                );
                                Ok(value)
                            } else {
                                log::warn!(
                                    "[Quota] live quota refresh failed for {}: {}",
                                    provider_id,
                                    error
                                );
                                Err(error)
                            }
                        }
                    }
                }
            })
            .await
            .clone();

        let mut state = self.state.lock().await;
        if state
            .inflight
            .get(&provider_id)
            .is_some_and(|current| Arc::ptr_eq(current, &inflight))
        {
            state.inflight.remove(&provider_id);
        }
        drop(state);

        result
    }

    async fn get_fresh(&self, provider_id: &str, ttl: Duration) -> Option<T> {
        let state = self.state.lock().await;
        state
            .entries
            .get(provider_id)
            .and_then(|entry| entry.is_fresh(ttl).then_some(entry.value.clone()))
    }
}

pub fn quota_cache_ttl() -> Duration {
    std::env::var(QUOTA_TTL_SECS_ENV_VAR)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_QUOTA_TTL)
}

#[cfg(test)]
mod tests {
    use super::{quota_cache_ttl, QuotaCache, DEFAULT_QUOTA_TTL, QUOTA_TTL_SECS_ENV_VAR};
    use serial_test::serial;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    };
    use std::time::Duration;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        _guard: std::sync::MutexGuard<'static, ()>,
        original: Option<String>,
    }

    impl EnvGuard {
        fn new(value: Option<&str>) -> Self {
            let guard = env_lock()
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let original = std::env::var(QUOTA_TTL_SECS_ENV_VAR).ok();
            let this = Self {
                _guard: guard,
                original,
            };
            this.set(value);
            this
        }

        fn set(&self, value: Option<&str>) {
            match value {
                Some(value) => std::env::set_var(QUOTA_TTL_SECS_ENV_VAR, value),
                None => std::env::remove_var(QUOTA_TTL_SECS_ENV_VAR),
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.original {
                Some(value) => std::env::set_var(QUOTA_TTL_SECS_ENV_VAR, value),
                None => std::env::remove_var(QUOTA_TTL_SECS_ENV_VAR),
            }
        }
    }

    #[tokio::test]
    #[serial]
    async fn hit_within_ttl_skips_refresh() {
        let _env = EnvGuard::new(None);
        let cache = QuotaCache::new();
        let calls = AtomicUsize::new(0);

        let first = cache
            .get_or_refresh("claude-oauth", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>("first".to_string())
            })
            .await
            .expect("first refresh");
        let second = cache
            .get_or_refresh("claude-oauth", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>("second".to_string())
            })
            .await
            .expect("cached refresh");

        assert_eq!(first, "first");
        assert_eq!(second, "first");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    #[serial]
    async fn first_miss_calls_refresh() {
        let _env = EnvGuard::new(None);
        let cache = QuotaCache::new();
        let calls = AtomicUsize::new(0);

        let value = cache
            .get_or_refresh("codex-official", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>("fresh".to_string())
            })
            .await
            .expect("refresh");

        assert_eq!(value, "fresh");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    #[serial]
    async fn expired_entry_triggers_refresh() {
        let env = EnvGuard::new(None);
        let cache = QuotaCache::new();
        let calls = AtomicUsize::new(0);

        cache
            .get_or_refresh("codex-official", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>("old".to_string())
            })
            .await
            .expect("initial refresh");

        env.set(Some("0"));
        let value = cache
            .get_or_refresh("codex-official", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, String>("new".to_string())
            })
            .await
            .expect("expired refresh");

        assert_eq!(value, "new");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    #[serial]
    async fn concurrent_miss_is_single_flight() {
        let _env = EnvGuard::new(Some("0"));
        let cache = QuotaCache::new();
        let calls = Arc::new(AtomicUsize::new(0));

        let first = {
            let cache = cache.clone();
            let calls = calls.clone();
            tokio::spawn(async move {
                cache
                    .get_or_refresh("claude-oauth", || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        Ok::<_, String>("snapshot".to_string())
                    })
                    .await
            })
        };
        let second = {
            let cache = cache.clone();
            let calls = calls.clone();
            tokio::spawn(async move {
                cache
                    .get_or_refresh("claude-oauth", || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok::<_, String>("other".to_string())
                    })
                    .await
            })
        };

        let (first, second) = tokio::join!(first, second);
        assert_eq!(
            first.expect("join first").expect("first result"),
            "snapshot"
        );
        assert_eq!(
            second.expect("join second").expect("second result"),
            "snapshot"
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    #[serial]
    async fn refresh_error_returns_last_good_value() {
        let _env = EnvGuard::new(Some("0"));
        let cache = QuotaCache::new();

        cache
            .get_or_refresh("claude-oauth", || async {
                Ok::<_, String>("cached".to_string())
            })
            .await
            .expect("seed cache");

        let value = cache
            .get_or_refresh("claude-oauth", || async {
                Err::<String, _>("429".to_string())
            })
            .await
            .expect("fallback value");

        assert_eq!(value, "cached");
    }

    #[tokio::test]
    #[serial]
    async fn refresh_error_without_prior_value_returns_error() {
        let _env = EnvGuard::new(Some("0"));
        let cache = QuotaCache::<String>::new();

        let error = cache
            .get_or_refresh("claude-oauth", || async {
                Err::<String, _>("429".to_string())
            })
            .await
            .expect_err("refresh error");

        assert_eq!(error, "429");
    }

    #[test]
    #[serial]
    fn env_override_changes_ttl() {
        let env = EnvGuard::new(Some("5"));
        assert_eq!(quota_cache_ttl(), Duration::from_secs(5));

        env.set(None);
        assert_eq!(quota_cache_ttl(), DEFAULT_QUOTA_TTL);
    }
}
