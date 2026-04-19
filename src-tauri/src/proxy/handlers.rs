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
    types::*,
    usage::parser::TokenUsage,
    ProxyError,
};
use crate::app_config::AppType;
use crate::proxy::providers::{
    claude_oauth_store::load_claude_auth_for_provider,
    codex_oauth_store::load_codex_auth_for_provider,
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

async fn refresh_codex_quota_snapshots(state: &ProxyState) {
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
        let Some(auth) = load_codex_auth_for_provider(&provider.id) else {
            continue;
        };

        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(async move {
            let quota = query_codex_quota(
                &auth.access_token,
                auth.account_id.as_deref(),
                "codex_oauth",
                "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
            )
            .await;

            if !quota.success {
                log::warn!(
                    "[Quota] live Codex quota refresh failed for {}: {}",
                    provider.id,
                    quota
                        .error
                        .clone()
                        .unwrap_or_else(|| "unknown upstream error".to_string())
                );
                return None;
            }

            let previous = {
                let store = state.rate_limits.read().await;
                store.get(&provider.id).cloned()
            };

            super::rate_limit::snapshot_from_subscription_quota(
                "codex",
                &provider.id,
                &provider.name,
                &quota,
                previous.as_ref(),
            )
        });
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

/// Reconcile stored Claude rate-limit snapshots before serving `/api/quota`.
///
/// Retain rules:
/// - keep non-Claude snapshots untouched;
/// - evict Claude snapshots whose provider no longer exists in the DB;
/// - keep header-captured Claude snapshots (`source != "subscription_quota"`);
/// - evict `subscription_quota` snapshots for providers that will not be
///   refreshed in this cycle.
async fn refresh_claude_quota_snapshots_with_query<F, Fut>(state: &ProxyState, query_quota: F)
where
    F: Fn(String) -> Fut + Clone,
    Fut: Future<Output = SubscriptionQuota>,
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
    let now_ms = chrono::Utc::now().timestamp_millis();

    for provider in providers.into_values().filter(is_claude_oauth_provider) {
        let Some(auth) = load_claude_auth_for_provider(&provider.id) else {
            continue;
        };

        if auth
            .expires_at_ms
            .is_some_and(|expires_at_ms| expires_at_ms < now_ms)
        {
            log::warn!(
                "[Quota] stored Claude auth for {} is expired at {}; skipping live quota refresh",
                provider.id,
                auth.expires_at_ms.unwrap_or_default()
            );
            continue;
        }

        let query_quota = query_quota.clone();
        live_refresh_provider_ids.insert(provider.id.clone());
        live_fetches.push(async move {
            let quota = query_quota(auth.access_token.clone()).await;

            if !quota.success {
                log::warn!(
                    "[Quota] live Claude quota refresh failed for {}: {}",
                    provider.id,
                    quota
                        .error
                        .clone()
                        .unwrap_or_else(|| "unknown upstream error".to_string())
                );
                return None;
            }

            let previous = {
                let store = state.rate_limits.read().await;
                store.get(&provider.id).cloned()
            };

            super::rate_limit::snapshot_from_subscription_quota(
                "claude",
                &provider.id,
                &provider.name,
                &quota,
                previous.as_ref(),
            )
        });
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
    let tool_schema_hints = transform_gemini::extract_anthropic_tool_schema_hints(original_body);
    let tool_schema_hints = (!tool_schema_hints.is_empty()).then_some(tool_schema_hints);

    if is_stream {
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

    let upstream_response: Value = serde_json::from_slice(&body_bytes).map_err(|e| {
        log::error!("[Claude] 解析上游响应失败: {e}, body: {body_str}");
        ProxyError::TransformError(format!("Failed to parse upstream response: {e}"))
    })?;

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
        refresh_claude_quota_snapshots_with_query,
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
    };
    use crate::services::subscription::{CredentialStatus, QuotaTier, SubscriptionQuota};
    use serde_json::json;
    use serial_test::serial;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    use tempfile::TempDir;
    use tokio::sync::RwLock;

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

    fn sample_quota(tier_name: &str, utilization: f64) -> SubscriptionQuota {
        SubscriptionQuota {
            tool: "claude".to_string(),
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
                    sample_quota("seven_day_claude_design", 42.0)
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
    async fn refresh_claude_quota_snapshots_skips_expired_uploaded_auth() {
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
        refresh_claude_quota_snapshots_with_query(&state, {
            let calls = calls.clone();
            move |_access_token: String| {
                let calls = calls.clone();
                async move {
                    *calls.lock().expect("lock calls") += 1;
                    sample_quota("seven_day_claude_design", 42.0)
                }
            }
        })
        .await;

        assert_eq!(*calls.lock().expect("lock calls"), 0);
        assert!(state.rate_limits.read().await.get("claude-oauth").is_none());
    }
}
