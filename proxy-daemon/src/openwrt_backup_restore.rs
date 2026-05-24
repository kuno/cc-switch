use crate::database::Database;
use crate::version;
use anyhow::{anyhow, Context};
use chrono::Utc;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, TryLockError};
use tar::{Archive, Builder, EntryType, Header};
use uuid::Uuid;

const MANIFEST_PATH: &str = "manifest.json";
const CONFIG_ARCHIVE_PATH: &str = "etc/config/ccswitch";
const MAX_ARCHIVE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_RESTORE_MULTIPART_BYTES: usize = 10 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 512 * 1024;
const MAX_TOTAL_AUTH_BYTES: usize = 2 * 1024 * 1024;
const MAX_AUTH_FILES: usize = 64;
const MAX_JOBS: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtConfigBackupManifest {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub format_version: u32,
    pub exported_at: String,
    pub daemon_version: String,
    pub package_version: Option<String>,
    pub schema_version: i32,
    pub supported_schema_version: i32,
    pub app_count: usize,
    pub provider_count: usize,
    pub includes_credentials: bool,
    pub auth_file_count: usize,
    pub rollback_supported: bool,
    pub config_path: String,
    pub auth_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtConfigRestoreDryRunView {
    pub manifest: OpenWrtConfigBackupManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtConfigRestoreStartView {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtConfigRestoreEvent {
    pub step: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rolled_back: Option<bool>,
}

#[derive(Debug, Clone)]
struct RestorePayload {
    manifest: OpenWrtConfigBackupManifest,
    config: Vec<u8>,
    auth_files: Vec<(String, Vec<u8>)>,
}

#[derive(Debug, Clone)]
struct RestoreJob {
    latest: OpenWrtConfigRestoreEvent,
    events: Vec<OpenWrtConfigRestoreEvent>,
}

static RESTORE_JOBS: Lazy<Mutex<HashMap<String, RestoreJob>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RESTORE_JOB_ORDER: Lazy<Mutex<VecDeque<String>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static RESTORE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub fn config_backup_filename() -> String {
    format!("ccswitch-backup-{}.tar.gz", Utc::now().format("%Y-%m-%d"))
}

pub fn create_config_backup_archive(db: &Database) -> anyhow::Result<Vec<u8>> {
    let config_path = openwrt_config_path();
    let config_bytes = fs::read(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
    if config_bytes.len() > MAX_FILE_BYTES {
        return Err(anyhow!("ccswitch config exceeds backup size limit"));
    }

    let auth_files = collect_auth_files()?;
    let manifest = build_manifest(db, &auth_files)?;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut tar = Builder::new(&mut encoder);
        append_bytes(
            &mut tar,
            MANIFEST_PATH,
            &serde_json::to_vec_pretty(&manifest)?,
            0o644,
        )?;
        append_bytes(&mut tar, CONFIG_ARCHIVE_PATH, &config_bytes, 0o600)?;
        for (archive_path, bytes) in &auth_files {
            append_bytes(&mut tar, archive_path, bytes, 0o600)?;
        }
        tar.finish()?;
    }
    encoder.finish().context("failed to finish gzip archive")
}

pub fn validate_config_restore_archive(
    db: &Database,
    archive_bytes: &[u8],
) -> anyhow::Result<OpenWrtConfigRestoreDryRunView> {
    let payload = parse_restore_archive(db, archive_bytes)?;
    validate_uci_config(&payload.config)?;
    Ok(OpenWrtConfigRestoreDryRunView {
        manifest: payload.manifest,
    })
}

pub fn start_config_restore_job(
    db: &Database,
    archive_bytes: Vec<u8>,
) -> anyhow::Result<OpenWrtConfigRestoreStartView> {
    let job_id = Uuid::new_v4().to_string();
    insert_job(
        job_id.clone(),
        OpenWrtConfigRestoreEvent {
            step: "validate".to_string(),
            state: "active".to_string(),
            error: None,
            rolled_back: None,
        },
    );

    let supported_schema = Database::supported_schema_version();
    let current_schema = db
        .current_schema_version()
        .map_err(|e| anyhow!("failed to read current schema version: {e}"))?;
    std::thread::spawn({
        let job_id = job_id.clone();
        move || {
            run_restore_job(&job_id, archive_bytes, current_schema, supported_schema);
        }
    });

    Ok(OpenWrtConfigRestoreStartView { job_id })
}

pub fn get_restore_job_event(job_id: &str) -> anyhow::Result<OpenWrtConfigRestoreEvent> {
    let jobs = RESTORE_JOBS.lock().expect("restore jobs lock");
    jobs.get(job_id)
        .map(|job| job.latest.clone())
        .ok_or_else(|| anyhow!("restore job not found"))
}

pub fn get_restore_job_events(job_id: &str) -> anyhow::Result<Vec<OpenWrtConfigRestoreEvent>> {
    let jobs = RESTORE_JOBS.lock().expect("restore jobs lock");
    jobs.get(job_id)
        .map(|job| job.events.clone())
        .ok_or_else(|| anyhow!("restore job not found"))
}

fn run_restore_job(
    job_id: &str,
    archive_bytes: Vec<u8>,
    current_schema: i32,
    supported_schema: i32,
) {
    let result = (|| -> anyhow::Result<bool> {
        let _restore_guard = match RESTORE_LOCK.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                push_event(
                    job_id,
                    "validate",
                    "failed",
                    Some("another restore job is already running".to_string()),
                    Some(false),
                );
                return Ok(false);
            }
            Err(TryLockError::Poisoned(error)) => error.into_inner(),
        };
        let payload =
            parse_restore_archive_with_versions(&archive_bytes, current_schema, supported_schema)?;
        validate_uci_config(&payload.config)?;
        push_event(job_id, "validate", "done", None, None);
        push_event(job_id, "apply", "active", None, None);

        let safety = capture_current_files().context("failed to create restore safety backup")?;
        if let Err(error) = apply_payload(&payload) {
            let rolled_back = rollback_files(&safety).is_ok();
            return Err(anyhow!("apply failed: {error}; rolledBack={rolled_back}"));
        }
        push_event(job_id, "apply", "done", None, None);

        push_event(job_id, "reload", "active", None, None);
        if let Err(error) = reload_daemon_state() {
            let rolled_back = rollback_files(&safety).is_ok();
            push_event(
                job_id,
                "reload",
                "failed",
                Some(error.to_string()),
                Some(rolled_back),
            );
            return Ok(false);
        }
        push_event(job_id, "reload", "done", None, None);

        push_event(job_id, "verify", "active", None, None);
        if let Err(error) = verify_restore(&payload) {
            let rolled_back = rollback_files(&safety).is_ok();
            push_event(
                job_id,
                "verify",
                "failed",
                Some(error.to_string()),
                Some(rolled_back),
            );
            return Ok(false);
        }
        push_event(job_id, "verify", "done", None, None);
        Ok(true)
    })();

    match result {
        Ok(true) => {}
        Ok(false) => {}
        Err(error) => {
            let message = error.to_string();
            let rolled_back = message.contains("rolledBack=true");
            let clean_message = message
                .replace("; rolledBack=true", "")
                .replace("; rolledBack=false", "");
            let step = if clean_message.starts_with("apply failed") {
                "apply"
            } else {
                "validate"
            };
            push_event(
                job_id,
                step,
                "failed",
                Some(clean_message),
                Some(rolled_back),
            );
        }
    }
}

fn build_manifest(
    db: &Database,
    auth_files: &[(String, Vec<u8>)],
) -> anyhow::Result<OpenWrtConfigBackupManifest> {
    let apps = [
        ("claude", crate::app_config::AppType::Claude),
        ("codex", crate::app_config::AppType::Codex),
        ("gemini", crate::app_config::AppType::Gemini),
    ];
    let mut provider_count = 0usize;
    let mut app_count = 0usize;
    for (app_id, _) in apps {
        let providers = db
            .get_all_providers(app_id)
            .map_err(|e| anyhow!("failed to count {app_id} providers: {e}"))?;
        if !providers.is_empty() {
            app_count += 1;
        }
        provider_count += providers.len();
    }

    Ok(OpenWrtConfigBackupManifest {
        schema: "https://ccswitch.dev/schema/openwrt-config-backup-v1.json".to_string(),
        format_version: 1,
        exported_at: Utc::now().to_rfc3339(),
        daemon_version: version::build_version().to_string(),
        package_version: std::env::var("CC_SWITCH_PACKAGE_VERSION").ok(),
        schema_version: db
            .current_schema_version()
            .map_err(|e| anyhow!("failed to read schema version: {e}"))?,
        supported_schema_version: Database::supported_schema_version(),
        app_count,
        provider_count,
        includes_credentials: !auth_files.is_empty(),
        auth_file_count: auth_files.len(),
        rollback_supported: false,
        config_path: "/etc/config/ccswitch".to_string(),
        auth_paths: auth_files.iter().map(|(path, _)| path.clone()).collect(),
    })
}

fn parse_restore_archive(db: &Database, archive_bytes: &[u8]) -> anyhow::Result<RestorePayload> {
    parse_restore_archive_with_versions(
        archive_bytes,
        db.current_schema_version()
            .map_err(|e| anyhow!("failed to read current schema version: {e}"))?,
        Database::supported_schema_version(),
    )
}

fn parse_restore_archive_with_versions(
    archive_bytes: &[u8],
    _current_schema: i32,
    supported_schema: i32,
) -> anyhow::Result<RestorePayload> {
    if archive_bytes.is_empty() {
        return Err(anyhow!("restore archive is empty"));
    }
    if archive_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(anyhow!("restore archive exceeds size limit"));
    }

    let decoder = GzDecoder::new(Cursor::new(archive_bytes));
    let mut archive = Archive::new(decoder);
    let mut manifest = None;
    let mut config = None;
    let mut auth_files = Vec::new();
    let mut total_auth_bytes = 0usize;

    for entry in archive
        .entries()
        .context("failed to read gzip tar archive")?
    {
        let mut entry = entry.context("failed to read tar entry")?;
        let header = entry.header();
        if header.entry_type() != EntryType::Regular {
            return Err(anyhow!("restore archive contains non-regular file"));
        }
        let path = entry.path().context("tar entry path is invalid")?;
        let path = normalize_archive_path(&path)?;
        if entry.size() as usize > MAX_FILE_BYTES {
            return Err(anyhow!("restore archive entry {path} exceeds size limit"));
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;

        match path.as_str() {
            MANIFEST_PATH => {
                manifest = Some(
                    serde_json::from_slice::<OpenWrtConfigBackupManifest>(&bytes)
                        .context("manifest.json is malformed")?,
                );
            }
            CONFIG_ARCHIVE_PATH => config = Some(bytes),
            path if is_auth_archive_path(path) => {
                if auth_files.len() >= MAX_AUTH_FILES {
                    return Err(anyhow!("restore archive contains too many auth files"));
                }
                total_auth_bytes = total_auth_bytes
                    .checked_add(bytes.len())
                    .ok_or_else(|| anyhow!("restore archive auth payload exceeds size limit"))?;
                if total_auth_bytes > MAX_TOTAL_AUTH_BYTES {
                    return Err(anyhow!("restore archive auth payload exceeds size limit"));
                }
                auth_files.push((path.to_string(), bytes));
            }
            _ => return Err(anyhow!("restore archive contains unsupported path: {path}")),
        }
    }

    let manifest = manifest.ok_or_else(|| anyhow!("restore archive missing manifest.json"))?;
    if manifest.format_version != 1 {
        return Err(anyhow!(
            "unsupported backup format version {}",
            manifest.format_version
        ));
    }
    if manifest.schema_version > supported_schema {
        return Err(anyhow!(
            "backup schema version {} is newer than supported version {}",
            manifest.schema_version,
            supported_schema
        ));
    }
    let config = config.ok_or_else(|| anyhow!("restore archive missing etc/config/ccswitch"))?;

    Ok(RestorePayload {
        manifest,
        config,
        auth_files,
    })
}

fn append_bytes(
    tar: &mut Builder<&mut GzEncoder<Vec<u8>>>,
    path: &str,
    bytes: &[u8],
    mode: u32,
) -> anyhow::Result<()> {
    let mut header = Header::new_gnu();
    header.set_entry_type(EntryType::Regular);
    header.set_size(bytes.len() as u64);
    header.set_mode(mode);
    header.set_cksum();
    tar.append_data(&mut header, path, Cursor::new(bytes))?;
    Ok(())
}

fn collect_auth_files() -> anyhow::Result<Vec<(String, Vec<u8>)>> {
    let data_dir = crate::config::get_app_config_dir();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for dir in ["codex_auth", "claude_auth"] {
        let root = data_dir.join(dir);
        if !root.exists() {
            continue;
        }
        for entry in
            fs::read_dir(&root).with_context(|| format!("failed to read {}", root.display()))?
        {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| anyhow!("auth filename is not UTF-8"))?;
            if !name.ends_with(".json") || name.contains('/') || name.contains("..") {
                continue;
            }
            let bytes = fs::read(entry.path())?;
            if bytes.len() > MAX_FILE_BYTES {
                return Err(anyhow!("auth file {dir}/{name} exceeds backup size limit"));
            }
            if files.len() >= MAX_AUTH_FILES {
                return Err(anyhow!("too many auth files for backup"));
            }
            let current_total: usize = files.iter().map(|(_, bytes)| bytes.len()).sum();
            if current_total.saturating_add(bytes.len()) > MAX_TOTAL_AUTH_BYTES {
                return Err(anyhow!("auth files exceed backup size limit"));
            }
            files.push((format!("data/{dir}/{name}"), bytes));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}

fn normalize_archive_path(path: &Path) -> anyhow::Result<String> {
    if path.is_absolute() {
        return Err(anyhow!("restore archive contains absolute path"));
    }
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(
                part.to_str()
                    .ok_or_else(|| anyhow!("restore archive path is not UTF-8"))?
                    .to_string(),
            ),
            _ => return Err(anyhow!("restore archive contains path traversal")),
        }
    }
    let normalized = parts.join("/");
    if normalized.is_empty() {
        return Err(anyhow!("restore archive contains empty path"));
    }
    Ok(normalized)
}

