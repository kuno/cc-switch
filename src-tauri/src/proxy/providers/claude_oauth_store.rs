use crate::config::get_app_config_dir;
use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use super::codex_oauth_store::validate_provider_id;

const CLAUDE_AUTH_DIR: &str = "claude_auth";
const CLAUDE_AUTH_UPLOAD_LIMIT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TmpClaudeAuth {
    pub access_token: String,
    pub expires_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct ClaudeSavedAuthSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<i64>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub refresh_token_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClaudeAuthEntry {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<i64>,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(rename = "subscriptionType")]
    subscription_type: Option<String>,
}

fn claude_auth_dir() -> PathBuf {
    std::env::var("CC_SWITCH_DATA_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(get_app_config_dir)
        .join(CLAUDE_AUTH_DIR)
}

fn claude_auth_path(provider_id: &str) -> anyhow::Result<PathBuf> {
    validate_provider_id(provider_id)?;
    Ok(claude_auth_dir().join(format!("{provider_id}.json")))
}

fn parse_claude_auth(raw_bytes: &[u8]) -> anyhow::Result<(TmpClaudeAuth, ClaudeSavedAuthSummary)> {
    if raw_bytes.len() > CLAUDE_AUTH_UPLOAD_LIMIT_BYTES {
        return Err(anyhow!(
            "auth.json exceeds {} KiB limit",
            CLAUDE_AUTH_UPLOAD_LIMIT_BYTES / 1024
        ));
    }

    let parsed: serde_json::Value =
        serde_json::from_slice(raw_bytes).context("failed to parse auth.json")?;
    let entry_value = parsed
        .get("claudeAiOauth")
        .or_else(|| parsed.get("claude.ai_oauth"))
        .cloned()
        .ok_or_else(|| anyhow!("claudeAiOauth or claude.ai_oauth entry is required"))?;
    let entry: ClaudeAuthEntry =
        serde_json::from_value(entry_value).context("failed to parse Claude OAuth entry")?;

    let access_token = entry
        .access_token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Claude OAuth accessToken must be a non-empty string"))?;

    if let Some(expires_at_ms) = entry.expires_at {
        if !(1_000_000_000_000..=9_999_999_999_999).contains(&expires_at_ms) {
            return Err(anyhow!(
                "Claude OAuth expiresAt must be a 13-digit unix-milliseconds integer"
            ));
        }
    }

    let scopes = entry
        .scopes
        .into_iter()
        .map(|scope| scope.trim().to_string())
        .filter(|scope| !scope.is_empty())
        .collect::<Vec<_>>();
    let refresh_token_present = entry
        .refresh_token
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let subscription_type = entry
        .subscription_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Ok((
        TmpClaudeAuth {
            access_token,
            expires_at_ms: entry.expires_at,
        },
        ClaudeSavedAuthSummary {
            expires_at_ms: entry.expires_at,
            scopes,
            refresh_token_present,
            subscription_type,
        },
    ))
}

pub(crate) fn claude_auth_upload_limit_bytes() -> usize {
    CLAUDE_AUTH_UPLOAD_LIMIT_BYTES
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
                "[Claude] failed to fsync parent directory {} after auth save: {}",
                parent.display(),
                error
            );
        }
    }
}

#[cfg(not(unix))]
fn best_effort_fsync_parent_dir(_path: &std::path::Path) {}

pub(crate) fn save_claude_auth_for_provider(
    provider_id: &str,
    raw_bytes: &[u8],
) -> anyhow::Result<ClaudeSavedAuthSummary> {
    let target_path = claude_auth_path(provider_id)?;
    let (_, summary) = parse_claude_auth(raw_bytes)?;
    let parent = target_path
        .parent()
        .ok_or_else(|| anyhow!("invalid claude auth path"))?;

    fs::create_dir_all(parent).with_context(|| format!("failed to create {}", parent.display()))?;

    let mut temp_file = tempfile::NamedTempFile::new_in(parent)
        .with_context(|| format!("failed to create temp file in {}", parent.display()))?;
    #[cfg(unix)]
    {
        fs::set_permissions(temp_file.path(), fs::Permissions::from_mode(0o600)).with_context(
            || {
                format!(
                    "failed to set permissions on {}",
                    temp_file.path().display()
                )
            },
        )?;
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

pub(crate) fn load_claude_auth_for_provider(provider_id: &str) -> Option<TmpClaudeAuth> {
    let path = match claude_auth_path(provider_id) {
        Ok(path) => path,
        Err(error) => {
            log::warn!("[Claude] invalid provider id `{provider_id}` for auth lookup: {error}");
            return None;
        }
    };

    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!("[Claude] failed to read {}: {}", path.display(), error);
            return None;
        }
    };

    match parse_claude_auth(&raw) {
        Ok((auth, _)) => Some(auth),
        Err(error) => {
            log::warn!(
                "[Claude] {} exists but is invalid: {}",
                path.display(),
                error
            );
            None
        }
    }
}

