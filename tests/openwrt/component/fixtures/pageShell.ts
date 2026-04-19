import type {
  OpenWrtProviderTransport,
  OpenWrtRpcResult,
} from "@/platform/openwrt/providers";
import type {
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
  SharedProviderTokenField,
} from "@/shared/providers/domain";

export const OPENWRT_PAGE_THEME_STORAGE_KEY =
  "ccswitch-openwrt-native-page-theme";
export const OPENWRT_PROVIDER_UI_THEME_CLASS =
  "ccswitch-openwrt-provider-ui-theme";
export const OPENWRT_PROVIDER_UI_THEME_DARK_CLASS =
  "ccswitch-openwrt-provider-ui-theme-dark";
export const OPENWRT_PAGE_FIXED_NOW = Date.parse("2026-04-19T12:00:00Z");

type ProviderSeed = {
  active?: boolean;
  baseUrl?: string;
  configured?: boolean;
  model?: string;
  name: string;
  notes?: string;
  providerId: string;
  tokenConfigured?: boolean;
  tokenField?: SharedProviderTokenField;
  tokenMasked?: string;
};

type PageShellBridgeData = {
  host: OpenWrtHostState;
  message: OpenWrtPageMessage | null;
  providerStats: Record<SharedProviderAppId, OpenWrtProviderStat[]>;
  recentActivity: Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>;
  requestDetails: Record<
    SharedProviderAppId,
    Record<string, OpenWrtRequestLog | null>
  >;
  requestLogs: Record<SharedProviderAppId, OpenWrtRequestLog[]>;
  restartState: {
    inFlight: boolean;
    pending: boolean;
  };
  serviceStatus: {
    isRunning: boolean;
  };
  usageSummary: Record<SharedProviderAppId, OpenWrtUsageSummary>;
};

