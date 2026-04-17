use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::Write;
use std::path::{Component, PathBuf};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use crate::config::get_app_config_dir;

use super::codex_oauth_auth::{
    parse_chatgpt_account_id_from_jwt, parse_jwt_exp_from_jwt,
};

const CODEX_AUTH_DIR: &str = "codex_auth";
const CODEX_AUTH_UPLOAD_LIMIT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TmpCodexAuth {
    pub access_token: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct SavedAuthSummary {
    pub account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    pub refresh_token_present: bool,
}

#[derive(Debug, Deserialize)]
struct CodexAuthFile {
    tokens: CodexAuthTokens,
}

#[derive(Debug, Deserialize)]
struct CodexAuthTokens {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    account_id: Option<String>,
}

fn codex_auth_dir() -> PathBuf {
    std::env::var("CC_SWITCH_DATA_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(get_app_config_dir)
        .join(CODEX_AUTH_DIR)
}

fn validate_provider_id(provider_id: &str) -> anyhow::Result<()> {
    let trimmed = provider_id.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider id is required"));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err(anyhow!("provider id must be relative"));
    }

    if path.components().any(|component| {
        !matches!(component, Component::Normal(_))
    }) {
        return Err(anyhow!("provider id contains invalid path components"));
    }

    Ok(())
}

fn codex_auth_path(provider_id: &str) -> anyhow::Result<PathBuf> {
    validate_provider_id(provider_id)?;
    Ok(codex_auth_dir().join(format!("{provider_id}.json")))
}

fn parse_codex_auth(raw_bytes: &[u8]) -> anyhow::Result<(TmpCodexAuth, SavedAuthSummary)> {
    let parsed: CodexAuthFile =
        serde_json::from_slice(raw_bytes).context("failed to parse auth.json")?;

    if parsed.tokens.access_token.trim().is_empty() {
        return Err(anyhow!("tokens.access_token must be a non-empty string"));
    }

    let account_id = parsed.tokens.account_id.clone().or_else(|| {
        parsed
            .tokens
            .id_token
            .as_deref()
            .and_then(parse_chatgpt_account_id_from_jwt)
    });

    let expires_at = parse_jwt_exp_from_jwt(&parsed.tokens.access_token).or_else(|| {
        parsed
            .tokens
            .id_token
            .as_deref()
            .and_then(parse_jwt_exp_from_jwt)
    });

    Ok((
        TmpCodexAuth {
            access_token: parsed.tokens.access_token,
            account_id: account_id.clone(),
        },
        SavedAuthSummary {
            account_id,
            expires_at,
            refresh_token_present: true,
        },
    ))
}

pub(crate) fn codex_auth_upload_limit_bytes() -> usize {
    CODEX_AUTH_UPLOAD_LIMIT_BYTES
}

#[cfg(unix)]
fn best_effort_fsync_parent_dir(path: &std::path::Path) {
    let Some(parent) = path.parent() else {
        return;
    };

    match File::open(parent).and_then(|file| file.sync_all()) {
        Ok(()) => {}
        Err(error) => {
            log::warn!(
                "[Codex] failed to fsync parent directory {} after auth save: {}",
                parent.display(),
                error
            );
        }
    }
}

#[cfg(not(unix))]
fn best_effort_fsync_parent_dir(_path: &std::path::Path) {}

pub(crate) fn save_codex_auth_for_provider(
    provider_id: &str,
    raw_bytes: &[u8],
) -> anyhow::Result<SavedAuthSummary> {
    let (_, summary) = parse_codex_auth(raw_bytes)?;
    let target_path = codex_auth_path(provider_id)?;
    let parent = target_path
        .parent()
        .ok_or_else(|| anyhow!("invalid codex auth path"))?;

    fs::create_dir_all(parent)
        .with_context(|| format!("failed to create {}", parent.display()))?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .with_context(|| format!("failed to create temp file in {}", parent.display()))?;
    #[cfg(unix)]
    {
        fs::set_permissions(temp_file.path(), fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to set permissions on {}", temp_file.path().display()))?;
    }
    temp_file
        .write_all(raw_bytes)
        .with_context(|| format!("failed to write {}", target_path.display()))?;
    temp_file
        .as_file()
        .sync_all()
        .with_context(|| format!("failed to sync {}", temp_file.path().display()))?;
    temp_file
        .flush()
        .with_context(|| format!("failed to flush {}", target_path.display()))?;
    temp_file
        .persist(&target_path)
        .map_err(|error| anyhow!(error.error))
        .with_context(|| format!("failed to persist {}", target_path.display()))?;
    best_effort_fsync_parent_dir(&target_path);

    #[cfg(unix)]
    {
        fs::set_permissions(&target_path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to set permissions on {}", target_path.display()))?;
    }

    Ok(summary)
}

pub(crate) fn load_codex_auth_for_provider(provider_id: &str) -> Option<TmpCodexAuth> {
    let path = match codex_auth_path(provider_id) {
        Ok(path) => path,
        Err(err) => {
            log::warn!("[Codex] invalid provider id `{provider_id}` for auth lookup: {err}");
            return None;
        }
    };

    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            log::warn!("[Codex] failed to read {}: {}", path.display(), err);
            return None;
        }
    };

    match parse_codex_auth(&raw) {
        Ok((auth, _)) => Some(auth),
        Err(err) => {
            log::warn!("[Codex] {} exists but is invalid: {}", path.display(), err);
            None
        }
    }
}

pub(crate) fn load_codex_auth_summary_for_provider(
    provider_id: &str,
) -> anyhow::Result<Option<SavedAuthSummary>> {
    let path = codex_auth_path(provider_id)?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err).with_context(|| format!("failed to read {}", path.display())),
    };

    let (_, summary) = parse_codex_auth(&raw)?;
    Ok(Some(summary))
}