pub(crate) fn load_claude_auth_summary_for_provider(
    provider_id: &str,
) -> anyhow::Result<Option<ClaudeSavedAuthSummary>> {
    let path = claude_auth_path(provider_id)?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };

    let (_, summary) = parse_claude_auth(&raw)?;
    Ok(Some(summary))
}

pub(crate) fn delete_claude_auth_for_provider(provider_id: &str) -> anyhow::Result<()> {
    let path = claude_auth_path(provider_id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            claude_auth_dir().join(format!("{provider_id}.json"))
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

    fn sample_auth_json(root_key: &str) -> Vec<u8> {
        serde_json::json!({
            root_key: {
                "accessToken": "sk-ant-oat01-example",
                "refreshToken": "refresh-token",
                "expiresAt": 1_738_000_000_123i64,
                "scopes": ["user:profile", "user:inference"],
                "subscriptionType": "pro"
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    #[serial]
    fn save_and_load_claude_auth_round_trip() {
        let env = TestEnv::new();
        let summary =
            save_claude_auth_for_provider("provider-1", &sample_auth_json("claudeAiOauth"))
                .expect("save auth");
        assert_eq!(summary.expires_at_ms, Some(1_738_000_000_123));
        assert_eq!(
            summary.scopes,
            vec!["user:profile".to_string(), "user:inference".to_string()]
        );
        assert!(summary.refresh_token_present);
        assert_eq!(summary.subscription_type.as_deref(), Some("pro"));

        let auth = load_claude_auth_for_provider("provider-1").expect("load auth");
        assert_eq!(auth.access_token, "sk-ant-oat01-example");
        assert_eq!(auth.expires_at_ms, Some(1_738_000_000_123));

        let stored_summary =
            load_claude_auth_summary_for_provider("provider-1").expect("load summary");
        assert_eq!(stored_summary, Some(summary));

        delete_claude_auth_for_provider("provider-1").expect("delete auth");
        assert!(load_claude_auth_for_provider("provider-1").is_none());
        assert!(!env.auth_path("provider-1").exists());
    }

    #[test]
    #[serial]
    fn alternate_root_key_is_accepted() {
        let _env = TestEnv::new();
        let summary =
            save_claude_auth_for_provider("provider-1", &sample_auth_json("claude.ai_oauth"))
                .expect("save auth");
        assert_eq!(summary.expires_at_ms, Some(1_738_000_000_123));
    }

    #[test]
    #[serial]
    fn invalid_json_is_rejected() {
        let _env = TestEnv::new();
        let error = save_claude_auth_for_provider("provider-1", br#"{"claudeAiOauth":"broken"}"#)
            .expect_err("invalid JSON should fail");
        assert!(error
            .to_string()
            .contains("failed to parse Claude OAuth entry"));
    }

    #[test]
    #[serial]
    fn missing_access_token_is_rejected() {
        let _env = TestEnv::new();
        let payload = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "   ",
                "expiresAt": 1_738_000_000_123i64
            }
        })
        .to_string();
        let error = save_claude_auth_for_provider("provider-1", payload.as_bytes())
            .expect_err("missing access token should fail");
        assert!(error
            .to_string()
            .contains("Claude OAuth accessToken must be a non-empty string"));
    }

    #[test]
    #[serial]
    fn invalid_expires_at_is_rejected() {
        let _env = TestEnv::new();
        let payload = serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-example",
                "expiresAt": 1_738_000_000i64
            }
        })
        .to_string();
        let error = save_claude_auth_for_provider("provider-1", payload.as_bytes())
            .expect_err("invalid expiresAt should fail");
        assert!(error
            .to_string()
            .contains("Claude OAuth expiresAt must be a 13-digit unix-milliseconds integer"));
    }

    #[test]
    #[serial]
    fn oversized_payload_is_rejected() {
        let _env = TestEnv::new();
        let error = save_claude_auth_for_provider(
            "provider-1",
            &vec![b'x'; claude_auth_upload_limit_bytes() + 1],
        )
        .expect_err("oversized payload should fail");
        assert!(error.to_string().contains("64 KiB limit"));
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn saved_file_uses_private_permissions() {
        let env = TestEnv::new();
        save_claude_auth_for_provider("provider-1", &sample_auth_json("claudeAiOauth"))
            .expect("save auth");
        let metadata = fs::metadata(env.auth_path("provider-1")).expect("stat auth file");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    }
}
