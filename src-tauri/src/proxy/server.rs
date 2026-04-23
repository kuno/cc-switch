//! HTTP代理服务器
//!
//! 基于Axum的HTTP服务器，处理代理请求
//!
//! Uses a manual hyper HTTP/1.1 accept loop with `preserve_header_case(true)` so
//! that the original header-name casing from the CLI client is captured in a
//! `HeaderCaseMap` extension.  This map is later forwarded to the upstream via
//! the hyper-based HTTP client, producing wire-level header casing identical to
//! a direct (non-proxied) CLI request.

use super::{
    failover_switch::FailoverSwitchManager, handlers, log_codes::srv as log_srv,
    provider_router::ProviderRouter, providers::gemini_shadow::GeminiShadowStore, types::*,
    ProxyError,
};
use crate::database::Database;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use crate::services::oauth_refresh::OAuthRefreshLockManager;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, head, post},
    Router,
};
use hyper_util::rt::TokioIo;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

fn identity_router(router: Router<ProxyState>) -> Router<ProxyState> {
    router
}

fn active_target_priority(app_type: &str) -> u8 {
    if app_type.eq_ignore_ascii_case("claude") {
        0
    } else {
        1
    }
}

pub(crate) fn populate_status_active_targets(
    status: &mut ProxyStatus,
    current_providers: &std::collections::HashMap<String, (String, String)>,
) {
    status.active_targets = current_providers
        .iter()
        .map(|(app_type, (provider_id, provider_name))| ActiveTarget {
            app_type: app_type.clone(),
            provider_id: provider_id.clone(),
            provider_name: provider_name.clone(),
        })
        .collect();

    status.active_targets.sort_by(|left, right| {
        active_target_priority(&left.app_type)
            .cmp(&active_target_priority(&right.app_type))
            .then_with(|| left.app_type.cmp(&right.app_type))
            .then_with(|| left.provider_name.cmp(&right.provider_name))
            .then_with(|| left.provider_id.cmp(&right.provider_id))
    });

    status.current_provider = status
        .active_targets
        .first()
        .map(|target| target.provider_name.clone());
    status.current_provider_id = status
        .active_targets
        .first()
        .map(|target| target.provider_id.clone());
}

/// 代理服务器状态（共享）
#[derive(Clone)]
pub struct ProxyState {
    pub db: Arc<Database>,
    pub config: Arc<RwLock<ProxyConfig>>,
    pub status: Arc<RwLock<ProxyStatus>>,
    pub start_time: Arc<RwLock<Option<std::time::Instant>>>,
    /// 每个应用类型当前使用的 provider (app_type -> (provider_id, provider_name))
    pub current_providers: Arc<RwLock<std::collections::HashMap<String, (String, String)>>>,
    /// 共享的 ProviderRouter（持有熔断器状态，跨请求保持）
    pub provider_router: Arc<ProviderRouter>,
    /// Gemini Native shadow state，用于 thoughtSignature / tool call 回放
    pub gemini_shadow: Arc<GeminiShadowStore>,
    /// Copilot auth manager — injected directly, no Tauri needed
    pub copilot_auth: Option<Arc<RwLock<CopilotAuthManager>>>,
    /// Codex OAuth auth manager — injected directly, no Tauri needed
    pub codex_oauth_auth: Option<Arc<RwLock<CodexOAuthManager>>>,
    /// AppHandle for UI notifications (desktop only)
    #[cfg(feature = "tauri-desktop")]
    pub app_handle: Option<tauri::AppHandle>,
    /// 故障转移切换管理器
    pub failover_manager: Arc<FailoverSwitchManager>,
    /// Per-provider rate limit snapshots from upstream response headers
    pub rate_limits: super::rate_limit::RateLimitStore,
    /// In-memory TTL cache for live subscription quota snapshots
    pub quota_snapshot_cache: super::quota_cache::RateLimitSnapshotCache,
    /// Single-flight locks for reactive OAuth token refresh
    pub oauth_refresh_locks: OAuthRefreshLockManager,
}

