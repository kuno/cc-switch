import type {
  OpenWrtPaginatedRequestLogs,
  OpenWrtRequestLog,
} from "@/openwrt-provider-ui/pageTypes";
import type { SharedProviderAppId } from "@/shared/providers/domain";

export const FIXED_ACTIVITY_NOW = Date.UTC(2025, 0, 15, 12, 0, 0);

export function createRequestLog(
  overrides: Partial<OpenWrtRequestLog> = {},
): OpenWrtRequestLog {
  return {
    requestId: "req-claude-001",
    providerId: "anthropic-primary",
    providerName: "Anthropic Direct",
    appType: "claude",
    model: "claude-3-7-sonnet",
    requestModel: "claude-3-7-sonnet-20250219",
    costMultiplier: "1.0",
    inputTokens: 1324,
    outputTokens: 342,
    cacheReadTokens: 128,
    cacheCreationTokens: 0,
    inputCostUsd: "0.0024",
    outputCostUsd: "0.0068",
    cacheReadCostUsd: "0.0001",
    cacheCreationCostUsd: "0.0000",
    totalCostUsd: "0.0093",
    isStreaming: true,
    latencyMs: 1240,
    firstTokenMs: 420,
    durationMs: 1610,
    statusCode: 200,
    errorMessage: null,
    createdAt: FIXED_ACTIVITY_NOW - 5 * 60_000,
    dataSource: "luci-history",
    ...overrides,
  };
}

export function createRequestLogsPage(
  entries: OpenWrtRequestLog[],
  overrides: Partial<OpenWrtPaginatedRequestLogs> = {},
): OpenWrtPaginatedRequestLogs {
  return {
    data: entries,
    total: entries.length,
    page: 0,
    pageSize: 6,
    ...overrides,
  };
}

export const CLAUDE_REQUEST_LOG = createRequestLog();

export const CLAUDE_REQUEST_LOG_SECONDARY = createRequestLog({
  requestId: "req-claude-002",
  providerId: "anthropic-fallback",
  providerName: "Anthropic Burst",
  model: "claude-3-5-haiku",
  inputTokens: 884,
  outputTokens: 201,
  cacheReadTokens: 0,
  totalCostUsd: "0.0041",
  latencyMs: 880,
  createdAt: FIXED_ACTIVITY_NOW - 27 * 60_000,
});

export const CODEX_REQUEST_LOG = createRequestLog({
  requestId: "req-codex-101",
  providerId: "openai-router",
  providerName: "OpenAI Router",
  appType: "codex",
  model: "gpt-5.4",
  requestModel: "gpt-5.4",
  inputTokens: 948,
  outputTokens: 187,
  cacheReadTokens: 64,
  totalCostUsd: "0.0065",
  isStreaming: false,
  latencyMs: 1930,
  firstTokenMs: 0,
  durationMs: 2050,
  statusCode: 502,
  errorMessage: "Upstream gateway timeout",
  createdAt: FIXED_ACTIVITY_NOW - 14 * 60_000,
  dataSource: "router-audit",
});

export const GEMINI_REQUEST_LOG = createRequestLog({
  requestId: "req-gemini-301",
  providerId: "google-gateway",
  providerName: "Google Gateway",
  appType: "gemini",
  model: "gemini-2.5-pro",
  requestModel: "gemini-2.5-pro",
  inputTokens: 2104,
  outputTokens: 512,
  cacheReadTokens: 96,
  cacheCreationTokens: 64,
  inputCostUsd: "0.0018",
  outputCostUsd: "0.0036",
  cacheReadCostUsd: "0.0001",
  cacheCreationCostUsd: "0.0001",
  totalCostUsd: "0.0056",
  latencyMs: 1580,
  firstTokenMs: 360,
  durationMs: 1725,
  statusCode: 201,
  createdAt: FIXED_ACTIVITY_NOW - 41 * 60_000,
});

export const ACTIVITY_DRAWER_APP_LOGS: Record<
  SharedProviderAppId,
  OpenWrtPaginatedRequestLogs
> = {
  claude: createRequestLogsPage([
    CLAUDE_REQUEST_LOG,
    CLAUDE_REQUEST_LOG_SECONDARY,
  ]),
  codex: createRequestLogsPage([CODEX_REQUEST_LOG]),
  gemini: createRequestLogsPage([GEMINI_REQUEST_LOG]),
};

export const ACTIVITY_DRAWER_REQUEST_DETAILS: Partial<
  Record<SharedProviderAppId, Record<string, OpenWrtRequestLog | null>>
> = {
  claude: {
    [CLAUDE_REQUEST_LOG.requestId]: CLAUDE_REQUEST_LOG,
    [CLAUDE_REQUEST_LOG_SECONDARY.requestId]: CLAUDE_REQUEST_LOG_SECONDARY,
  },
  codex: {
    [CODEX_REQUEST_LOG.requestId]: CODEX_REQUEST_LOG,
  },
  gemini: {
    [GEMINI_REQUEST_LOG.requestId]: GEMINI_REQUEST_LOG,
  },
};
