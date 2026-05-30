//! Standalone proxy daemon for cc-switch
//!
//! Build:
//!   cargo build --release
//!
//! Cross-compile for OpenWrt:
//!   cargo build --release --target mips-unknown-linux-musl    (MIPS)
//!   cargo build --release --target aarch64-unknown-linux-musl (ARM64)

mod app_config;
mod app_store;
#[path = "../../src-tauri/src/claude_desktop_config.rs"]
mod claude_desktop_config;
mod codex_config;
mod config;
mod error;
mod gemini_config;
mod hermes_config;
mod openclaw_config;
mod opencode_config;
mod openwrt_admin;
mod openwrt_backup_restore;
mod openwrt_http;
mod prompt;
mod prompt_files;
mod provider;
mod provider_defaults;
mod settings;
mod shared_core;
mod store;
mod usage_events;
mod usage_script;
mod version;

mod services;
pub use shared_core::*;

use std::io::Read;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

const OPENWRT_COMMAND_HELP: &str = "unsupported command. expected one of: `cc-switch openwrt get-meta`, `cc-switch openwrt get-runtime-status`, `cc-switch openwrt [claude|codex|gemini] get-runtime-status`, `cc-switch openwrt [claude|codex|gemini] get-config`, `cc-switch openwrt [claude|codex|gemini] set-config`, `cc-switch openwrt [claude|codex|gemini] get-usage-summary`, `cc-switch openwrt [claude|codex|gemini] get-provider-stats`, `cc-switch openwrt [claude|codex|gemini] get-recent-activity`, `cc-switch openwrt [claude|codex|gemini] get-request-logs [page] [page-size]`, `cc-switch openwrt [claude|codex|gemini] get-request-detail <request-id>`, `cc-switch openwrt [claude|codex|gemini] get-active-provider`, `cc-switch openwrt [claude|codex|gemini] upsert-active-provider`, `cc-switch openwrt [claude|codex|gemini] list-providers`, `cc-switch openwrt [claude|codex|gemini] get-provider <provider-id>`, `cc-switch openwrt [claude|codex|gemini] get-provider-failover <provider-id>`, `cc-switch openwrt [claude|codex|gemini] get-circuit-breaker-stats <provider-id>`, `cc-switch openwrt [claude|codex|gemini] reset-circuit-breaker <provider-id>`, `cc-switch openwrt [claude|codex|gemini] upsert-provider [provider-id]`, `cc-switch openwrt [claude|codex|gemini] delete-provider <provider-id>`, `cc-switch openwrt [claude|codex|gemini] activate-provider <provider-id>`, `cc-switch openwrt [claude|codex|gemini] get-available-failover-providers`, `cc-switch openwrt [claude|codex|gemini] add-to-failover-queue <provider-id>`, `cc-switch openwrt [claude|codex|gemini] remove-from-failover-queue <provider-id>`, `cc-switch openwrt [claude|codex|gemini] reorder-failover-queue`, `cc-switch openwrt [claude|codex|gemini] set-auto-failover-enabled <true|false>`, `cc-switch openwrt [claude|codex|gemini] set-max-retries <value>`, `cc-switch openwrt claude upload-claude-auth <provider-id>`, `cc-switch openwrt claude remove-claude-auth <provider-id>`, `cc-switch openwrt codex upload-codex-auth <provider-id>`, `cc-switch openwrt codex remove-codex-auth <provider-id>`";
const OAUTH_REFRESH_SKEW_MS: i64 = 5 * 60 * 1000;
const OAUTH_REFRESH_MIN_SLEEP: Duration = Duration::from_secs(60);
const OAUTH_REFRESH_MAX_SLEEP: Duration = Duration::from_secs(5 * 60);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    install_rustls_crypto_provider();

    let args: Vec<String> = std::env::args().skip(1).collect();

    if matches!(
        args.as_slice(),
        [flag] if matches!(flag.as_str(), "--version" | "-V" | "version")
    ) {
        println!("{}", version::build_version());
        return Ok(());
    }

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

    if args.first().map(String::as_str) != Some("openwrt") {
        return Err(anyhow::anyhow!(
            "unsupported command. expected namespace: `cc-switch openwrt ...`"
        ));
    }

    let (app_type, command_offset) = match args.get(1) {
        Some(value) => match crate::app_config::AppType::from_str(value) {
            Ok(_app_type) => (openwrt_admin::parse_supported_app(value)?, 2usize),
            Err(_) => (crate::app_config::AppType::Claude, 1usize),
        },
        None => {
            return Err(anyhow::anyhow!(OPENWRT_COMMAND_HELP));
        }
    };

    let command = args.get(command_offset).map(String::as_str);
    let tail = &args[(command_offset + 1).min(args.len())..];

    match (command, tail) {
        (Some("get-meta"), []) => {
            print_json(&openwrt_admin::get_admin_meta()?)?;
            Ok(())
        }
        (Some("get-runtime-status"), []) => {
            if command_offset == 1 {
                print_json(&openwrt_admin::get_runtime_status(&db).await?)?;
            } else {
                print_json(&openwrt_admin::get_app_runtime_status(&db, &app_type).await?)?;
            }
            Ok(())
        }
        (Some("get-config"), []) => {
            print_json(&openwrt_admin::get_app_proxy_config(&db, &app_type).await?)?;
            Ok(())
        }
        (Some("set-config"), []) => {
            let payload = serde_json::from_reader::<_, openwrt_admin::OpenWrtAppConfigPayload>(
                std::io::stdin(),
            )
            .map_err(|e| anyhow::anyhow!("failed to parse app config JSON from stdin: {e}"))?;
            print_json(&openwrt_admin::update_app_proxy_config(&db, &app_type, payload).await?)?;
            Ok(())
        }
        (Some("get-usage-summary"), []) => {
            print_json(&openwrt_admin::get_usage_summary(&db, &app_type)?)?;
            Ok(())
        }
        (Some("get-provider-stats"), []) => {
            print_json(&openwrt_admin::get_provider_stats(&db, &app_type)?)?;
            Ok(())
        }
        (Some("get-recent-activity"), []) => {
            print_json(&openwrt_admin::get_recent_activity(&db, &app_type)?)?;
            Ok(())
        }
        (Some("get-request-logs"), []) => {
            print_json(&openwrt_admin::get_request_logs(
                &db,
                &app_type,
                None,
                None,
                crate::services::usage_stats::LogFilters::default(),
            )?)?;
            Ok(())
        }
        (Some("get-request-logs"), [page]) => {
            let page = parse_u32_arg("page", page)?;
            print_json(&openwrt_admin::get_request_logs(
                &db,
                &app_type,
                Some(page),
                None,
                crate::services::usage_stats::LogFilters::default(),
            )?)?;
            Ok(())
        }
        (Some("get-request-logs"), [page, page_size]) => {
            let page = parse_u32_arg("page", page)?;
            let page_size = parse_u32_arg("page size", page_size)?;
            print_json(&openwrt_admin::get_request_logs(
                &db,
                &app_type,
                Some(page),
                Some(page_size),
                crate::services::usage_stats::LogFilters::default(),
            )?)?;
            Ok(())
        }
        (Some("get-request-detail"), [request_id]) => {
            print_json(&openwrt_admin::get_request_detail(
                &db, &app_type, request_id,
            )?)?;
            Ok(())
        }
        (Some("get-active-provider"), []) => {
            print_json(&openwrt_admin::get_active_provider(&db, &app_type)?)?;
            Ok(())
        }
        (Some("upsert-active-provider"), []) => {
            print_json(&openwrt_admin::upsert_active_provider(&db, &app_type)?)?;
            Ok(())
        }
        (Some("list-providers"), []) => {
            print_json(&openwrt_admin::list_providers(&db, &app_type)?)?;
            Ok(())
        }
        (Some("get-provider"), [provider_id]) => {
            print_json(&openwrt_admin::get_provider(&db, &app_type, provider_id)?)?;
            Ok(())
        }
        (Some("get-provider-failover"), [provider_id]) => {
            print_json(&openwrt_admin::get_provider_failover(&db, &app_type, provider_id).await?)?;
            Ok(())
        }
        (Some("get-circuit-breaker-stats"), [provider_id])
        | (Some("get-circuit-breaker-state"), [provider_id]) => {
            print_json(
                &openwrt_admin::get_live_circuit_breaker_state(&db, &app_type, provider_id).await?,
            )?;
            Ok(())
        }
        (Some("reset-circuit-breaker"), [provider_id]) => {
            print_json(
                &openwrt_admin::reset_live_circuit_breaker(&db, &app_type, provider_id).await?,
            )?;
            Ok(())
        }
        (Some("upsert-provider"), []) => {
            print_json(&openwrt_admin::upsert_provider(&db, &app_type, None)?)?;
            Ok(())
        }
        (Some("upsert-provider"), [provider_id]) => {
            print_json(&openwrt_admin::upsert_provider(
                &db,
                &app_type,
                Some(provider_id),
            )?)?;
            Ok(())
        }
        (Some("delete-provider"), [provider_id]) => {
            print_json(&openwrt_admin::delete_provider(
                &db,
                &app_type,
                provider_id,
            )?)?;
            Ok(())
        }
        (Some("activate-provider"), [provider_id]) => {
            print_json(&openwrt_admin::activate_provider(
                &db,
                &app_type,
                provider_id,
            )?)?;
            Ok(())
        }
        (Some("get-available-failover-providers"), []) => {
            print_json(&openwrt_admin::get_available_failover_providers(
                &db, &app_type,
            )?)?;
            Ok(())
        }
        (Some("get-available-providers-for-failover"), []) => {
            print_json(&openwrt_admin::get_available_failover_providers(
                &db, &app_type,
            )?)?;
            Ok(())
        }
        (Some("add-to-failover-queue"), [provider_id]) => {
            print_json(&openwrt_admin::add_to_failover_queue(&db, &app_type, provider_id).await?)?;
            Ok(())
        }
        (Some("remove-from-failover-queue"), [provider_id]) => {
            print_json(
                &openwrt_admin::remove_from_failover_queue(&db, &app_type, provider_id).await?,
            )?;
            Ok(())
        }
        (Some("reorder-failover-queue"), []) => {
            let provider_ids = read_string_array_from_stdin()?;
            print_json(
                &openwrt_admin::reorder_failover_queue(&db, &app_type, &provider_ids).await?,
            )?;
            Ok(())
        }
        (Some("set-auto-failover-enabled"), [enabled]) => {
            let enabled = parse_bool_flag(enabled)?;
            print_json(&openwrt_admin::set_auto_failover_enabled(&db, &app_type, enabled).await?)?;
            Ok(())
        }
        (Some("set-max-retries"), [value]) => {
            let value = value
                .trim()
                .parse::<u32>()
                .map_err(|e| anyhow::anyhow!("invalid max retries `{value}`: {e}"))?;
            print_json(&openwrt_admin::set_max_retries(&db, &app_type, value).await?)?;
            Ok(())
        }
        (Some("upload-codex-auth"), [provider_id]) => {
            let raw_bytes = read_bytes_from_stdin(
                crate::proxy::providers::codex_oauth_store::codex_auth_upload_limit_bytes(),
            )?;
            print_json(&openwrt_admin::upload_codex_auth(
                &db,
                &app_type,
                provider_id,
                &raw_bytes,
            )?)?;
            Ok(())
        }
        (Some("upload-claude-auth"), [provider_id]) => {
            let raw_bytes = read_bytes_from_stdin(
                crate::proxy::providers::claude_oauth_store::claude_auth_upload_limit_bytes(),
            )?;
            print_json(&openwrt_admin::upload_claude_auth(
                &db,
                &app_type,
                provider_id,
                &raw_bytes,
            )?)?;
            Ok(())
        }
        (Some("remove-codex-auth"), [provider_id]) => {
            print_json(&openwrt_admin::remove_codex_auth(
                &db,
                &app_type,
                provider_id,
            )?)?;
            Ok(())
        }
        (Some("remove-claude-auth"), [provider_id]) => {
            print_json(&openwrt_admin::remove_claude_auth(
                &db,
                &app_type,
                provider_id,
            )?)?;
            Ok(())
        }
        _ => Err(anyhow::anyhow!(OPENWRT_COMMAND_HELP)),
    }
}

