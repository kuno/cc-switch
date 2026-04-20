//! 请求处理器
//!
//! 处理各种API端点的HTTP请求
//!
//! 重构后的结构：
//! - 通用逻辑提取到 `handler_context` 和 `response_processor` 模块
//! - 各 handler 只保留独特的业务逻辑
//! - Claude 的格式转换逻辑保留在此文件（用于 OpenRouter 旧接口回退）

use super::{
    error_mapper::{get_error_message, map_proxy_error_to_status},
    handler_config::{
        CLAUDE_PARSER_CONFIG, CODEX_PARSER_CONFIG, GEMINI_PARSER_CONFIG, OPENAI_PARSER_CONFIG,
    },
    handler_context::RequestContext,
    providers::{
        get_adapter, get_claude_api_format, streaming::create_anthropic_sse_stream,
        streaming_gemini::create_anthropic_sse_stream_from_gemini,
        streaming_responses::create_anthropic_sse_stream_from_responses, transform,
        transform_gemini, transform_responses,
    },
    response_processor::{
        create_logged_passthrough_stream, process_response, read_decoded_body,
        strip_entity_headers_for_rebuilt_body, strip_hop_by_hop_response_headers,
        SseUsageCollector,
    },
    server::{populate_status_active_targets, ProxyState},
    sse::{strip_sse_field, take_sse_block},
    types::*,
    usage::parser::TokenUsage,
    ProxyError,
};
use crate::app_config::AppType;
use crate::services::oauth_refresh::storage::{
    load_claude_refresh_auth_for_provider, load_codex_refresh_auth_for_provider,
    save_refreshed_claude_auth_for_provider, save_refreshed_codex_auth_for_provider,
};
use crate::services::oauth_refresh::{
    load_or_refresh_oauth_credentials, ClaudeTokenRefresher, CodexTokenRefresher,
    OAuthTokenRefresher,
};
use crate::services::subscription::{query_claude_quota, query_codex_quota, SubscriptionQuota};
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use bytes::Bytes;
use futures::future::join_all;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::future::Future;

const CODEX_OFFICIAL_PROVIDER_ID: &str = "codex-official";
const CODEX_OAUTH_AUTH_MODE: &str = "codex_oauth";
const CODEX_LEGACY_CLIENT_PASSTHROUGH_AUTH_MODE: &str = "client_passthrough";
const CLAUDE_OAUTH_AUTH_MODE: &str = "claude_oauth";

// ============================================================================
// 健康检查和状态查询（简单端点）
// ============================================================================

/// 健康检查
pub async fn health_check() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "healthy",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

fn is_codex_oauth_provider(provider: &crate::provider::Provider) -> bool {
    provider.id == CODEX_OFFICIAL_PROVIDER_ID
        || provider
            .meta
            .as_ref()
            .and_then(|meta| meta.provider_type.as_deref())
            == Some(CODEX_OAUTH_AUTH_MODE)
        || provider
            .settings_config
            .get("auth_mode")
            .and_then(Value::as_str)
            .is_some_and(|auth_mode| {
                matches!(
                    auth_mode,
                    CODEX_OAUTH_AUTH_MODE | CODEX_LEGACY_CLIENT_PASSTHROUGH_AUTH_MODE
                )
            })
}

fn is_claude_oauth_provider(provider: &crate::provider::Provider) -> bool {
    provider
        .settings_config
        .get("auth_mode")
        .and_then(Value::as_str)
        == Some(CLAUDE_OAUTH_AUTH_MODE)
}

fn quota_cache_key(app_type: &str, provider_id: &str) -> String {
    format!("{app_type}:{provider_id}")
}

fn subscription_quota_error(quota: &SubscriptionQuota) -> String {
    quota
        .error
        .clone()
        .unwrap_or_else(|| "unknown upstream error".to_string())
}

async fn build_subscription_quota_snapshot(
    state: &ProxyState,
    app_type: &str,
    provider_id: &str,
    provider_name: &str,
    quota: SubscriptionQuota,
) -> Result<super::rate_limit::RateLimitSnapshot, String> {
    if !quota.success {
        return Err(subscription_quota_error(&quota));
    }

    let previous = {
        let store = state.rate_limits.read().await;
        store.get(provider_id).cloned()
    };

    super::rate_limit::snapshot_from_subscription_quota(
        app_type,
        provider_id,
        provider_name,
        &quota,
        previous.as_ref(),
    )
    .ok_or_else(|| subscription_quota_error(&quota))
}

async fn refresh_cached_quota_snapshot<F, Fut>(
    state: &ProxyState,
    app_type: &str,
    provider_id: String,
    provider_name: String,
    refresh: F,
) -> Option<super::rate_limit::RateLimitSnapshot>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<super::rate_limit::RateLimitSnapshot, String>>,
{
    match state
        .quota_snapshot_cache
        .get_or_refresh(&quota_cache_key(app_type, &provider_id), refresh)
        .await
    {
        Ok(mut snapshot) => {
            snapshot.app_type = app_type.to_string();
            snapshot.provider_id = provider_id;
            snapshot.provider_name = provider_name;
            Some(snapshot)
        }
        Err(_) => None,
    }
}