fn is_auth_archive_path(path: &str) -> bool {
    let Some(name) = path
        .strip_prefix("data/codex_auth/")
        .or_else(|| path.strip_prefix("data/claude_auth/"))
    else {
        return false;
    };
    !name.is_empty() && name.ends_with(".json") && !name.contains('/') && !name.contains("..")
}

fn apply_payload(payload: &RestorePayload) -> anyhow::Result<()> {
    write_private_file(&openwrt_config_path(), &payload.config)?;
    let data_dir = crate::config::get_app_config_dir();
    clear_managed_auth_dirs(&data_dir)?;
    for (archive_path, bytes) in &payload.auth_files {
        let relative = archive_path
            .strip_prefix("data/")
            .ok_or_else(|| anyhow!("invalid auth archive path"))?;
        write_private_file(&data_dir.join(relative), bytes)?;
    }
    Ok(())
}

#[derive(Debug)]
struct SafetyBackup {
    config: Option<Vec<u8>>,
    auth_files: Vec<(PathBuf, Vec<u8>)>,
    auth_dirs: Vec<PathBuf>,
}

fn capture_current_files() -> anyhow::Result<SafetyBackup> {
    let config_path = openwrt_config_path();
    let config = match fs::read(&config_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", config_path.display()))
        }
    };
    let mut auth_files = Vec::new();
    let mut auth_dirs = Vec::new();
    let data_dir = crate::config::get_app_config_dir();
    for dir in ["codex_auth", "claude_auth"] {
        let root = data_dir.join(dir);
        if !root.exists() {
            continue;
        }
        auth_dirs.push(root.clone());
        capture_files_recursive(&root, &mut auth_files)?;
    }
    Ok(SafetyBackup {
        config,
        auth_files,
        auth_dirs,
    })
}