fn parse_bool_flag(value: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        _ => Err(anyhow::anyhow!(
            "invalid boolean flag `{value}`; expected one of: true, false, 1, 0, yes, no, on, off"
        )),
    }
}

fn parse_u32_arg(label: &str, value: &str) -> anyhow::Result<u32> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|e| anyhow::anyhow!("invalid {label} `{value}`: {e}"))
}

fn print_json<T: serde::Serialize>(value: &T) -> anyhow::Result<()> {
    serde_json::to_writer_pretty(std::io::stdout(), value)?;
    println!();
    Ok(())
}

fn read_string_array_from_stdin() -> anyhow::Result<Vec<String>> {
    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    let parsed = serde_json::from_str::<Vec<String>>(input.trim())
        .map_err(|e| anyhow::anyhow!("failed to parse provider id array from stdin: {e}"))?;

    Ok(parsed)
}

fn read_bytes_from_stdin(limit: usize) -> anyhow::Result<Vec<u8>> {
    let mut stdin = std::io::stdin();
    let input = read_bounded_bytes(&mut stdin, limit)?;
    if input.is_empty() {
        return Err(anyhow::anyhow!("stdin payload is required"));
    }

    Ok(input)
}

fn read_bounded_bytes<R: Read>(reader: &mut R, limit: usize) -> anyhow::Result<Vec<u8>> {
    let mut input = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }

        if input.len() + read > limit {
            return Err(anyhow::anyhow!(
                "stdin payload exceeds {} KiB limit",
                limit / 1024
            ));
        }

        input.extend_from_slice(&chunk[..read]);
    }

    Ok(input)
}