async fn refresh_codex_quota_snapshots_with_query_and_refresher<F, Fut, R>(
    state: &ProxyState,
    query_quota: F,
    refresher: &R,
) where
    F: Fn(String, Option<String>) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
    R: OAuthTokenRefresher,
{
    let providers = match state.db.get_all_providers("codex") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!("[Quota] failed to list codex providers for live quota refresh: {error}");
            return;
        }
    };

    let mut live_refresh_provider_ids = HashSet::new();
    let mut live_fetches = Vec::new();

    for provider in providers.into_values().filter(is_codex_oauth_provider) {
        let auth_provider_id = provider.id.clone();
        let provider_key = format!("codex:{auth_provider_id}");
        let Some(auth) = load_or_refresh_oauth_credentials(
            "Codex",
            &auth_provider_id,
            &provider_key,
            refresher,
            &state.oauth_refresh_locks,
            || load_codex_refresh_auth_for_provider(&auth_provider_id),
            |stored, refreshed| {
                save_refreshed_codex_auth_for_provider(&auth_provider_id, stored, refreshed)
            },
        )
        .await
        else {
            continue;
        };
        let query_quota = query_quota.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();

        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(refresh_cached_quota_snapshot(
            state,
            "codex",
            provider_id.clone(),
            provider_name.clone(),
            move || async move {
                let quota = query_quota(auth.access_token.clone(), auth.account_id.clone()).await;

                build_subscription_quota_snapshot(
                    state,
                    "codex",
                    &provider_id,
                    &provider_name,
                    quota,
                )
                .await
            },
        ));
    }

    {
        let mut store = state.rate_limits.write().await;
        store.retain(|_, snapshot| {
            !(snapshot.app_type == "codex"
                && snapshot.source.as_deref() == Some("subscription_quota")
                && !live_refresh_provider_ids.contains(&snapshot.provider_id))
        });
    }

    if live_fetches.is_empty() {
        return;
    }

    let refreshed = join_all(live_fetches).await;
    let mut store = state.rate_limits.write().await;
    for snapshot in refreshed.into_iter().flatten() {
        store.insert(snapshot.provider_id.clone(), snapshot);
    }
}

async fn refresh_codex_quota_snapshots(state: &ProxyState) {
    let refresher = CodexTokenRefresher::new();
    refresh_codex_quota_snapshots_with_query_and_refresher(
        state,
        |access_token: String, account_id: Option<String>| async move {
            query_codex_quota(
                &access_token,
                account_id.as_deref(),
                "codex_oauth",
                "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
            )
            .await
        },
        &refresher,
    )
    .await;
}

/// Reconcile stored Claude rate-limit snapshots before serving `/api/quota`.
///
/// Retain rules:
/// - keep non-Claude snapshots untouched;
/// - evict Claude snapshots whose provider no longer exists in the DB;
/// - keep header-captured Claude snapshots (`source != "subscription_quota"`);
/// - evict `subscription_quota` snapshots for providers that will not be
///   refreshed in this cycle.
async fn refresh_claude_quota_snapshots_with_query_and_refresher<F, Fut, R>(
    state: &ProxyState,
    query_quota: F,
    refresher: &R,
) where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
    R: OAuthTokenRefresher,
{
    let providers = match state.db.get_all_providers("claude") {
        Ok(providers) => providers,
        Err(error) => {
            log::warn!(
                "[Quota] failed to list claude providers for stale snapshot cleanup: {error}"
            );
            return;
        }
    };

    let live_claude_provider_ids: HashSet<String> = providers.keys().cloned().collect();
    let mut live_refresh_provider_ids = HashSet::new();
    let mut live_fetches = Vec::new();

    for provider in providers.into_values().filter(is_claude_oauth_provider) {
        let auth_provider_id = provider.id.clone();
        let provider_key = format!("claude:{auth_provider_id}");
        let Some(auth) = load_or_refresh_oauth_credentials(
            "Claude",
            &auth_provider_id,
            &provider_key,
            refresher,
            &state.oauth_refresh_locks,
            || load_claude_refresh_auth_for_provider(&auth_provider_id),
            |stored, refreshed| {
                save_refreshed_claude_auth_for_provider(&auth_provider_id, stored, refreshed)
            },
        )
        .await
        else {
            continue;
        };

        let query_quota = query_quota.clone();
        let provider_id = provider.id.clone();
        let provider_name = provider.name.clone();
        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(refresh_cached_quota_snapshot(
            state,
            "claude",
            provider_id.clone(),
            provider_name.clone(),
            move || async move {
                let quota = query_quota(auth.access_token.clone()).await;
                build_subscription_quota_snapshot(
                    state,
                    "claude",
                    &provider_id,
                    &provider_name,
                    quota,
                )
                .await
            },
        ));
    }

    let mut store = state.rate_limits.write().await;
    store.retain(|_, snapshot| {
        if snapshot.app_type != "claude" {
            return true;
        }

        if !live_claude_provider_ids.contains(&snapshot.provider_id) {
            return false;
        }

        if snapshot.source.as_deref() != Some("subscription_quota") {
            return true;
        }

        live_refresh_provider_ids.contains(&snapshot.provider_id)
    });

    drop(store);

    if live_fetches.is_empty() {
        return;
    }

    let refreshed = join_all(live_fetches).await;
    let mut store = state.rate_limits.write().await;
    for snapshot in refreshed.into_iter().flatten() {
        store.insert(snapshot.provider_id.clone(), snapshot);
    }
}

async fn refresh_claude_quota_snapshots_with_query<F, Fut>(state: &ProxyState, query_quota: F)
where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
{
    let refresher = ClaudeTokenRefresher::new();
    refresh_claude_quota_snapshots_with_query_and_refresher(state, query_quota, &refresher).await;
}

async fn refresh_claude_quota_snapshots(state: &ProxyState) {
    refresh_claude_quota_snapshots_with_query(state, |access_token: String| async move {
        query_claude_quota(&access_token).await
    })
    .await;
}

