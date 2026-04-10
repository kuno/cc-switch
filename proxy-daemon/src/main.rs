//! Standalone proxy daemon for cc-switch
//!
//! Build:
//!   cargo build --release
//!
//! Cross-compile for OpenWrt:
//!   cargo build --release --target mips-unknown-linux-musl    (MIPS)
//!   cargo build --release --target aarch64-unknown-linux-musl (ARM64)

// ─────────────────────────────────────────────────────────────────────────────
// Re-declare only the modules needed by the proxy subsystem.
// Each `#[path]` points to the source file in src-tauri/src/.
// `crate::` in those files resolves to THIS crate root, so every module
// they reference with `crate::` must also appear here.
// Sub-modules of directory modules (e.g. database/dao/) are resolved
// automatically relative to the #[path]-specified file's directory.
// ─────────────────────────────────────────────────────────────────────────────

mod app_store;

#[path = "../../src-tauri/src/app_config.rs"]
mod app_config;

#[path = "../../src-tauri/src/claude_mcp.rs"]
mod claude_mcp;

#[path = "../../src-tauri/src/codex_config.rs"]
mod codex_config;

#[path = "../../src-tauri/src/config.rs"]
mod config;

#[path = "../../src-tauri/src/database/mod.rs"]
mod database;

#[path = "../../src-tauri/src/error.rs"]
mod error;

#[path = "../../src-tauri/src/gemini_config.rs"]
mod gemini_config;

#[path = "../../src-tauri/src/gemini_mcp.rs"]
mod gemini_mcp;

#[path = "../../src-tauri/src/mcp/mod.rs"]
mod mcp;

#[path = "../../src-tauri/src/openclaw_config.rs"]
mod openclaw_config;

#[path = "../../src-tauri/src/opencode_config.rs"]
mod opencode_config;

#[path = "../../src-tauri/src/prompt.rs"]
mod prompt;

#[path = "../../src-tauri/src/prompt_files.rs"]
mod prompt_files;

#[path = "../../src-tauri/src/provider.rs"]
mod provider;

#[path = "../../src-tauri/src/provider_defaults.rs"]
mod provider_defaults;

#[path = "../../src-tauri/src/proxy/mod.rs"]
mod proxy;

#[path = "../../src-tauri/src/settings.rs"]
mod settings;

#[path = "../../src-tauri/src/usage_script.rs"]
mod usage_script;

mod services;

#[path = "../../src-tauri/src/store.rs"]
mod store;

use std::sync::Arc;
use tokio::sync::RwLock;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .init();

    log::info!("cc-switch proxy daemon starting...");

    // Initialize database (uses ~/.cc-switch/cc-switch.db by default)
    let db = Arc::new(
        database::Database::init().map_err(|e| anyhow::anyhow!("DB init failed: {e}"))?,
    );
    log::info!("Database initialized");

    // Apply env var overrides for listen address/port
    {
        let mut cfg = db
            .get_proxy_config()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get proxy config: {e}"))?;
        let mut changed = false;
        if let Ok(addr) = std::env::var("PROXY_LISTEN_ADDR") {
            log::info!("Overriding listen address from env: {}", addr);
            cfg.listen_address = addr;
            changed = true;
        }
        if let Ok(port) = std::env::var("PROXY_LISTEN_PORT") {
            let port: u16 = port.parse().map_err(|e| anyhow::anyhow!("Invalid PROXY_LISTEN_PORT: {e}"))?;
            log::info!("Overriding listen port from env: {}", port);
            cfg.listen_port = port;
            changed = true;
        }
        if changed {
            db.update_proxy_config(cfg)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to update proxy config: {e}"))?;
        }
    }

    // Config dir for auth managers
    let config_dir = config::get_app_config_dir();

    // Initialize auth managers
    let copilot_auth = Arc::new(RwLock::new(
        proxy::providers::copilot_auth::CopilotAuthManager::new(config_dir.clone()),
    ));
    let codex_oauth_auth = Arc::new(RwLock::new(
        proxy::providers::codex_oauth_auth::CodexOAuthManager::new(config_dir.clone()),
    ));

    // Initialize proxy service
    let proxy_service = services::ProxyService::new(db.clone());
    proxy_service.set_copilot_auth(copilot_auth);
    proxy_service.set_codex_oauth_auth(codex_oauth_auth);

    // Start proxy
    let info = proxy_service
        .start()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to start proxy: {e}"))?;

    log::info!("Proxy listening on {}:{}", info.address, info.port);

    // Wait for Ctrl-C
    tokio::signal::ctrl_c().await?;
    log::info!("Shutting down...");

    proxy_service
        .stop()
        .await
        .map_err(|e| anyhow::anyhow!("Stop failed: {e}"))?;

    Ok(())
}
