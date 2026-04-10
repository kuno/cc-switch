//! Stub for app_store — the desktop uses tauri-plugin-store to persist
//! an app config dir override.  The daemon has no such override; just
//! return None so callers fall back to the default ~/.cc-switch path.

use std::path::PathBuf;

pub fn get_app_config_dir_override() -> Option<PathBuf> {
    None
}