pub async fn get_quota(State(state): State<ProxyState>) -> (StatusCode, Json<Value>) {
    refresh_codex_quota_snapshots(&state).await;
    refresh_claude_quota_snapshots(&state).await;
    let store = state.rate_limits.read().await;
    let providers: Vec<_> = store.values().cloned().collect();
    (
        StatusCode::OK,
        Json(json!({
            "providers": providers,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        })),
    )
}

/// 获取服务状态
pub async fn get_status(State(state): State<ProxyState>) -> Result<Json<ProxyStatus>, ProxyError> {
    let mut status = state.status.read().await.clone();

    if let Some(start) = *state.start_time.read().await {
        status.uptime_seconds = start.elapsed().as_secs();
    }

    let current_providers = state.current_providers.read().await;
    populate_status_active_targets(&mut status, &current_providers);

    Ok(Json(status))
}

// ============================================================================
// Claude API 处理器（包含格式转换逻辑）
// ============================================================================

/// 处理 /v1/messages 请求（Claude API）
///
/// Claude 处理器包含独特的格式转换逻辑：
/// - 过去用于 OpenRouter 的 OpenAI Chat Completions 兼容接口（Anthropic ↔ OpenAI 转换）
/// - 现在 OpenRouter 已推出 Claude Code 兼容接口，默认不再启用该转换（逻辑保留以备回退）
pub async fn handle_messages(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Claude, "Claude", "claude").await?;

    let endpoint = uri
        .path_and_query()
        .map(|path_and_query| path_and_query.as_str())
        .unwrap_or(uri.path());

    let is_stream = body
        .get("stream")
        .and_then(|s| s.as_bool())
        .unwrap_or(false);

    // 转发请求
    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Claude,
            endpoint,
            body.clone(),
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let api_format = result
        .claude_api_format
        .as_deref()
        .unwrap_or_else(|| get_claude_api_format(&ctx.provider))
        .to_string();
    let response = result.response;

    // 检查是否需要格式转换（OpenRouter 等中转服务）
    let adapter = get_adapter(&AppType::Claude);
    let needs_transform = adapter.needs_transform(&ctx.provider);

    // Claude 特有：格式转换处理
    if needs_transform {
        return handle_claude_transform(response, &ctx, &state, &body, is_stream, &api_format)
            .await;
    }

    // 通用响应处理（透传模式）
    process_response(response, &ctx, &state, &CLAUDE_PARSER_CONFIG, is_stream).await
}

