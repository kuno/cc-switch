use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::Provider;
use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;

const DEFAULT_PROVIDER_ID: &str = "openwrt-claude";
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
pub struct ActiveClaudeProviderPayload {
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
pub struct ActiveClaudeProviderView {
    pub configured: bool,
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub token_field: String,
    pub token_configured: bool,
    pub token_masked: String,
    pub model: String,
    pub notes: String,
}

impl Default for ActiveClaudeProviderView {
    fn default() -> Self {
        Self {
            configured: false,
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

pub fn get_active_claude_provider(db: &Database) -> anyhow::Result<ActiveClaudeProviderView> {
    Ok(resolve_active_provider(db)?
        .as_ref()
        .map(provider_to_view)
        .unwrap_or_default())
}

pub fn upsert_active_claude_provider(db: &Database) -> anyhow::Result<ActiveClaudeProviderView> {
    let payload = read_payload_from_stdin()?;
    let existing = resolve_active_provider(db)?;
    let provider = build_provider(existing, payload)?;

    db.save_provider("claude", &provider)
        .map_err(|e| anyhow!("failed to save Claude provider: {e}"))?;
    db.set_current_provider("claude", &provider.id)
        .map_err(|e| anyhow!("failed to set active Claude provider: {e}"))?;
    crate::settings::set_current_provider(&AppType::Claude, Some(&provider.id))
        .map_err(|e| anyhow!("failed to persist local Claude provider selection: {e}"))?;

    Ok(provider_to_view(&provider))
}

fn read_payload_from_stdin() -> anyhow::Result<ActiveClaudeProviderPayload> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read provider payload from stdin")?;

    if input.trim().is_empty() {
        return Err(anyhow!("provider payload is required on stdin"));
    }

    serde_json::from_str(&input).context("failed to parse provider payload JSON")
}

fn resolve_active_provider(db: &Database) -> anyhow::Result<Option<Provider>> {
    let current_id = crate::settings::get_effective_current_provider(db, &AppType::Claude)
        .map_err(|e| anyhow!("failed to resolve active Claude provider: {e}"))?;

    let Some(current_id) = current_id else {
        return Ok(None);
    };

    db.get_provider_by_id(&current_id, "claude")
        .map_err(|e| anyhow!("failed to load Claude provider {current_id}: {e}"))
}

fn build_provider(
    existing: Option<Provider>,
    payload: ActiveClaudeProviderPayload,
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

    let mut provider = existing.unwrap_or_else(|| {
        Provider::with_id(
            DEFAULT_PROVIDER_ID.to_string(),
            name.to_string(),
            json!({}),
            None,
        )
    });

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

fn provider_to_view(provider: &Provider) -> ActiveClaudeProviderView {
    let env = provider
        .settings_config
        .get("env")
        .and_then(Value::as_object);
    let (token_field, token_value) = env
        .and_then(extract_token_from_env)
        .unwrap_or((DEFAULT_TOKEN_FIELD, ""));

    ActiveClaudeProviderView {
        configured: true,
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