fn rollback_files(safety: &SafetyBackup) -> anyhow::Result<()> {
    let config_path = openwrt_config_path();
    if let Some(bytes) = &safety.config {
        write_private_file(&config_path, bytes)?;
    } else if config_path.exists() {
        fs::remove_file(&config_path)?;
    }
    let data_dir = crate::config::get_app_config_dir();
    clear_managed_auth_dirs(&data_dir)?;
    for (path, bytes) in &safety.auth_files {
        write_private_file(path, bytes)?;
    }
    for dir in ["codex_auth", "claude_auth"] {
        let root = data_dir.join(dir);
        if !safety.auth_dirs.iter().any(|existing| existing == &root) && root.exists() {
            let _ = fs::remove_dir(&root);
        }
    }
    Ok(())
}

fn capture_files_recursive(root: &Path, files: &mut Vec<(PathBuf, Vec<u8>)>) -> anyhow::Result<()> {
    for entry in fs::read_dir(root).with_context(|| format!("failed to read {}", root.display()))? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            capture_files_recursive(&path, files)?;
        } else if file_type.is_file() {
            files.push((path.clone(), fs::read(&path)?));
        }
    }
    Ok(())
}

fn clear_managed_auth_dirs(data_dir: &Path) -> anyhow::Result<()> {
    for dir in ["codex_auth", "claude_auth"] {
        let root = data_dir.join(dir);
        if root.exists() {
            fs::remove_dir_all(&root)
                .with_context(|| format!("failed to clear {}", root.display()))?;
        }
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = tempfile::NamedTempFile::new_in(path.parent().unwrap_or_else(|| Path::new(".")))?;
    fs::write(tmp.path(), bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o600))?;
    }
    tmp.persist(path)
        .map_err(|error| anyhow!(error.error))
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