fn sync_openwrt_host_proxy_into_runtime_state(db: &database::Database) -> anyhow::Result<()> {
    let host_proxy_url = proxy::http_client::get_host_proxy_url_from_env();
    let current_proxy_url = db
        .get_global_proxy_url()
        .map_err(|e| anyhow::anyhow!("Failed to read global proxy URL: {e}"))?;

    if current_proxy_url != host_proxy_url {
        db.set_global_proxy_url(host_proxy_url.as_deref())
            .map_err(|e| anyhow::anyhow!("Failed to persist OpenWrt host proxy URL: {e}"))?;
    }

    proxy::http_client::init(host_proxy_url.as_deref())
        .map_err(|e| anyhow::anyhow!("Failed to initialize upstream proxy runtime: {e}"))?;

    if let Some(url) = host_proxy_url {
        log::info!(
            "Initialized OpenWrt upstream proxy from host config: {}",
            proxy::http_client::mask_url(&url)
        );
    } else {
        log::info!("Initialized OpenWrt upstream proxy from host config: direct connection");
    }

    Ok(())
}

async fn startup_claude_oauth_refresh_with_refresher<R>(
    db: &database::Database,
    claude_uploaded_auth: &services::oauth_refresh::ClaudeUploadedAuthManager,
    refresher: &R,
    warn_unusable: bool,
) where
    R: services::oauth_refresh::OAuthTokenRefresher,
{
    let providers = match db.get_all_providers("claude") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[Startup] failed to list Claude providers for eager OAuth refresh: {error}"
            );
            return;
        }
    };

    for provider in providers.into_values() {
        if provider
            .settings_config
            .get("auth_mode")
            .and_then(|v| v.as_str())
            != Some("claude_oauth")
        {
            continue;
        }

        let provider_id = provider.id.clone();
        let result = claude_uploaded_auth
            .get_valid_access_token(&provider_id, refresher)
            .await;

        if warn_unusable && result.is_none() {
            log::warn!("[Startup] Claude OAuth provider {provider_id} has no usable token after refresh attempt");
        }
    }
}