/// Claude 格式转换处理（独有逻辑）
///
/// 支持 OpenAI Chat Completions 和 Responses API 两种格式的转换
async fn handle_claude_transform(
    response: super::hyper_client::ProxyResponse,
    ctx: &RequestContext,
    state: &ProxyState,
    original_body: &Value,
    is_stream: bool,
    api_format: &str,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    let is_codex_oauth = ctx
        .provider
        .meta
        .as_ref()
        .and_then(|meta| meta.provider_type.as_deref())
        == Some("codex_oauth");
    // Codex OAuth 会把 openai_responses 响应强制升级为 SSE，即使客户端发的是 stream:false。
    // should_use_claude_transform_streaming 默认会把这个组合路由到流式转换器——虽然能避免
    // JSON parse 报 422，但会让非流客户端收到 text/event-stream，违反 Anthropic 非流语义。
    // 这里为这个特定组合打开 override：把上游 SSE 聚合成 Anthropic JSON 回给客户端，其它
    // 场景（任意上游 is_sse、非 Codex OAuth 等）仍沿用原有流式兜底。
    let aggregate_codex_oauth_responses_sse =
        !is_stream && is_codex_oauth && api_format == "openai_responses";
    let use_streaming = if aggregate_codex_oauth_responses_sse {
        false
    } else {
        should_use_claude_transform_streaming(
            is_stream,
            response.is_sse(),
            api_format,
            is_codex_oauth,
        )
    };
    let tool_schema_hints = transform_gemini::extract_anthropic_tool_schema_hints(original_body);
    let tool_schema_hints = (!tool_schema_hints.is_empty()).then_some(tool_schema_hints);

    if use_streaming {
        // 根据 api_format 选择流式转换器
        let stream = response.bytes_stream();
        let sse_stream: Box<
            dyn futures::Stream<Item = Result<Bytes, std::io::Error>> + Send + Unpin,
        > = if api_format == "openai_responses" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_responses(stream)))
        } else if api_format == "gemini_native" {
            Box::new(Box::pin(create_anthropic_sse_stream_from_gemini(
                stream,
                Some(state.gemini_shadow.clone()),
                Some(ctx.provider.id.clone()),
                Some(ctx.session_id.clone()),
                tool_schema_hints.clone(),
            )))
        } else {
            Box::new(Box::pin(create_anthropic_sse_stream(stream)))
        };

        // 创建使用量收集器
        let usage_collector = {
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = ctx.request_model.clone();
            let status_code = status.as_u16();
            let start_time = ctx.start_time;

            SseUsageCollector::new(start_time, move |events, first_token_ms| {
                if let Some(usage) = TokenUsage::from_claude_stream_events(&events) {
                    let latency_ms = start_time.elapsed().as_millis() as u64;
                    let state = state.clone();
                    let provider_id = provider_id.clone();
                    let model = model.clone();

                    tokio::spawn(async move {
                        log_usage(
                            &state,
                            &provider_id,
                            "claude",
                            &model,
                            &model,
                            usage,
                            latency_ms,
                            first_token_ms,
                            true,
                            status_code,
                        )
                        .await;
                    });
                } else {
                    log::debug!("[Claude] OpenRouter 流式响应缺少 usage 统计，跳过消费记录");
                }
            })
        };

        // 获取流式超时配置
        let timeout_config = ctx.streaming_timeout_config();

        let logged_stream = create_logged_passthrough_stream(
            sse_stream,
            "Claude/OpenRouter",
            Some(usage_collector),
            timeout_config,
        );

        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            "Content-Type",
            axum::http::HeaderValue::from_static("text/event-stream"),
        );
        headers.insert(
            "Cache-Control",
            axum::http::HeaderValue::from_static("no-cache"),
        );

        let body = axum::body::Body::from_stream(logged_stream);
        return Ok((headers, body).into_response());
    }

    // 非流式响应转换 (OpenAI/Responses → Anthropic)
    let body_timeout =
        if ctx.app_config.auto_failover_enabled && ctx.app_config.non_streaming_timeout > 0 {
            std::time::Duration::from_secs(ctx.app_config.non_streaming_timeout as u64)
        } else {
            std::time::Duration::ZERO
        };
    let (mut response_headers, _status, body_bytes) =
        read_decoded_body(response, ctx.tag, body_timeout).await?;

    let body_str = String::from_utf8_lossy(&body_bytes);

    let upstream_response: Value = if aggregate_codex_oauth_responses_sse {
        responses_sse_to_response_value(&body_str)?
    } else {
        serde_json::from_slice(&body_bytes).map_err(|e| {
            log::error!("[Claude] 解析上游响应失败: {e}, body: {body_str}");
            ProxyError::TransformError(format!("Failed to parse upstream response: {e}"))
        })?
    };

    // 根据 api_format 选择非流式转换器
    let anthropic_response = if api_format == "openai_responses" {
        transform_responses::responses_to_anthropic(upstream_response)
    } else if api_format == "gemini_native" {
        transform_gemini::gemini_to_anthropic_with_shadow_and_hints(
            upstream_response,
            Some(state.gemini_shadow.as_ref()),
            Some(&ctx.provider.id),
            Some(&ctx.session_id),
            tool_schema_hints.as_ref(),
        )
    } else {
        transform::openai_to_anthropic(upstream_response)
    }
    .map_err(|e| {
        log::error!("[Claude] 转换响应失败: {e}");
        e
    })?;

    // 记录使用量
    if let Some(usage) = TokenUsage::from_claude_response(&anthropic_response) {
        let model = anthropic_response
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");
        let latency_ms = ctx.latency_ms();

        let request_model = ctx.request_model.clone();
        tokio::spawn({
            let state = state.clone();
            let provider_id = ctx.provider.id.clone();
            let model = model.to_string();
            async move {
                log_usage(
                    &state,
                    &provider_id,
                    "claude",
                    &model,
                    &request_model,
                    usage,
                    latency_ms,
                    None,
                    false,
                    status.as_u16(),
                )
                .await;
            }
        });
    }

    // 构建响应
    let mut builder = axum::response::Response::builder().status(status);
    strip_entity_headers_for_rebuilt_body(&mut response_headers);
    strip_hop_by_hop_response_headers(&mut response_headers);

    for (key, value) in response_headers.iter() {
        builder = builder.header(key, value);
    }

    builder = builder.header("content-type", "application/json");

    let response_body = serde_json::to_vec(&anthropic_response).map_err(|e| {
        log::error!("[Claude] 序列化响应失败: {e}");
        ProxyError::TransformError(format!("Failed to serialize response: {e}"))
    })?;

    let body = axum::body::Body::from(response_body);
    builder.body(body).map_err(|e| {
        log::error!("[Claude] 构建响应失败: {e}");
        ProxyError::Internal(format!("Failed to build response: {e}"))
    })
}

fn endpoint_with_query(uri: &axum::http::Uri, endpoint: &str) -> String {
    match uri.query() {
        Some(query) => format!("{endpoint}?{query}"),
        None => endpoint.to_string(),
    }
}

// ============================================================================
// Codex API 处理器
// ============================================================================

/// 处理 /v1/chat/completions 请求（OpenAI Chat Completions API - Codex CLI）
pub async fn handle_chat_completions(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/chat/completions");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &OPENAI_PARSER_CONFIG, is_stream).await
}

/// 处理 /v1/responses 请求（OpenAI Responses API - Codex CLI 透传）
pub async fn handle_responses(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG, is_stream).await
}

/// 处理 /v1/responses/compact 请求（OpenAI Responses Compact API - Codex CLI 透传）
pub async fn handle_responses_compact(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let uri = parts.uri;
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    let mut ctx =
        RequestContext::new(&state, &body, &headers, AppType::Codex, "Codex", "codex").await?;
    let endpoint = endpoint_with_query(&uri, "/responses/compact");

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Codex,
            &endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &CODEX_PARSER_CONFIG, is_stream).await
}

// ============================================================================
// Gemini API 处理器
// ============================================================================