fn reload_daemon_state() -> anyhow::Result<()> {
    if std::env::var("CCSWITCH_OPENWRT_RESTORE_SKIP_RELOAD")
        .ok()
        .as_deref()
        == Some("1")
    {
        return Ok(());
    }
    crate::settings::reload_settings().map_err(|e| anyhow!("failed to reload settings: {e}"))?;
    Ok(())
}

fn validate_uci_config(config: &[u8]) -> anyhow::Result<()> {
    if std::env::var("CCSWITCH_OPENWRT_RESTORE_SKIP_UCI_VALIDATE")
        .ok()
        .as_deref()
        == Some("1")
    {
        return Ok(());
    }

    let scratch = tempfile::tempdir().context("failed to create UCI validation scratch dir")?;
    let scratch_config = scratch.path().join("ccswitch");
    write_private_file(&scratch_config, config)?;
    let output = match Command::new("uci")
        .arg("-c")
        .arg(scratch.path())
        .arg("show")
        .arg("ccswitch")
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("failed to execute uci validation"),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("uci validation failed: {}", stderr.trim()));
    }
    Ok(())
}

fn verify_restore(payload: &RestorePayload) -> anyhow::Result<()> {
    let applied_config =
        fs::read(openwrt_config_path()).context("failed to read applied config")?;
    if applied_config != payload.config {
        return Err(anyhow!(
            "applied ccswitch config does not match restore archive"
        ));
    }

    let data_dir = crate::config::get_app_config_dir();
    let expected_auth_paths = payload
        .auth_files
        .iter()
        .map(|(archive_path, _)| archive_path.as_str())
        .collect::<HashSet<_>>();

    for dir in ["codex_auth", "claude_auth"] {
        let root = data_dir.join(dir);
        if !root.exists() {
            continue;
        }
        for entry in
            fs::read_dir(&root).with_context(|| format!("failed to read {}", root.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                return Err(anyhow!(
                    "managed auth directory contains unexpected nested directory: {}",
                    path.display()
                ));
            }
            if !file_type.is_file() {
                return Err(anyhow!(
                    "managed auth directory contains unexpected entry: {}",
                    path.display()
                ));
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| anyhow!("auth filename is not UTF-8"))?;
            let archive_path = format!("data/{dir}/{name}");
            if !expected_auth_paths.contains(archive_path.as_str()) {
                return Err(anyhow!(
                    "stale auth file remains after restore: {archive_path}"
                ));
            }
        }
    }

    for (archive_path, expected) in &payload.auth_files {
        let relative = archive_path
            .strip_prefix("data/")
            .ok_or_else(|| anyhow!("invalid auth archive path"))?;
        let applied = fs::read(data_dir.join(relative))
            .with_context(|| format!("failed to read applied auth file {archive_path}"))?;
        if &applied != expected {
            return Err(anyhow!(
                "applied auth file {archive_path} does not match restore archive"
            ));
        }
    }

    validate_uci_config(&payload.config)?;
    let db = Database::init().context("failed to open database after restore")?;
    db.current_schema_version()
        .map_err(|e| anyhow!("failed to read database schema after restore: {e}"))?;
    Ok(())
}

