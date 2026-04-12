use crate::app_config::AppType;
use crate::config::sanitize_provider_name;
use crate::database::Database;
use crate::provider::Provider;
use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::str::FromStr;
use uuid::Uuid;

const CLAUDE_APP_ID: &str = "claude";
const CODEX_APP_ID: &str = "codex";
const GEMINI_APP_ID: &str = "gemini";
const CLAUDE_DEFAULT_PROVIDER_ID: &str = "openwrt-claude";
const CLAUDE_PROVIDER_ID_PREFIX: &str = "openwrt-claude-";
const CLAUDE_DEFAULT_TOKEN_FIELD: &str = "ANTHROPIC_AUTH_TOKEN";
const CLAUDE_ALT_TOKEN_FIELD: &str = "ANTHROPIC_API_KEY";
const CODEX_DEFAULT_PROVIDER_ID: &str = "openwrt-codex";
const CODEX_PROVIDER_ID_PREFIX: &str = "openwrt-codex-";
const CODEX_TOKEN_FIELD: &str = "OPENAI_API_KEY";
const GEMINI_DEFAULT_PROVIDER_ID: &str = "openwrt-gemini";
const GEMINI_PROVIDER_ID_PREFIX: &str = "openwrt-gemini-";
const GEMINI_TOKEN_FIELD: &str = "GEMINI_API_KEY";
const CLAUDE_MODEL_KEYS_TO_CLEAR: [&str; 6] = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
];

const CLAUDE_APP_TYPE: &str = CLAUDE_APP_ID;
const DEFAULT_PROVIDER_ID: &str = CLAUDE_DEFAULT_PROVIDER_ID;
const DEFAULT_TOKEN_FIELD: &str = CLAUDE_DEFAULT_TOKEN_FIELD;

type ClaudeProviderPayload = OpenWrtProviderPayload;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderPayload {
    #[serde(default)]
    pub provider_id: Option<String>,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
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
pub struct OpenWrtProviderView {
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
pub struct OpenWrtProviderListView {
    pub active_provider_id: Option<String>,
    pub providers: Vec<OpenWrtProviderView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWrtProviderDeleteView {
    pub deleted_provider_id: String,
    pub active_provider_id: Option<String>,
    pub providers_remaining: usize,
}

#[derive(Clone, Copy)]
struct OpenWrtAppProfile {
    app_id: &'static str,
    default_provider_id: &'static str,
    provider_id_prefix: &'static str,
    default_token_field: &'static str,
    alt_token_field: Option<&'static str>,
    default_model: Option<&'static str>,
    icon: &'static str,
    icon_color: &'static str,
}

pub fn parse_supported_app(value: &str) -> anyhow::Result<AppType> {
    let app_type = AppType::from_str(value).map_err(|e| anyhow!(e.to_string()))?;
    openwrt_app_profile(&app_type)?;
    Ok(app_type)
}

pub fn list_providers(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderListView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let providers = db
        .get_all_providers(profile.app_id)
        .map_err(|e| anyhow!("failed to list {} providers: {e}", profile.app_id))?;

    Ok(provider_list_to_view(
        app_type,
        profile,
        providers,
        active_provider_id.as_deref(),
    ))
}

pub fn get_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let provider = load_provider(db, profile, provider_id)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        active_provider_id.as_deref(),
    ))
}

pub fn get_active_provider(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    let provider = active_provider_id
        .as_deref()
        .map(|provider_id| load_provider(db, profile, provider_id))
        .transpose()?;

    Ok(provider
        .as_ref()
        .map(|provider| provider_to_view(app_type, profile, provider, Some(provider.id.as_str())))
        .unwrap_or_else(|| empty_provider_view(profile)))
}

pub fn upsert_provider(
    db: &Database,
    app_type: &AppType,
    requested_provider_id: Option<&str>,
) -> anyhow::Result<OpenWrtProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_provider_with_payload(db, app_type, requested_provider_id, payload)
}

pub fn upsert_active_provider(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<OpenWrtProviderView> {
    let payload = read_payload_from_stdin()?;
    upsert_active_provider_with_payload(db, app_type, payload)
}

pub fn activate_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let provider_id = normalize_provider_id(provider_id)?;
    let provider = load_provider(db, profile, &provider_id)?;
    set_active_provider_id(db, app_type, profile, Some(&provider_id))?;
    Ok(provider_to_view(app_type, profile, &provider, Some(&provider_id)))
}

