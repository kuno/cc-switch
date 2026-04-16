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
    provider_router::ProviderRouter, types::*, ProxyError,
};
use crate::database::Database;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::proxy::providers::copilot_auth::CopilotAuthManager;
use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post, put},
    Router,
};
use hyper_util::rt::TokioIo;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;
use tower_http::cors::{Any, CorsLayer};

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
}

/// 代理HTTP服务器
pub struct ProxyServer {
    config: ProxyConfig,
    state: ProxyState,
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
                log::info!("[RateLimit] loaded {} persisted snapshots from DB", snapshots.len());
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
            copilot_auth,
            codex_oauth_auth,
            #[cfg(feature = "tauri-desktop")]
            app_handle,
            failover_manager,
            rate_limits,
        };

        Self {
            config,
            state,
            shutdown_tx: Arc::new(RwLock::new(None)),
            server_handle: Arc::new(RwLock::new(None)),
        }
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

        let router = Router::new()
            // 健康检查
            .route("/health", get(handlers::health_check))
            .route("/status", get(handlers::get_status))
            .route("/api/quota", get(handlers::get_quota))
            // Claude API (支持带前缀和不带前缀两种格式)
            .route("/v1/messages", post(handlers::handle_messages))
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

        #[cfg(not(feature = "tauri-desktop"))]
        let router = router
            .route(
                "/openwrt/admin/runtime",
                get(handlers::openwrt_get_runtime_status),
            )
            .route(
                "/openwrt/admin/apps/:app/runtime",
                get(handlers::openwrt_get_app_runtime_status),
            )
            .route(
                "/openwrt/admin/apps/:app/usage-summary",
                get(handlers::openwrt_get_usage_summary),
            )
            .route(
                "/openwrt/admin/apps/:app/provider-stats",
                get(handlers::openwrt_get_provider_stats),
            )
            .route(
                "/openwrt/admin/apps/:app/recent-activity",
                get(handlers::openwrt_get_recent_activity),
            )
            .route(
                "/openwrt/admin/apps/:app/providers",
                get(handlers::openwrt_list_providers).post(handlers::openwrt_upsert_provider),
            )
            .route(
                "/openwrt/admin/apps/:app/providers/active",
                get(handlers::openwrt_get_active_provider)
                    .post(handlers::openwrt_upsert_active_provider),
            )
            .route(
                "/openwrt/admin/apps/:app/providers/:provider_id",
                get(handlers::openwrt_get_provider)
                    .put(handlers::openwrt_upsert_provider_by_id)
                    .delete(handlers::openwrt_delete_provider),
            )
            .route(
                "/openwrt/admin/apps/:app/providers/:provider_id/activate",
                post(handlers::openwrt_activate_provider),
            )
            .route(
                "/openwrt/admin/apps/:app/providers/:provider_id/failover",
                get(handlers::openwrt_get_provider_failover),
            )
            .route(
                "/openwrt/admin/apps/:app/failover/providers/available",
                get(handlers::openwrt_get_available_failover_providers),
            )
            .route(
                "/openwrt/admin/apps/:app/failover/providers/:provider_id",
                post(handlers::openwrt_add_to_failover_queue)
                    .delete(handlers::openwrt_remove_from_failover_queue),
            )
            .route(
                "/openwrt/admin/apps/:app/failover/queue",
                put(handlers::openwrt_reorder_failover_queue),
            )
            .route(
                "/openwrt/admin/apps/:app/failover/auto-enabled",
                put(handlers::openwrt_set_auto_failover_enabled),
            )
            .route(
                "/openwrt/admin/apps/:app/failover/max-retries",
                put(handlers::openwrt_set_max_retries),
            );

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
    use crate::database::Database;

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
}
