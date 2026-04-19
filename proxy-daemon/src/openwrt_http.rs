use crate::app_config::AppType;
use crate::openwrt_admin::{self, OpenWrtAppConfigPayload, OpenWrtProviderPayload};
use crate::proxy::providers::codex_oauth_store::codex_auth_upload_limit_bytes;
use crate::proxy::server::ProxyState;
use crate::services::usage_stats::LogFilters;
use axum::{
    extract::{Path, Query, State},
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
            "/openwrt/admin/apps/:app/config",
            get(openwrt_get_app_config).put(openwrt_update_app_config),
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
            "/openwrt/admin/apps/:app/request-logs",
            get(openwrt_get_request_logs),
        )
        .route(
            "/openwrt/admin/apps/:app/request-logs/:request_id",
            get(openwrt_get_request_detail),
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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtRequestLogsQuery {
    page: Option<u32>,
    page_size: Option<u32>,
    provider_name: Option<String>,
    model: Option<String>,
    status_code: Option<u16>,
    start_date: Option<i64>,
    end_date: Option<i64>,
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

fn normalize_optional_query_filter(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

async fn openwrt_get_admin_meta() -> (StatusCode, Json<Value>) {
    match openwrt_admin::get_admin_meta() {
        Ok(meta) => openwrt_admin_ok(meta),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_runtime_status(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
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
        Ok(app_type) => {
            match openwrt_admin::get_app_runtime_status(state.db.as_ref(), &app_type).await {
                Ok(status) => openwrt_admin_ok(status),
                Err(error) => openwrt_admin_error(error),
            }
        }
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_app_config(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => {
            match openwrt_admin::get_app_proxy_config(state.db.as_ref(), &app_type).await {
                Ok(config) => openwrt_admin_ok(config),
                Err(error) => openwrt_admin_error(error),
            }
        }
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

async fn openwrt_get_request_logs(
    Path(app): Path<String>,
    Query(query): Query<OpenWrtRequestLogsQuery>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    let filters = LogFilters {
        provider_name: normalize_optional_query_filter(query.provider_name),
        model: normalize_optional_query_filter(query.model),
        status_code: query.status_code,
        start_date: query.start_date,
        end_date: query.end_date,
        ..Default::default()
    };

    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_request_logs(
            state.db.as_ref(),
            &app_type,
            query.page,
            query.page_size,
            filters,
        )
    }) {
        Ok(logs) => openwrt_admin_ok(logs),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_request_detail(
    Path((app, request_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_request_detail(state.db.as_ref(), &app_type, &request_id)
    }) {
        Ok(detail) => openwrt_admin_ok(detail),
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
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_provider(state.db.as_ref(), &app_type, &provider_id)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_provider_failover(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => {
            match openwrt_admin::get_provider_failover(state.db.as_ref(), &app_type, &provider_id)
                .await
            {
                Ok(view) => openwrt_admin_ok(view),
                Err(error) => openwrt_admin_error(error),
            }
        }
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
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::delete_provider(state.db.as_ref(), &app_type, &provider_id)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_activate_provider(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::activate_provider(state.db.as_ref(), &app_type, &provider_id)
    }) {
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
        Ok(app_type) => {
            match openwrt_admin::add_to_failover_queue(state.db.as_ref(), &app_type, &provider_id)
                .await
            {
                Ok(view) => openwrt_admin_ok(view),
                Err(error) => openwrt_admin_error(error),
            }
        }
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
        Ok(app_type) => {
            match openwrt_admin::set_max_retries(state.db.as_ref(), &app_type, payload.value).await
            {
                Ok(view) => openwrt_admin_ok(view),
                Err(error) => openwrt_admin_error(error),
            }
        }
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_update_app_config(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtAppConfigPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => {
            match openwrt_admin::update_app_proxy_config(state.db.as_ref(), &app_type, payload)
                .await
            {
                Ok(config) => openwrt_admin_ok(config),
                Err(error) => openwrt_admin_error(error),
            }
        }
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

    fn insert_request_log(
        db: &Database,
        request_id: &str,
        provider_id: &str,
        app_type: &str,
        model: &str,
        status_code: u16,
        created_at: i64,
    ) {
        let conn = db.conn.lock().expect("lock conn");
        conn.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model,
                input_tokens, output_tokens, total_cost_usd,
                latency_ms, status_code, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                request_id,
                provider_id,
                app_type,
                model,
                120,
                48,
                "0.012300",
                245,
                status_code,
                created_at
            ],
        )
        .expect("insert request log");
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
        assert_eq!(
            body["service"]["daemon"],
            Value::String("cc-switch".to_string())
        );
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

    #[tokio::test]
    async fn openwrt_get_request_logs_returns_scoped_page() {
        let state = test_proxy_state();
        insert_request_log(
            state.db.as_ref(),
            "req-claude",
            "provider-a",
            "claude",
            "claude-sonnet",
            200,
            100,
        );
        insert_request_log(
            state.db.as_ref(),
            "req-codex",
            "provider-b",
            "codex",
            "gpt-5.4",
            200,
            200,
        );

        let (status, body) = openwrt_get_request_logs(
            Path("claude".to_string()),
            Query(OpenWrtRequestLogsQuery {
                page: Some(0),
                page_size: Some(5),
                ..Default::default()
            }),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(body["total"], Value::from(1));
        assert_eq!(
            body["data"][0]["requestId"],
            Value::String("req-claude".to_string())
        );
    }

    #[tokio::test]
    async fn openwrt_get_request_detail_rejects_cross_app_lookup() {
        let state = test_proxy_state();
        insert_request_log(
            state.db.as_ref(),
            "req-codex",
            "provider-b",
            "codex",
            "gpt-5.4",
            200,
            200,
        );

        let (status, body) = openwrt_get_request_detail(
            Path(("claude".to_string(), "req-codex".to_string())),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(false));
        assert!(body["error"]
            .as_str()
            .expect("error string")
            .contains("request log `req-codex` not found for claude"));
    }

    #[tokio::test]
    async fn openwrt_update_app_config_persists_payload_for_path_app() {
        let state = test_proxy_state();
        let payload = OpenWrtAppConfigPayload {
            enabled: true,
            auto_failover_enabled: true,
            max_retries: 9,
            streaming_first_byte_timeout: 75,
            streaming_idle_timeout: 180,
            non_streaming_timeout: 900,
            circuit_failure_threshold: 7,
            circuit_success_threshold: 3,
            circuit_timeout_seconds: 120,
            circuit_error_rate_threshold: 0.55,
            circuit_min_requests: 14,
        };

        let (status, body) = openwrt_update_app_config(
            Path("codex".to_string()),
            State(state.clone()),
            Json(payload),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(body["appType"], Value::String("codex".to_string()));
        assert_eq!(body["enabled"], Value::Bool(true));
        assert_eq!(body["maxRetries"], Value::from(9));
        assert_eq!(body["circuitErrorRateThreshold"], Value::from(0.55));

        let persisted = state
            .db
            .get_proxy_config_for_app("codex")
            .await
            .expect("persisted app config");
        assert!(persisted.enabled);
        assert!(persisted.auto_failover_enabled);
        assert_eq!(persisted.max_retries, 9);
        assert_eq!(persisted.streaming_first_byte_timeout, 75);
        assert_eq!(persisted.circuit_min_requests, 14);
    }

    #[tokio::test]
    async fn openwrt_update_app_config_rejects_invalid_thresholds() {
        let state = test_proxy_state();
        let payload = OpenWrtAppConfigPayload {
            enabled: true,
            auto_failover_enabled: false,
            max_retries: 3,
            streaming_first_byte_timeout: 60,
            streaming_idle_timeout: 120,
            non_streaming_timeout: 600,
            circuit_failure_threshold: 4,
            circuit_success_threshold: 2,
            circuit_timeout_seconds: 60,
            circuit_error_rate_threshold: 1.5,
            circuit_min_requests: 10,
        };

        let (status, body) =
            openwrt_update_app_config(Path("claude".to_string()), State(state), Json(payload))
                .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(false));
        assert!(body["error"]
            .as_str()
            .expect("error string")
            .contains("between 0 and 1"));
    }
}