pub fn delete_provider(
    db: &Database,
    app_type: &AppType,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderDeleteView> {
    let profile = openwrt_app_profile(app_type)?;
    let normalized_provider_id = normalize_provider_id(provider_id)?;
    load_provider(db, profile, &normalized_provider_id)?;

    let effective_current = resolve_active_provider_id(db, app_type)?;
    let db_current = db
        .get_current_provider(profile.app_id)
        .map_err(|e| anyhow!("failed to read database current {} provider: {e}", profile.app_id))?;

    db.delete_provider(profile.app_id, &normalized_provider_id).map_err(|e| {
        anyhow!(
            "failed to delete {} provider {normalized_provider_id}: {e}",
            profile.app_id
        )
    })?;

    let remaining = db
        .get_all_providers(profile.app_id)
        .map_err(|e| anyhow!("failed to reload {} providers after delete: {e}", profile.app_id))?;
    let next_current = select_current_provider_after_delete(
        &remaining,
        &normalized_provider_id,
        effective_current.as_deref(),
        db_current.as_deref(),
    );
    set_active_provider_id(db, app_type, profile, next_current.as_deref())?;
    let response_active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;

    Ok(OpenWrtProviderDeleteView {
        deleted_provider_id: normalized_provider_id,
        active_provider_id: response_active_provider_id,
        providers_remaining: remaining.len(),
    })
}

pub fn list_claude_providers(db: &Database) -> anyhow::Result<OpenWrtProviderListView> {
    list_providers(db, &AppType::Claude)
}

pub fn get_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    get_provider(db, &AppType::Claude, provider_id)
}

pub fn get_active_claude_provider(db: &Database) -> anyhow::Result<OpenWrtProviderView> {
    get_active_provider(db, &AppType::Claude)
}

pub fn upsert_claude_provider(
    db: &Database,
    requested_provider_id: Option<&str>,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_provider(db, &AppType::Claude, requested_provider_id)
}

pub fn upsert_active_claude_provider(db: &Database) -> anyhow::Result<OpenWrtProviderView> {
    upsert_active_provider(db, &AppType::Claude)
}

pub fn activate_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderView> {
    activate_provider(db, &AppType::Claude, provider_id)
}

pub fn delete_claude_provider(
    db: &Database,
    provider_id: &str,
) -> anyhow::Result<OpenWrtProviderDeleteView> {
    delete_provider(db, &AppType::Claude, provider_id)
}

fn upsert_claude_provider_with_payload(
    db: &Database,
    requested_provider_id: Option<&str>,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_provider_with_payload(db, &AppType::Claude, requested_provider_id, payload)
}

fn upsert_active_claude_provider_with_payload(
    db: &Database,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    upsert_active_provider_with_payload(db, &AppType::Claude, payload)
}

fn resolve_claude_active_provider_id(db: &Database) -> anyhow::Result<Option<String>> {
    resolve_active_provider_id(db, &AppType::Claude)
}

fn extract_claude_token(provider: &Provider) -> Option<(&'static str, &str)> {
    let profile = openwrt_app_profile(&AppType::Claude).ok()?;
    extract_token(profile, provider)
}

fn upsert_provider_with_payload(
    db: &Database,
    app_type: &AppType,
    requested_provider_id: Option<&str>,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let payload_provider_id = normalize_requested_provider_id(payload.provider_id.as_deref())?;
    let requested_provider_id = normalize_requested_provider_id(requested_provider_id)?;
    ensure_matching_provider_ids(
        requested_provider_id.as_deref(),
        payload_provider_id.as_deref(),
    )?;

    let target_provider_id = requested_provider_id
        .or(payload_provider_id)
        .unwrap_or_else(|| generate_provider_id(profile));
    let existing = db
        .get_provider_by_id(&target_provider_id, profile.app_id)
        .map_err(|e| anyhow!("failed to load {} provider {target_provider_id}: {e}", profile.app_id))?;
    let provider = build_provider(app_type, profile, existing, target_provider_id.clone(), payload)?;

    db.save_provider(profile.app_id, &provider)
        .map_err(|e| anyhow!("failed to save {} provider: {e}", profile.app_id))?;

    let active_provider_id = resolve_active_provider_id_for_read(db, app_type, profile)?;
    Ok(provider_to_view(
        app_type,
        profile,
        &provider,
        active_provider_id.as_deref(),
    ))
}

