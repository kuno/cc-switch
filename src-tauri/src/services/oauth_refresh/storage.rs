use crate::config::get_app_config_dir;
use crate::proxy::providers::codex_oauth_auth::{
    parse_chatgpt_account_id_from_jwt, parse_jwt_exp_from_jwt,
};
use anyhow::{anyhow, Context};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
#[cfg(unix)]
use std::fs::File;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};

use super::{RefreshedCredentials, StoredOAuthCredential};

pub(crate) const CODEX_AUTH_DIR: &str = "codex_auth";
pub(crate) const CLAUDE_AUTH_DIR: &str = "claude_auth";

pub(crate) fn validate_provider_id(provider_id: &str) -> anyhow::Result<()> {
    let trimmed = provider_id.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider id is required"));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        return Err(anyhow!("provider id must be relative"));
    }

    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(anyhow!("provider id contains invalid path components"));
    }

    Ok(())
}

pub(crate) fn provider_auth_dir(dir_name: &str) -> PathBuf {
    std::env::var("CC_SWITCH_DATA_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(get_app_config_dir)
        .join(dir_name)
}

pub(crate) fn provider_auth_path(dir_name: &str, provider_id: &str) -> anyhow::Result<PathBuf> {
    validate_provider_id(provider_id)?;
    Ok(provider_auth_dir(dir_name).join(format!("{provider_id}.json")))
}

pub(crate) fn persist_auth_bytes(target_path: &Path, raw_bytes: &[u8]) -> anyhow::Result<()> {
    let parent = target_path
        .parent()
        .ok_or_else(|| anyhow!("invalid auth path"))?;

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
        .persist(target_path)
        .map_err(|error| anyhow!(error.error))
        .with_context(|| format!("failed to persist {}", target_path.display()))?;
    best_effort_fsync_parent_dir(target_path);

    #[cfg(unix)]
    {
        fs::set_permissions(target_path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to set permissions on {}", target_path.display()))?;
    }

    Ok(())
}

pub(crate) fn load_codex_refresh_auth_for_provider(
    provider_id: &str,
) -> anyhow::Result<Option<StoredCodexRefreshAuth>> {
    let path = provider_auth_path(CODEX_AUTH_DIR, provider_id)?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };

    parse_stored_codex_auth(&raw).map(Some)
}

pub(crate) fn save_refreshed_codex_auth_for_provider(
    provider_id: &str,
    stored: &StoredCodexRefreshAuth,
    refreshed: &RefreshedCredentials,
) -> anyhow::Result<StoredCodexRefreshAuth> {
    let path = provider_auth_path(CODEX_AUTH_DIR, provider_id)?;
    let mut raw = stored.raw_json.clone();
    let tokens = raw
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| anyhow!("tokens object is required"))?;

    tokens.insert(
        "access_token".to_string(),
        Value::String(refreshed.access_token.clone()),
    );

    if let Some(new_refresh_token) = refreshed
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        tokens.insert(
            "refresh_token".to_string(),
            Value::String(new_refresh_token.to_string()),
        );
    }

    if let Some(id_token) = refreshed
        .extra
        .get("id_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        tokens.insert("id_token".to_string(), Value::String(id_token.to_string()));
    }

    if let Some(account_id) = refreshed
        .extra
        .get("account_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| parse_chatgpt_account_id_from_jwt(&refreshed.access_token))
    {
        tokens.insert("account_id".to_string(), Value::String(account_id));
    }

    let raw_bytes =
        serde_json::to_vec_pretty(&raw).context("failed to serialize refreshed Codex auth")?;
    persist_auth_bytes(&path, &raw_bytes)?;
    parse_stored_codex_auth(&raw_bytes)
}

pub(crate) fn load_claude_refresh_auth_for_provider(
    provider_id: &str,
) -> anyhow::Result<Option<StoredClaudeRefreshAuth>> {
    let path = provider_auth_path(CLAUDE_AUTH_DIR, provider_id)?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };

    parse_stored_claude_auth(&raw).map(Some)
}

pub(crate) fn save_refreshed_claude_auth_for_provider(
    provider_id: &str,
    stored: &StoredClaudeRefreshAuth,
    refreshed: &RefreshedCredentials,
) -> anyhow::Result<StoredClaudeRefreshAuth> {
    let path = provider_auth_path(CLAUDE_AUTH_DIR, provider_id)?;
    let mut raw = stored.raw_json.clone();
    let entry = raw
        .get_mut(&stored.entry_key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| anyhow!("Claude OAuth entry is required"))?;

    entry.insert(
        "accessToken".to_string(),
        Value::String(refreshed.access_token.clone()),
    );
    entry.insert(
        "expiresAt".to_string(),
        Value::from(refreshed.expires_at_ms),
    );

    if let Some(new_refresh_token) = refreshed
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        entry.insert(
            "refreshToken".to_string(),
            Value::String(new_refresh_token.to_string()),
        );
    }

    if let Some(extra) = refreshed.extra.as_object() {
        for (key, value) in extra {
            if !value.is_null() {
                entry.insert(key.clone(), value.clone());
            }
        }
    }

    let raw_bytes =
        serde_json::to_vec_pretty(&raw).context("failed to serialize refreshed Claude auth")?;
    persist_auth_bytes(&path, &raw_bytes)?;
    parse_stored_claude_auth(&raw_bytes)
}