fn is_codex_oauth_provider_for_refresh(provider: &provider::Provider) -> bool {
    provider.id == "codex-official"
        || provider
            .settings_config
            .get("auth_mode")
            .and_then(|v| v.as_str())
            .is_some_and(|auth_mode| matches!(auth_mode, "codex_oauth" | "client_passthrough"))
}

async fn refresh_due_codex_oauth_with_refresher<R>(
    db: &database::Database,
    oauth_refresh_locks: &services::oauth_refresh::OAuthRefreshLockManager,
    refresher: &R,
) where
    R: services::oauth_refresh::OAuthTokenRefresher,
{
    let providers = match db.get_all_providers("codex") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[OAuthRefresh] failed to list Codex providers for scheduled refresh: {error}"
            );
            return;
        }
    };

    for provider in providers
        .into_values()
        .filter(is_codex_oauth_provider_for_refresh)
    {
        let provider_id = provider.id.clone();
        let provider_key = format!("codex:{provider_id}");
        let _ = services::oauth_refresh::load_or_refresh_oauth_credentials(
            "Codex",
            &provider_id,
            &provider_key,
            refresher,
            oauth_refresh_locks,
            || services::oauth_refresh::storage::load_codex_refresh_auth_for_provider(&provider_id),
            |stored, refreshed| {
                services::oauth_refresh::storage::save_refreshed_codex_auth_for_provider(
                    &provider_id,
                    stored,
                    refreshed,
                )
            },
        )
        .await;
    }
}

