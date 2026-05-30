//! Service modules re-exported from src-tauri/src/services/
//! Paths are relative to this file (proxy-daemon/src/services/mod.rs)

#[path = "../../../src-tauri/src/services/omo.rs"]
pub mod omo;

#[path = "../../../src-tauri/src/services/model_fetch.rs"]
pub mod model_fetch;

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

#[path = "../../../src-tauri/src/services/usage_stats.rs"]
pub mod usage_stats;

// Stub: webdav_auto_sync needs a Tauri AppHandle; provide a no-op version
pub mod webdav_auto_sync;

pub use omo::OmoService;
pub use proxy::ProxyService;
