use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::Provider;
use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use uuid::Uuid;

const CLAUDE_APP_TYPE: &str = "claude";
const DEFAULT_PROVIDER_ID: &str = "openwrt-claude";
const PROVIDER_ID_PREFIX: &str = "openwrt-claude-";
const DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";
const MODEL_KEYS_TO_CLEAR: [&str; 6] = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderPayload {
    #[serde(default)]
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub token_field: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderView {
    pub configured: bool,
    pub active: bool,
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub token_field: String,
    pub token_configured: bool,
    pub token_masked: String,
    pub model: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderListView {
    pub active_provider_id: Option<String>,
    pub providers: Vec<ClaudeProviderView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderDeleteView {
    pub deleted_provider_id: String,
    pub active_provider_id: Option<String>,
    pub providers_remaining: usize,
}

impl Default for ClaudeProviderView {
    fn default() -> Self {
        Self {
            configured: false,
            active: false,
            provider_id: None,
            name: String::new(),
            base_url: String::new(),
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token_configured: false,
            token_masked: String::new(),
            model: String::new(),
            notes: String::new(),
        }
    }
}

pub fn list_claude_providers(db: &Database) -> anyhow::Result<ClaudeProviderListView> {
    let active_provider_id = resolve_active_provider_id(db)?;
    let providers = db
        .get_all_providers(CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to list Claude providers: {e}"))?;

    Ok(provider_list_to_view(
        providers,
        active_provider_id.as_deref(),
    ))
}

pub fn get_claude_provider(db: &Database, provider_id: &str) -> anyhow::Result<ClaudeProviderView> {
    let provider = load_provider(db, provider_id)?;
    let active_provider_id = resolve_active_provider_id(db)?;
    Ok(provider_to_view(&provider, active_provider_id.as_deref()))
}

pub fn get_active_claude_provider(db: &Database) -> anyhow::Result<ClaudeProviderView> {
    let active_provider_id = resolve_active_provider_id(db)?;
    Ok(active_provider_id
        .as_deref()
        .map(|provider_id| load_provider(db, provider_id))
        .transpose()?
        .as_ref()
        .map(|provider| provider_to_view(provider, active_provider_id.as_deref()))
        .unwrap_or_default())
}

pub fn upsert_claude_provider(
    db: &Database,
    requested_provider_id: Option<&str>,
) -> anyhow::Result<ClaudeProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_claude_provider_with_payload(db, requested_provider_id, payload)
}

pub fn upsert_active_claude_provider(db: &Database) -> anyhow::Result<ClaudeProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_active_claude_provider_with_payload(db, payload)
}

pub fn activate_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<ClaudeProviderView> {
    let provider_id = normalize_provider_id(provider_id)?;
    let provider = load_provider(db, &provider_id)?;
    set_active_provider_id(db, Some(&provider_id))?;
    Ok(provider_to_view(&provider, Some(&provider_id)))
}

pub fn delete_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<ClaudeProviderDeleteView> {
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, &normalized_provider_id)?;

    let effective_current = resolve_active_provider_id(db)?;
    let db_current = db
        .get_current_provider(CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to read database current Claude provider: {e}"))?;

    db.delete_provider(CLAUDE_APP_TYPE, &normalized_provider_id)
        .map_err(|e| anyhow!("failed to delete Claude provider {normalized_provider_id}: {e}"))?;

    let remaining = db
        .get_all_providers(CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to reload Claude providers after delete: {e}"))?;
    let next_current = select_current_provider_after_delete(
        &remaining,
        &normalized_provider_id,
        effective_current.as_deref(),
        db_current.as_deref(),
    );
    set_active_provider_id(db, next_current.as_deref())?;

    Ok(ClaudeProviderDeleteView {
        deleted_provider_id: normalized_provider_id,
        active_provider_id: next_current,
        providers_remaining: remaining.len(),
    })
}

fn upsert_claude_provider_with_payload(
    db: &Database,
    requested_provider_id: Option<&str>,
    payload: ClaudeProviderPayload,
) -> anyhow::Result<ClaudeProviderView> {
    let payload_provider_id = normalize_requested_provider_id(payload.provider_id.as_deref())?;
    let requested_provider_id = normalize_requested_provider_id(requested_provider_id)?;
    ensure_matching_provider_ids(
        requested_provider_id.as_deref(),
        payload_provider_id.as_deref(),
    )?;

    let target_provider_id = requested_provider_id
        .or(payload_provider_id)
        .unwrap_or_else(generate_provider_id);
    let existing = db
        .get_provider_by_id(&target_provider_id, CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to load Claude provider {target_provider_id}: {e}"))?;
    let provider = build_provider(existing, target_provider_id.clone(), payload)?;

    db.save_provider(CLAUDE_APP_TYPE, &provider)
        .map_err(|e| anyhow!("failed to save Claude provider: {e}"))?;

    let active_provider_id = resolve_active_provider_id(db)?;
    Ok(provider_to_view(&provider, active_provider_id.as_deref()))
}

fn upsert_active_claude_provider_with_payload(
    db: &Database,
    payload: ClaudeProviderPayload,
) -> anyhow::Result<ClaudeProviderView> {
    let active_provider_id = resolve_active_provider_id(db)?;
    let payload_provider_id = normalize_requested_provider_id(payload.provider_id.as_deref())?;

    if let (Some(active_provider_id), Some(payload_provider_id)) = (
        active_provider_id.as_deref(),
        payload_provider_id.as_deref(),
    ) {
        if active_provider_id != payload_provider_id {
            return Err(anyhow!(
                "upsert-active-provider targets the current active provider; use upsert-provider to edit a different provider"
            ));
        }
    }

    let target_provider_id = active_provider_id
        .or(payload_provider_id)
        .unwrap_or_else(|| DEFAULT_PROVIDER_ID.to_string());
    let existing = db
        .get_provider_by_id(&target_provider_id, CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to load Claude provider {target_provider_id}: {e}"))?;
    let provider = build_provider(existing, target_provider_id.clone(), payload)?;

    db.save_provider(CLAUDE_APP_TYPE, &provider)
        .map_err(|e| anyhow!("failed to save Claude provider: {e}"))?;
    set_active_provider_id(db, Some(&provider.id))?;

    Ok(provider_to_view(&provider, Some(&provider.id)))
}

fn read_payload_from_stdin() -> anyhow::Result<ClaudeProviderPayload> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read provider payload from stdin")?;

    if input.trim().is_empty() {
        return Err(anyhow!("provider payload is required on stdin"));
    }

    serde_json::from_str(&input).context("failed to parse provider payload JSON")
}

fn load_provider(db: &Database, provider_id: &str) -> anyhow::Result<Provider> {
    let provider_id = normalize_provider_id(provider_id)?;
    db.get_provider_by_id(&provider_id, CLAUDE_APP_TYPE)
        .map_err(|e| anyhow!("failed to load Claude provider {provider_id}: {e}"))?
        .ok_or_else(|| anyhow!("Claude provider {provider_id} does not exist"))
}

fn resolve_active_provider_id(db: &Database) -> anyhow::Result<Option<String>> {
    crate::settings::get_effective_current_provider(db, &AppType::Claude)
        .map_err(|e| anyhow!("failed to resolve active Claude provider: {e}"))
}

fn set_active_provider_id(db: &Database, provider_id: Option<&str>) -> anyhow::Result<()> {
    match provider_id {
        Some(provider_id) => {
            let provider_id = normalize_provider_id(provider_id)?;
            db.set_current_provider(CLAUDE_APP_TYPE, &provider_id)
                .map_err(|e| anyhow!("failed to set active Claude provider: {e}"))?;
            crate::settings::set_current_provider(&AppType::Claude, Some(&provider_id))
                .map_err(|e| anyhow!("failed to persist local Claude provider selection: {e}"))?;
        }
        None => {
            crate::settings::set_current_provider(&AppType::Claude, None)
                .map_err(|e| anyhow!("failed to clear local Claude provider selection: {e}"))?;
        }
    }

    Ok(())
}

fn select_current_provider_after_delete(
    providers: &indexmap::IndexMap<String, Provider>,
    deleted_provider_id: &str,
    effective_current: Option<&str>,
    db_current: Option<&str>,
) -> Option<String> {
    let deleted_was_current = [effective_current, db_current]
        .into_iter()
        .flatten()
        .any(|candidate| candidate == deleted_provider_id);

    for candidate in [effective_current, db_current] {
        if let Some(candidate) = candidate
            .filter(|candidate| *candidate != deleted_provider_id)
            .and_then(|candidate| {
                providers
                    .contains_key(candidate)
                    .then(|| candidate.to_string())
            })
        {
            return Some(candidate);
        }
    }

    if deleted_was_current {
        providers.keys().next().cloned()
    } else {
        None
    }
}

fn provider_list_to_view(
    providers: indexmap::IndexMap<String, Provider>,
    active_provider_id: Option<&str>,
) -> ClaudeProviderListView {
    let providers = providers
        .values()
        .map(|provider| provider_to_view(provider, active_provider_id))
        .collect();

    ClaudeProviderListView {
        active_provider_id: active_provider_id.map(str::to_string),
        providers,
    }
}

fn build_provider(
    existing: Option<Provider>,
    provider_id: String,
    payload: ClaudeProviderPayload,
) -> anyhow::Result<Provider> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(anyhow!("provider name is required"));
    }

    let base_url = payload.base_url.trim();
    if base_url.is_empty() {
        return Err(anyhow!("base URL is required"));
    }

    let token_field = normalize_token_field(&payload.token_field)?;
    let existing_token = existing
        .as_ref()
        .and_then(extract_token)
        .map(|(_, token)| token.to_string());
    let token_value = match payload.token.trim() {
        "" => existing_token.ok_or_else(|| anyhow!("token is required for the first save"))?,
        token => token.to_string(),
    };

    let mut provider = existing
        .unwrap_or_else(|| Provider::with_id(provider_id, name.to_string(), json!({}), None));

    provider.name = name.to_string();
    provider.notes = normalize_optional(payload.notes);
    if provider.created_at.is_none() {
        provider.created_at = Some(chrono::Utc::now().timestamp_millis());
    }
    if provider.icon.is_none() {
        provider.icon = Some("anthropic".to_string());
    }
    if provider.icon_color.is_none() {
        provider.icon_color = Some("#D4915D".to_string());
    }
    provider.in_failover_queue = false;

    if !provider.settings_config.is_object() {
        provider.settings_config = json!({});
    }

    let root = provider
        .settings_config
        .as_object_mut()
        .ok_or_else(|| anyhow!("Claude provider settings must be a JSON object"))?;
    let env_value = root.entry("env".to_string()).or_insert_with(|| json!({}));
    if !env_value.is_object() {
        *env_value = json!({});
    }

    let env = env_value
        .as_object_mut()
        .ok_or_else(|| anyhow!("Claude provider env must be a JSON object"))?;

    env.insert("ANTHROPIC_BASE_URL".to_string(), json!(base_url));
    env.remove(DEFAULT_TOKEN_FIELD);
    env.remove(ALT_TOKEN_FIELD);
    env.remove("OPENROUTER_API_KEY");
    env.remove("OPENAI_API_KEY");
    env.insert(token_field.to_string(), json!(token_value));

    for key in MODEL_KEYS_TO_CLEAR {
        env.remove(key);
    }
    if let Some(model) = normalize_optional(payload.model) {
        env.insert("ANTHROPIC_MODEL".to_string(), json!(model));
    }

    Ok(provider)
}

fn ensure_matching_provider_ids(
    requested_provider_id: Option<&str>,
    payload_provider_id: Option<&str>,
) -> anyhow::Result<()> {
    if let (Some(requested_provider_id), Some(payload_provider_id)) =
        (requested_provider_id, payload_provider_id)
    {
        if requested_provider_id != payload_provider_id {
            return Err(anyhow!(
                "providerId in payload does not match the provider ID in the command"
            ));
        }
    }

    Ok(())
}

fn normalize_requested_provider_id(value: Option<&str>) -> anyhow::Result<Option<String>> {
    value.map(normalize_provider_id).transpose()
}

fn normalize_provider_id(value: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider ID is required"));
    }

    Ok(trimmed.to_string())
}

fn generate_provider_id() -> String {
    format!("{PROVIDER_ID_PREFIX}{}", Uuid::new_v4().simple())
}

fn normalize_token_field(value: &str) -> anyhow::Result<&'static str> {
    match value.trim() {
        "" | DEFAULT_TOKEN_FIELD => Ok(DEFAULT_TOKEN_FIELD),
        ALT_TOKEN_FIELD => Ok(ALT_TOKEN_FIELD),
        other => Err(anyhow!("unsupported token field: {other}")),
    }
}

