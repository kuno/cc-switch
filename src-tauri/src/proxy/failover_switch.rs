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
        #[cfg(feature = "tauri-desktop")]
        {
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
                        if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
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
            let app_enum = app_type
                .parse::<crate::app_config::AppType>()
                .map_err(|e| AppError::Message(format!("不支持的应用类型 {app_type}: {e}")))?;

            if let Err(e) = self.db.set_current_provider(app_type, provider_id) {
                log::error!("[Failover] DB 更新当前供应商失败: {e}");
                return Err(AppError::Message(format!("更新当前供应商失败: {e}")));
            }

            if let Err(e) = crate::settings::set_current_provider(&app_enum, Some(provider_id)) {
                log::error!("[Failover] settings 更新当前供应商失败: {e}");
                return Err(AppError::Message(format!("更新当前供应商设置失败: {e}")));
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

#[cfg(all(test, not(feature = "tauri-desktop")))]
mod tests {
    use super::*;
    use crate::app_config::AppType;
    use crate::provider::Provider;
    use serde_json::json;
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
                .expect("lock test env");
            let tmp = TempDir::new().expect("create temp dir");
            let home = tmp.path().join("home");
            let data = tmp.path().join("data");

            std::fs::create_dir_all(home.join(".cc-switch")).expect("create home dir");
            std::fs::create_dir_all(&data).expect("create data dir");

            let original_home = std::env::var("HOME").ok();
            let original_userprofile = std::env::var("USERPROFILE").ok();
            let original_test_home = std::env::var("CC_SWITCH_TEST_HOME").ok();
            let original_data_dir = std::env::var("CC_SWITCH_DATA_DIR").ok();

            std::env::set_var("HOME", &home);
            std::env::set_var("USERPROFILE", &home);
            std::env::set_var("CC_SWITCH_TEST_HOME", &home);
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);
            crate::settings::reload_settings().expect("reload settings");

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
            if let Some(value) = &self.original_home {
                std::env::set_var("HOME", value);
            } else {
                std::env::remove_var("HOME");
            }

            if let Some(value) = &self.original_userprofile {
                std::env::set_var("USERPROFILE", value);
            } else {
                std::env::remove_var("USERPROFILE");
            }

            if let Some(value) = &self.original_test_home {
                std::env::set_var("CC_SWITCH_TEST_HOME", value);
            } else {
                std::env::remove_var("CC_SWITCH_TEST_HOME");
            }

            if let Some(value) = &self.original_data_dir {
                std::env::set_var("CC_SWITCH_DATA_DIR", value);
            } else {
                std::env::remove_var("CC_SWITCH_DATA_DIR");
            }

            crate::settings::reload_settings().expect("reload settings after restore");
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn standalone_try_switch_persists_db_and_settings_when_app_proxy_disabled() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        let current_providers = Arc::new(RwLock::new(HashMap::new()));
        let manager = FailoverSwitchManager::new(db.clone(), current_providers.clone());

        let provider = Provider::with_id(
            "provider-b".to_string(),
            "Provider B".to_string(),
            json!({"base_url": "https://example.test"}),
            None,
        );
        db.save_provider("claude", &provider)
            .expect("save provider");
        db.set_proxy_flags_sync("claude", false, true)
            .expect("set app proxy flags");

        let switched = manager
            .try_switch("claude", "provider-b", "Provider B")
            .await
            .expect("switch provider");

        assert!(switched);
        assert_eq!(
            db.get_current_provider("claude")
                .expect("database current provider")
                .as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            current_providers
                .read()
                .await
                .get("claude")
                .map(|(id, name)| (id.as_str(), name.as_str())),
            Some(("provider-b", "Provider B"))
        );
    }
}
