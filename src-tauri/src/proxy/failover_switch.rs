//! 故障转移切换模块

use crate::database::Database;
use crate::error::AppError;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct FailoverSwitchManager {
    pending_switches: Arc<RwLock<HashSet<String>>>,
    db: Arc<Database>,
    /// In-memory provider tracking (updated on standalone failover)
    current_providers: Arc<RwLock<HashMap<String, (String, String)>>>,
}

impl FailoverSwitchManager {
    pub fn new(
        db: Arc<Database>,
        current_providers: Arc<RwLock<HashMap<String, (String, String)>>>,
    ) -> Self {
        Self {
            pending_switches: Arc::new(RwLock::new(HashSet::new())),
            db,
            current_providers,
        }
    }

    pub async fn try_switch(
        &self,
        #[cfg(feature = "tauri-desktop")] app_handle: Option<&tauri::AppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let switch_key = format!("{app_type}:{provider_id}");

        {
            let mut pending = self.pending_switches.write().await;
            if pending.contains(&switch_key) {
                log::debug!("[Failover] 切换已在进行中，跳过: {app_type} -> {provider_id}");
                return Ok(false);
            }
            pending.insert(switch_key.clone());
        }

        let result = self
            .do_switch(
                #[cfg(feature = "tauri-desktop")]
                app_handle,
                app_type,
                provider_id,
                provider_name,
            )
            .await;

        {
            let mut pending = self.pending_switches.write().await;
            pending.remove(&switch_key);
        }

        result
    }

    async fn do_switch(
        &self,
        #[cfg(feature = "tauri-desktop")] app_handle: Option<&tauri::AppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let app_enabled = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(config) => config.enabled,
            Err(e) => {
                log::warn!("[FO-002] 无法读取 {app_type} 配置: {e}，跳过切换");
                return Ok(false);
            }
        };

        if !app_enabled {
            log::debug!("[Failover] {app_type} 未启用代理，跳过切换");
            return Ok(false);
        }

        log::info!("[FO-001] 切换: {app_type} → {provider_name}");

        #[cfg(feature = "tauri-desktop")]
        {
            use tauri::{Emitter, Manager};
            let mut switched = false;

            if let Some(app) = app_handle {
                if let Some(app_state) = app.try_state::<crate::store::AppState>() {
                    switched = app_state
                        .proxy_service
                        .hot_switch_provider(app_type, provider_id)
                        .await
                        .map_err(AppError::Message)?
                        .logical_target_changed;

                    if !switched {
                        return Ok(false);
                    }

                    if let Ok(new_menu) = crate::tray::create_tray_menu(app, app_state.inner()) {
                        if let Some(tray) = app.tray_by_id("main") {
                            if let Err(e) = tray.set_menu(Some(new_menu)) {
                                log::error!("[Failover] 更新托盘菜单失败: {e}");
                            }
                        }
                    }
                }

                let event_data = serde_json::json!({
                    "appType": app_type,
                    "providerId": provider_id,
                    "source": "failover"
                });
                if let Err(e) = app.emit("provider-switched", event_data) {
                    log::error!("[Failover] 发射事件失败: {e}");
                }
            }

            return Ok(switched);
        }

        // Standalone (non-Tauri) path: update DB + in-memory map
        #[cfg(not(feature = "tauri-desktop"))]
        {
            if let Err(e) = self.db.set_current_provider(app_type, provider_id) {
                log::error!("[Failover] DB 更新当前供应商失败: {e}");
                return Err(AppError::Message(format!("更新当前供应商失败: {e}")));
            }

            let mut current = self.current_providers.write().await;
            current.insert(
                app_type.to_string(),
                (provider_id.to_string(), provider_name.to_string()),
            );

            log::info!("[Failover] 已切换: {app_type} → {provider_name}");
            Ok(true)
        }
    }
}
