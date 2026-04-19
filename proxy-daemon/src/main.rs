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
mod openwrt_admin;

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
    install_rustls_crypto_provider();

    let args: Vec<String> = std::env::args().skip(1).collect();

    if !args.is_empty() {
        init_logger("warn");
        return run_cli(args).await;
    }

    init_logger("info");
    run_daemon().await
}

fn install_rustls_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

fn init_logger(default_filter: &str) {
    let _ =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(default_filter))
            .try_init();
}

async fn run_cli(args: Vec<String>) -> anyhow::Result<()> {
    let db = database::Database::init().map_err(|e| anyhow::anyhow!("DB init failed: {e}"))?;

    match args.as_slice() {
        [namespace, command] if namespace == "openwrt" && command == "get-active-provider" => {
            print_json(&openwrt_admin::get_active_claude_provider(&db)?)?;
            Ok(())
        }
        [namespace, command] if namespace == "openwrt" && command == "upsert-active-provider" => {
            print_json(&openwrt_admin::upsert_active_claude_provider(&db)?)?;
            Ok(())
        }
        [namespace, command] if namespace == "openwrt" && command == "list-providers" => {
            print_json(&openwrt_admin::list_claude_providers(&db)?)?;
            Ok(())
        }
        [namespace, command, provider_id]
            if namespace == "openwrt" && command == "get-provider" =>
        {
            print_json(&openwrt_admin::get_claude_provider(&db, provider_id)?)?;
            Ok(())
        }
        [namespace, command] if namespace == "openwrt" && command == "upsert-provider" => {
            print_json(&openwrt_admin::upsert_claude_provider(&db, None)?)?;
            Ok(())
        }
        [namespace, command, provider_id]
            if namespace == "openwrt" && command == "upsert-provider" =>
        {
            print_json(&openwrt_admin::upsert_claude_provider(&db, Some(provider_id))?)?;
            Ok(())
        }
        [namespace, command, provider_id]
            if namespace == "openwrt" && command == "delete-provider" =>
        {
            print_json(&openwrt_admin::delete_claude_provider(&db, provider_id)?)?;
            Ok(())
        }
        [namespace, command, provider_id]
            if namespace == "openwrt" && command == "activate-provider" =>
        {
            print_json(&openwrt_admin::activate_claude_provider(&db, provider_id)?)?;
            Ok(())
        }
        _ => Err(anyhow::anyhow!(
            "unsupported command. expected one of: `cc-switch openwrt list-providers`, `cc-switch openwrt get-provider <id>`, `cc-switch openwrt upsert-provider [id]`, `cc-switch openwrt delete-provider <id>`, `cc-switch openwrt activate-provider <id>`, `cc-switch openwrt get-active-provider`, `cc-switch openwrt upsert-active-provider`"
        )),
    }
}

fn print_json<T: serde::Serialize>(value: &T) -> anyhow::Result<()> {
    serde_json::to_writer_pretty(std::io::stdout(), value)?;
    println!();
    Ok(())
}

async fn run_daemon() -> anyhow::Result<()> {
    log::info!("cc-switch proxy daemon starting...");

    // Initialize database (uses ~/.cc-switch/cc-switch.db by default)
    let db =
        Arc::new(database::Database::init().map_err(|e| anyhow::anyhow!("DB init failed: {e}"))?);
    log::info!("Database initialized");

    // Apply env var overrides for listen address/port
    // Uses targeted update to avoid clobbering per-app retry/timeout settings
    {
        let cfg = db
            .get_proxy_config()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get proxy config: {e}"))?;
        let mut addr = cfg.listen_address;
        let mut port = cfg.listen_port;
        let mut changed = false;
        if let Ok(env_addr) = std::env::var("PROXY_LISTEN_ADDR") {
            log::info!("Overriding listen address from env: {}", env_addr);
            addr = env_addr;
            changed = true;
        }
        if let Ok(env_port) = std::env::var("PROXY_LISTEN_PORT") {
            let p: u16 = env_port
                .parse()
                .map_err(|e| anyhow::anyhow!("Invalid PROXY_LISTEN_PORT: {e}"))?;
            log::info!("Overriding listen port from env: {}", p);
            port = p;
            changed = true;
        }
        if changed {
            db.update_listen_config(&addr, port)
                .await
                .map_err(|e| anyhow::anyhow!("Failed to update listen config: {e}"))?;
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

    wait_for_shutdown_signal().await?;
    log::info!("Shutting down...");

    proxy_service
        .stop()
        .await
        .map_err(|e| anyhow::anyhow!("Stop failed: {e}"))?;

    Ok(())
}

#[cfg(unix)]
async fn wait_for_shutdown_signal() -> anyhow::Result<()> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigint = signal(SignalKind::interrupt())?;
    let mut sigterm = signal(SignalKind::terminate())?;

    tokio::select! {
        _ = sigint.recv() => {}
        _ = sigterm.recv() => {}
    }

    Ok(())
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() -> anyhow::Result<()> {
    tokio::signal::ctrl_c().await?;
    Ok(())
}
