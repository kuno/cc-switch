//! Daemon-facing app config surface.
//!
//! The OpenWrt daemon reuses proxy/service modules from `src-tauri`, so its
//! `AppType` must stay in lockstep with the desktop crate after upstream rebases.

#[path = "../../src-tauri/src/app_config.rs"]
mod desktop_app_config;

pub use desktop_app_config::*;