#[derive(Debug, Clone)]
pub(crate) struct StoredCodexRefreshAuth {
    pub access_token: String,
    pub refresh_token: String,
    pub account_id: Option<String>,
    pub expires_at_ms: Option<i64>,
    raw_json: Value,
}

impl StoredOAuthCredential for StoredCodexRefreshAuth {
    fn access_token(&self) -> &str {
        &self.access_token
    }

    fn refresh_token(&self) -> Option<&str> {
        Some(&self.refresh_token)
    }

    fn expires_at_ms(&self) -> Option<i64> {
        self.expires_at_ms
    }
}

#[derive(Debug, Clone)]
pub(crate) struct StoredClaudeRefreshAuth {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub scopes: Vec<String>,
    pub subscription_type: Option<String>,
    pub rate_limit_tier: Option<String>,
    entry_key: String,
    raw_json: Value,
}

impl StoredOAuthCredential for StoredClaudeRefreshAuth {
    fn access_token(&self) -> &str {
        &self.access_token
    }

    fn refresh_token(&self) -> Option<&str> {
        self.refresh_token.as_deref()
    }

    fn expires_at_ms(&self) -> Option<i64> {
        self.expires_at_ms
    }
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
    #[serde(rename = "rateLimitTier")]
    rate_limit_tier: Option<String>,
}

fn parse_stored_codex_auth(raw_bytes: &[u8]) -> anyhow::Result<StoredCodexRefreshAuth> {
    let parsed: CodexAuthFile =
        serde_json::from_slice(raw_bytes).context("failed to parse auth.json")?;
    let raw_json: Value = serde_json::from_slice(raw_bytes).context("failed to parse auth.json")?;

    let access_token = parsed.tokens.access_token.trim().to_string();
    if access_token.is_empty() {
        return Err(anyhow!("tokens.access_token must be a non-empty string"));
    }

    let refresh_token = parsed.tokens.refresh_token.trim().to_string();
    if refresh_token.is_empty() {
        return Err(anyhow!("tokens.refresh_token must be a non-empty string"));
    }

    let account_id = parsed.tokens.account_id.clone().or_else(|| {
        parsed
            .tokens
            .id_token
            .as_deref()
            .and_then(parse_chatgpt_account_id_from_jwt)
    });
    let expires_at_ms = parse_jwt_exp_from_jwt(&access_token)
        .or_else(|| {
            parsed
                .tokens
                .id_token
                .as_deref()
                .and_then(parse_jwt_exp_from_jwt)
        })
        .map(|value| value.saturating_mul(1000));

    Ok(StoredCodexRefreshAuth {
        access_token,
        refresh_token,
        account_id,
        expires_at_ms,
        raw_json,
    })
}

fn parse_stored_claude_auth(raw_bytes: &[u8]) -> anyhow::Result<StoredClaudeRefreshAuth> {
    let raw_json: Value = serde_json::from_slice(raw_bytes).context("failed to parse auth.json")?;
    let (entry_key, entry_value) = raw_json
        .get("claudeAiOauth")
        .map(|value| ("claudeAiOauth".to_string(), value.clone()))
        .or_else(|| {
            raw_json
                .get("claude.ai_oauth")
                .map(|value| ("claude.ai_oauth".to_string(), value.clone()))
        })
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

    Ok(StoredClaudeRefreshAuth {
        access_token,
        refresh_token: entry
            .refresh_token
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        expires_at_ms: entry.expires_at,
        scopes: entry
            .scopes
            .into_iter()
            .map(|scope| scope.trim().to_string())
            .filter(|scope| !scope.is_empty())
            .collect(),
        subscription_type: entry
            .subscription_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        rate_limit_tier: entry
            .rate_limit_tier
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        entry_key,
        raw_json,
    })
}

#[cfg(unix)]
fn best_effort_fsync_parent_dir(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };

    match File::open(parent).and_then(|file| file.sync_all()) {
        Ok(()) => {}
        Err(error) => {
            log::warn!(
                "[OAuthRefresh] failed to fsync parent directory {} after auth save: {}",
                parent.display(),
                error
            );
        }
    }
}

