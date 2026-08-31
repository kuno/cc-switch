//! Service modules re-exported from src-tauri/src/services/
//! Paths are relative to this file (proxy-daemon/src/services/mod.rs)

#[path = "../../../src-tauri/src/services/omo.rs"]
pub mod omo;

#[path = "../../../src-tauri/src/services/model_fetch.rs"]
pub mod model_fetch;

#[path = "../../../src-tauri/src/services/model_pricing.rs"]
pub mod model_pricing;

#[path = "../../../src-tauri/src/services/oauth_refresh/mod.rs"]
pub mod oauth_refresh;

#[path = "../../../src-tauri/src/services/sql_helpers.rs"]
pub mod sql_helpers;

#[path = "../../../src-tauri/src/services/provider/mod.rs"]
pub mod provider;

#[path = "../../../src-tauri/src/services/proxy.rs"]
pub mod proxy;

pub mod skill;

#[path = "../../../src-tauri/src/services/speedtest.rs"]
pub mod speedtest;

#[path = "../../../src-tauri/src/services/stream_check.rs"]
pub mod stream_check;

#[path = "../../../src-tauri/src/services/subscription.rs"]
pub mod subscription;

#[path = "../../../src-tauri/src/services/coding_plan.rs"]
pub mod coding_plan;

#[path = "../../../src-tauri/src/services/balance.rs"]
pub mod balance;

#[path = "../../../src-tauri/src/services/session_usage.rs"]
pub mod session_usage;

#[path = "../../../src-tauri/src/services/session_usage_codex.rs"]
pub mod session_usage_codex;

#[path = "../../../src-tauri/src/services/session_usage_gemini.rs"]
pub mod session_usage_gemini;

#[path = "../../../src-tauri/src/services/session_usage_grokbuild.rs"]
pub mod session_usage_grokbuild;

#[path = "../../../src-tauri/src/services/session_usage_pi.rs"]
pub mod session_usage_pi;

#[path = "../../../src-tauri/src/services/session_usage_opencode.rs"]
pub mod session_usage_opencode;

#[path = "../../../src-tauri/src/services/subscription_grok.rs"]
pub mod subscription_grok;

#[path = "../../../src-tauri/src/services/usage_stats.rs"]
pub mod usage_stats;

// Stub: webdav_auto_sync needs a Tauri AppHandle; provide a no-op version
pub mod webdav_auto_sync;

// Stub: S3 auto sync is desktop-only; shared database hooks only need this symbol.
pub mod s3_auto_sync {
    pub fn notify_db_changed(_table: &str) {}
}

// Stub: MCP server sync manages desktop app configs; the reused provider
// services call it after live writes, so provide no-op versions.
pub mod mcp {
    use crate::app_config::AppType;
    use crate::error::AppError;
    use crate::store::AppState;

    pub struct McpService;

    impl McpService {
        pub fn sync_enabled_for_app(_state: &AppState, _app: &AppType) -> Result<(), AppError> {
            Ok(())
        }

        pub fn sync_all_enabled(_state: &AppState) -> Result<(), AppError> {
            Ok(())
        }
    }
}

pub use omo::OmoService;
pub use proxy::ProxyService;