async fn refresh_due_codex_oauth(
    db: &database::Database,
    oauth_refresh_locks: &services::oauth_refresh::OAuthRefreshLockManager,
) {
    refresh_due_codex_oauth_with_refresher(
        db,
        oauth_refresh_locks,
        &services::oauth_refresh::CodexTokenRefresher::new(),
    )
    .await;
}

fn delay_until_oauth_refresh(expires_at_ms: Option<i64>, now_ms: i64) -> Option<Duration> {
    let expires_at_ms = expires_at_ms?;
    let refresh_at_ms = expires_at_ms.saturating_sub(OAUTH_REFRESH_SKEW_MS);
    if refresh_at_ms <= now_ms {
        return Some(OAUTH_REFRESH_MIN_SLEEP);
    }

    let delay_ms = refresh_at_ms.saturating_sub(now_ms);
    let delay = Duration::from_millis(delay_ms as u64);
    Some(delay.clamp(OAUTH_REFRESH_MIN_SLEEP, OAUTH_REFRESH_MAX_SLEEP))
}

fn min_delay(current: Duration, candidate: Option<Duration>) -> Duration {
    candidate.map_or(current, |delay| current.min(delay))
}

fn next_oauth_refresh_delay(db: &database::Database) -> Duration {
    next_oauth_refresh_delay_at(db, chrono::Utc::now().timestamp_millis())
}

fn next_oauth_refresh_delay_at(db: &database::Database, now_ms: i64) -> Duration {
    let mut next = OAUTH_REFRESH_MAX_SLEEP;

    if let Ok(providers) = db.get_all_providers("claude") {
        for provider in providers.into_values() {
            if provider
                .settings_config
                .get("auth_mode")
                .and_then(|v| v.as_str())
                != Some("claude_oauth")
            {
                continue;
            }

            if let Ok(Some(auth)) =
                services::oauth_refresh::storage::load_claude_refresh_auth_for_provider(
                    &provider.id,
                )
            {
                next = min_delay(next, delay_until_oauth_refresh(auth.expires_at_ms, now_ms));
            }
        }
    }

    if let Ok(providers) = db.get_all_providers("codex") {
        for provider in providers
            .into_values()
            .filter(is_codex_oauth_provider_for_refresh)
        {
            if let Ok(Some(auth)) =
                services::oauth_refresh::storage::load_codex_refresh_auth_for_provider(&provider.id)
            {
                next = min_delay(next, delay_until_oauth_refresh(auth.expires_at_ms, now_ms));
            }
        }
    }

    next
}