fn upsert_active_provider_with_payload(
    db: &Database,
    app_type: &AppType,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<OpenWrtProviderView> {
    let profile = openwrt_app_profile(app_type)?;
    let active_provider_id = resolve_active_provider_id(db, app_type)?;
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
        .unwrap_or_else(|| profile.default_provider_id.to_string());
    let existing = db
        .get_provider_by_id(&target_provider_id, profile.app_id)
        .map_err(|e| anyhow!("failed to load {} provider {target_provider_id}: {e}", profile.app_id))?;
    let provider = build_provider(app_type, profile, existing, target_provider_id.clone(), payload)?;

    db.save_provider(profile.app_id, &provider)
        .map_err(|e| anyhow!("failed to save {} provider: {e}", profile.app_id))?;
    set_active_provider_id(db, app_type, profile, Some(&provider.id))?;

    Ok(provider_to_view(app_type, profile, &provider, Some(&provider.id)))
}

fn openwrt_app_profile(app_type: &AppType) -> anyhow::Result<OpenWrtAppProfile> {
    match app_type {
        AppType::Claude => Ok(OpenWrtAppProfile {
            app_id: CLAUDE_APP_ID,
            default_provider_id: CLAUDE_DEFAULT_PROVIDER_ID,
            provider_id_prefix: CLAUDE_PROVIDER_ID_PREFIX,
            default_token_field: CLAUDE_DEFAULT_TOKEN_FIELD,
            alt_token_field: Some(CLAUDE_ALT_TOKEN_FIELD),
            default_model: None,
            icon: "anthropic",
            icon_color: "#D4915D",
        }),
        AppType::Codex => Ok(OpenWrtAppProfile {
            app_id: CODEX_APP_ID,
            default_provider_id: CODEX_DEFAULT_PROVIDER_ID,
            provider_id_prefix: CODEX_PROVIDER_ID_PREFIX,
            default_token_field: CODEX_TOKEN_FIELD,
            alt_token_field: None,
            default_model: Some("gpt-5.4"),
            icon: "openai",
            icon_color: "#00A67E",
        }),
        AppType::Gemini => Ok(OpenWrtAppProfile {
            app_id: GEMINI_APP_ID,
            default_provider_id: GEMINI_DEFAULT_PROVIDER_ID,
            provider_id_prefix: GEMINI_PROVIDER_ID_PREFIX,
            default_token_field: GEMINI_TOKEN_FIELD,
            alt_token_field: None,
            default_model: Some("gemini-3.1-pro"),
            icon: "gemini",
            icon_color: "#4285F4",
        }),
        AppType::OpenCode | AppType::OpenClaw => Err(anyhow!(
            "OpenWrt provider management is not implemented for {} yet",
            app_type.as_str()
        )),
    }
}

fn read_payload_from_stdin() -> anyhow::Result<OpenWrtProviderPayload> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read provider payload from stdin")?;

    if input.trim().is_empty() {
        return Err(anyhow!("provider payload is required on stdin"));
    }

    serde_json::from_str(&input).context("failed to parse provider payload JSON")
}

fn load_provider(
    db: &Database,
    profile: OpenWrtAppProfile,
    provider_id: &str,
) -> anyhow::Result<Provider> {
    let provider_id = normalize_provider_id(provider_id)?;
    db.get_provider_by_id(&provider_id, profile.app_id)
        .map_err(|e| anyhow!("failed to load {} provider {provider_id}: {e}", profile.app_id))?
        .ok_or_else(|| anyhow!("{} provider {provider_id} does not exist", profile.app_id))
}

fn resolve_active_provider_id(
    db: &Database,
    app_type: &AppType,
) -> anyhow::Result<Option<String>> {
    crate::settings::get_effective_current_provider(db, app_type)
        .map_err(|e| anyhow!("failed to resolve active {} provider: {e}", app_type.as_str()))
}

fn resolve_active_provider_id_for_read(
    db: &Database,
    app_type: &AppType,
    profile: OpenWrtAppProfile,
) -> anyhow::Result<Option<String>> {
    if let Some(provider_id) = resolve_active_provider_id(db, app_type)? {
        return Ok(Some(provider_id));
    }

    let has_legacy_default = db
        .get_provider_by_id(profile.default_provider_id, profile.app_id)
        .map_err(|e| {
            anyhow!(
                "failed to load {} provider {}: {e}",
                profile.app_id,
                profile.default_provider_id
            )
        })?
        .is_some();

    Ok(has_legacy_default.then(|| profile.default_provider_id.to_string()))
}

