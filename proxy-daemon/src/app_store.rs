//! Stub for app_store — the desktop uses tauri-plugin-store to persist
//! an app config dir override.  The daemon reads CC_SWITCH_DATA_DIR env
//! var to allow custom data paths (e.g. /etc/cc-switch on OpenWrt).

use std::path::PathBuf;

pub fn get_app_config_dir_override() -> Option<PathBuf> {
    std::env::var("CC_SWITCH_DATA_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
}