/// 处理 Gemini API 请求（透传，包括查询参数）
pub async fn handle_gemini(
    State(state): State<ProxyState>,
    uri: axum::http::Uri,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, req_body) = request.into_parts();
    let headers = parts.headers;
    let extensions = parts.extensions;
    let body_bytes = req_body
        .collect()
        .await
        .map_err(|e| ProxyError::Internal(format!("Failed to read request body: {e}")))?
        .to_bytes();
    let body: Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| ProxyError::Internal(format!("Failed to parse request body: {e}")))?;

    // Gemini 的模型名称在 URI 中
    let mut ctx = RequestContext::new(&state, &body, &headers, AppType::Gemini, "Gemini", "gemini")
        .await?
        .with_model_from_uri(&uri);

    // 提取完整的路径和查询参数
    let endpoint = uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(uri.path());

    let is_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let forwarder = ctx.create_forwarder(&state);
    let result = match forwarder
        .forward_with_retry(
            &AppType::Gemini,
            endpoint,
            body,
            headers,
            extensions,
            ctx.get_providers(),
        )
        .await
    {
        Ok(result) => result,
        Err(mut err) => {
            if let Some(provider) = err.provider.take() {
                ctx.provider = provider;
            }
            log_forward_error(&state, &ctx, is_stream, &err.error);
            return Err(err.error);
        }
    };

    ctx.provider = result.provider;
    let response = result.response;

    process_response(response, &ctx, &state, &GEMINI_PARSER_CONFIG, is_stream).await
}

fn should_use_claude_transform_streaming(
    requested_streaming: bool,
    upstream_is_sse: bool,
    api_format: &str,
    is_codex_oauth: bool,
) -> bool {
    requested_streaming || upstream_is_sse || (is_codex_oauth && api_format == "openai_responses")
}