fn set_active_provider_id(
    db: &Database,
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    provider_id: Option<&str>,
) -> anyhow::Result<()> {
    match provider_id {
        Some(provider_id) => {
            let provider_id = normalize_provider_id(provider_id)?;
            db.set_current_provider(profile.app_id, &provider_id).map_err(|e| {
                anyhow!("failed to set active {} provider: {e}", profile.app_id)
            })?;
            crate::settings::set_current_provider(app_type, Some(&provider_id)).map_err(|e| {
                anyhow!(
                    "failed to persist local {} provider selection: {e}",
                    profile.app_id
                )
            })?;
        }
        None => {
            crate::settings::set_current_provider(app_type, None).map_err(|e| {
                anyhow!(
                    "failed to clear local {} provider selection: {e}",
                    profile.app_id
                )
            })?;
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
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    providers: indexmap::IndexMap<String, Provider>,
    active_provider_id: Option<&str>,
) -> OpenWrtProviderListView {
    let providers = providers
        .values()
        .map(|provider| provider_to_view(app_type, profile, provider, active_provider_id))
        .collect();

    OpenWrtProviderListView {
        active_provider_id: active_provider_id.map(str::to_string),
        providers,
    }
}

fn build_provider(
    app_type: &AppType,
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    match app_type {
        AppType::Claude => build_claude_provider(profile, existing, provider_id, payload),
        AppType::Codex => build_codex_provider(profile, existing, provider_id, payload),
        AppType::Gemini => build_gemini_provider(profile, existing, provider_id, payload),
        AppType::OpenCode | AppType::OpenClaw => Err(anyhow!(
            "OpenWrt provider management is not implemented for {} yet",
            app_type.as_str()
        )),
    }
}

fn build_claude_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let token_field = normalize_token_field(profile, &payload.token_field)?;
    let token_value = resolve_token_value(profile, existing.as_ref(), &payload.token)?;
    let mut provider = init_provider(existing, provider_id, name, payload.notes, profile);

    let root = ensure_settings_object(&mut provider, "Claude provider settings")?;
    let env = ensure_child_object(root, "env", "Claude provider env")?;

    env.insert("ANTHROPIC_BASE_URL".to_string(), json!(base_url));
    env.remove(CLAUDE_DEFAULT_TOKEN_FIELD);
    env.remove(CLAUDE_ALT_TOKEN_FIELD);
    env.remove("OPENROUTER_API_KEY");
    env.remove("OPENAI_API_KEY");
    env.insert(token_field.to_string(), json!(token_value));

    for key in CLAUDE_MODEL_KEYS_TO_CLEAR {
        env.remove(key);
    }
    match normalize_optional(payload.model) {
        Some(model) => {
            env.insert("ANTHROPIC_MODEL".to_string(), json!(model));
        }
        None => {
            env.remove("ANTHROPIC_MODEL");
        }
    }

    Ok(provider)
}

fn build_codex_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let _token_field = normalize_token_field(profile, &payload.token_field)?;
    let token_value = resolve_token_value(profile, existing.as_ref(), &payload.token)?;
    let mut provider = init_provider(existing, provider_id, name, payload.notes, profile);
    let model = resolve_model_value(profile, &provider, &payload.model);
    let provider_id_for_default = provider.id.clone();
    let provider_name_for_default = provider.name.clone();

    let root = ensure_settings_object(&mut provider, "Codex provider settings")?;
    let auth = ensure_child_object(root, "auth", "Codex provider auth")?;
    auth.insert(CODEX_TOKEN_FIELD.to_string(), json!(token_value));
    root.insert("base_url".to_string(), json!(base_url));

    match model.as_ref() {
        Some(value) => {
            root.insert("model".to_string(), json!(value));
        }
        None => {
            root.remove("model");
        }
    }

    let config_seed = root
        .get("config")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            default_codex_config(
                &provider_id_for_default,
                &provider_name_for_default,
                base_url,
                model.as_deref(),
            )
        });
    let updated_base_url = crate::codex_config::update_codex_toml_field(
        &config_seed,
        "base_url",
        base_url,
    )
    .map_err(|e| anyhow!("failed to update Codex config base_url: {e}"))?;
    let updated_config = crate::codex_config::update_codex_toml_field(
        &updated_base_url,
        "model",
        model.as_deref().unwrap_or(""),
    )
    .map_err(|e| anyhow!("failed to update Codex config model: {e}"))?;
    root.insert("config".to_string(), json!(updated_config));

    Ok(provider)
}