async fn run_oauth_refresh_scheduler(
    db: Arc<database::Database>,
    claude_uploaded_auth: services::oauth_refresh::ClaudeUploadedAuthManager,
    oauth_refresh_locks: services::oauth_refresh::OAuthRefreshLockManager,
) {
    loop {
        startup_claude_oauth_refresh_with_refresher(
            db.as_ref(),
            &claude_uploaded_auth,
            &services::oauth_refresh::ClaudeTokenRefresher::new(),
            false,
        )
        .await;
        refresh_due_codex_oauth(db.as_ref(), &oauth_refresh_locks).await;

        let delay = next_oauth_refresh_delay(db.as_ref());
        log::debug!(
            "[OAuthRefresh] next scheduled OAuth refresh scan in {}s",
            delay.as_secs()
        );
        tokio::time::sleep(delay).await;
    }
}

async fn run_daemon() -> anyhow::Result<()> {
    log::info!(
        "cc-switch proxy daemon starting ({})...",
        version::build_version()
    );

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

    sync_openwrt_host_proxy_into_runtime_state(db.as_ref())?;

    // Config dir for auth managers
    let config_dir = config::get_app_config_dir();

    // Initialize auth managers
    let copilot_auth = Arc::new(RwLock::new(
        proxy::providers::copilot_auth::CopilotAuthManager::new(config_dir.clone()),
    ));
    let codex_oauth_auth = Arc::new(
        proxy::providers::codex_oauth_auth::CodexOAuthManager::new(config_dir.clone()),
    );

    // Initialize proxy service
    let proxy_service = services::ProxyService::new(db.clone());
    proxy_service.set_copilot_auth(copilot_auth);
    proxy_service.set_codex_oauth_auth(codex_oauth_auth);

    // Start proxy
    let info = proxy_service
        .start()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to start proxy: {e}"))?;

    // Keep uploaded OAuth access tokens warm without relying on request traffic
    // or `/api/status` polling. Request/status paths still use the same refresh
    // helpers and locks as a fallback.
    if let (Some(claude_uploaded_auth), Some(oauth_refresh_locks)) = (
        proxy_service.clone_claude_uploaded_auth_manager().await,
        proxy_service.clone_oauth_refresh_lock_manager().await,
    ) {
        tokio::spawn(run_oauth_refresh_scheduler(
            db.clone(),
            claude_uploaded_auth,
            oauth_refresh_locks,
        ));
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serial_test::serial;
    use std::io::Cursor;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn read_bounded_bytes_rejects_payloads_over_limit() {
        let limit = crate::proxy::providers::codex_oauth_store::codex_auth_upload_limit_bytes();
        let mut cursor = Cursor::new(vec![b'x'; limit + 1]);
        let error = read_bounded_bytes(&mut cursor, limit).expect_err("oversized payload");
        assert!(error.to_string().contains("64 KiB limit"));
    }

    #[test]
    #[serial]
    fn sync_openwrt_host_proxy_into_runtime_state_persists_env_proxy_truth() {
        let _guard = env_lock().lock().expect("lock env");
        let db = database::Database::memory().expect("db");

        for key in ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"] {
            std::env::remove_var(key);
        }

        std::env::set_var("http_proxy", "http://127.0.0.1:7890");
        std::env::set_var("https_proxy", "http://127.0.0.1:9443");

        sync_openwrt_host_proxy_into_runtime_state(&db).expect("sync host proxy");

        assert_eq!(
            db.get_global_proxy_url()
                .expect("read global proxy url")
                .as_deref(),
            Some("http://127.0.0.1:9443")
        );
        assert_eq!(
            proxy::http_client::get_current_proxy_url().as_deref(),
            Some("http://127.0.0.1:9443")
        );

        for key in ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"] {
            std::env::remove_var(key);
        }

        sync_openwrt_host_proxy_into_runtime_state(&db).expect("clear host proxy");

        assert_eq!(
            db.get_global_proxy_url().expect("read global proxy url"),
            None
        );
        assert_eq!(proxy::http_client::get_current_proxy_url(), None);
    }

    // ---- startup OAuth refresh tests ----

    struct TestAuthEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        _tmp: tempfile::TempDir,
    }

    impl TestAuthEnv {
        fn new() -> Self {
            let guard = env_lock().lock().expect("lock env");
            let tmp = tempfile::TempDir::new().expect("create temp dir");
            let data = tmp.path().join("data");
            std::fs::create_dir_all(&data).expect("create data dir");
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);
            Self {
                _guard: guard,
                _tmp: tmp,
            }
        }

        fn claude_auth_path(&self, provider_id: &str) -> std::path::PathBuf {
            self._tmp
                .path()
                .join("data")
                .join("claude_auth")
                .join(format!("{provider_id}.json"))
        }

        fn codex_auth_path(&self, provider_id: &str) -> std::path::PathBuf {
            self._tmp
                .path()
                .join("data")
                .join("codex_auth")
                .join(format!("{provider_id}.json"))
        }
    }

    impl Drop for TestAuthEnv {
        fn drop(&mut self) {
            std::env::remove_var("CC_SWITCH_DATA_DIR");
        }
    }

    fn expired_claude_auth_json() -> Vec<u8> {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "expired-access-token",
                "refreshToken": "valid-refresh-token",
                "expiresAt": 1_738_000_000_000i64,
                "scopes": ["user:inference"]
            }
        })
        .to_string()
        .into_bytes()
    }

    fn claude_auth_json(expires_at_ms: i64) -> Vec<u8> {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "access-token",
                "refreshToken": "refresh-token",
                "expiresAt": expires_at_ms,
                "scopes": ["user:inference"]
            }
        })
        .to_string()
        .into_bytes()
    }

    fn jwt_with_exp(exp_secs: i64) -> String {
        format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(format!(
                r#"{{"exp":{exp_secs},"https://api.openai.com/auth":{{"chatgpt_account_id":"acc-123"}}}}"#
            ))
        )
    }

    fn codex_auth_json(expires_at_ms: i64) -> Vec<u8> {
        serde_json::json!({
            "tokens": {
                "access_token": jwt_with_exp(expires_at_ms / 1000),
                "refresh_token": "refresh-token",
                "account_id": "acc-123"
            }
        })
        .to_string()
        .into_bytes()
    }

    struct MockRefresher {
        new_access_token: String,
    }

    #[async_trait::async_trait]
    impl services::oauth_refresh::OAuthTokenRefresher for MockRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<
            services::oauth_refresh::RefreshedCredentials,
            services::oauth_refresh::OAuthRefreshError,
        > {
            Ok(services::oauth_refresh::RefreshedCredentials {
                access_token: self.new_access_token.clone(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh-token".to_string()),
                extra: serde_json::Value::Null,
            })
        }
    }

    fn insert_claude_oauth_provider(db: &database::Database, provider_id: &str) {
        let provider = crate::provider::Provider {
            id: provider_id.to_string(),
            name: "Claude OAuth".to_string(),
            settings_config: serde_json::json!({ "auth_mode": "claude_oauth" }),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        db.save_provider("claude", &provider)
            .expect("save provider");
    }

    fn insert_codex_oauth_provider(db: &database::Database, provider_id: &str) {
        let provider = crate::provider::Provider {
            id: provider_id.to_string(),
            name: "Codex OAuth".to_string(),
            settings_config: serde_json::json!({ "auth_mode": "codex_oauth" }),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        db.save_provider("codex", &provider).expect("save provider");
    }

    #[test]
    fn delay_until_oauth_refresh_uses_skew_and_clamps_bounds() {
        let now_ms = 1_800_000_000_000;

        assert_eq!(delay_until_oauth_refresh(None, now_ms), None);
        assert_eq!(
            delay_until_oauth_refresh(Some(now_ms + 2 * 60 * 1000), now_ms),
            Some(OAUTH_REFRESH_MIN_SLEEP)
        );
        assert_eq!(
            delay_until_oauth_refresh(Some(now_ms + 8 * 60 * 1000), now_ms),
            Some(Duration::from_secs(3 * 60))
        );
        assert_eq!(
            delay_until_oauth_refresh(Some(now_ms + 20 * 60 * 1000), now_ms),
            Some(OAUTH_REFRESH_MAX_SLEEP)
        );
    }

    #[test]
    #[serial]
    fn next_oauth_refresh_delay_uses_soonest_uploaded_auth_expiry() {
        let env = TestAuthEnv::new();
        let db = database::Database::memory().expect("db");
        let now_ms = 1_800_000_000_000;

        insert_claude_oauth_provider(&db, "claude-oauth");
        insert_codex_oauth_provider(&db, "codex-oauth");

        let claude_auth_path = env.claude_auth_path("claude-oauth");
        std::fs::create_dir_all(claude_auth_path.parent().expect("claude auth parent"))
            .expect("create claude auth dir");
        std::fs::write(&claude_auth_path, claude_auth_json(now_ms + 8 * 60 * 1000))
            .expect("write claude auth");

        let codex_auth_path = env.codex_auth_path("codex-oauth");
        std::fs::create_dir_all(codex_auth_path.parent().expect("codex auth parent"))
            .expect("create codex auth dir");
        std::fs::write(&codex_auth_path, codex_auth_json(now_ms + 20 * 60 * 1000))
            .expect("write codex auth");

        assert_eq!(
            next_oauth_refresh_delay_at(&db, now_ms),
            Duration::from_secs(3 * 60)
        );

        drop(env);
    }

    #[tokio::test]
    #[serial]
    async fn startup_refresh_updates_expired_claude_oauth_token() {
        let env = TestAuthEnv::new();
        let db = database::Database::memory().expect("db");

        insert_claude_oauth_provider(&db, "claude-oauth");

        let auth_dir = env._tmp.path().join("data").join("claude_auth");
        std::fs::create_dir_all(&auth_dir).expect("create auth dir");
        std::fs::write(
            auth_dir.join("claude-oauth.json"),
            expired_claude_auth_json(),
        )
        .expect("write expired auth");

        let claude_uploaded_auth = services::oauth_refresh::ClaudeUploadedAuthManager::new();
        let refresher = MockRefresher {
            new_access_token: "refreshed-access-token".to_string(),
        };

        startup_claude_oauth_refresh_with_refresher(&db, &claude_uploaded_auth, &refresher, true)
            .await;

        let updated =
            services::oauth_refresh::storage::load_claude_refresh_auth_for_provider("claude-oauth")
                .expect("load auth")
                .expect("auth present");
        assert_eq!(updated.access_token, "refreshed-access-token");
        assert_eq!(
            updated.refresh_token.as_deref(),
            Some("rotated-refresh-token")
        );
        assert!(updated
            .expires_at_ms
            .is_some_and(|t| t > chrono::Utc::now().timestamp_millis()));

        drop(env);
    }

    #[tokio::test]
    #[serial]
    async fn startup_refresh_skips_non_oauth_claude_providers() {
        let env = TestAuthEnv::new();
        let db = database::Database::memory().expect("db");

        // Insert a provider with plain API key (not claude_oauth).
        let provider = crate::provider::Provider {
            id: "claude-apikey".to_string(),
            name: "Claude API Key".to_string(),
            settings_config: serde_json::json!({
                "env": { "ANTHROPIC_API_KEY": "sk-ant-key" }
            }),
            website_url: None,
            category: None,
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        };
        db.save_provider("claude", &provider)
            .expect("save provider");

        let claude_uploaded_auth = services::oauth_refresh::ClaudeUploadedAuthManager::new();
        let refresher = MockRefresher {
            new_access_token: "should-not-be-called".to_string(),
        };

        // Should complete without touching any auth file.
        startup_claude_oauth_refresh_with_refresher(&db, &claude_uploaded_auth, &refresher, true)
            .await;

        // No auth file should have been created.
        assert!(!env.claude_auth_path("claude-apikey").exists());

        drop(env);
    }
}

#[cfg(not(unix))]
async fn wait_for_shutdown_signal() -> anyhow::Result<()> {
    tokio::signal::ctrl_c().await?;
    Ok(())
}
