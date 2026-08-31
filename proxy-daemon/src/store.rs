//! Daemon-local app state used by reused upstream service modules.

use crate::database::Database;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::services::ProxyService;
use std::sync::Arc;

/// 全局应用状态
pub struct AppState {
    pub db: Arc<Database>,
    pub proxy_service: ProxyService,
    pub codex_oauth_manager: Arc<CodexOAuthManager>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        let codex_oauth_manager =
            Arc::new(CodexOAuthManager::new(crate::config::get_app_config_dir()));
        let proxy_service =
            ProxyService::new_with_codex_oauth_manager(db.clone(), codex_oauth_manager.clone());

        Self {
            db,
            proxy_service,
            codex_oauth_manager,
        }
    }
}