fn build_gemini_provider(
    profile: OpenWrtAppProfile,
    existing: Option<Provider>,
    provider_id: String,
    payload: OpenWrtProviderPayload,
) -> anyhow::Result<Provider> {
    let name = require_trimmed("provider name", &payload.name)?;
    let base_url = require_trimmed("base URL", &payload.base_url)?;
    let _token_field = normalize_token_field(profile, &payload.token_field)?;
    let token_value = resolve_token_value(profile, existing.as_ref(), &payload.token)?;
    let mut provider = init_provider(existing, provider_id, name, payload.notes, profile);
    let model = resolve_model_value(profile, &provider, &payload.model);

    let root = ensure_settings_object(&mut provider, "Gemini provider settings")?;
    let env = ensure_child_object(root, "env", "Gemini provider env")?;
    env.insert("GOOGLE_GEMINI_BASE_URL".to_string(), json!(base_url));
    env.insert(GEMINI_TOKEN_FIELD.to_string(), json!(token_value));
    match model.as_ref() {
        Some(value) => {
            env.insert("GEMINI_MODEL".to_string(), json!(value));
            root.insert("model".to_string(), json!(value));
        }
        None => {
            env.remove("GEMINI_MODEL");
            root.remove("model");
        }
    }
    root.insert("base_url".to_string(), json!(base_url));

    Ok(provider)
}

fn init_provider(
    existing: Option<Provider>,
    provider_id: String,
    name: &str,
    notes: String,
    profile: OpenWrtAppProfile,
) -> Provider {
    let mut provider = existing
        .unwrap_or_else(|| Provider::with_id(provider_id, name.to_string(), json!({}), None));

    provider.name = name.to_string();
    provider.notes = normalize_optional(notes);
    if provider.created_at.is_none() {
        provider.created_at = Some(chrono::Utc::now().timestamp_millis());
    }
    if provider.icon.is_none() {
        provider.icon = Some(profile.icon.to_string());
    }
    if provider.icon_color.is_none() {
        provider.icon_color = Some(profile.icon_color.to_string());
    }
    provider.in_failover_queue = false;

    provider
}

fn ensure_settings_object<'a>(
    provider: &'a mut Provider,
    context_label: &str,
) -> anyhow::Result<&'a mut serde_json::Map<String, Value>> {
    if !provider.settings_config.is_object() {
        provider.settings_config = json!({});
    }

    provider
        .settings_config
        .as_object_mut()
        .ok_or_else(|| anyhow!("{context_label} must be a JSON object"))
}

fn ensure_child_object<'a>(
    parent: &'a mut serde_json::Map<String, Value>,
    key: &str,
    context_label: &str,
) -> anyhow::Result<&'a mut serde_json::Map<String, Value>> {
    let child_value = parent.entry(key.to_string()).or_insert_with(|| json!({}));
    if !child_value.is_object() {
        *child_value = json!({});
    }
    child_value
        .as_object_mut()
        .ok_or_else(|| anyhow!("{context_label} must be a JSON object"))
}

fn require_trimmed<'a>(label: &str, value: &'a str) -> anyhow::Result<&'a str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{label} is required"));
    }
    Ok(trimmed)
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

fn generate_provider_id(profile: OpenWrtAppProfile) -> String {
    format!("{}{}", profile.provider_id_prefix, Uuid::new_v4().simple())
}

fn normalize_token_field(profile: OpenWrtAppProfile, value: &str) -> anyhow::Result<&'static str> {
    let trimmed = value.trim();

    if trimmed.is_empty() || trimmed == profile.default_token_field {
        return Ok(profile.default_token_field);
    }

    if let Some(alt) = profile.alt_token_field {
        if trimmed == alt {
            return Ok(alt);
        }
    }

    Err(anyhow!("unsupported token field: {trimmed}"))
}

