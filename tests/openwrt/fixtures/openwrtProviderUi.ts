import type {
  OpenWrtProviderTransport,
  OpenWrtRpcResult,
} from "@/platform/openwrt/providers";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPageMessage,
  OpenWrtPaginatedRequestLogs,
  OpenWrtProviderStat,
  OpenWrtRecentActivityItem,
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
  OpenWrtUsageSummary,
} from "@/openwrt-provider-ui/pageTypes";
import type {
  SharedProviderAppId,
  SharedProviderState,
  SharedProviderView,
} from "@/shared/providers/domain";

export const OPENWRT_APP_IDS = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedProviderAppId[];

export const FIXED_ACTIVITY_TIMESTAMP = Date.UTC(2024, 0, 15, 12, 0, 0);

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

const APP_BASE_URLS: Record<SharedProviderAppId, string> = {
  claude: "https://claude.example.com/v1",
  codex: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const APP_MODELS: Record<SharedProviderAppId, string> = {
  claude: "claude-sonnet-4-5",
  codex: "gpt-5.4",
  gemini: "gemini-2.5-pro",
};

const APP_TOKEN_FIELDS: Record<
  SharedProviderAppId,
  SharedProviderView["tokenField"]
> = {
  claude: "ANTHROPIC_AUTH_TOKEN",
  codex: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

const DEFAULT_HOST_STATE: OpenWrtHostState = {
  app: "claude",
  status: "running",
  health: "healthy",
  listenAddr: "127.0.0.1",
  listenPort: "15721",
  version: "3.13.0",
  serviceLabel: "CC Switch",
  httpProxy: "http://127.0.0.1:15721",
  httpsProxy: "http://127.0.0.1:15721",
  proxyEnabled: true,
  logLevel: "info",
};

const DEFAULT_USAGE_SUMMARY: OpenWrtUsageSummary = {
  totalRequests: 0,
  totalCost: "0.00",
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 0,
  successRate: 100,
};

function resolveTransportResult(
  value: Error | OpenWrtRpcResult | null | undefined,
  fallback: OpenWrtRpcResult | null,
): Promise<OpenWrtRpcResult | null> {
  if (value instanceof Error) {
    return Promise.reject(value);
  }

  return Promise.resolve(value === undefined ? fallback : value);
}

export function getAppLabel(appId: SharedProviderAppId): string {
  return APP_LABELS[appId];
}

export function createProviderView(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderView> = {},
): SharedProviderView {
  return {
    configured: true,
    providerId: `${appId}-primary`,
    name: `${APP_LABELS[appId]} Primary`,
    baseUrl: APP_BASE_URLS[appId],
    tokenField: APP_TOKEN_FIELDS[appId],
    tokenConfigured: true,
    tokenMasked: "sk-****",
    model: APP_MODELS[appId],
    notes: "",
    active: true,
    authMode: undefined,
    codexAuth: undefined,
    ...overrides,
  };
}

export function createProviderListResponse(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderView> = {},
): OpenWrtRpcResult {
  const provider = createProviderView(appId, {
    active: true,
    ...overrides,
  });

  return {
    ok: true,
    activeProviderId: provider.providerId,
    providers: [provider],
  };
}

export function createActiveProviderResponse(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderView> = {},
): OpenWrtRpcResult {
  return {
    ok: true,
    provider: {
      ...createProviderView(appId, {
        active: true,
        ...overrides,
      }),
    },
  };
}

export function createSharedProviderState(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderView> = {},
): SharedProviderState {
  const provider = createProviderView(appId, {
    active: true,
    ...overrides,
  });

  return {
    phase2Available: true,
    providers: [provider],
    activeProviderId: provider.providerId,
    activeProvider: provider,
  };
}

export function createProviderStat(
  appId: SharedProviderAppId,
  overrides: Partial<OpenWrtProviderStat> = {},
): OpenWrtProviderStat {
  const provider = createProviderView(appId);

  return {
    providerId: provider.providerId ?? `${appId}-primary`,
    providerName: provider.name,
    requestCount: 128,
    totalTokens: 42_000,
    totalCost: "4.20",
    successRate: 99.4,
    avgLatencyMs: 812,
    ...overrides,
  };
}

export function createUsageSummary(
  overrides: Partial<OpenWrtUsageSummary> = {},
): OpenWrtUsageSummary {
  return {
    ...DEFAULT_USAGE_SUMMARY,
    totalRequests: 128,
    totalCost: "4.20",
    totalInputTokens: 18_200,
    totalOutputTokens: 23_100,
    successRate: 99.4,
    ...overrides,
  };
}

export function createRecentActivity(
  appId: SharedProviderAppId,
  overrides: Partial<OpenWrtRecentActivityItem> = {},
): OpenWrtRecentActivityItem {
  const provider = createProviderView(appId);

  return {
    requestId: `${appId}-req-1`,
    providerId: provider.providerId ?? `${appId}-primary`,
    providerName: provider.name,
    model: provider.model,
    totalTokens: 1200,
    totalCost: "0.42",
    statusCode: 200,
    latencyMs: 840,
    createdAt: FIXED_ACTIVITY_TIMESTAMP,
    ...overrides,
  };
}

export function createRequestLog(
  appId: SharedProviderAppId,
  overrides: Partial<OpenWrtRequestLog> = {},
): OpenWrtRequestLog {
  const provider = createProviderView(appId);

  return {
    requestId: `${appId}-request-1`,
    providerId: provider.providerId ?? `${appId}-primary`,
    providerName: provider.name,
    appType: appId,
    model: provider.model,
    requestModel: provider.model,
    costMultiplier: "1.0",
    inputTokens: 400,
    outputTokens: 800,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    inputCostUsd: "0.10",
    outputCostUsd: "0.32",
    cacheReadCostUsd: "0.00",
    cacheCreationCostUsd: "0.00",
    totalCostUsd: "0.42",
    isStreaming: false,
    latencyMs: 840,
    firstTokenMs: 120,
    durationMs: 840,
    statusCode: 200,
    errorMessage: null,
    createdAt: FIXED_ACTIVITY_TIMESTAMP,
    dataSource: "fixture",
    ...overrides,
  };
}

export interface ShellStubOptions {
  selectedApp?: SharedProviderAppId;
  host?: Partial<OpenWrtHostState>;
  serviceStatus?: {
    isRunning: boolean;
  };
  restartState?: {
    pending: boolean;
    inFlight: boolean;
  };
  message?: OpenWrtPageMessage | null;
  providerStats?: Partial<Record<SharedProviderAppId, OpenWrtProviderStat[]>>;
  requestDetails?: Partial<
    Record<SharedProviderAppId, Record<string, OpenWrtRequestLog | null>>
  >;
  requestLogs?: Partial<
    Record<SharedProviderAppId, OpenWrtPaginatedRequestLogs>
  >;
  recentActivity?: Partial<
    Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>
  >;
  usageSummary?: Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>>;
}

export function createShellStub(
  options: ShellStubOptions = {},
): OpenWrtSharedPageShellApi {
  let selectedApp = options.selectedApp ?? "claude";
  let host: OpenWrtHostState = {
    ...DEFAULT_HOST_STATE,
    ...options.host,
  };
  let serviceStatus = options.serviceStatus ?? {
    isRunning: host.status === "running",
  };
  let restartState = options.restartState ?? {
    pending: false,
    inFlight: false,
  };
  let message = options.message ?? null;

  return {
    getSelectedApp() {
      return selectedApp;
    },
    setSelectedApp(appId) {
      selectedApp = appId;
      host = {
        ...host,
        app: appId,
      };

      return selectedApp;
    },
    getServiceStatus() {
      return serviceStatus;
    },
    getRestartState() {
      return restartState;
    },
    setRestartState(nextState) {
      restartState = {
        ...restartState,
        ...nextState,
      };
    },
    subscribe() {
      return () => {};
    },
    async refreshServiceStatus() {
      return serviceStatus;
    },
    showMessage(kind, text) {
      message = { kind, text };
    },
    clearMessage() {
      message = null;
    },
    async restartService() {
      return serviceStatus;
    },
    getHostState() {
      return host;
    },
    getMessage() {
      return message;
    },
    async getProviderStats(appId) {
      return options.providerStats?.[appId] ?? [];
    },
    async getRequestDetail(appId, requestId) {
      return options.requestDetails?.[appId]?.[requestId] ?? null;
    },
    async getRequestLogs(appId, page = 0, pageSize = 20) {
      return (
        options.requestLogs?.[appId] ?? {
          data: [],
          total: 0,
          page,
          pageSize,
        }
      );
    },
    async getRecentActivity(appId) {
      return options.recentActivity?.[appId] ?? [];
    },
    async getUsageSummary(appId) {
      return options.usageSummary?.[appId] ?? DEFAULT_USAGE_SUMMARY;
    },
    async refreshHostState() {
      return host;
    },
    async saveHostConfig(nextHost: OpenWrtHostConfigPayload) {
      host = {
        ...host,
        ...nextHost,
      };

      return host;
    },
  };
}

export interface ProviderTransportFixtureOptions {
  listProviders?: Partial<
    Record<SharedProviderAppId, Error | OpenWrtRpcResult | null>
  >;
  listSavedProviders?: Partial<
    Record<SharedProviderAppId, Error | OpenWrtRpcResult | null>
  >;
  getActiveProvider?: Partial<
    Record<SharedProviderAppId, Error | OpenWrtRpcResult | null>
  >;
}

export function createProviderTransportFixture(
  options: ProviderTransportFixtureOptions = {},
): OpenWrtProviderTransport {
  return {
    async listProviders(appId) {
      return resolveTransportResult(
        options.listProviders?.[appId],
        createProviderListResponse(appId),
      );
    },
    async listSavedProviders(appId) {
      return resolveTransportResult(
        options.listSavedProviders?.[appId],
        createProviderListResponse(appId),
      );
    },
    async getActiveProvider(appId) {
      return resolveTransportResult(
        options.getActiveProvider?.[appId],
        createActiveProviderResponse(appId),
      ).then((result) => result ?? { ok: false });
    },
    async restartService() {
      return { ok: true };
    },
  };
}
