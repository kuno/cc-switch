//! Daemon-facing app config surface.
//!
//! The router daemon intentionally depends only on shared config types that are
//! needed at runtime. Legacy desktop JSON config loading/migration lives in
//! `src-tauri/src/app_config.rs` and is kept out of the daemon build.

#[allow(unused_imports)]
pub use cc_switch_shared::app_config::{
    AppType, CommonConfigSnippets, InstalledSkill, McpApps, McpConfig, McpRoot, McpServer,
    SkillApps, UnmanagedSkill,
};
