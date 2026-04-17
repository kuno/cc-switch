use crate::app_config::AppType;
use crate::openwrt_admin::{self, OpenWrtProviderPayload};
use crate::proxy::providers::codex_oauth_store::codex_auth_upload_limit_bytes;
use crate::proxy::server::ProxyState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) fn mount_openwrt_admin_routes(router: Router<ProxyState>) -> Router<ProxyState> {
    router
        .route("/openwrt/admin/meta", get(openwrt_get_admin_meta))
        .route("/openwrt/admin/runtime", get(openwrt_get_runtime_status))
        .route(
            "/openwrt/admin/apps/:app/runtime",
            get(openwrt_get_app_runtime_status),
        )
        .route(
            "/openwrt/admin/apps/:app/usage-summary",
            get(openwrt_get_usage_summary),
        )
        .route(
            "/openwrt/admin/apps/:app/provider-stats",
            get(openwrt_get_provider_stats),
        )
        .route(
            "/openwrt/admin/apps/:app/recent-activity",
            get(openwrt_get_recent_activity),
        )
        .route(
            "/openwrt/admin/apps/:app/providers",
            get(openwrt_list_providers).post(openwrt_upsert_provider),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/active",
            get(openwrt_get_active_provider).post(openwrt_upsert_active_provider),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id",
            get(openwrt_get_provider)
                .put(openwrt_upsert_provider_by_id)
                .delete(openwrt_delete_provider),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/activate",
            post(openwrt_activate_provider),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/codex-auth",
            post(openwrt_upload_codex_auth).delete(openwrt_remove_codex_auth),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/failover",
            get(openwrt_get_provider_failover),
        )
        .route(
            "/openwrt/admin/apps/:app/failover/providers/available",
            get(openwrt_get_available_failover_providers),
        )
        .route(
            "/openwrt/admin/apps/:app/failover/providers/:provider_id",
            post(openwrt_add_to_failover_queue).delete(openwrt_remove_from_failover_queue),
        )
        .route(
            "/openwrt/admin/apps/:app/failover/queue",
            put(openwrt_reorder_failover_queue),
        )
        .route(
            "/openwrt/admin/apps/:app/failover/auto-enabled",
            put(openwrt_set_auto_failover_enabled),
        )
        .route(
            "/openwrt/admin/apps/:app/failover/max-retries",
            put(openwrt_set_max_retries),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtReorderQueuePayload {
    provider_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtEnabledPayload {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtMaxRetriesPayload {
    value: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtCodexAuthUploadPayload {
    auth_json_text: String,
}

fn openwrt_admin_ok<T: serde::Serialize>(value: T) -> (StatusCode, Json<Value>) {
    match serde_json::to_value(value) {
        Ok(Value::Object(mut map)) => {
            map.insert("ok".to_string(), Value::Bool(true));
            (StatusCode::OK, Json(Value::Object(map)))
        }
        Ok(value) => (StatusCode::OK, Json(json!({ "ok": true, "value": value }))),
        Err(error) => (
            StatusCode::OK,
            Json(json!({
                "ok": false,
                "error": format!("failed to serialize OpenWrt admin response: {error}")
            })),
        ),
    }
}

fn openwrt_admin_error(error: anyhow::Error) -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({ "ok": false, "error": error.to_string() })),
    )
}

fn parse_openwrt_app(app: &str) -> Result<AppType, anyhow::Error> {
    openwrt_admin::parse_supported_app(app)
}

async fn openwrt_get_admin_meta() -> (StatusCode, Json<Value>) {
    match openwrt_admin::get_admin_meta() {
        Ok(meta) => openwrt_admin_ok(meta),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_runtime_status(
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match openwrt_admin::get_runtime_status(state.db.as_ref()).await {
        Ok(status) => openwrt_admin_ok(status),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_app_runtime_status(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::get_app_runtime_status(state.db.as_ref(), &app_type)
            .await
        {
            Ok(status) => openwrt_admin_ok(status),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_usage_summary(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::get_usage_summary(state.db.as_ref(), &app_type))
    {
        Ok(summary) => openwrt_admin_ok(summary),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_provider_stats(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::get_provider_stats(state.db.as_ref(), &app_type))
    {
        Ok(stats) => openwrt_admin_ok(stats),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_recent_activity(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::get_recent_activity(state.db.as_ref(), &app_type))
    {
        Ok(activity) => openwrt_admin_ok(activity),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_list_providers(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::list_providers(state.db.as_ref(), &app_type))
    {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_active_provider(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::get_active_provider(state.db.as_ref(), &app_type))
    {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_provider(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::get_provider(state.db.as_ref(), &app_type, &provider_id))
    {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_provider_failover(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::get_provider_failover(
            state.db.as_ref(),
            &app_type,
            &provider_id,
        )
        .await
        {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_available_failover_providers(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_available_failover_providers(state.db.as_ref(), &app_type)
    }) {
        Ok(providers) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "providers": providers
            })),
        ),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_upsert_provider(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtProviderPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::upsert_provider_from_payload(state.db.as_ref(), &app_type, None, payload)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_upsert_provider_by_id(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtProviderPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::upsert_provider_from_payload(
            state.db.as_ref(),
            &app_type,
            Some(provider_id.as_str()),
            payload,
        )
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_upsert_active_provider(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtProviderPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::upsert_active_provider_from_payload(state.db.as_ref(), &app_type, payload)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_delete_provider(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::delete_provider(state.db.as_ref(), &app_type, &provider_id))
    {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_activate_provider(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app)
        .and_then(|app_type| openwrt_admin::activate_provider(state.db.as_ref(), &app_type, &provider_id))
    {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_upload_codex_auth(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtCodexAuthUploadPayload>,
) -> (StatusCode, Json<Value>) {
    if payload.auth_json_text.as_bytes().len() > codex_auth_upload_limit_bytes() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": format!(
                    "auth_json_text exceeds {} KiB limit",
                    codex_auth_upload_limit_bytes() / 1024
                )
            })),
        );
    }

    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::upload_codex_auth(
            state.db.as_ref(),
            &app_type,
            &provider_id,
            payload.auth_json_text.as_bytes(),
        )
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_remove_codex_auth(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::remove_codex_auth(state.db.as_ref(), &app_type, &provider_id)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_add_to_failover_queue(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::add_to_failover_queue(
            state.db.as_ref(),
            &app_type,
            &provider_id,
        )
        .await
        {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_remove_from_failover_queue(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::remove_from_failover_queue(
            state.db.as_ref(),
            &app_type,
            &provider_id,
        )
        .await
        {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_reorder_failover_queue(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtReorderQueuePayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::reorder_failover_queue(
            state.db.as_ref(),
            &app_type,
            &payload.provider_ids,
        )
        .await
        {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_set_auto_failover_enabled(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtEnabledPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::set_auto_failover_enabled(
            state.db.as_ref(),
            &app_type,
            payload.enabled,
        )
        .await
        {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_set_max_retries(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtMaxRetriesPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::set_max_retries(state.db.as_ref(), &app_type, payload.value).await {
            Ok(view) => openwrt_admin_ok(view),
            Err(error) => openwrt_admin_error(error),
        },
        Err(error) => openwrt_admin_error(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::proxy::{
        failover_switch::FailoverSwitchManager,
        provider_router::ProviderRouter,
        providers::gemini_shadow::GeminiShadowStore,
        rate_limit::new_rate_limit_store,
        types::{ProxyConfig, ProxyStatus},
    };
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn test_proxy_state() -> ProxyState {
        let db = Arc::new(Database::memory().expect("db"));
        let current_providers = Arc::new(RwLock::new(HashMap::new()));

        ProxyState {
            db: db.clone(),
            config: Arc::new(RwLock::new(ProxyConfig::default())),
            status: Arc::new(RwLock::new(ProxyStatus::default())),
            start_time: Arc::new(RwLock::new(None)),
            current_providers: current_providers.clone(),
            provider_router: Arc::new(ProviderRouter::new(db.clone())),
            gemini_shadow: Arc::new(GeminiShadowStore::default()),
            copilot_auth: None,
            codex_oauth_auth: None,
            failover_manager: Arc::new(FailoverSwitchManager::new(db, current_providers)),
            rate_limits: new_rate_limit_store(),
            #[cfg(feature = "tauri-desktop")]
            app_handle: None,
        }
    }

    #[tokio::test]
    async fn openwrt_upload_codex_auth_rejects_oversized_payload() {
        let state = test_proxy_state();
        let payload = OpenWrtCodexAuthUploadPayload {
            auth_json_text: "x".repeat(codex_auth_upload_limit_bytes() + 1),
        };

        let (status, body) = openwrt_upload_codex_auth(
            Path(("codex".to_string(), "provider-1".to_string())),
            State(state),
            Json(payload),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body["error"]
            .as_str()
            .expect("error string")
            .contains("64 KiB limit"));
    }

    #[tokio::test]
    async fn openwrt_get_admin_meta_returns_supported_apps_and_version() {
        let (status, body) = openwrt_get_admin_meta().await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(body["service"]["daemon"], Value::String("cc-switch".to_string()));
        assert_eq!(
            body["service"]["version"],
            Value::String(crate::version::build_version().to_string())
        );

        let apps = body["apps"].as_array().expect("apps array");
        assert_eq!(apps.len(), 3);
        assert_eq!(apps[0]["app"], Value::String("claude".to_string()));
        assert_eq!(apps[1]["app"], Value::String("codex".to_string()));
        assert_eq!(apps[2]["app"], Value::String("gemini".to_string()));
        assert_eq!(apps[1]["supportsCodexAuthUpload"], Value::Bool(true));
        assert_eq!(apps[0]["supportsCodexAuthUpload"], Value::Bool(false));
    }
}
