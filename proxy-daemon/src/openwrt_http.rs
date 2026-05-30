use crate::app_config::AppType;
use crate::openwrt_admin::{
    self, OpenWrtAppConfigPayload, OpenWrtOutboundProxyTestPayload, OpenWrtProviderPayload,
};
use crate::proxy::providers::{
    claude_oauth_store::claude_auth_upload_limit_bytes,
    codex_oauth_store::codex_auth_upload_limit_bytes,
};
use crate::proxy::server::ProxyState;
use crate::services::usage_stats::LogFilters;
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, post, put},
    Json, Router,
};
use futures::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{convert::Infallible, time::Duration};

pub(crate) fn mount_openwrt_admin_routes(router: Router<ProxyState>) -> Router<ProxyState> {
    router
        .route("/openwrt/admin/meta", get(openwrt_get_admin_meta))
        .route("/openwrt/admin/runtime", get(openwrt_get_runtime_status))
        .route(
            "/openwrt/admin/outbound-proxy/test",
            post(openwrt_test_outbound_proxy),
        )
        .route(
            "/openwrt/admin/diagnostics/daemon-log-tail",
            get(openwrt_get_daemon_log_tail),
        )
        .route(
            "/openwrt/admin/backups",
            get(openwrt_list_backups).post(openwrt_create_backup),
        )
        .route("/openwrt/admin/backups/import", post(openwrt_import_backup))
        .route(
            "/openwrt/admin/backups/:filename/download",
            get(openwrt_download_backup),
        )
        .route(
            "/openwrt/admin/backups/:filename",
            delete(openwrt_delete_backup),
        )
        .route(
            "/openwrt/admin/backups/:filename/restore",
            post(openwrt_restore_backup),
        )
        .route("/openwrt/admin/backup", get(openwrt_download_config_backup))
        .route(
            "/openwrt/admin/restore/capability",
            get(openwrt_get_config_restore_capability),
        )
        .route(
            "/openwrt/admin/restore",
            post(openwrt_upload_config_restore).layer(DefaultBodyLimit::max(
                crate::openwrt_backup_restore::MAX_RESTORE_MULTIPART_BYTES,
            )),
        )
        .route(
            "/openwrt/admin/restore/jobs/:job_id",
            get(openwrt_get_config_restore_job),
        )
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
            "/openwrt/admin/apps/:app/request-logs/diagnostics",
            get(openwrt_get_request_log_diagnostics),
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
            "/openwrt/admin/apps/:app/providers/order",
            put(openwrt_reorder_providers),
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
            "/openwrt/admin/apps/:app/providers/:provider_id/latency",
            post(openwrt_test_provider_latency),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/models",
            post(openwrt_fetch_provider_models),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/codex-auth",
            post(openwrt_upload_codex_auth).delete(openwrt_remove_codex_auth),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/claude-auth",
            post(openwrt_upload_claude_auth).delete(openwrt_remove_claude_auth),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/failover",
            get(openwrt_get_provider_failover),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/circuit-breaker",
            get(openwrt_get_circuit_breaker_state),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/circuit-breaker/reset",
            post(openwrt_reset_circuit_breaker),
        )
        .route(
            "/openwrt/admin/apps/:app/providers/:provider_id/stream-check",
            get(openwrt_get_provider_stream_check).post(openwrt_run_provider_stream_check),
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
struct OpenWrtProviderIdListPayload {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtClaudeAuthUploadPayload {
    auth_json_text: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtRequestLogsQuery {
    page: Option<u32>,
    page_size: Option<u32>,
    provider_id: Option<String>,
    provider_name: Option<String>,
    model: Option<String>,
    status_code: Option<u16>,
    failures_only: Option<bool>,
    start_date: Option<i64>,
    end_date: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtRequestLogDiagnosticsQuery {
    provider_id: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtDaemonLogTailQuery {
    lines: Option<u32>,
    max_bytes: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenWrtRestoreQuery {
    dry_run: Option<String>,
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

async fn openwrt_list_backups(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
    match openwrt_admin::list_backups(state.db.as_ref()) {
        Ok(backups) => openwrt_admin_ok(backups),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_create_backup(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
    match openwrt_admin::create_backup(state.db.as_ref()) {
        Ok(backup) => openwrt_admin_ok(backup),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_import_backup(
    Json(payload): Json<openwrt_admin::OpenWrtBackupImportPayload>,
) -> (StatusCode, Json<Value>) {
    if payload.data_base64.len() > crate::database::Database::backup_import_limit_bytes() * 2 {
        return openwrt_admin_error(anyhow::anyhow!(
            "base64 backup payload exceeds import limit"
        ));
    }

    match openwrt_admin::import_backup(payload) {
        Ok(backup) => openwrt_admin_ok(backup),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_download_backup(Path(filename): Path<String>) -> Response {
    match openwrt_admin::read_backup_file(&filename) {
        Ok((entry, bytes)) => (
            StatusCode::OK,
            [
                ("content-type", "application/octet-stream".to_string()),
                (
                    "content-disposition",
                    format!("attachment; filename=\"{}\"", entry.filename),
                ),
                ("content-length", bytes.len().to_string()),
                (
                    "x-cc-switch-schema-version",
                    entry.schema_version.unwrap_or(0).to_string(),
                ),
                (
                    "x-cc-switch-supported-schema-version",
                    entry.supported_schema_version.to_string(),
                ),
            ],
            Bytes::from(bytes),
        )
            .into_response(),
        Err(error) => openwrt_admin_error(error).into_response(),
    }
}

async fn openwrt_delete_backup(Path(filename): Path<String>) -> (StatusCode, Json<Value>) {
    match openwrt_admin::delete_backup(&filename) {
        Ok(deleted) => openwrt_admin_ok(deleted),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_restore_backup(
    Path(filename): Path<String>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match openwrt_admin::restore_backup(state.db.as_ref(), &filename) {
        Ok(restored) => openwrt_admin_ok(restored),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_download_config_backup(State(state): State<ProxyState>) -> Response {
    match crate::openwrt_backup_restore::create_config_backup_archive(state.db.as_ref()) {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "application/gzip".to_string()),
                (
                    header::CONTENT_DISPOSITION,
                    format!(
                        "attachment; filename=\"{}\"",
                        crate::openwrt_backup_restore::config_backup_filename()
                    ),
                ),
                (header::CONTENT_LENGTH, bytes.len().to_string()),
            ],
            Bytes::from(bytes),
        )
            .into_response(),
        Err(error) => openwrt_admin_error(error).into_response(),
    }
}

async fn openwrt_get_config_restore_capability() -> (StatusCode, Json<Value>) {
    openwrt_admin_ok(json!({
        "available": true,
        "backupScope": "full-app",
        "backupEndpoint": "/openwrt/admin/backup",
        "restoreEndpoint": "/openwrt/admin/restore",
        "jobEndpoint": "/openwrt/admin/restore/jobs/:jobId",
        "rollbackSupported": false,
        "jobPersistence": "process",
        "restartDuringRestore": false
    }))
}

async fn openwrt_upload_config_restore(
    State(state): State<ProxyState>,
    Query(query): Query<OpenWrtRestoreQuery>,
    multipart: Multipart,
) -> (StatusCode, Json<Value>) {
    let archive = match read_restore_archive_upload(multipart).await {
        Ok(archive) => archive,
        Err(error) => return openwrt_admin_error(error),
    };

    let dry_run = matches!(
        query.dry_run.as_deref(),
        Some("1") | Some("true") | Some("yes")
    );

    if dry_run {
        match crate::openwrt_backup_restore::validate_config_restore_archive(
            state.db.as_ref(),
            &archive,
        ) {
            Ok(result) => openwrt_admin_ok(result),
            Err(error) => openwrt_admin_error(error),
        }
    } else {
        match crate::openwrt_backup_restore::start_config_restore_job(state.db.clone(), archive) {
            Ok(result) => match serde_json::to_value(result) {
                Ok(Value::Object(map)) => (StatusCode::ACCEPTED, Json(Value::Object(map))),
                Ok(value) => (StatusCode::ACCEPTED, Json(json!({ "value": value }))),
                Err(error) => openwrt_admin_error(anyhow::anyhow!(
                    "failed to serialize restore job response: {error}"
                )),
            },
            Err(error) => openwrt_admin_error(error),
        }
    }
}

async fn openwrt_get_config_restore_job(
    Path(job_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let wants_sse = headers
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false);

    if wants_sse {
        match crate::openwrt_backup_restore::get_restore_job_event(&job_id) {
            Ok(_) => restore_job_sse(job_id).into_response(),
            Err(error) => openwrt_admin_error(error).into_response(),
        }
    } else {
        match crate::openwrt_backup_restore::get_restore_job_event(&job_id) {
            Ok(event) => (StatusCode::OK, Json(event)).into_response(),
            Err(error) => openwrt_admin_error(error).into_response(),
        }
    }
}

async fn read_restore_archive_upload(mut multipart: Multipart) -> anyhow::Result<Vec<u8>> {
    let mut archive = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| anyhow::anyhow!("failed to parse multipart upload: {e}"))?
    {
        if field.name() == Some("archive") {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| anyhow::anyhow!("failed to read archive upload: {e}"))?;
            archive = Some(bytes.to_vec());
            break;
        }
    }
    archive.ok_or_else(|| anyhow::anyhow!("multipart field `archive` is required"))
}

fn restore_job_sse(job_id: String) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = async_stream::stream! {
        let mut sent = 0usize;
        loop {
            match crate::openwrt_backup_restore::get_restore_job_events(&job_id) {
                Ok(events) => {
                    for event in events.iter().skip(sent) {
                        sent += 1;
                        let data = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());
                        yield Ok(Event::default().data(data));
                    }
                    if events.last().map(|event| event.state == "done" || event.state == "failed").unwrap_or(false) {
                        break;
                    }
                }
                Err(error) => {
                    yield Ok(Event::default().data(json!({
                        "step": "validate",
                        "state": "failed",
                        "error": error.to_string(),
                        "rolledBack": false
                    }).to_string()));
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    };
    Sse::new(stream)
}

async fn openwrt_get_runtime_status(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
    match openwrt_admin::get_runtime_status(state.db.as_ref()).await {
        Ok(status) => openwrt_admin_ok(status),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_test_outbound_proxy(
    State(state): State<ProxyState>,
    payload: Option<Json<OpenWrtOutboundProxyTestPayload>>,
) -> (StatusCode, Json<Value>) {
    let payload = payload.map(|Json(payload)| payload).unwrap_or_default();

    match openwrt_admin::test_outbound_proxy(state.db.as_ref(), payload).await {
        Ok(result) => openwrt_admin_ok(result),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_get_daemon_log_tail(
    Query(query): Query<OpenWrtDaemonLogTailQuery>,
) -> (StatusCode, Json<Value>) {
    match openwrt_admin::get_daemon_log_tail(query.lines, query.max_bytes) {
        Ok(tail) => openwrt_admin_ok(tail),
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
        provider_id: normalize_optional_query_filter(query.provider_id),
        provider_name: normalize_optional_query_filter(query.provider_name),
        model: normalize_optional_query_filter(query.model),
        status_code: query.status_code,
        failures_only: query.failures_only.unwrap_or(false),
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

async fn openwrt_get_request_log_diagnostics(
    Path(app): Path<String>,
    Query(query): Query<OpenWrtRequestLogDiagnosticsQuery>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    let provider_id = normalize_optional_query_filter(query.provider_id);
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_request_log_diagnostics(
            state.db.as_ref(),
            &app_type,
            provider_id.as_deref(),
            query.limit,
        )
    }) {
        Ok(diagnostics) => openwrt_admin_ok(diagnostics),
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

async fn openwrt_get_circuit_breaker_state(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::get_circuit_breaker_state(
            state.db.as_ref(),
            state.provider_router.as_ref(),
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

async fn openwrt_reset_circuit_breaker(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::reset_circuit_breaker(
            state.db.as_ref(),
            state.provider_router.as_ref(),
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

async fn openwrt_get_provider_stream_check(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::get_provider_stream_check(state.db.as_ref(), &app_type, &provider_id)
    }) {
        Ok(view) => openwrt_admin_ok(view),
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_run_provider_stream_check(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => match openwrt_admin::run_provider_stream_check(
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
        Ok(view) => {
            if app == "claude" {
                if let Some(provider_id) = view.provider_id.as_deref() {
                    state.claude_uploaded_auth.invalidate(provider_id).await;
                }
            }
            openwrt_admin_ok(view)
        }
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
        Ok(view) => {
            if app == "claude" {
                state.claude_uploaded_auth.invalidate(&provider_id).await;
                if let Some(updated_provider_id) = view.provider_id.as_deref() {
                    if updated_provider_id != provider_id {
                        state
                            .claude_uploaded_auth
                            .invalidate(updated_provider_id)
                            .await;
                    }
                }
            }
            openwrt_admin_ok(view)
        }
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
        Ok(view) => {
            if app == "claude" {
                if let Some(provider_id) = view.provider_id.as_deref() {
                    state.claude_uploaded_auth.invalidate(provider_id).await;
                }
            }
            openwrt_admin_ok(view)
        }
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
        Ok(view) => {
            if app == "claude" {
                state
                    .claude_uploaded_auth
                    .invalidate(&view.deleted_provider_id)
                    .await;
            }
            openwrt_admin_ok(view)
        }
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

async fn openwrt_test_provider_latency(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => {
            match openwrt_admin::test_provider_latency(state.db.as_ref(), &app_type, &provider_id)
                .await
            {
                Ok(view) => openwrt_admin_ok(view),
                Err(error) => openwrt_admin_error(error),
            }
        }
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_fetch_provider_models(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app) {
        Ok(app_type) => {
            match openwrt_admin::fetch_provider_models(state.db.as_ref(), &app_type, &provider_id)
                .await
            {
                Ok(view) => openwrt_admin_ok(view),
                Err(error) => openwrt_admin_error(error),
            }
        }
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_reorder_providers(
    Path(app): Path<String>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtProviderIdListPayload>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::reorder_providers(state.db.as_ref(), &app_type, &payload.provider_ids)
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

async fn openwrt_upload_claude_auth(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
    Json(payload): Json<OpenWrtClaudeAuthUploadPayload>,
) -> (StatusCode, Json<Value>) {
    if payload.auth_json_text.as_bytes().len() > claude_auth_upload_limit_bytes() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": format!(
                    "auth_json_text exceeds {} KiB limit",
                    claude_auth_upload_limit_bytes() / 1024
                )
            })),
        );
    }

    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::upload_claude_auth(
            state.db.as_ref(),
            &app_type,
            &provider_id,
            payload.auth_json_text.as_bytes(),
        )
    }) {
        Ok(view) => {
            state.claude_uploaded_auth.invalidate(&provider_id).await;
            openwrt_admin_ok(view)
        }
        Err(error) => openwrt_admin_error(error),
    }
}

async fn openwrt_remove_claude_auth(
    Path((app, provider_id)): Path<(String, String)>,
    State(state): State<ProxyState>,
) -> (StatusCode, Json<Value>) {
    match parse_openwrt_app(&app).and_then(|app_type| {
        openwrt_admin::remove_claude_auth(state.db.as_ref(), &app_type, &provider_id)
    }) {
        Ok(view) => {
            state.claude_uploaded_auth.invalidate(&provider_id).await;
            openwrt_admin_ok(view)
        }
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
    Json(payload): Json<OpenWrtProviderIdListPayload>,
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
    use crate::provider::Provider;
    use crate::proxy::{
        failover_switch::FailoverSwitchManager,
        provider_router::ProviderRouter,
        providers::{codex_chat_history::CodexChatHistoryStore, gemini_shadow::GeminiShadowStore},
        quota_cache::RateLimitSnapshotCache,
        rate_limit::new_rate_limit_store,
        types::{ProxyConfig, ProxyStatus},
    };
    use crate::services::stream_check::{HealthStatus, StreamCheckResult};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    const SECRET_PROVIDER_ERROR: &str =
        "upstream timeout Authorization: Bearer sk-ant-secret-token access_token=secret-token";

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
            codex_chat_history: Arc::new(CodexChatHistoryStore::default()),
            copilot_auth: None,
            codex_oauth_auth: None,
            failover_manager: Arc::new(FailoverSwitchManager::new(db, current_providers)),
            rate_limits: new_rate_limit_store(),
            quota_snapshot_cache: RateLimitSnapshotCache::new(),
            claude_uploaded_auth: crate::services::oauth_refresh::ClaudeUploadedAuthManager::new(),
            oauth_refresh_locks: crate::services::oauth_refresh::OAuthRefreshLockManager::new(),
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

    fn assert_secret_redacted(value: &Value) {
        let message = value.as_str().expect("diagnostic error string");
        assert!(message.contains("[REDACTED]"));
        assert!(!message.contains("sk-ant-secret-token"));
        assert!(!message.contains("secret-token"));
    }

    async fn seed_unhealthy_provider_with_secret_error(
        state: &ProxyState,
        app_type: &str,
        provider_id: &str,
    ) {
        let provider = crate::provider::Provider::with_id(
            provider_id.to_string(),
            "Health Provider".to_string(),
            json!({}),
            None,
        );
        state
            .db
            .save_provider(app_type, &provider)
            .expect("save provider");
        state
            .db
            .set_current_provider(app_type, provider_id)
            .expect("set current provider");
        state
            .db
            .add_to_failover_queue(app_type, provider_id)
            .expect("add provider to failover queue");
        state
            .db
            .update_provider_health_with_threshold(
                provider_id,
                app_type,
                false,
                Some(SECRET_PROVIDER_ERROR.to_string()),
                1,
            )
            .await
            .expect("mark provider unhealthy");
    }

    async fn seed_open_circuit_provider(state: &ProxyState, app_type: &str, provider_id: &str) {
        let provider = crate::provider::Provider::with_id(
            provider_id.to_string(),
            "Circuit Provider".to_string(),
            json!({}),
            None,
        );
        state
            .db
            .save_provider(app_type, &provider)
            .expect("save provider");

        let mut config = state
            .db
            .get_proxy_config_for_app(app_type)
            .await
            .expect("app proxy config");
        config.circuit_failure_threshold = 1;
        state
            .db
            .update_proxy_config_for_app(config)
            .await
            .expect("update app proxy config");

        state
            .provider_router
            .record_result(
                provider_id,
                app_type,
                false,
                false,
                Some(SECRET_PROVIDER_ERROR.to_string()),
            )
            .await
            .expect("record failed provider result");
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
    async fn openwrt_upload_claude_auth_rejects_oversized_payload() {
        let state = test_proxy_state();
        let payload = OpenWrtClaudeAuthUploadPayload {
            auth_json_text: "x".repeat(claude_auth_upload_limit_bytes() + 1),
        };

        let (status, body) = openwrt_upload_claude_auth(
            Path(("claude".to_string(), "provider-1".to_string())),
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
        assert_eq!(
            body["service"]["backupScope"],
            Value::String("full-app".to_string())
        );
        assert_eq!(
            body["service"]["databaseFile"],
            Value::String("cc-switch.db".to_string())
        );
        assert_eq!(
            body["service"]["supportedSchemaVersion"],
            Value::from(crate::database::Database::supported_schema_version())
        );

        let apps = body["apps"].as_array().expect("apps array");
        assert_eq!(apps.len(), 3);
        assert_eq!(apps[0]["app"], Value::String("claude".to_string()));
        assert_eq!(apps[1]["app"], Value::String("codex".to_string()));
        assert_eq!(apps[2]["app"], Value::String("gemini".to_string()));
        assert_eq!(apps[0]["supportsClaudeAuthUpload"], Value::Bool(true));
        assert_eq!(apps[1]["supportsCodexAuthUpload"], Value::Bool(true));
        assert_eq!(apps[0]["supportsCodexAuthUpload"], Value::Bool(false));
    }

    #[tokio::test]
    async fn openwrt_get_provider_stream_check_returns_openwrt_error_envelope() {
        let state = test_proxy_state();

        let (status, body) = openwrt_get_provider_stream_check(
            Path(("claude".to_string(), "missing-provider".to_string())),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(false));
        assert!(body["error"]
            .as_str()
            .expect("error string")
            .contains("missing-provider"));
    }

    #[tokio::test]
    async fn openwrt_get_provider_stream_check_preserves_error_category() {
        let state = test_proxy_state();
        let provider = Provider::with_id(
            "provider-a".to_string(),
            "Provider A".to_string(),
            json!({}),
            None,
        );
        state
            .db
            .save_provider("claude", &provider)
            .expect("save provider");
        state
            .db
            .save_stream_check_log(
                "provider-a",
                "Provider A",
                "claude",
                &StreamCheckResult {
                    status: HealthStatus::Failed,
                    success: false,
                    message: "model missing".to_string(),
                    response_time_ms: Some(12),
                    http_status: Some(404),
                    model_used: "claude-test".to_string(),
                    tested_at: 1234,
                    retry_count: 0,
                    error_category: Some("modelNotFound".to_string()),
                },
            )
            .expect("save stream check");

        let (status, body) = openwrt_get_provider_stream_check(
            Path(("claude".to_string(), "provider-a".to_string())),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(
            body["check"]["errorCategory"],
            Value::String("modelNotFound".to_string())
        );
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
    async fn openwrt_get_request_logs_accepts_provider_id_filter() {
        let state = test_proxy_state();
        insert_request_log(
            state.db.as_ref(),
            "req-claude-a",
            "provider-a",
            "claude",
            "claude-sonnet",
            200,
            100,
        );
        insert_request_log(
            state.db.as_ref(),
            "req-claude-b",
            "provider-b",
            "claude",
            "claude-opus",
            200,
            200,
        );

        let (status, body) = openwrt_get_request_logs(
            Path("claude".to_string()),
            Query(OpenWrtRequestLogsQuery {
                page: Some(0),
                page_size: Some(20),
                provider_id: Some("provider-b".to_string()),
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
            Value::String("req-claude-b".to_string())
        );
        assert_eq!(
            body["data"][0]["providerId"],
            Value::String("provider-b".to_string())
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
    async fn openwrt_get_provider_failover_redacts_provider_health_last_error() {
        let state = test_proxy_state();
        seed_unhealthy_provider_with_secret_error(&state, "claude", "provider-a").await;

        let (status, body) = openwrt_get_provider_failover(
            Path(("claude".to_string(), "provider-a".to_string())),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_secret_redacted(&body["providerHealth"]["lastError"]);
        assert_secret_redacted(&body["failoverQueue"][0]["health"]["lastError"]);
    }

    #[tokio::test]
    async fn openwrt_get_app_runtime_status_redacts_provider_health_last_error() {
        let state = test_proxy_state();
        seed_unhealthy_provider_with_secret_error(&state, "claude", "provider-a").await;

        let (status, body) =
            openwrt_get_app_runtime_status(Path("claude".to_string()), State(state)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_secret_redacted(&body["activeProviderHealth"]["lastError"]);
        assert_secret_redacted(&body["failoverQueue"][0]["health"]["lastError"]);
    }

    #[tokio::test]
    async fn openwrt_get_circuit_breaker_state_returns_live_stats_and_health() {
        let state = test_proxy_state();
        seed_open_circuit_provider(&state, "claude", "provider-a").await;
        insert_request_log(
            state.db.as_ref(),
            "req-failed",
            "provider-a",
            "claude",
            "claude-sonnet",
            502,
            300,
        );

        let (status, body) = openwrt_get_circuit_breaker_state(
            Path(("claude".to_string(), "provider-a".to_string())),
            State(state),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(body["app"], Value::String("claude".to_string()));
        assert_eq!(body["providerId"], Value::String("provider-a".to_string()));
        assert_eq!(body["liveRuntimeReachable"], Value::Bool(true));
        assert_eq!(body["source"], Value::String("runtime-router".to_string()));
        assert_eq!(body["state"], Value::String("open".to_string()));
        assert_eq!(
            body["stateReason"],
            Value::String("failure_threshold".to_string())
        );
        let last_failure = body["lastFailure"]["message"]
            .as_str()
            .expect("top-level last failure message");
        assert!(last_failure.contains("[REDACTED]"));
        assert!(!last_failure.contains("sk-ant-secret-token"));
        assert!(!last_failure.contains("secret-token"));
        assert_eq!(body["stats"]["state"], Value::String("open".to_string()));
        assert_eq!(body["stats"]["failedRequests"], Value::from(1));
        assert_eq!(
            body["stats"]["stateReason"],
            Value::String("failure_threshold".to_string())
        );
        let stats_last_failure = body["stats"]["lastFailure"]["message"]
            .as_str()
            .expect("stats last failure message");
        assert!(stats_last_failure.contains("[REDACTED]"));
        assert!(!stats_last_failure.contains("sk-ant-secret-token"));
        assert!(!stats_last_failure.contains("secret-token"));
        let stats_recent_failure = body["stats"]["recentFailures"][0]["message"]
            .as_str()
            .expect("stats recent failure message");
        assert!(stats_recent_failure.contains("[REDACTED]"));
        assert!(!stats_recent_failure.contains("sk-ant-secret-token"));
        assert!(!stats_recent_failure.contains("secret-token"));
        assert_eq!(
            body["recentFailures"][0]["requestId"],
            Value::String("req-failed".to_string())
        );
        assert_eq!(body["recentFailures"][0]["statusCode"], Value::from(502));
        assert_eq!(body["providerHealth"]["observed"], Value::Bool(true));
        assert_eq!(body["providerHealth"]["healthy"], Value::Bool(false));
        assert_eq!(
            body["providerHealth"]["consecutiveFailures"],
            Value::from(1)
        );
        let provider_last_error = body["providerHealth"]["lastError"]
            .as_str()
            .expect("provider health last error");
        assert!(provider_last_error.contains("[REDACTED]"));
        assert!(!provider_last_error.contains("sk-ant-secret-token"));
        assert!(!provider_last_error.contains("secret-token"));
    }

    #[tokio::test]
    async fn openwrt_reset_circuit_breaker_resets_health_and_live_state() {
        let state = test_proxy_state();
        seed_open_circuit_provider(&state, "claude", "provider-a").await;

        let (status, body) = openwrt_reset_circuit_breaker(
            Path(("claude".to_string(), "provider-a".to_string())),
            State(state.clone()),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["ok"], Value::Bool(true));
        assert_eq!(body["providerId"], Value::String("provider-a".to_string()));
        assert_eq!(body["providerHealth"]["observed"], Value::Bool(true));
        assert_eq!(body["providerHealth"]["healthy"], Value::Bool(true));
        assert_eq!(
            body["providerHealth"]["consecutiveFailures"],
            Value::from(0)
        );
        assert_eq!(body["providerHealth"]["lastError"], Value::Null);
        assert_eq!(
            body["resetResult"]["previousState"],
            Value::String("open".to_string())
        );
        assert_eq!(
            body["resetResult"]["currentState"],
            Value::String("closed".to_string())
        );
        assert_eq!(body["resetResult"]["healthReset"], Value::Bool(true));
        assert_eq!(
            body["circuitBreaker"]["state"],
            Value::String("closed".to_string())
        );
        assert_eq!(
            body["circuitBreaker"]["stats"]["state"],
            Value::String("closed".to_string())
        );
        assert_eq!(
            body["circuitBreaker"]["stats"]["failedRequests"],
            Value::from(0)
        );
        let reset_stats_last_failure = body["circuitBreaker"]["stats"]["lastFailure"]["message"]
            .as_str()
            .expect("reset stats last failure message");
        assert!(reset_stats_last_failure.contains("[REDACTED]"));
        assert!(!reset_stats_last_failure.contains("sk-ant-secret-token"));
        assert!(!reset_stats_last_failure.contains("secret-token"));

        let persisted_health = state
            .db
            .get_provider_health("provider-a", "claude")
            .await
            .expect("persisted provider health");
        assert!(persisted_health.is_healthy);
        assert_eq!(persisted_health.consecutive_failures, 0);
        assert_eq!(persisted_health.last_error, None);

        let live_stats = state
            .provider_router
            .get_circuit_breaker_stats("provider-a", "claude")
            .await
            .expect("live breaker stats");
        assert_eq!(live_stats.state, crate::proxy::CircuitState::Closed);
        assert_eq!(live_stats.failed_requests, 0);
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