pub(crate) fn delete_codex_auth_for_provider(provider_id: &str) -> anyhow::Result<()> {
    let path = codex_auth_path(provider_id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err).with_context(|| format!("failed to remove {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serial_test::serial;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        _tmp: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
        original_data_dir: Option<String>,
    }

    impl TestEnv {
        fn new() -> Self {
            let guard = env_lock()
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let tmp = TempDir::new().expect("create temp dir");
            let home = tmp.path().join("home");
            let data = tmp.path().join("data");

            fs::create_dir_all(&home).expect("create home");
            fs::create_dir_all(&data).expect("create data");

            let original_home = std::env::var("HOME").ok();
            let original_userprofile = std::env::var("USERPROFILE").ok();
            let original_test_home = std::env::var("CC_SWITCH_TEST_HOME").ok();
            let original_data_dir = std::env::var("CC_SWITCH_DATA_DIR").ok();

            std::env::set_var("HOME", &home);
            std::env::set_var("USERPROFILE", &home);
            std::env::set_var("CC_SWITCH_TEST_HOME", &home);
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);

            Self {
                _guard: guard,
                _tmp: tmp,
                original_home,
                original_userprofile,
                original_test_home,
                original_data_dir,
            }
        }

        fn auth_path(&self, provider_id: &str) -> PathBuf {
            codex_auth_dir().join(format!("{provider_id}.json"))
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            match &self.original_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match &self.original_userprofile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            match &self.original_test_home {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            match &self.original_data_dir {
                Some(value) => std::env::set_var("CC_SWITCH_DATA_DIR", value),
                None => std::env::remove_var("CC_SWITCH_DATA_DIR"),
            }
        }
    }

    fn sample_auth_json() -> Vec<u8> {
        let access_token = format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(
                br#"{"exp":1893456000,"https://api.openai.com/auth":{"chatgpt_account_id":"acc-123"}}"#,
            )
        );

        serde_json::json!({
            "tokens": {
                "access_token": access_token,
                "refresh_token": "refresh-token",
                "account_id": "acc-explicit"
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    #[serial]
    fn save_and_load_codex_auth_round_trip() {
        let env = TestEnv::new();
        let summary =
            save_codex_auth_for_provider("provider-1", &sample_auth_json()).expect("save auth");
        assert_eq!(summary.account_id.as_deref(), Some("acc-explicit"));
        assert_eq!(summary.expires_at, Some(1_893_456_000));
        assert!(summary.refresh_token_present);

        let auth = load_codex_auth_for_provider("provider-1").expect("load auth");
        assert_eq!(auth.account_id.as_deref(), Some("acc-explicit"));
        assert!(!auth.access_token.is_empty());

        let stored_summary =
            load_codex_auth_summary_for_provider("provider-1").expect("load summary");
        assert_eq!(stored_summary, Some(summary));

        delete_codex_auth_for_provider("provider-1").expect("delete auth");
        assert!(load_codex_auth_for_provider("provider-1").is_none());
        assert!(!env.auth_path("provider-1").exists());
    }

    #[test]
    #[serial]
    fn invalid_json_is_rejected() {
        let _env = TestEnv::new();
        let error = save_codex_auth_for_provider("provider-1", br#"{"tokens":"broken"}"#)
            .expect_err("invalid JSON should fail");
        assert!(error.to_string().contains("failed to parse auth.json"));
    }

    #[test]
    #[serial]
    fn missing_access_token_is_rejected() {
        let _env = TestEnv::new();
        let payload = serde_json::json!({
            "tokens": {
                "access_token": "   ",
                "refresh_token": "refresh-token"
            }
        })
        .to_string();
        let error = save_codex_auth_for_provider("provider-1", payload.as_bytes())
            .expect_err("missing access token should fail");
        assert!(
            error
                .to_string()
                .contains("tokens.access_token must be a non-empty string")
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn saved_file_uses_private_permissions() {
        let env = TestEnv::new();
        save_codex_auth_for_provider("provider-1", &sample_auth_json()).expect("save auth");
        let metadata = fs::metadata(env.auth_path("provider-1")).expect("stat auth file");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    }
}