/// 代理HTTP服务器
pub struct ProxyServer {
    config: ProxyConfig,
    state: ProxyState,
    route_mounter: fn(Router<ProxyState>) -> Router<ProxyState>,
    shutdown_tx: Arc<RwLock<Option<oneshot::Sender<()>>>>,
    /// 服务器任务句柄，用于等待服务器实际关闭
    server_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
}

impl ProxyServer {
    pub fn new(
        config: ProxyConfig,
        db: Arc<Database>,
        copilot_auth: Option<Arc<RwLock<CopilotAuthManager>>>,
        codex_oauth_auth: Option<Arc<RwLock<CodexOAuthManager>>>,
        #[cfg(feature = "tauri-desktop")] app_handle: Option<tauri::AppHandle>,
    ) -> Self {
        // 创建共享的 ProviderRouter（熔断器状态将跨所有请求保持）
        let provider_router = Arc::new(ProviderRouter::new(db.clone()));
        // 创建共享的 current_providers map
        let current_providers = Arc::new(RwLock::new(std::collections::HashMap::new()));
        // 创建故障转移切换管理器
        let failover_manager = Arc::new(FailoverSwitchManager::new(
            db.clone(),
            current_providers.clone(),
        ));

        let rate_limits = {
            let store = super::rate_limit::new_rate_limit_store();
            let snapshots = db.load_rate_limit_snapshots();
            if !snapshots.is_empty() {
                log::info!(
                    "[RateLimit] loaded {} persisted snapshots from DB",
                    snapshots.len()
                );
                let mut map = store.try_write().expect("rate_limit store lock on init");
                for s in snapshots {
                    map.insert(s.provider_id.clone(), s);
                }
            }
            store
        };

        let state = ProxyState {
            db,
            config: Arc::new(RwLock::new(config.clone())),
            status: Arc::new(RwLock::new(ProxyStatus::default())),
            start_time: Arc::new(RwLock::new(None)),
            current_providers,
            provider_router,
            gemini_shadow: Arc::new(GeminiShadowStore::default()),
            copilot_auth,
            codex_oauth_auth,
            #[cfg(feature = "tauri-desktop")]
            app_handle,
            failover_manager,
            rate_limits,
            quota_snapshot_cache: super::quota_cache::RateLimitSnapshotCache::new(),
            oauth_refresh_locks: OAuthRefreshLockManager::new(),
        };

        Self {
            config,
            state,
            route_mounter: identity_router,
            shutdown_tx: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn with_route_mounter(
        mut self,
        route_mounter: fn(Router<ProxyState>) -> Router<ProxyState>,
    ) -> Self {
        self.route_mounter = route_mounter;
        self
    }

    pub async fn start(&self) -> Result<ProxyServerInfo, ProxyError> {
        // 检查是否已在运行
        if self.shutdown_tx.read().await.is_some() {
            return Err(ProxyError::AlreadyRunning);
        }

        let addr: SocketAddr =
            format!("{}:{}", self.config.listen_address, self.config.listen_port)
                .parse()
                .map_err(|e| ProxyError::BindFailed(format!("无效的地址: {e}")))?;

        // 创建关闭通道
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        // 构建路由
        let app = self.build_router();

        // 绑定监听器
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| ProxyError::BindFailed(e.to_string()))?;

        log::info!("[{}] 代理服务器启动于 {addr}", log_srv::STARTED);

        // 更新全局代理端口，用于系统代理检测
        crate::proxy::http_client::set_proxy_port(self.config.listen_port);

        // 保存关闭句柄
        *self.shutdown_tx.write().await = Some(shutdown_tx);

        // 更新状态
        let mut status = self.state.status.write().await;
        status.running = true;
        status.address = self.config.listen_address.clone();
        status.port = self.config.listen_port;
        drop(status);

        // 记录启动时间
        *self.state.start_time.write().await = Some(std::time::Instant::now());

        // 启动服务器 — 使用手动 hyper HTTP/1.1 accept loop
        // 开启 preserve_header_case 以捕获客户端请求头的原始大小写
        let state = self.state.clone();
        let handle = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        let (stream, _remote_addr) = match result {
                            Ok(v) => v,
                            Err(e) => {
                                log::error!("[{SRV}] accept 失败: {e}", SRV = log_srv::ACCEPT_ERR);
                                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                                continue;
                            }
                        };

                        let app = app.clone();
                        tokio::spawn(async move {
                            // Peek raw TCP bytes to capture original header casing
                            // before hyper parses (and lowercases) the header names.
                            let original_cases = {
                                let mut peek_buf = vec![0u8; 8192];
                                match stream.peek(&mut peek_buf).await {
                                    Ok(n) => {
                                        let cases = super::hyper_client::OriginalHeaderCases::from_raw_bytes(&peek_buf[..n]);
                                        log::debug!(
                                            "[ProxyServer] Peeked {} bytes, captured {} header casings",
                                            n, cases.cases.len()
                                        );
                                        cases
                                    }
                                    Err(e) => {
                                        log::debug!("[ProxyServer] peek failed (non-fatal): {e}");
                                        super::hyper_client::OriginalHeaderCases::default()
                                    }
                                }
                            };

                            // service_fn 将 axum Router（tower::Service）桥接到 hyper
                            let service = hyper::service::service_fn(move |req: hyper::Request<hyper::body::Incoming>| {
                                let mut router = app.clone();
                                let cases = original_cases.clone();
                                async move {
                                    // 将 hyper::body::Incoming 转为 axum::body::Body，保留 extensions
                                    let (mut parts, body) = req.into_parts();

                                    // Insert our own header case map alongside hyper's internal one
                                    parts.extensions.insert(cases);

                                    let body = axum::body::Body::new(body);
                                    let axum_req = http::Request::from_parts(parts, body);
                                    <Router as tower::Service<http::Request<axum::body::Body>>>::call(&mut router, axum_req).await
                                }
                            });

                            if let Err(e) = hyper::server::conn::http1::Builder::new()
                                .preserve_header_case(true)
                                .serve_connection(TokioIo::new(stream), service)
                                .await
                            {
                                // Connection reset / broken pipe 等在代理场景下很常见，debug 级别
                                log::debug!("[{SRV}] connection error: {e}", SRV = log_srv::CONN_ERR);
                            }
                        });
                    }
                    _ = &mut shutdown_rx => {
                        break;
                    }
                }
            }

            // 服务器停止后更新状态
            state.status.write().await.running = false;
            *state.start_time.write().await = None;
        });

        // 保存服务器任务句柄
        *self.server_handle.write().await = Some(handle);

        Ok(ProxyServerInfo {
            address: self.config.listen_address.clone(),
            port: self.config.listen_port,
            started_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub async fn stop(&self) -> Result<(), ProxyError> {
        // 0. Persist rate limit snapshots to DB before shutdown
        {
            let store = self.state.rate_limits.read().await;
            let snapshots: Vec<_> = store.values().cloned().collect();
            if !snapshots.is_empty() {
                match self.state.db.flush_rate_limit_snapshots(&snapshots) {
                    Ok(()) => log::info!("[RateLimit] flushed {} snapshots to DB", snapshots.len()),
                    Err(e) => log::warn!("[RateLimit] failed to persist snapshots: {e}"),
                }
            }
        }

        // 1. 发送关闭信号
        if let Some(tx) = self.shutdown_tx.write().await.take() {
            let _ = tx.send(());
        } else {
            return Err(ProxyError::NotRunning);
        }

        // 2. 等待服务器任务结束（带 5 秒超时保护）
        if let Some(handle) = self.server_handle.write().await.take() {
            match tokio::time::timeout(std::time::Duration::from_secs(5), handle).await {
                Ok(Ok(())) => {
                    log::info!("[{}] 代理服务器已完全停止", log_srv::STOPPED);
                    Ok(())
                }
                Ok(Err(e)) => {
                    log::warn!("[{}] 代理服务器任务异常终止: {e}", log_srv::TASK_ERROR);
                    Err(ProxyError::StopFailed(e.to_string()))
                }
                Err(_) => {
                    log::warn!(
                        "[{}] 代理服务器停止超时（5秒），强制继续",
                        log_srv::STOP_TIMEOUT
                    );
                    Err(ProxyError::StopTimeout)
                }
            }
        } else {
            Ok(())
        }
    }

    pub async fn get_status(&self) -> ProxyStatus {
        let mut status = self.state.status.read().await.clone();

        // 计算运行时间
        if let Some(start) = *self.state.start_time.read().await {
            status.uptime_seconds = start.elapsed().as_secs();
        }

        // 从 current_providers HashMap 获取每个应用类型当前正在使用的 provider
        let current_providers = self.state.current_providers.read().await;
        populate_status_active_targets(&mut status, &current_providers);

        status
    }

    /// 从内存中的快照存储移除指定供应商的速率限制快照
    pub async fn evict_rate_limit_snapshot(&self, provider_id: &str) {
        self.state.rate_limits.write().await.remove(provider_id);
    }

    /// Clone the shared OAuth refresh lock manager so callers outside this server
    /// (e.g. a startup background task) can acquire the same per-provider locks and
    /// avoid racing with the lazy refresh path in the request handlers.
    pub fn clone_oauth_refresh_locks(&self) -> OAuthRefreshLockManager {
        self.state.oauth_refresh_locks.clone()
    }

    /// 更新某个应用类型当前"目标供应商"（用于 UI 展示 active_targets）
    ///
    /// 注意：这不代表该供应商一定已经处理过请求，而是用于"热切换/启用故障转移立即切 P1"
    /// 等场景下，让 UI 能立刻反映最新目标。
    pub async fn set_active_target(&self, app_type: &str, provider_id: &str, provider_name: &str) {
        let mut current_providers = self.state.current_providers.write().await;
        current_providers.insert(
            app_type.to_string(),
            (provider_id.to_string(), provider_name.to_string()),
        );
    }

    fn build_router(&self) -> Router {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let router: Router<ProxyState> = Router::new()
            // 健康检查
            .route("/health", get(handlers::health_check))
            .route("/", head(handlers::handle_head_root))
            .route("/status", get(handlers::get_status))
            .route("/api/quota", get(handlers::get_quota))
            // Claude API (支持带前缀和不带前缀两种格式)
            .route("/v1/models", get(handlers::handle_list_models))
            .route("/v1/messages", post(handlers::handle_messages))
            .route("/claude/v1/models", get(handlers::handle_list_models))
            .route("/claude/v1/messages", post(handlers::handle_messages))
            // OpenAI Chat Completions API (Codex CLI，支持带前缀和不带前缀)
            .route("/chat/completions", post(handlers::handle_chat_completions))
            .route(
                "/v1/chat/completions",
                post(handlers::handle_chat_completions),
            )
            .route(
                "/v1/v1/chat/completions",
                post(handlers::handle_chat_completions),
            )
            .route(
                "/codex/v1/chat/completions",
                post(handlers::handle_chat_completions),
            )
            // OpenAI Responses API (Codex CLI，支持带前缀和不带前缀)
            .route("/responses", post(handlers::handle_responses))
            .route("/v1/responses", post(handlers::handle_responses))
            .route("/v1/v1/responses", post(handlers::handle_responses))
            .route("/codex/v1/responses", post(handlers::handle_responses))
            // OpenAI Responses Compact API (Codex CLI 远程压缩，透传)
            .route(
                "/responses/compact",
                post(handlers::handle_responses_compact),
            )
            .route(
                "/v1/responses/compact",
                post(handlers::handle_responses_compact),
            )
            .route(
                "/v1/v1/responses/compact",
                post(handlers::handle_responses_compact),
            )
            .route(
                "/codex/v1/responses/compact",
                post(handlers::handle_responses_compact),
            )
            // Gemini API (支持带前缀和不带前缀)
            .route("/v1beta/*path", post(handlers::handle_gemini))
            .route("/gemini/v1beta/*path", post(handlers::handle_gemini))
            // 提高默认请求体大小限制（避免 413 Payload Too Large）
            .layer(DefaultBodyLimit::max(200 * 1024 * 1024))
            .layer(cors);

        let router = (self.route_mounter)(router);

        router.with_state(self.state.clone())
    }

    /// 在不重启服务的情况下更新运行时配置
    pub async fn apply_runtime_config(&self, config: &ProxyConfig) {
        *self.state.config.write().await = config.clone();
    }

    /// 热更新熔断器配置
    ///
    /// 将新配置应用到所有已创建的熔断器实例
    pub async fn update_circuit_breaker_configs(
        &self,
        config: super::circuit_breaker::CircuitBreakerConfig,
    ) {
        self.state.provider_router.update_all_configs(config).await;
    }

    /// 重置指定 Provider 的熔断器
    pub async fn reset_provider_circuit_breaker(&self, provider_id: &str, app_type: &str) {
        self.state
            .provider_router
            .reset_provider_breaker(provider_id, app_type)
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Provider;
    use crate::proxy::rate_limit::RateLimitSnapshot;
    use crate::{app_config::AppType, database::Database};
    use axum::{
        extract::{RawQuery, State},
        http::{HeaderMap, StatusCode, Uri},
        response::IntoResponse,
        routing::get,
        Json, Router,
    };
    use reqwest::Client;
    use serde_json::{json, Value};
    use serial_test::serial;
    use std::sync::{Arc, Mutex, OnceLock};
    use tempfile::TempDir;

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
            let guard = crate::settings::test_env_lock()
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
            let _ = crate::settings::set_current_provider(&AppType::Claude, None);

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
            let _ = crate::settings::set_current_provider(&AppType::Claude, None);
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
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct CapturedUpstreamRequest {
        method: String,
        path_and_query: String,
        authorization: Option<String>,
        anthropic_beta: Option<String>,
    }

    #[derive(Clone, Default)]
    struct MockAnthropicState {
        requests: Arc<Mutex<Vec<CapturedUpstreamRequest>>>,
    }

    struct SpawnedServer {
        base_url: String,
        handle: tokio::task::JoinHandle<()>,
    }

    impl Drop for SpawnedServer {
        fn drop(&mut self) {
            self.handle.abort();
        }
    }

    fn claude_oauth_provider(provider_id: &str, base_url: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            "Claude OAuth".to_string(),
            json!({
                "auth_mode": "claude_oauth",
                "env": {
                    "ANTHROPIC_BASE_URL": base_url
                }
            }),
            None,
        )
    }

    fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(ToString::to_string)
    }

    fn ensure_rustls_crypto_provider() {
        static INIT: OnceLock<()> = OnceLock::new();
        INIT.get_or_init(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
    }

    async fn mock_models_handler(
        State(state): State<MockAnthropicState>,
        headers: HeaderMap,
        uri: Uri,
        raw_query: RawQuery,
    ) -> impl IntoResponse {
        state
            .requests
            .lock()
            .expect("lock mock requests")
            .push(CapturedUpstreamRequest {
                method: "GET".to_string(),
                path_and_query: uri
                    .path_and_query()
                    .map(|value| value.as_str().to_string())
                    .unwrap_or_else(|| uri.path().to_string()),
                authorization: header_value(&headers, "authorization"),
                anthropic_beta: header_value(&headers, "anthropic-beta"),
            });

        assert_eq!(raw_query.0.as_deref(), Some("limit=1000"));

        (
            StatusCode::OK,
            [("x-upstream-test", "models")],
            Json(json!({
                "data": [{
                    "id": "claude-3-5-sonnet-20241022",
                    "type": "model",
                    "display_name": "Claude 3.5 Sonnet"
                }],
                "has_more": false,
                "first_id": "claude-3-5-sonnet-20241022",
                "last_id": "claude-3-5-sonnet-20241022"
            })),
        )
    }

    async fn spawn_router(app: Router) -> SpawnedServer {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test listener");
        let address = listener.local_addr().expect("listener addr");
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("serve test router");
        });

        SpawnedServer {
            base_url: format!("http://{}", address),
            handle,
        }
    }

    async fn spawn_mock_anthropic() -> (SpawnedServer, MockAnthropicState) {
        let state = MockAnthropicState::default();
        let app = Router::new()
            .route("/v1/models", get(mock_models_handler))
            .route("/claude/v1/models", get(mock_models_handler))
            .with_state(state.clone());

        (spawn_router(app).await, state)
    }

    async fn spawn_proxy_with_claude_provider(base_url: &str) -> SpawnedServer {
        ensure_rustls_crypto_provider();
        let db = Arc::new(Database::memory().expect("init db"));
        let provider = claude_oauth_provider("claude-oauth", base_url);
        db.save_provider("claude", &provider)
            .expect("save claude provider");
        db.set_current_provider("claude", &provider.id)
            .expect("set current provider");
        crate::settings::set_current_provider(&AppType::Claude, Some(&provider.id))
            .expect("set local current provider");

        let server = ProxyServer::new(
            ProxyConfig::default(),
            db,
            None,
            None,
            #[cfg(feature = "tauri-desktop")]
            None,
        );

        spawn_router(server.build_router()).await
    }

    async fn spawn_proxy_without_claude_provider() -> SpawnedServer {
        ensure_rustls_crypto_provider();
        let db = Arc::new(Database::memory().expect("init db"));
        let server = ProxyServer::new(
            ProxyConfig::default(),
            db,
            None,
            None,
            #[cfg(feature = "tauri-desktop")]
            None,
        );

        spawn_router(server.build_router()).await
    }

    #[tokio::test]
    async fn get_status_prefers_claude_target_for_legacy_current_provider_fields() {
        let db = Arc::new(Database::memory().expect("init db"));
        let server = ProxyServer::new(
            ProxyConfig::default(),
            db,
            None,
            None,
            #[cfg(feature = "tauri-desktop")]
            None,
        );

        server
            .set_active_target("Codex", "codex-provider", "Codex Provider")
            .await;
        server
            .set_active_target("Claude", "claude-provider", "Claude Provider")
            .await;

        let status = server.get_status().await;
        assert_eq!(status.active_targets.len(), 2);
        assert_eq!(status.active_targets[0].app_type, "Claude");
        assert_eq!(status.current_provider.as_deref(), Some("Claude Provider"));
        assert_eq!(
            status.current_provider_id.as_deref(),
            Some("claude-provider")
        );
    }

    #[tokio::test]
    async fn get_quota_removes_stale_codex_subscription_snapshots_without_live_refresh_sources() {
        let db = Arc::new(Database::memory().expect("init db"));
        let server = ProxyServer::new(
            ProxyConfig::default(),
            db,
            None,
            None,
            #[cfg(feature = "tauri-desktop")]
            None,
        );
        let provider = Provider::with_id(
            "quota-stale-provider".to_string(),
            "Codex OAuth".to_string(),
            json!({ "auth_mode": "codex_oauth" }),
            None,
        );
        server
            .state
            .db
            .save_provider("codex", &provider)
            .expect("save codex provider");
        // Seed a live Claude provider for the `claude-1` control snapshot so the
        // new Claude stale-snapshot refresh (which runs in the same `get_quota`
        // call) does not touch it — preserving this test's original intent.
        let claude_control = Provider::with_id(
            "claude-1".to_string(),
            "Claude Provider".to_string(),
            json!({}),
            None,
        );
        server
            .state
            .db
            .save_provider("claude", &claude_control)
            .expect("save claude control provider");

        {
            let mut store = server.state.rate_limits.write().await;
            store.insert(
                provider.id.clone(),
                RateLimitSnapshot {
                    app_type: "codex".to_string(),
                    provider_id: provider.id.clone(),
                    provider_name: provider.name.clone(),
                    source: Some("subscription_quota".to_string()),
                    status: None,
                    windows: Vec::new(),
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 1,
                },
            );
            store.insert(
                "claude-1".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-1".to_string(),
                    provider_name: "Claude Provider".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: Vec::new(),
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 2,
                },
            );
        }

        let (status, body) = crate::proxy::handlers::get_quota(State(server.state.clone())).await;

        assert_eq!(status, StatusCode::OK);
        assert!(
            body["providers"]
                .as_array()
                .expect("providers array")
                .iter()
                .all(|snapshot| snapshot["provider_id"] != provider.id),
            "stale codex subscription quota snapshot should be absent from the quota response"
        );
        assert!(
            body["providers"]
                .as_array()
                .expect("providers array")
                .iter()
                .any(|snapshot| snapshot["provider_id"] == "claude-1"),
            "live non-codex snapshots should remain present in the quota response"
        );

        let store = server.state.rate_limits.read().await;
        assert!(
            !store.contains_key(&provider.id),
            "stale codex subscription quota snapshot should be removed when no live refresh source exists"
        );
        assert!(
            store.contains_key("claude-1"),
            "live non-codex snapshots should not be touched by codex quota cleanup"
        );
    }

    #[tokio::test]
    async fn get_quota_removes_stale_claude_snapshots_for_providers_missing_from_db() {
        let db = Arc::new(Database::memory().expect("init db"));
        let server = ProxyServer::new(
            ProxyConfig::default(),
            db,
            None,
            None,
            #[cfg(feature = "tauri-desktop")]
            None,
        );
        let live = Provider::with_id(
            "claude-live".to_string(),
            "Claude Live".to_string(),
            json!({}),
            None,
        );
        server
            .state
            .db
            .save_provider("claude", &live)
            .expect("save live claude provider");

        {
            let mut store = server.state.rate_limits.write().await;
            // Stale Claude snapshot: provider no longer in DB. Uses
            // `response_headers` source because Claude rate-limit snapshots
            // are captured from upstream response headers, not from a quota
            // polling source — the refresh must not filter on `source`.
            store.insert(
                "claude-ghost".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-ghost".to_string(),
                    provider_name: "Claude Ghost".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: Vec::new(),
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 1,
                },
            );
            // Live Claude snapshot — must survive.
            store.insert(
                live.id.clone(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: live.id.clone(),
                    provider_name: live.name.clone(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: Vec::new(),
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 2,
                },
            );
            // Non-Claude snapshot — must not be affected by the Claude refresh.
            store.insert(
                "codex-passthrough".to_string(),
                RateLimitSnapshot {
                    app_type: "codex".to_string(),
                    provider_id: "codex-passthrough".to_string(),
                    provider_name: "Codex Passthrough".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: Vec::new(),
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    balances: None,
                    captured_at: 3,
                },
            );
        }

        let (status, body) = crate::proxy::handlers::get_quota(State(server.state.clone())).await;
        assert_eq!(status, StatusCode::OK);

        let providers = body["providers"].as_array().expect("providers array");
        assert!(
            providers
                .iter()
                .all(|snapshot| snapshot["provider_id"] != "claude-ghost"),
            "stale Claude snapshot for missing provider should be absent from the quota response"
        );
        assert!(
            providers
                .iter()
                .any(|snapshot| snapshot["provider_id"] == live.id),
            "live Claude provider snapshot should be preserved"
        );
        assert!(
            providers
                .iter()
                .any(|snapshot| snapshot["provider_id"] == "codex-passthrough"),
            "non-Claude snapshots should not be touched by Claude cleanup"
        );

        let store = server.state.rate_limits.read().await;
        assert!(
            !store.contains_key("claude-ghost"),
            "ghost Claude snapshot should be evicted from the in-memory store"
        );
        assert!(
            store.contains_key(&live.id),
            "live Claude snapshot should remain in the in-memory store"
        );
        assert!(
            store.contains_key("codex-passthrough"),
            "codex snapshot should remain in the in-memory store"
        );
    }

    #[tokio::test]
    #[serial]
    async fn build_router_forwards_claude_models_query_and_headers() {
        let _env = TestEnv::new();
        let (upstream, upstream_state) = spawn_mock_anthropic().await;
        let proxy = spawn_proxy_with_claude_provider(&upstream.base_url).await;

        let response = Client::new()
            .get(format!("{}/v1/models?limit=1000", proxy.base_url))
            .header("authorization", "Bearer test-oauth-token")
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", "effort-2025-11-24")
            .header(
                "user-agent",
                "claude-cli/2.1.111 (external, claude-desktop-3p)",
            )
            .send()
            .await
            .expect("send proxy request");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("x-upstream-test")
                .and_then(|value| value.to_str().ok()),
            Some("models")
        );

        let body: Value = response.json().await.expect("parse response json");
        assert_eq!(body["has_more"], json!(false));
        assert_eq!(body["first_id"], json!("claude-3-5-sonnet-20241022"));
        assert_eq!(body["last_id"], json!("claude-3-5-sonnet-20241022"));

        let requests = upstream_state
            .requests
            .lock()
            .expect("lock upstream requests");
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].method, "GET");
        assert_eq!(requests[0].path_and_query, "/v1/models?limit=1000");
        assert_eq!(
            requests[0].authorization.as_deref(),
            Some("Bearer test-oauth-token")
        );
        assert_eq!(
            requests[0].anthropic_beta.as_deref(),
            Some("effort-2025-11-24")
        );
    }

    #[tokio::test]
    #[serial]
    async fn build_router_mounts_prefixed_claude_models_route() {
        let _env = TestEnv::new();
        let (upstream, upstream_state) = spawn_mock_anthropic().await;
        let proxy = spawn_proxy_with_claude_provider(&upstream.base_url).await;

        let response = Client::new()
            .get(format!("{}/claude/v1/models?limit=1000", proxy.base_url))
            .header("authorization", "Bearer test-oauth-token")
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .expect("send prefixed proxy request");

        assert_eq!(response.status(), StatusCode::OK);

        let requests = upstream_state
            .requests
            .lock()
            .expect("lock upstream requests");
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].path_and_query, "/claude/v1/models?limit=1000");
    }

    #[tokio::test]
    #[serial]
    async fn build_router_head_root_returns_no_content() {
        let _env = TestEnv::new();
        let proxy = spawn_proxy_without_claude_provider().await;

        let response = Client::new()
            .head(format!("{}/", proxy.base_url))
            .send()
            .await
            .expect("send head request");

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(response
            .bytes()
            .await
            .expect("read response body")
            .is_empty());
    }

    #[tokio::test]
    #[serial]
    async fn build_router_models_returns_503_without_active_claude_provider() {
        let _env = TestEnv::new();
        let proxy = spawn_proxy_without_claude_provider().await;

        let response = Client::new()
            .get(format!("{}/v1/models?limit=1000", proxy.base_url))
            .header("authorization", "Bearer test-oauth-token")
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .expect("send models request");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