fn openwrt_config_path() -> PathBuf {
    std::env::var("CCSWITCH_OPENWRT_CONFIG_FILE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/etc/config/ccswitch"))
}

fn insert_job(job_id: String, event: OpenWrtConfigRestoreEvent) {
    {
        let mut jobs = RESTORE_JOBS.lock().expect("restore jobs lock");
        jobs.insert(
            job_id.clone(),
            RestoreJob {
                latest: event.clone(),
                events: vec![event],
            },
        );
    }
    let mut order = RESTORE_JOB_ORDER.lock().expect("restore job order lock");
    order.push_back(job_id);
    while order.len() > MAX_JOBS {
        if let Some(oldest) = order.pop_front() {
            RESTORE_JOBS
                .lock()
                .expect("restore jobs lock")
                .remove(&oldest);
        }
    }
}

fn push_event(
    job_id: &str,
    step: &str,
    state: &str,
    error: Option<String>,
    rolled_back: Option<bool>,
) {
    let event = OpenWrtConfigRestoreEvent {
        step: step.to_string(),
        state: state.to_string(),
        error,
        rolled_back,
    };
    let mut jobs = RESTORE_JOBS.lock().expect("restore jobs lock");
    if let Some(job) = jobs.get_mut(job_id) {
        job.latest = event.clone();
        job.events.push(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::io::Write;
    struct TestEnv {
        _dir: tempfile::TempDir,
        config_path: PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    fn test_env() -> TestEnv {
        let guard = crate::settings::test_env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("ccswitch");
        fs::write(
            &config_path,
            b"config ccswitch 'main'\n\toption enabled '1'\n",
        )
        .expect("write config");
        std::env::set_var("CCSWITCH_OPENWRT_CONFIG_FILE", &config_path);
        std::env::set_var("CC_SWITCH_DATA_DIR", dir.path().join("data"));
        std::env::set_var("CCSWITCH_OPENWRT_RESTORE_SKIP_RELOAD", "1");
        std::env::set_var("CCSWITCH_OPENWRT_RESTORE_SKIP_UCI_VALIDATE", "1");
        TestEnv {
            _dir: dir,
            config_path,
            _guard: guard,
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            std::env::remove_var("CCSWITCH_OPENWRT_CONFIG_FILE");
            std::env::remove_var("CC_SWITCH_DATA_DIR");
            std::env::remove_var("CCSWITCH_OPENWRT_RESTORE_SKIP_RELOAD");
            std::env::remove_var("CCSWITCH_OPENWRT_RESTORE_SKIP_UCI_VALIDATE");
        }
    }

    #[test]
    #[serial]
    fn backup_archive_creation_and_dry_run_validation() {
        let env = test_env();
        let db = Database::memory().expect("db");
        let auth_dir = crate::config::get_app_config_dir().join("codex_auth");
        fs::create_dir_all(&auth_dir).expect("auth dir");
        fs::write(
            auth_dir.join("provider.json"),
            br#"{"tokens":{"access_token":"x","refresh_token":"y"}}"#,
        )
        .expect("auth");

        let archive = create_config_backup_archive(&db).expect("backup");
        let dry_run = validate_config_restore_archive(&db, &archive).expect("dry run");
        assert_eq!(dry_run.manifest.format_version, 1);
        assert_eq!(dry_run.manifest.auth_file_count, 1);
        assert!(dry_run.manifest.includes_credentials);
        assert_eq!(
            fs::read(&env.config_path).expect("config"),
            b"config ccswitch 'main'\n\toption enabled '1'\n"
        );
    }

    #[test]
    #[serial]
    fn restore_rejects_traversal_and_malformed_archive() {
        let _env = test_env();
        let db = Database::memory().expect("db");
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&raw_tar_entry("../manifest.json", b"{}"))
            .expect("write tar");
        let archive = gz.finish().expect("gz");
        let error = validate_config_restore_archive(&db, &archive).expect_err("reject traversal");
        assert!(error.to_string().contains("path traversal"));

        let error =
            validate_config_restore_archive(&db, b"not gzip").expect_err("reject malformed");
        let message = error.to_string();
        assert!(
            message.contains("gzip")
                || message.contains("archive")
                || message.contains("header")
                || message.contains("tar"),
            "{message}"
        );
    }

    fn raw_tar_entry(path: &str, body: &[u8]) -> Vec<u8> {
        let mut header = [0u8; 512];
        header[..path.len()].copy_from_slice(path.as_bytes());
        header[100..108].copy_from_slice(b"0000600\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        let size = format!("{:011o}\0", body.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[136..148].copy_from_slice(b"00000000000\0");
        for byte in &mut header[148..156] {
            *byte = b' ';
        }
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let checksum: u32 = header.iter().map(|byte| *byte as u32).sum();
        let checksum = format!("{:06o}\0 ", checksum);
        header[148..156].copy_from_slice(checksum.as_bytes());
        let mut out = header.to_vec();
        out.extend_from_slice(body);
        let padding = (512 - (body.len() % 512)) % 512;
        out.extend(std::iter::repeat(0).take(padding));
        out.extend(std::iter::repeat(0).take(1024));
        out
    }

    #[test]
    #[serial]
    fn restore_job_success_status() {
        let env = test_env();
        let db = Database::memory().expect("db");
        let mut archive = create_config_backup_archive(&db).expect("backup");
        fs::write(&env.config_path, b"old").expect("overwrite");
        let started = start_config_restore_job(&db, std::mem::take(&mut archive)).expect("start");

        for _ in 0..50 {
            let event = get_restore_job_event(&started.job_id).expect("job");
            if event.state == "done" && event.step == "verify" {
                assert_eq!(
                    fs::read(&env.config_path).expect("config"),
                    b"config ccswitch 'main'\n\toption enabled '1'\n"
                );
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("restore job did not finish");
    }

    #[test]
    #[serial]
    fn restore_job_failure_reports_rollback() {
        let env = test_env();
        let db = Database::memory().expect("db");
        let archive = b"broken".to_vec();
        let started = start_config_restore_job(&db, archive).expect("start");
        for _ in 0..50 {
            let event = get_restore_job_event(&started.job_id).expect("job");
            if event.state == "failed" {
                assert_eq!(event.step, "validate");
                assert_eq!(event.rolled_back, Some(false));
                assert_eq!(
                    fs::read(&env.config_path).expect("config"),
                    b"config ccswitch 'main'\n\toption enabled '1'\n"
                );
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("restore job did not fail");
    }

    #[test]
    #[serial]
    fn restore_rejects_nested_auth_archive_paths() {
        let _env = test_env();
        let db = Database::memory().expect("db");
        let manifest = build_manifest(&db, &[]).expect("manifest");
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        {
            let mut tar = Builder::new(&mut encoder);
            append_bytes(
                &mut tar,
                MANIFEST_PATH,
                &serde_json::to_vec_pretty(&manifest).expect("manifest json"),
                0o644,
            )
            .expect("append manifest");
            append_bytes(
                &mut tar,
                CONFIG_ARCHIVE_PATH,
                b"config ccswitch 'main'\n\toption enabled '1'\n",
                0o600,
            )
            .expect("append config");
            append_bytes(
                &mut tar,
                "data/codex_auth/nested/provider.json",
                br#"{"access_token":"new"}"#,
                0o600,
            )
            .expect("append nested auth");
            tar.finish().expect("finish tar");
        }
        let archive = encoder.finish().expect("finish gzip");
        let error = validate_config_restore_archive(&db, &archive).expect_err("reject nested auth");
        assert!(error.to_string().contains("unsupported path"));
    }

    #[test]
    #[serial]
    fn whole_app_restore_removes_stale_managed_auth_files() {
        let env = test_env();
        let db = Database::memory().expect("db");
        let archive = create_config_backup_archive(&db).expect("backup");
        let auth_dir = crate::config::get_app_config_dir().join("codex_auth");
        fs::create_dir_all(&auth_dir).expect("auth dir");
        fs::write(auth_dir.join("stale.json"), br#"{"access_token":"stale"}"#).expect("stale auth");

        let started = start_config_restore_job(&db, archive).expect("start");
        for _ in 0..50 {
            let event = get_restore_job_event(&started.job_id).expect("job");
            if event.state == "done" && event.step == "verify" {
                assert_eq!(
                    fs::read(&env.config_path).expect("config"),
                    b"config ccswitch 'main'\n\toption enabled '1'\n"
                );
                assert!(
                    !auth_dir.exists(),
                    "restore without auth entries should clear managed auth dir"
                );
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("restore job did not finish");
    }

    #[test]
    #[serial]
    fn rollback_removes_new_managed_auth_directories() {
        let _env = test_env();
        let safety = capture_current_files().expect("safety");
        let auth_dir = crate::config::get_app_config_dir().join("claude_auth");
        fs::create_dir_all(&auth_dir).expect("auth dir");
        fs::write(
            auth_dir.join("created.json"),
            br#"{"access_token":"created"}"#,
        )
        .expect("created auth");

        rollback_files(&safety).expect("rollback");
        assert!(
            !auth_dir.exists(),
            "rollback should remove auth dirs created after the safety snapshot"
        );
    }
}