/// 把 OpenAI Responses SSE 流聚合成一个完整的 Responses JSON 对象，供下游转成 Anthropic
/// 非流响应。仅在 Codex OAuth 把 `stream:false` 强制升级为 SSE 的场景下调用。
///
/// 复用 `proxy::sse` 的 `take_sse_block`/`strip_sse_field`：`take_sse_block` 同时支持
/// `\n\n` 与 `\r\n\r\n` 两种分隔符，`strip_sse_field` 兼容带/不带空格的字段写法。
fn responses_sse_to_response_value(body: &str) -> Result<Value, ProxyError> {
    let mut buffer = body.to_string();
    let mut completed_response: Option<Value> = None;
    let mut output_items = Vec::new();

    while let Some(block) = take_sse_block(&mut buffer) {
        let mut event_name = "";
        let mut data_lines: Vec<&str> = Vec::new();

        for line in block.lines() {
            if let Some(evt) = strip_sse_field(line, "event") {
                event_name = evt.trim();
            } else if let Some(d) = strip_sse_field(line, "data") {
                data_lines.push(d);
            }
        }

        if data_lines.is_empty() {
            continue;
        }

        let data_str = data_lines.join("\n");
        if data_str.trim() == "[DONE]" {
            continue;
        }

        let data: Value = serde_json::from_str(&data_str).map_err(|e| {
            ProxyError::TransformError(format!("Failed to parse upstream SSE event: {e}"))
        })?;

        match event_name {
            "response.output_item.done" => {
                if let Some(item) = data.get("item") {
                    output_items.push(item.clone());
                }
            }
            "response.completed" => {
                completed_response = Some(data.get("response").cloned().unwrap_or(data));
            }
            "response.failed" => {
                let message = data
                    .pointer("/response/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("response.failed event received");
                return Err(ProxyError::TransformError(message.to_string()));
            }
            _ => {}
        }
    }

    let mut response = completed_response.ok_or_else(|| {
        ProxyError::TransformError("No response.completed event in upstream SSE".to_string())
    })?;

    if !output_items.is_empty() {
        if let Some(obj) = response.as_object_mut() {
            obj.insert("output".to_string(), Value::Array(output_items));
        } else {
            return Err(ProxyError::TransformError(
                "response.completed payload is not an object".to_string(),
            ));
        }
    }

    Ok(response)
}

// ============================================================================
// 使用量记录（保留用于 Claude 转换逻辑）
// ============================================================================

fn log_forward_error(
    state: &ProxyState,
    ctx: &RequestContext,
    is_streaming: bool,
    error: &ProxyError,
) {
    use super::usage::logger::UsageLogger;

    let logger = UsageLogger::new(&state.db);
    let status_code = map_proxy_error_to_status(error);
    let error_message = get_error_message(error);
    let request_id = uuid::Uuid::new_v4().to_string();

    if let Err(e) = logger.log_error_with_context(
        request_id,
        ctx.provider.id.clone(),
        ctx.app_type_str.to_string(),
        ctx.request_model.clone(),
        status_code,
        error_message,
        ctx.latency_ms(),
        is_streaming,
        Some(ctx.session_id.clone()),
        None,
    ) {
        log::warn!("记录失败请求日志失败: {e}");
    }
}

/// 记录请求使用量
#[allow(clippy::too_many_arguments)]
async fn log_usage(
    state: &ProxyState,
    provider_id: &str,
    app_type: &str,
    model: &str,
    request_model: &str,
    usage: TokenUsage,
    latency_ms: u64,
    first_token_ms: Option<u64>,
    is_streaming: bool,
    status_code: u16,
) {
    use super::usage::logger::UsageLogger;

    let logger = UsageLogger::new(&state.db);

    let (multiplier, pricing_model_source) =
        logger.resolve_pricing_config(provider_id, app_type).await;
    let pricing_model = if pricing_model_source == "request" {
        request_model
    } else {
        model
    };

    let request_id = usage.dedup_request_id();

    if let Err(e) = logger.log_with_calculation(
        request_id,
        provider_id.to_string(),
        app_type.to_string(),
        model.to_string(),
        request_model.to_string(),
        pricing_model.to_string(),
        usage,
        multiplier,
        latency_ms,
        first_token_ms,
        status_code,
        None,
        None, // provider_type
        is_streaming,
    ) {
        log::warn!("[USG-001] 记录使用量失败: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_claude_oauth_provider, is_codex_oauth_provider,
        refresh_claude_quota_snapshots_with_query, responses_sse_to_response_value,
        should_use_claude_transform_streaming,
        refresh_claude_quota_snapshots_with_query_and_refresher,
        refresh_codex_quota_snapshots_with_query_and_refresher,
    };
    use crate::database::Database;
    use crate::provider::Provider;
    use crate::proxy::{
        failover_switch::FailoverSwitchManager,
        provider_router::ProviderRouter,
        providers::{
            claude_oauth_store::save_claude_auth_for_provider, gemini_shadow::GeminiShadowStore,
        },
        rate_limit::{new_rate_limit_store, RateLimitSnapshot, RateLimitWindow},
        server::ProxyState,
        types::{ProxyConfig, ProxyStatus},
        ProxyError,
    };
    use crate::services::oauth_refresh::storage::{
        load_claude_refresh_auth_for_provider, load_codex_refresh_auth_for_provider,
    };
    use crate::services::oauth_refresh::{
        OAuthRefreshError, OAuthRefreshLockManager, OAuthTokenRefresher, RefreshedCredentials,
    };
    use crate::services::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use serial_test::serial;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    use tempfile::TempDir;
    use tokio::sync::RwLock;

    #[test]
    fn codex_oauth_responses_force_streaming_even_if_client_sent_false() {
        assert!(should_use_claude_transform_streaming(
            false,
            false,
            "openai_responses",
            true,
        ));
    }

    #[test]
    fn upstream_sse_response_always_uses_streaming_path() {
        assert!(should_use_claude_transform_streaming(
            false,
            true,
            "openai_chat",
            false,
        ));
    }

    #[test]
    fn non_streaming_response_stays_non_streaming_for_regular_openai_responses() {
        assert!(!should_use_claude_transform_streaming(
            false,
            false,
            "openai_responses",
            false,
        ));
    }

    #[test]
    fn responses_sse_to_response_value_collects_output_items() {
        let sse = r#"event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","model":"gpt-5.4","output":[],"usage":{"input_tokens":10,"output_tokens":2}}}

"#;

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_1");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hello");
    }

    #[test]
    fn responses_sse_to_response_value_handles_crlf_delimiters() {
        // 真实 HTTP SSE 按规范使用 \r\n\r\n 分隔事件；take_sse_block 必须同时处理两种分隔符，
        // 否则此路径在任何标准上游（含 Codex OAuth HTTPS 后端）下都会 TransformError。
        let sse = "event: response.output_item.done\r\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hi\"}]}}\r\n\
\r\n\
event: response.completed\r\n\
data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_crlf\",\"status\":\"completed\",\"model\":\"gpt-5.4\",\"output\":[],\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}\r\n\
\r\n";

        let response = responses_sse_to_response_value(sse).unwrap();

        assert_eq!(response["id"], "resp_crlf");
        assert_eq!(response["output"][0]["type"], "message");
        assert_eq!(response["output"][0]["content"][0]["text"], "hi");
    }

    #[test]
    fn responses_sse_to_response_value_returns_err_on_response_failed() {
        let sse = "event: response.failed\n\
data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"upstream blew up\"}}}\n\n";

        let err = responses_sse_to_response_value(sse).unwrap_err();
        match err {
            ProxyError::TransformError(msg) => assert!(msg.contains("upstream blew up")),
            other => panic!("expected TransformError, got {other:?}"),
        }
    }

    #[test]
    fn responses_sse_to_response_value_errors_when_no_completed_event() {
        let sse = "event: response.output_item.done\n\
data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"message\"}}\n\n";

        assert!(responses_sse_to_response_value(sse).is_err());
    }

    #[test]
    fn official_codex_seed_counts_as_codex_oauth_provider() {
        let provider = Provider::with_id(
            "codex-official".to_string(),
            "OpenAI Official".to_string(),
            json!({ "auth": {}, "config": "" }),
            None,
        );

        assert!(is_codex_oauth_provider(&provider));
    }

    #[test]
    fn claude_oauth_mode_counts_as_claude_oauth_provider() {
        let provider = Provider::with_id(
            "claude-oauth".to_string(),
            "Claude Official".to_string(),
            json!({ "auth_mode": "claude_oauth", "env": {} }),
            None,
        );

        assert!(is_claude_oauth_provider(&provider));
    }

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

            std::fs::create_dir_all(&home).expect("create home");
            std::fs::create_dir_all(&data).expect("create data");

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

    fn test_proxy_state(db: Arc<Database>) -> ProxyState {
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
            quota_snapshot_cache: crate::proxy::quota_cache::RateLimitSnapshotCache::new(),
            oauth_refresh_locks: OAuthRefreshLockManager::new(),
            #[cfg(feature = "tauri-desktop")]
            app_handle: None,
        }
    }

    fn claude_provider(provider_id: &str, auth_mode: &str, name: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            name.to_string(),
            json!({
                "auth_mode": auth_mode,
                "env": {
                    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
                }
            }),
            None,
        )
    }

    fn codex_provider(provider_id: &str, auth_mode: &str, name: &str) -> Provider {
        Provider::with_id(
            provider_id.to_string(),
            name.to_string(),
            json!({
                "auth_mode": auth_mode,
                "env": {}
            }),
            None,
        )
    }

    fn make_jwt(payload: serde_json::Value) -> String {
        format!(
            "{}.{}.",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#),
            URL_SAFE_NO_PAD.encode(payload.to_string())
        )
    }

    fn sample_claude_auth_json(expires_at_ms: i64) -> Vec<u8> {
        serde_json::json!({
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-uploaded",
                "refreshToken": "refresh-token",
                "expiresAt": expires_at_ms,
                "scopes": ["user:profile"],
                "subscriptionType": "pro"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_codex_auth_json(exp_secs: i64) -> Vec<u8> {
        serde_json::json!({
            "tokens": {
                "access_token": make_jwt(json!({
                    "exp": exp_secs,
                    "https://api.openai.com/auth": {
                        "chatgpt_account_id": "acc-123"
                    }
                })),
                "refresh_token": "refresh-token",
                "account_id": "acc-123"
            }
        })
        .to_string()
        .into_bytes()
    }

    fn sample_quota(tool: &str, tier_name: &str, utilization: f64) -> SubscriptionQuota {
        SubscriptionQuota {
            tool: tool.to_string(),
            credential_status: CredentialStatus::Valid,
            credential_message: None,
            success: true,
            tiers: vec![QuotaTier {
                name: tier_name.to_string(),
                utilization,
                resets_at: Some("2026-04-30T12:00:00Z".to_string()),
            }],
            extra_usage: None,
            error: None,
            queried_at: Some(chrono::Utc::now().timestamp_millis()),
        }
    }

    #[derive(Clone)]
    struct FakeRefresher {
        calls: Arc<Mutex<usize>>,
        result: Result<RefreshedCredentials, OAuthRefreshError>,
    }

    #[async_trait::async_trait]
    impl OAuthTokenRefresher for FakeRefresher {
        async fn refresh(
            &self,
            _refresh_token: &str,
        ) -> Result<RefreshedCredentials, OAuthRefreshError> {
            *self.calls.lock().expect("lock refresh calls") += 1;
            self.result.clone()
        }
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_uses_uploaded_auth_and_preserves_header_snapshots() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        db.save_provider(
            "claude",
            &claude_provider("claude-pass", "client_passthrough", "Claude Passthrough"),
        )
        .expect("save passthrough provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() + 60_000),
        )
        .expect("save uploaded auth");

        let state = test_proxy_state(db);
        {
            let mut store = state.rate_limits.write().await;
            store.insert(
                "claude-oauth".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-oauth".to_string(),
                    provider_name: "Claude OAuth".to_string(),
                    source: Some("subscription_quota".to_string()),
                    status: None,
                    windows: vec![RateLimitWindow {
                        name: "seven_day".to_string(),
                        status: None,
                        utilization: Some(0.9),
                        reset: Some(1_700_000_000),
                    }],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: Some(50),
                    requests_remaining: Some(10),
                    tokens_limit: Some(1_000),
                    tokens_remaining: Some(500),
                    captured_at: 1_700_000_000_000,
                },
            );
            store.insert(
                "claude-pass".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-pass".to_string(),
                    provider_name: "Claude Passthrough".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: vec![RateLimitWindow {
                        name: "7d".to_string(),
                        status: None,
                        utilization: Some(0.4),
                        reset: Some(1_700_000_500),
                    }],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    captured_at: 1_700_000_000_100,
                },
            );
            store.insert(
                "ghost-claude".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "ghost-claude".to_string(),
                    provider_name: "Ghost Claude".to_string(),
                    source: Some("response_headers".to_string()),
                    status: None,
                    windows: vec![],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    captured_at: 1_700_000_000_200,
                },
            );
        }

        let seen_tokens = Arc::new(Mutex::new(Vec::new()));
        refresh_claude_quota_snapshots_with_query(&state, {
            let seen_tokens = seen_tokens.clone();
            move |access_token: String| {
                let seen_tokens = seen_tokens.clone();
                async move {
                    seen_tokens
                        .lock()
                        .expect("lock seen tokens")
                        .push(access_token);
                    sample_quota("claude", "seven_day_claude_design", 42.0)
                }
            }
        })
        .await;

        assert_eq!(
            seen_tokens.lock().expect("lock seen tokens").as_slice(),
            ["sk-ant-oat01-uploaded"]
        );

        let store = state.rate_limits.read().await;
        let oauth_snapshot = store.get("claude-oauth").expect("oauth snapshot");
        assert_eq!(oauth_snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(oauth_snapshot.windows.len(), 1);
        assert_eq!(oauth_snapshot.windows[0].name, "seven_day_claude_design");
        assert_eq!(oauth_snapshot.requests_limit, Some(50));
        assert_eq!(oauth_snapshot.tokens_limit, Some(1_000));
        assert_eq!(
            store
                .get("claude-pass")
                .and_then(|snapshot| snapshot.source.as_deref()),
            Some("response_headers")
        );
        assert!(!store.contains_key("ghost-claude"));
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_refreshes_expired_uploaded_auth() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() - 60_000),
        )
        .expect("save expired auth");

        let state = test_proxy_state(db);

        let calls = Arc::new(Mutex::new(0usize));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Ok(RefreshedCredentials {
                access_token: "sk-ant-oat01-refreshed".to_string(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh".to_string()),
                extra: json!({
                    "scopes": ["user:profile", "user:inference"],
                    "subscriptionType": "max",
                    "rateLimitTier": "priority"
                }),
            }),
        };
        let seen_tokens = Arc::new(Mutex::new(Vec::new()));
        refresh_claude_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let seen_tokens = seen_tokens.clone();
                move |_access_token: String| {
                    let seen_tokens = seen_tokens.clone();
                    async move {
                        seen_tokens
                            .lock()
                            .expect("lock seen tokens")
                            .push(_access_token);
                        sample_quota("claude", "seven_day_claude_design", 42.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock calls"), 1);
        assert_eq!(
            seen_tokens.lock().expect("lock seen tokens").as_slice(),
            ["sk-ant-oat01-refreshed"]
        );

        let refreshed_auth = load_claude_refresh_auth_for_provider("claude-oauth")
            .expect("load refreshed auth")
            .expect("refreshed auth");
        assert_eq!(refreshed_auth.access_token, "sk-ant-oat01-refreshed");
        assert_eq!(
            refreshed_auth.refresh_token.as_deref(),
            Some("rotated-refresh")
        );
        assert_eq!(refreshed_auth.subscription_type.as_deref(), Some("max"));
        assert_eq!(refreshed_auth.rate_limit_tier.as_deref(), Some("priority"));

        let snapshot = state
            .rate_limits
            .read()
            .await
            .get("claude-oauth")
            .cloned()
            .expect("claude quota snapshot");
        assert_eq!(snapshot.source.as_deref(), Some("subscription_quota"));
        assert_eq!(snapshot.windows[0].name, "seven_day_claude_design");
    }

    #[tokio::test]
    #[serial]
    async fn refresh_claude_quota_snapshots_skips_live_fetch_when_refresh_fails() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "claude",
            &claude_provider("claude-oauth", "claude_oauth", "Claude OAuth"),
        )
        .expect("save oauth provider");
        save_claude_auth_for_provider(
            "claude-oauth",
            &sample_claude_auth_json(chrono::Utc::now().timestamp_millis() - 60_000),
        )
        .expect("save expired auth");

        let state = test_proxy_state(db);
        {
            let mut store = state.rate_limits.write().await;
            store.insert(
                "claude-oauth".to_string(),
                RateLimitSnapshot {
                    app_type: "claude".to_string(),
                    provider_id: "claude-oauth".to_string(),
                    provider_name: "Claude OAuth".to_string(),
                    source: Some("subscription_quota".to_string()),
                    status: None,
                    windows: vec![],
                    representative_claim: None,
                    overage_status: None,
                    fallback_percentage: None,
                    requests_limit: None,
                    requests_remaining: None,
                    tokens_limit: None,
                    tokens_remaining: None,
                    captured_at: 1_700_000_000_000,
                },
            );
        }

        let calls = Arc::new(Mutex::new(0usize));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Err(OAuthRefreshError::RefreshTokenInvalid),
        };
        let query_calls = Arc::new(Mutex::new(0usize));
        refresh_claude_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let query_calls = query_calls.clone();
                move |_access_token: String| {
                    let query_calls = query_calls.clone();
                    async move {
                        *query_calls.lock().expect("lock query calls") += 1;
                        sample_quota("claude", "seven_day_claude_design", 42.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock refresh calls"), 1);
        assert_eq!(*query_calls.lock().expect("lock query calls"), 0);
        assert!(state.rate_limits.read().await.get("claude-oauth").is_none());
    }

    #[tokio::test]
    #[serial]
    async fn refresh_codex_quota_snapshots_refreshes_expired_uploaded_auth() {
        let _env = TestEnv::new();
        let db = Arc::new(Database::memory().expect("db"));
        db.save_provider(
            "codex",
            &codex_provider("codex-oauth", "codex_oauth", "Codex OAuth"),
        )
        .expect("save oauth provider");
        let expired_secs = (chrono::Utc::now().timestamp_millis() / 1000) - 60;
        crate::proxy::providers::codex_oauth_store::save_codex_auth_for_provider(
            "codex-oauth",
            &sample_codex_auth_json(expired_secs),
        )
        .expect("save expired codex auth");

        let state = test_proxy_state(db);
        let calls = Arc::new(Mutex::new(0usize));
        let refreshed_access = make_jwt(json!({
            "exp": 4_102_444_800i64,
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "acc-999"
            }
        }));
        let refreshed_id_token = make_jwt(json!({
            "chatgpt_account_id": "acc-999",
            "exp": 4_102_444_800i64
        }));
        let refresher = FakeRefresher {
            calls: calls.clone(),
            result: Ok(RefreshedCredentials {
                access_token: refreshed_access.clone(),
                expires_at_ms: chrono::Utc::now().timestamp_millis() + 3_600_000,
                refresh_token: Some("rotated-refresh".to_string()),
                extra: json!({
                    "id_token": refreshed_id_token,
                    "account_id": "acc-999"
                }),
            }),
        };
        let seen_requests = Arc::new(Mutex::new(Vec::new()));
        refresh_codex_quota_snapshots_with_query_and_refresher(
            &state,
            {
                let seen_requests = seen_requests.clone();
                move |access_token: String, account_id: Option<String>| {
                    let seen_requests = seen_requests.clone();
                    async move {
                        seen_requests
                            .lock()
                            .expect("lock codex requests")
                            .push((access_token, account_id));
                        sample_quota("codex", "five_hour", 12.0)
                    }
                }
            },
            &refresher,
        )
        .await;

        assert_eq!(*calls.lock().expect("lock refresh calls"), 1);
        assert_eq!(
            seen_requests
                .lock()
                .expect("lock codex requests")
                .as_slice(),
            &[(refreshed_access.clone(), Some("acc-999".to_string()))]
        );

        let refreshed_auth = load_codex_refresh_auth_for_provider("codex-oauth")
            .expect("load refreshed codex auth")
            .expect("refreshed auth");
        assert_eq!(refreshed_auth.refresh_token, "rotated-refresh");
        assert_eq!(refreshed_auth.account_id.as_deref(), Some("acc-999"));
    }
}