#[cfg(not(unix))]
fn best_effort_fsync_parent_dir(_path: &Path) {}

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

    fn sample_codex_auth_json(exp_secs: i64) -> Vec<u8> {
        let access_token = format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(
                format!(
                    r#"{{"exp":{exp_secs},"https://api.openai.com/auth":{{"chatgpt_account_id":"acc-123"}}}}"#
                ),
            )
        );
        let id_token = format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(br#"{"chatgpt_account_id":"acc-123","exp":1893456000}"#,)
        );

        serde_json::json!({
            "tokens": {
                "access_token": access_token,
                "refresh_token": "refresh-token",
                "id_token": id_token,
                "account_id": "acc-explicit"
            },
            "meta": {
                "source": "uploaded"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_claude_auth_json(entry_key: &str, expires_at_ms: i64) -> Vec<u8> {
        serde_json::json!({
            entry_key: {
                "accessToken": "sk-ant-oat01-uploaded",
                "refreshToken": "refresh-token",
                "expiresAt": expires_at_ms,
                "scopes": ["user:profile"],
                "subscriptionType": "pro",
                "rawProfile": {
                    "emailAddress": "user@example.com"
                }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    #[serial]
    fn save_refreshed_codex_auth_updates_tokens_and_preserves_root_fields() {
        let _env = TestEnv::new();
        let path = provider_auth_path(CODEX_AUTH_DIR, "provider-1").expect("codex auth path");
        persist_auth_bytes(&path, &sample_codex_auth_json(1_700_000_000)).expect("write auth");

        let stored = load_codex_refresh_auth_for_provider("provider-1")
            .expect("load")
            .expect("auth");
        let refreshed = RefreshedCredentials {
            access_token: "header.new.sig".to_string(),
            expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
            refresh_token: Some("rotated-refresh".to_string()),
            extra: serde_json::json!({
                "id_token": format!(
                    "{}.{}.",
                    URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
                    URL_SAFE_NO_PAD.encode(
                        br#"{"chatgpt_account_id":"acc-999","exp":1893456000}"#,
                    )
                ),
                "account_id": "acc-999"
            }),
        };

        let updated = save_refreshed_codex_auth_for_provider("provider-1", &stored, &refreshed)
            .expect("save refreshed auth");
        let raw: Value =
            serde_json::from_slice(&fs::read(path).expect("read refreshed auth")).expect("json");

        assert_eq!(updated.access_token, "header.new.sig");
        assert_eq!(updated.refresh_token, "rotated-refresh");
        assert_eq!(updated.account_id.as_deref(), Some("acc-999"));
        assert_eq!(raw["meta"]["source"], Value::String("uploaded".to_string()));
    }

    #[test]
    #[serial]
    fn save_refreshed_claude_auth_preserves_entry_key_and_existing_profile() {
        let _env = TestEnv::new();
        let path = provider_auth_path(CLAUDE_AUTH_DIR, "provider-1").expect("claude auth path");
        persist_auth_bytes(
            &path,
            &sample_claude_auth_json("claude.ai_oauth", 1_700_000_000_000),
        )
        .expect("write auth");

        let stored = load_claude_refresh_auth_for_provider("provider-1")
            .expect("load")
            .expect("auth");
        let refreshed = RefreshedCredentials {
            access_token: "sk-ant-oat01-refreshed".to_string(),
            expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
            refresh_token: Some("rotated-refresh".to_string()),
            extra: serde_json::json!({
                "scopes": ["user:profile", "user:inference"],
                "subscriptionType": "max",
                "rateLimitTier": "priority"
            }),
        };

        let updated = save_refreshed_claude_auth_for_provider("provider-1", &stored, &refreshed)
            .expect("save refreshed auth");
        let raw: Value =
            serde_json::from_slice(&fs::read(path).expect("read refreshed auth")).expect("json");

        assert_eq!(updated.access_token, "sk-ant-oat01-refreshed");
        assert_eq!(updated.refresh_token.as_deref(), Some("rotated-refresh"));
        assert_eq!(updated.subscription_type.as_deref(), Some("max"));
        assert_eq!(updated.rate_limit_tier.as_deref(), Some("priority"));
        assert_eq!(
            raw["claude.ai_oauth"]["rawProfile"]["emailAddress"],
            Value::String("user@example.com".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn persist_auth_bytes_uses_private_permissions() {
        let _env = TestEnv::new();
        let path = provider_auth_path(CLAUDE_AUTH_DIR, "provider-1").expect("claude auth path");
        persist_auth_bytes(
            &path,
            &sample_claude_auth_json("claudeAiOauth", 1_700_000_000_000),
        )
        .expect("write auth");
        let metadata = fs::metadata(path).expect("stat auth file");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    }
}