fn normalize_optional(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_token_value(
    profile: OpenWrtAppProfile,
    existing: Option<&Provider>,
    payload_token: &str,
) -> anyhow::Result<String> {
    let existing_token = existing
        .and_then(|provider| extract_token(profile, provider))
        .map(|(_, token)| token.to_string());

    match payload_token.trim() {
        "" => existing_token.ok_or_else(|| anyhow!("token is required for the first save")),
        token => Ok(token.to_string()),
    }
}

fn resolve_model_value(
    profile: OpenWrtAppProfile,
    provider: &Provider,
    payload_model: &str,
) -> Option<String> {
    if let Some(model) = normalize_optional(payload_model.to_string()) {
        return Some(model);
    }

    match profile.app_id {
        "claude" => None,
        _ => extract_model(profile, provider)
            .or_else(|| profile.default_model.map(str::to_string)),
    }
}

fn empty_provider_view(profile: OpenWrtAppProfile) -> OpenWrtProviderView {
    OpenWrtProviderView {
        configured: false,
        active: false,
        provider_id: None,
        name: String::new(),
        base_url: String::new(),
        token_field: profile.default_token_field.to_string(),
        token_configured: false,
        token_masked: String::new(),
        model: String::new(),
        notes: String::new(),
    }
}

fn provider_to_view(
    _app_type: &AppType,
    profile: OpenWrtAppProfile,
    provider: &Provider,
    active_provider_id: Option<&str>,
) -> OpenWrtProviderView {
    let (token_field, token_value) = extract_token(profile, provider)
        .unwrap_or((profile.default_token_field, ""));

    OpenWrtProviderView {
        configured: true,
        active: active_provider_id == Some(provider.id.as_str()),
        provider_id: Some(provider.id.clone()),
        name: provider.name.clone(),
        base_url: extract_base_url(profile, provider).unwrap_or_default(),
        token_field: token_field.to_string(),
        token_configured: !token_value.is_empty(),
        token_masked: mask_secret(token_value),
        model: extract_model(profile, provider).unwrap_or_default(),
        notes: provider.notes.clone().unwrap_or_default(),
    }
}

fn extract_token(profile: OpenWrtAppProfile, provider: &Provider) -> Option<(&'static str, &str)> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(extract_claude_token_from_env),
        "codex" => extract_token_with_fallbacks(provider, CODEX_TOKEN_FIELD, &["auth", "env"]),
        "gemini" => extract_token_with_fallbacks(provider, GEMINI_TOKEN_FIELD, &["env"]),
        _ => None,
    }
}

fn extract_claude_token_from_env(
    env: &serde_json::Map<String, Value>,
) -> Option<(&'static str, &str)> {
    for key in [CLAUDE_DEFAULT_TOKEN_FIELD, CLAUDE_ALT_TOKEN_FIELD] {
        if let Some(value) = env
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some((key, value));
        }
    }

    if env.contains_key(CLAUDE_DEFAULT_TOKEN_FIELD) {
        return Some((CLAUDE_DEFAULT_TOKEN_FIELD, ""));
    }
    if env.contains_key(CLAUDE_ALT_TOKEN_FIELD) {
        return Some((CLAUDE_ALT_TOKEN_FIELD, ""));
    }

    None
}

fn extract_token_with_fallbacks<'a>(
    provider: &'a Provider,
    token_field: &'static str,
    object_keys: &[&str],
) -> Option<(&'static str, &'a str)> {
    for object_key in object_keys {
        if let Some(object) = provider.settings_config.get(*object_key).and_then(Value::as_object) {
            if let Some(value) = object.get(token_field).and_then(Value::as_str) {
                return Some((token_field, value.trim()));
            }
            if object.contains_key(token_field) {
                return Some((token_field, ""));
            }
        }
    }

    if let Some(value) = provider
        .settings_config
        .get("apiKey")
        .or_else(|| provider.settings_config.get("api_key"))
        .and_then(Value::as_str)
    {
        return Some((token_field, value.trim()));
    }

    None
}

fn extract_base_url(profile: OpenWrtAppProfile, provider: &Provider) -> Option<String> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])),
        "codex" => extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])
            .or_else(|| {
                provider
                    .settings_config
                    .get("config")
                    .and_then(Value::as_str)
                    .and_then(extract_codex_base_url_from_toml)
            }),
        "gemini" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("GOOGLE_GEMINI_BASE_URL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["base_url", "baseURL"])),
        _ => None,
    }
}

fn extract_model(profile: OpenWrtAppProfile, provider: &Provider) -> Option<String> {
    match profile.app_id {
        "claude" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("ANTHROPIC_MODEL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string()),
        "codex" => extract_direct_string(&provider.settings_config, &["model"]).or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .and_then(extract_codex_model_from_toml)
        }),
        "gemini" => provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get("GEMINI_MODEL"))
            .and_then(Value::as_str)
            .map(|value| value.trim().to_string())
            .or_else(|| extract_direct_string(&provider.settings_config, &["model"])),
        _ => None,
    }
}

