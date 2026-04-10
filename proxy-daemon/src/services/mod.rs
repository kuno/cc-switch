//! Service modules re-exported from src-tauri/src/services/
//! Paths are relative to this file (proxy-daemon/src/services/mod.rs)

#[path = "../../../src-tauri/src/services/mcp.rs"]
pub mod mcp;

#[path = "../../../src-tauri/src/services/omo.rs"]
pub mod omo;

#[path = "../../../src-tauri/src/services/provider/mod.rs"]
pub mod provider;

#[path = "../../../src-tauri/src/services/proxy.rs"]
pub mod proxy;

#[path = "../../../src-tauri/src/services/skill.rs"]
pub mod skill;

#[path = "../../../src-tauri/src/services/stream_check.rs"]
pub mod stream_check;

#[path = "../../../src-tauri/src/services/usage_stats.rs"]
pub mod usage_stats;

// Stub: webdav_auto_sync needs a Tauri AppHandle; provide a no-op version
pub mod webdav_auto_sync;

pub use omo::OmoService;
pub use proxy::ProxyService;