fn normalize_optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn provider_to_view(provider: &Provider, active_provider_id: Option<&str>) -> ClaudeProviderView {
    let env = provider
        .settings_config
        .get("env")
        .and_then(Value::as_object);
    let (token_field, token_value) = env
        .and_then(extract_token_from_env)
        .unwrap_or((DEFAULT_TOKEN_FIELD, ""));

    ClaudeProviderView {
        configured: true,
        active: active_provider_id == Some(provider.id.as_str()),
        provider_id: Some(provider.id.clone()),
        name: provider.name.clone(),
        base_url: env
            .and_then(|map| map.get("ANTHROPIC_BASE_URL"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        token_field: token_field.to_string(),
        token_configured: !token_value.is_empty(),
        token_masked: mask_secret(token_value),
        model: env
            .and_then(|map| map.get("ANTHROPIC_MODEL"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        notes: provider.notes.clone().unwrap_or_default(),
    }
}

fn extract_token(provider: &Provider) -> Option<(&'static str, &str)> {
    provider
        .settings_config
        .get("env")
        .and_then(Value::as_object)
        .and_then(extract_token_from_env)
}

fn extract_token_from_env(env: &serde_json::Map<String, Value>) -> Option<(&'static str, &str)> {
    for key in [DEFAULT_TOKEN_FIELD, ALT_TOKEN_FIELD] {
        if let Some(value) = env
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((key, value));
        }
    }

    if env.contains_key(DEFAULT_TOKEN_FIELD) {
        return Some((DEFAULT_TOKEN_FIELD, ""));
    }
    if env.contains_key(ALT_TOKEN_FIELD) {
        return Some((ALT_TOKEN_FIELD, ""));
    }

    None
}

fn mask_secret(secret: &str) -> String {
    if secret.is_empty() {
        return String::new();
    }

    let suffix: String = secret
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("********{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    struct TestEnv {
        _guard: std::sync::MutexGuard<'static, ()>,
        tmp: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
        original_test_home: Option<String>,
        original_data_dir: Option<String>,
    }

    impl TestEnv {
        fn new() -> Self {
            let guard = crate::settings::test_env_lock()
                .lock()
                .expect("lock test env");
            let tmp = TempDir::new().expect("create temp dir");
            let home = tmp.path().join("home");
            let data = tmp.path().join("data");

            std::fs::create_dir_all(home.join(".cc-switch")).expect("create home dir");
            std::fs::create_dir_all(&data).expect("create data dir");

            let original_home = std::env::var("HOME").ok();
            let original_userprofile = std::env::var("USERPROFILE").ok();
            let original_test_home = std::env::var("CC_SWITCH_TEST_HOME").ok();
            let original_data_dir = std::env::var("CC_SWITCH_DATA_DIR").ok();

            std::env::set_var("HOME", &home);
            std::env::set_var("USERPROFILE", &home);
            std::env::set_var("CC_SWITCH_TEST_HOME", &home);
            std::env::set_var("CC_SWITCH_DATA_DIR", &data);
            crate::settings::reload_settings().expect("reload settings");

            Self {
                _guard: guard,
                tmp,
                original_home,
                original_userprofile,
                original_test_home,
                original_data_dir,
            }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            if let Some(value) = &self.original_home {
                std::env::set_var("HOME", value);
            } else {
                std::env::remove_var("HOME");
            }

            if let Some(value) = &self.original_userprofile {
                std::env::set_var("USERPROFILE", value);
            } else {
                std::env::remove_var("USERPROFILE");
            }

            if let Some(value) = &self.original_test_home {
                std::env::set_var("CC_SWITCH_TEST_HOME", value);
            } else {
                std::env::remove_var("CC_SWITCH_TEST_HOME");
            }

            if let Some(value) = &self.original_data_dir {
                std::env::set_var("CC_SWITCH_DATA_DIR", value);
            } else {
                std::env::remove_var("CC_SWITCH_DATA_DIR");
            }

            crate::settings::reload_settings().expect("reload settings after restore");
            let _ = &self.tmp;
        }
    }

    fn sample_payload(name: &str, token: &str) -> ClaudeProviderPayload {
        ClaudeProviderPayload {
            provider_id: None,
            name: name.to_string(),
            base_url: "https://example.test".to_string(),
            token_field: DEFAULT_TOKEN_FIELD.to_string(),
            token: token.to_string(),
            model: "claude-sonnet".to_string(),
            notes: "notes".to_string(),
        }
    }

    #[test]
    #[serial]
    fn upsert_provider_masks_reads_and_preserves_blank_token() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let created = upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-1234"),
        )
        .expect("create provider");
        assert_eq!(created.provider_id.as_deref(), Some("provider-a"));
        assert!(created.token_configured);
        assert_eq!(created.token_masked, "********1234");
        assert!(!created.active);

        let mut update = sample_payload("A updated", "");
        update.provider_id = Some("provider-a".to_string());
        update.base_url = "https://updated.example.test".to_string();
        update.model = "claude-opus".to_string();
        let updated =
            upsert_claude_provider_with_payload(&db, None, update).expect("update provider");

        assert_eq!(updated.provider_id.as_deref(), Some("provider-a"));
        assert_eq!(updated.base_url, "https://updated.example.test");
        assert_eq!(updated.model, "claude-opus");
        assert_eq!(updated.token_masked, "********1234");
        assert!(updated.token_configured);

        let stored = db
            .get_provider_by_id("provider-a", CLAUDE_APP_TYPE)
            .expect("load stored provider")
            .expect("stored provider");
        let (_, token) = extract_token(&stored).expect("stored token");
        assert_eq!(token, "secret-1234");
    }

    #[test]
    #[serial]
    fn activate_provider_updates_settings_and_database_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        let activated = activate_claude_provider(&db, "provider-b").expect("activate provider");
        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("provider-b"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn activate_provider_trims_whitespace_padded_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");

        let activated =
            activate_claude_provider(&db, "  provider-a  ").expect("activate trimmed provider");
        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("provider-a"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-a")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-a")
        );
    }

    #[test]
    #[serial]
    fn delete_active_provider_promotes_remaining_provider() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");

        let deleted = delete_claude_provider(&db, "provider-a").expect("delete provider a");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id.as_deref(), Some("provider-b"));
        assert_eq!(deleted.providers_remaining, 1);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn delete_last_active_provider_clears_current_selection() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_active_claude_provider_with_payload(&db, sample_payload("Only", "secret-only"))
            .expect("create active provider");

        let deleted =
            delete_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("delete last provider");
        assert_eq!(deleted.active_provider_id, None);
        assert_eq!(deleted.providers_remaining, 0);
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn delete_inactive_provider_preserves_no_active_selection() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        assert_eq!(
            resolve_active_provider_id(&db).expect("resolve active"),
            None
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );

        let deleted = delete_claude_provider(&db, "provider-a").expect("delete inactive provider");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id, None);
        assert_eq!(deleted.providers_remaining, 1);
        assert_eq!(
            resolve_active_provider_id(&db).expect("resolve active"),
            None
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude),
            None
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current"),
            None
        );
    }

    #[test]
    #[serial]
    fn delete_provider_trims_whitespace_padded_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some("provider-a"),
            sample_payload("A", "secret-a"),
        )
        .expect("create provider a");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");
        activate_claude_provider(&db, "provider-a").expect("activate provider a");

        let deleted =
            delete_claude_provider(&db, "  provider-a  ").expect("delete trimmed provider a");
        assert_eq!(deleted.deleted_provider_id, "provider-a");
        assert_eq!(deleted.active_provider_id.as_deref(), Some("provider-b"));
        assert_eq!(deleted.providers_remaining, 1);
        assert!(db
            .get_provider_by_id("provider-a", CLAUDE_APP_TYPE)
            .expect("load deleted provider")
            .is_none());
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("provider-b")
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some("provider-b")
        );
    }

    #[test]
    #[serial]
    fn legacy_upsert_active_provider_uses_phase_one_default_id() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let active =
            upsert_active_claude_provider_with_payload(&db, sample_payload("Phase1", "secret"))
                .expect("upsert active provider");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(
            db.get_current_provider(CLAUDE_APP_TYPE)
                .expect("load db current")
                .as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
    }
}