fn extract_direct_string(root: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| root.get(*key).and_then(Value::as_str))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn extract_codex_base_url_from_toml(config: &str) -> Option<String> {
    if let Ok(table) = toml::from_str::<toml::Table>(config) {
        if let Some(provider_key) = table
            .get("model_provider")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
        {
            if let Some(url) = table
                .get("model_providers")
                .and_then(|value| value.as_table())
                .and_then(|providers| providers.get(provider_key))
                .and_then(|value| value.as_table())
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str())
            {
                let trimmed = url.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }

        if let Some(url) = table.get("base_url").and_then(|value| value.as_str()) {
            let trimmed = url.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    None
}

fn extract_codex_model_from_toml(config: &str) -> Option<String> {
    toml::from_str::<toml::Table>(config)
        .ok()
        .and_then(|table| table.get("model").and_then(|value| value.as_str()).map(str::to_string))
        .filter(|value| !value.trim().is_empty())
}

fn default_codex_config(
    provider_id: &str,
    provider_name: &str,
    base_url: &str,
    model: Option<&str>,
) -> String {
    let provider_key = sanitize_codex_provider_key(provider_name, provider_id);
    let display_name = provider_name.replace('"', "'");
    let model_line = model
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("model = \"{}\"\n", value.replace('"', "'")))
        .unwrap_or_default();

    format!(
        "model_provider = \"{provider_key}\"\n\
{model_line}model_reasoning_effort = \"high\"\n\
disable_response_storage = true\n\
\n\
[model_providers.{provider_key}]\n\
name = \"{display_name}\"\n\
base_url = \"{base_url}\"\n\
wire_api = \"responses\"\n\
requires_openai_auth = true\n"
    )
}

fn sanitize_codex_provider_key(provider_name: &str, provider_id: &str) -> String {
    let source = if provider_name.trim().is_empty() {
        provider_id
    } else {
        provider_name
    };

    let sanitized = sanitize_provider_name(source)
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "custom".to_string()
    } else {
        sanitized
    }
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
        let (_, token) = extract_claude_token(&stored).expect("stored token");
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
            resolve_claude_active_provider_id(&db).expect("resolve active"),
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
            resolve_claude_active_provider_id(&db).expect("resolve active"),
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
    fn legacy_get_active_provider_falls_back_to_default_slot_when_no_provider_is_marked_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");

        assert!(active.configured);
        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(active.name, "Phase1");
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
    fn legacy_read_surfaces_fall_back_to_default_slot_when_no_provider_is_marked_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");
        let provider = get_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("read provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert!(provider.active);
        assert_eq!(provider.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(
            list.active_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(list.providers.len(), 1);
        assert_eq!(
            list.providers[0].provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert!(list.providers[0].active);
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

    #[test]
    #[serial]
    fn legacy_upsert_active_provider_ignores_payload_provider_id_when_no_provider_is_active() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        let mut payload = sample_payload("Phase1", "secret");
        payload.provider_id = Some("provider-b".to_string());

        let active = upsert_active_claude_provider_with_payload(&db, payload)
            .expect("upsert active provider with payload provider id");

        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert!(db
            .get_provider_by_id("provider-b", CLAUDE_APP_TYPE)
            .expect("load payload-selected provider")
            .is_none());
        assert!(db
            .get_provider_by_id(DEFAULT_PROVIDER_ID, CLAUDE_APP_TYPE)
            .expect("load default provider")
            .is_some());
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

    #[test]
    #[serial]
    fn legacy_upsert_provider_response_matches_follow_up_reads_when_default_slot_is_effectively_active(
    ) {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");

        let mut payload = sample_payload("Phase1 updated", "secret-updated");
        payload.provider_id = Some(DEFAULT_PROVIDER_ID.to_string());
        let upserted = upsert_claude_provider_with_payload(&db, Some(DEFAULT_PROVIDER_ID), payload)
            .expect("update default provider");

        let active = get_active_claude_provider(&db).expect("read active provider");
        let provider = get_claude_provider(&db, DEFAULT_PROVIDER_ID).expect("read provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert!(upserted.active);
        assert_eq!(upserted.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(active.provider_id, upserted.provider_id);
        assert!(provider.active);
        assert_eq!(provider.provider_id, upserted.provider_id);
        assert_eq!(list.active_provider_id, upserted.provider_id);
        assert_eq!(list.providers.len(), 1);
        assert!(list.providers[0].active);
        assert_eq!(list.providers[0].provider_id, upserted.provider_id);
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
    fn legacy_delete_provider_response_matches_follow_up_reads_when_default_slot_is_effectively_active(
    ) {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");

        upsert_claude_provider_with_payload(
            &db,
            Some(DEFAULT_PROVIDER_ID),
            sample_payload("Phase1", "secret"),
        )
        .expect("create default provider");
        upsert_claude_provider_with_payload(
            &db,
            Some("provider-b"),
            sample_payload("B", "secret-b"),
        )
        .expect("create provider b");

        let deleted = delete_claude_provider(&db, "provider-b").expect("delete provider b");
        let active = get_active_claude_provider(&db).expect("read active provider");
        let list = list_claude_providers(&db).expect("list providers");

        assert_eq!(deleted.deleted_provider_id, "provider-b");
        assert_eq!(
            deleted.active_provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
        );
        assert_eq!(deleted.providers_remaining, 1);
        assert!(active.active);
        assert_eq!(active.provider_id.as_deref(), Some(DEFAULT_PROVIDER_ID));
        assert_eq!(list.active_provider_id, deleted.active_provider_id);
        assert_eq!(list.providers.len(), 1);
        assert!(list.providers[0].active);
        assert_eq!(
            list.providers[0].provider_id.as_deref(),
            Some(DEFAULT_PROVIDER_ID)
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
    fn codex_provider_round_trip_uses_openai_token_and_toml_config() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload = OpenWrtProviderPayload {
            provider_id: None,
            name: "Codex Relay".to_string(),
            base_url: "https://codex.example/v1".to_string(),
            token_field: CODEX_TOKEN_FIELD.to_string(),
            token: "sk-codex-secret".to_string(),
            model: "gpt-5.4".to_string(),
            notes: "codex-notes".to_string(),
        };

        let created = upsert_provider_with_payload(&db, &AppType::Codex, Some("codex-a"), payload)
            .expect("create codex provider");

        assert_eq!(created.provider_id.as_deref(), Some("codex-a"));
        assert_eq!(created.token_field, CODEX_TOKEN_FIELD);
        assert_eq!(created.base_url, "https://codex.example/v1");
        assert_eq!(created.model, "gpt-5.4");
        assert_eq!(created.token_masked, "********cret");

        let stored = db
            .get_provider_by_id("codex-a", CODEX_APP_ID)
            .expect("load stored codex provider")
            .expect("stored codex provider");
        assert_eq!(
            stored
                .settings_config
                .get("auth")
                .and_then(|value| value.get(CODEX_TOKEN_FIELD))
                .and_then(Value::as_str),
            Some("sk-codex-secret")
        );
        assert_eq!(
            stored
                .settings_config
                .get("base_url")
                .and_then(Value::as_str),
            Some("https://codex.example/v1")
        );
        assert!(stored
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .contains("base_url = \"https://codex.example/v1\""));
    }

    #[test]
    #[serial]
    fn gemini_provider_activation_updates_database_and_settings_current() {
        let _env = TestEnv::new();
        let db = Database::memory().expect("db");
        let payload_a = OpenWrtProviderPayload {
            provider_id: None,
            name: "Gemini A".to_string(),
            base_url: "https://gemini-a.example/v1beta".to_string(),
            token_field: GEMINI_TOKEN_FIELD.to_string(),
            token: "gemini-a-secret".to_string(),
            model: "gemini-3.1-pro".to_string(),
            notes: String::new(),
        };
        let payload_b = OpenWrtProviderPayload {
            provider_id: None,
            name: "Gemini B".to_string(),
            base_url: "https://gemini-b.example/v1beta".to_string(),
            token_field: GEMINI_TOKEN_FIELD.to_string(),
            token: "gemini-b-secret".to_string(),
            model: "gemini-3.1-pro".to_string(),
            notes: String::new(),
        };

        upsert_provider_with_payload(&db, &AppType::Gemini, Some("gemini-a"), payload_a)
            .expect("create gemini a");
        upsert_provider_with_payload(&db, &AppType::Gemini, Some("gemini-b"), payload_b)
            .expect("create gemini b");

        let activated = activate_provider(&db, &AppType::Gemini, "gemini-b")
            .expect("activate gemini provider");

        assert!(activated.active);
        assert_eq!(activated.provider_id.as_deref(), Some("gemini-b"));
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Gemini).as_deref(),
            Some("gemini-b")
        );
        assert_eq!(
            db.get_current_provider(GEMINI_APP_ID)
                .expect("load gemini db current")
                .as_deref(),
            Some("gemini-b")
        );
    }
}