function createProviderState(
  appId: SharedProviderAppId,
  providers: ProviderSeed[],
  activeProviderId: string | null = providers.find(
    (provider) => provider.active,
  )?.providerId ?? null,
): SharedProviderState {
  const defaultTokenFieldByApp: Record<
    SharedProviderAppId,
    SharedProviderTokenField
  > = {
    claude: "ANTHROPIC_AUTH_TOKEN",
    codex: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const normalizedProviders = providers.map((provider) => ({
    active: provider.active ?? provider.providerId === activeProviderId,
    baseUrl: provider.baseUrl ?? `https://${provider.providerId}.example.com`,
    configured: provider.configured ?? true,
    model: provider.model ?? "",
    name: provider.name,
    notes: provider.notes ?? "",
    providerId: provider.providerId,
    tokenConfigured: provider.tokenConfigured ?? true,
    tokenField: provider.tokenField ?? defaultTokenFieldByApp[appId],
    tokenMasked: provider.tokenMasked ?? "********",
  }));
  const activeProvider = normalizedProviders.find(
    (provider) => provider.providerId === activeProviderId,
  ) ?? {
    active: false,
    baseUrl: "",
    configured: false,
    model: "",
    name: "",
    notes: "",
    providerId: null,
    tokenConfigured: false,
    tokenField: defaultTokenFieldByApp[appId],
    tokenMasked: "",
  };

  return {
    phase2Available: true,
    providers: normalizedProviders,
    activeProviderId,
    activeProvider,
  };
}

export const REALISTIC_PROVIDER_STATES: Record<
  SharedProviderAppId,
  SharedProviderState
> = {
  claude: createProviderState("claude", [
    {
      active: true,
      baseUrl: "https://claude-primary.example.com/v1",
      model: "claude-sonnet-4-5",
      name: "Claude Primary",
      notes: "Pinned for router traffic",
      providerId: "claude-primary",
      tokenConfigured: true,
      tokenField: "ANTHROPIC_AUTH_TOKEN",
    },
    {
      active: false,
      baseUrl: "https://claude-backup.example.com/v1",
      model: "claude-haiku-4-5",
      name: "Claude Backup",
      notes: "Warm standby route",
      providerId: "claude-backup",
      tokenConfigured: true,
      tokenField: "ANTHROPIC_API_KEY",
    },
  ]),
  codex: createProviderState("codex", [
    {
      active: true,
      baseUrl: "https://codex-primary.example.com/v1",
      model: "gpt-5.4",
      name: "Codex Primary",
      notes: "Responses endpoint",
      providerId: "codex-primary",
      tokenConfigured: true,
      tokenField: "OPENAI_API_KEY",
    },
    {
      active: false,
      baseUrl: "https://codex-backup.example.com/v1",
      model: "gpt-5.4-mini",
      name: "Codex Backup",
      notes: "Fallback response endpoint",
      providerId: "codex-backup",
      tokenConfigured: true,
      tokenField: "OPENAI_API_KEY",
    },
  ]),
  gemini: createProviderState("gemini", [
    {
      active: true,
      baseUrl: "https://gemini-primary.example.com/v1beta",
      model: "gemini-2.5-pro",
      name: "Gemini Primary",
      notes: "Google route",
      providerId: "gemini-primary",
      tokenConfigured: true,
      tokenField: "GEMINI_API_KEY",
    },
  ]),
};

export const REALISTIC_HOST_STATE: OpenWrtHostState = {
  app: "claude",
  status: "running",
  health: "healthy",
  listenAddr: "0.0.0.0",
  listenPort: "15721",
  version: "v3.13.0-213-gbe1a81ae",
  serviceLabel: "Router daemon",
  httpProxy: "http://127.0.0.1:15721",
  httpsProxy: "http://127.0.0.1:15721",
  proxyEnabled: true,
  logLevel: "info",
};

export const REALISTIC_USAGE_SUMMARIES: Record<
  SharedProviderAppId,
  OpenWrtUsageSummary
> = {
  claude: {
    totalRequests: 138,
    totalCost: "1.23",
    totalInputTokens: 245_100,
    totalOutputTokens: 48_200,
    totalCacheCreationTokens: 12_400,
    totalCacheReadTokens: 8_100,
    successRate: 87.5,
  },
  codex: {
    totalRequests: 94,
    totalCost: "0.78",
    totalInputTokens: 131_400,
    totalOutputTokens: 27_300,
    totalCacheCreationTokens: 4_200,
    totalCacheReadTokens: 2_900,
    successRate: 96.1,
  },
  gemini: {
    totalRequests: 47,
    totalCost: "0.31",
    totalInputTokens: 66_800,
    totalOutputTokens: 15_200,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    successRate: 93.4,
  },
};

export const REALISTIC_PROVIDER_STATS: Record<
  SharedProviderAppId,
  OpenWrtProviderStat[]
> = {
  claude: [
    {
      providerId: "claude-primary",
      providerName: "Claude Primary",
      requestCount: 111,
      totalTokens: 236_400,
      totalCost: "1.01",
      successRate: 87.5,
      avgLatencyMs: 684,
    },
    {
      providerId: "claude-backup",
      providerName: "Claude Backup",
      requestCount: 27,
      totalTokens: 77_400,
      totalCost: "0.22",
      successRate: 88.9,
      avgLatencyMs: 741,
    },
  ],
  codex: [
    {
      providerId: "codex-primary",
      providerName: "Codex Primary",
      requestCount: 82,
      totalTokens: 148_900,
      totalCost: "0.69",
      successRate: 96.1,
      avgLatencyMs: 412,
    },
    {
      providerId: "codex-backup",
      providerName: "Codex Backup",
      requestCount: 12,
      totalTokens: 16_900,
      totalCost: "0.09",
      successRate: 91.7,
      avgLatencyMs: 454,
    },
  ],
  gemini: [
    {
      providerId: "gemini-primary",
      providerName: "Gemini Primary",
      requestCount: 47,
      totalTokens: 82_000,
      totalCost: "0.31",
      successRate: 93.4,
      avgLatencyMs: 533,
    },
  ],
};

export const REALISTIC_RECENT_ACTIVITY: Record<
  SharedProviderAppId,
  OpenWrtRecentActivityItem[]
> = {
  claude: [
    {
      requestId: "claude-req-429",
      providerId: "claude-primary",
      providerName: "Claude Primary",
      model: "claude-sonnet-4-5",
      totalTokens: 1420,
      totalCost: "0.0184",
      statusCode: 429,
      latencyMs: 918,
      createdAt: Date.parse("2026-04-19T11:48:00Z"),
    },
    {
      requestId: "claude-req-201",
      providerId: "claude-backup",
      providerName: "Claude Backup",
      model: "claude-haiku-4-5",
      totalTokens: 880,
      totalCost: "0.0062",
      statusCode: 201,
      latencyMs: 512,
      createdAt: Date.parse("2026-04-19T10:35:00Z"),
    },
    {
      requestId: "claude-req-200",
      providerId: "claude-primary",
      providerName: "Claude Primary",
      model: "claude-sonnet-4-5",
      totalTokens: 1940,
      totalCost: "0.0219",
      statusCode: 200,
      latencyMs: 648,
      createdAt: Date.parse("2026-04-18T21:15:00Z"),
    },
  ],
  codex: [
    {
      requestId: "codex-req-200",
      providerId: "codex-primary",
      providerName: "Codex Primary",
      model: "gpt-5.4",
      totalTokens: 1230,
      totalCost: "0.0121",
      statusCode: 200,
      latencyMs: 401,
      createdAt: Date.parse("2026-04-19T11:42:00Z"),
    },
    {
      requestId: "codex-req-204",
      providerId: "codex-backup",
      providerName: "Codex Backup",
      model: "gpt-5.4-mini",
      totalTokens: 610,
      totalCost: "0.0037",
      statusCode: 204,
      latencyMs: 336,
      createdAt: Date.parse("2026-04-19T09:10:00Z"),
    },
  ],
  gemini: [
    {
      requestId: "gemini-req-200",
      providerId: "gemini-primary",
      providerName: "Gemini Primary",
      model: "gemini-2.5-pro",
      totalTokens: 980,
      totalCost: "0.0091",
      statusCode: 200,
      latencyMs: 587,
      createdAt: Date.parse("2026-04-19T08:45:00Z"),
    },
  ],
};

function createRequestLog(
  appId: SharedProviderAppId,
  log: Omit<OpenWrtRequestLog, "appType">,
): OpenWrtRequestLog {
  return {
    ...log,
    appType: appId,
  };
}

export const REALISTIC_REQUEST_LOGS: Record<
  SharedProviderAppId,
  OpenWrtRequestLog[]
> = {
  claude: [
    createRequestLog("claude", {
      requestId: "claude-req-429",
      providerId: "claude-primary",
      providerName: "Claude Primary",
      model: "claude-sonnet-4-5",
      requestModel: "claude-sonnet-4-5",
      costMultiplier: "1",
      inputTokens: 890,
      outputTokens: 490,
      cacheReadTokens: 40,
      cacheCreationTokens: 0,
      inputCostUsd: "0.0102",
      outputCostUsd: "0.0075",
      cacheReadCostUsd: "0.0007",
      cacheCreationCostUsd: "0.0000",
      totalCostUsd: "0.0184",
      isStreaming: true,
      latencyMs: 918,
      firstTokenMs: 640,
      durationMs: 1180,
      statusCode: 429,
      errorMessage: "Rate limit from upstream backup provider",
      createdAt: Date.parse("2026-04-19T11:48:00Z"),
      dataSource: "openwrt-router",
    }),
    createRequestLog("claude", {
      requestId: "claude-req-201",
      providerId: "claude-backup",
      providerName: "Claude Backup",
      model: "claude-haiku-4-5",
      requestModel: "claude-haiku-4-5",
      costMultiplier: "1",
      inputTokens: 510,
      outputTokens: 320,
      cacheReadTokens: 25,
      cacheCreationTokens: 25,
      inputCostUsd: "0.0031",
      outputCostUsd: "0.0021",
      cacheReadCostUsd: "0.0005",
      cacheCreationCostUsd: "0.0005",
      totalCostUsd: "0.0062",
      isStreaming: true,
      latencyMs: 512,
      firstTokenMs: 282,
      durationMs: 694,
      statusCode: 201,
      errorMessage: null,
      createdAt: Date.parse("2026-04-19T10:35:00Z"),
      dataSource: "openwrt-router",
    }),
    createRequestLog("claude", {
      requestId: "claude-req-200",
      providerId: "claude-primary",
      providerName: "Claude Primary",
      model: "claude-sonnet-4-5",
      requestModel: "claude-sonnet-4-5",
      costMultiplier: "1",
      inputTokens: 1140,
      outputTokens: 720,
      cacheReadTokens: 80,
      cacheCreationTokens: 0,
      inputCostUsd: "0.0118",
      outputCostUsd: "0.0091",
      cacheReadCostUsd: "0.0010",
      cacheCreationCostUsd: "0.0000",
      totalCostUsd: "0.0219",
      isStreaming: false,
      latencyMs: 648,
      firstTokenMs: null,
      durationMs: 648,
      statusCode: 200,
      errorMessage: null,
      createdAt: Date.parse("2026-04-18T21:15:00Z"),
      dataSource: "openwrt-router",
    }),
  ],
  codex: [
    createRequestLog("codex", {
      requestId: "codex-req-200",
      providerId: "codex-primary",
      providerName: "Codex Primary",
      model: "gpt-5.4",
      requestModel: "gpt-5.4",
      costMultiplier: "1",
      inputTokens: 640,
      outputTokens: 560,
      cacheReadTokens: 30,
      cacheCreationTokens: 0,
      inputCostUsd: "0.0063",
      outputCostUsd: "0.0055",
      cacheReadCostUsd: "0.0003",
      cacheCreationCostUsd: "0.0000",
      totalCostUsd: "0.0121",
      isStreaming: true,
      latencyMs: 401,
      firstTokenMs: 190,
      durationMs: 509,
      statusCode: 200,
      errorMessage: null,
      createdAt: Date.parse("2026-04-19T11:42:00Z"),
      dataSource: "openwrt-router",
    }),
    createRequestLog("codex", {
      requestId: "codex-req-204",
      providerId: "codex-backup",
      providerName: "Codex Backup",
      model: "gpt-5.4-mini",
      requestModel: "gpt-5.4-mini",
      costMultiplier: "1",
      inputTokens: 320,
      outputTokens: 240,
      cacheReadTokens: 50,
      cacheCreationTokens: 0,
      inputCostUsd: "0.0019",
      outputCostUsd: "0.0015",
      cacheReadCostUsd: "0.0003",
      cacheCreationCostUsd: "0.0000",
      totalCostUsd: "0.0037",
      isStreaming: false,
      latencyMs: 336,
      firstTokenMs: null,
      durationMs: 336,
      statusCode: 204,
      errorMessage: null,
      createdAt: Date.parse("2026-04-19T09:10:00Z"),
      dataSource: "openwrt-router",
    }),
  ],
  gemini: [
    createRequestLog("gemini", {
      requestId: "gemini-req-200",
      providerId: "gemini-primary",
      providerName: "Gemini Primary",
      model: "gemini-2.5-pro",
      requestModel: "gemini-2.5-pro",
      costMultiplier: "1",
      inputTokens: 430,
      outputTokens: 470,
      cacheReadTokens: 80,
      cacheCreationTokens: 0,
      inputCostUsd: "0.0036",
      outputCostUsd: "0.0049",
      cacheReadCostUsd: "0.0006",
      cacheCreationCostUsd: "0.0000",
      totalCostUsd: "0.0091",
      isStreaming: true,
      latencyMs: 587,
      firstTokenMs: 264,
      durationMs: 702,
      statusCode: 200,
      errorMessage: null,
      createdAt: Date.parse("2026-04-19T08:45:00Z"),
      dataSource: "openwrt-router",
    }),
  ],
};

export const REALISTIC_REQUEST_DETAILS: Record<
  SharedProviderAppId,
  Record<string, OpenWrtRequestLog | null>
> = {
  claude: Object.fromEntries(
    REALISTIC_REQUEST_LOGS.claude.map((entry) => [entry.requestId, entry]),
  ),
  codex: Object.fromEntries(
    REALISTIC_REQUEST_LOGS.codex.map((entry) => [entry.requestId, entry]),
  ),
  gemini: Object.fromEntries(
    REALISTIC_REQUEST_LOGS.gemini.map((entry) => [entry.requestId, entry]),
  ),
};

export const REALISTIC_BRIDGE_DATA: PageShellBridgeData = {
  host: REALISTIC_HOST_STATE,
  message: null,
  providerStats: REALISTIC_PROVIDER_STATS,
  recentActivity: REALISTIC_RECENT_ACTIVITY,
  requestDetails: REALISTIC_REQUEST_DETAILS,
  requestLogs: REALISTIC_REQUEST_LOGS,
  restartState: {
    inFlight: false,
    pending: false,
  },
  serviceStatus: {
    isRunning: true,
  },
  usageSummary: REALISTIC_USAGE_SUMMARIES,
};

function createProviderStateResponse(
  state: SharedProviderState,
): OpenWrtRpcResult {
  return {
    ok: true,
    activeProviderId: state.activeProviderId,
    providers: Object.fromEntries(
      state.providers.map((provider) => [
        provider.providerId ?? provider.name,
        {
          active: provider.active,
          baseUrl: provider.baseUrl,
          configured: provider.configured,
          model: provider.model,
          name: provider.name,
          notes: provider.notes,
          providerId: provider.providerId,
          tokenConfigured: provider.tokenConfigured,
          tokenField: provider.tokenField,
          tokenMasked: provider.tokenMasked,
        },
      ]),
    ),
  };
}

function createActiveProviderResponse(
  state: SharedProviderState,
): OpenWrtRpcResult {
  if (!state.activeProvider.configured) {
    return { ok: false };
  }

  return {
    ok: true,
    baseUrl: state.activeProvider.baseUrl,
    configured: state.activeProvider.configured,
    model: state.activeProvider.model,
    name: state.activeProvider.name,
    notes: state.activeProvider.notes,
    providerId: state.activeProvider.providerId,
    tokenConfigured: state.activeProvider.tokenConfigured,
    tokenField: state.activeProvider.tokenField,
    tokenMasked: state.activeProvider.tokenMasked,
  } as OpenWrtRpcResult;
}

export function createProviderTransportFixture(
  providerStates: Partial<
    Record<SharedProviderAppId, SharedProviderState>
  > = {},
): OpenWrtProviderTransport {
  function getProviderState(appId: SharedProviderAppId): SharedProviderState {
    return providerStates[appId] ?? REALISTIC_PROVIDER_STATES[appId];
  }

  return {
    async listProviders(appId) {
      return createProviderStateResponse(getProviderState(appId));
    },
    async listSavedProviders(appId) {
      return createProviderStateResponse(getProviderState(appId));
    },
    async getActiveProvider(appId) {
      return createActiveProviderResponse(getProviderState(appId));
    },
    async restartService() {
      return { ok: true };
    },
  };
}

function paginateLogs(
  entries: OpenWrtRequestLog[],
  page = 0,
  pageSize = 20,
): OpenWrtPaginatedRequestLogs {
  const safePage = Math.max(0, page);
  const safePageSize = Math.max(1, pageSize);
  const start = safePage * safePageSize;
  const end = start + safePageSize;

  return {
    data: entries.slice(start, end),
    total: entries.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

export function createPlainPageShellBridge(
  data: Partial<PageShellBridgeData> = {},
): OpenWrtSharedPageShellApi {
  let host = {
    ...REALISTIC_BRIDGE_DATA.host,
    ...data.host,
  };
  let selectedApp = host.app;
  let message = data.message ?? REALISTIC_BRIDGE_DATA.message;
  let serviceStatus = data.serviceStatus ?? REALISTIC_BRIDGE_DATA.serviceStatus;
  let restartState = data.restartState ?? REALISTIC_BRIDGE_DATA.restartState;
  const usageSummary = data.usageSummary ?? REALISTIC_BRIDGE_DATA.usageSummary;
  const providerStats =
    data.providerStats ?? REALISTIC_BRIDGE_DATA.providerStats;
  const recentActivity =
    data.recentActivity ?? REALISTIC_BRIDGE_DATA.recentActivity;
  const requestDetails =
    data.requestDetails ?? REALISTIC_BRIDGE_DATA.requestDetails;
  const requestLogs = data.requestLogs ?? REALISTIC_BRIDGE_DATA.requestLogs;

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
      return appId;
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
      serviceStatus = { isRunning: true };
      host = {
        ...host,
        health: host.health === "stopped" ? "healthy" : host.health,
        status: "running",
      };
      return serviceStatus;
    },
    getHostState() {
      return host;
    },
    getMessage() {
      return message;
    },
    async getProviderStats(appId) {
      return providerStats[appId] ?? [];
    },
    async getRequestDetail(appId, requestId) {
      return requestDetails[appId]?.[requestId] ?? null;
    },
    async getRequestLogs(appId, page, pageSize) {
      return paginateLogs(requestLogs[appId] ?? [], page, pageSize);
    },
    async getRecentActivity(appId) {
      return recentActivity[appId] ?? [];
    },
    async getUsageSummary(appId) {
      return usageSummary[appId];
    },
    async refreshHostState() {
      return host;
    },
    async saveHostConfig(nextHost) {
      host = {
        ...host,
        ...nextHost,
      };
      return host;
    },
  };
}
