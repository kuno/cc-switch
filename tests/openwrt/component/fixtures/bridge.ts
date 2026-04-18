import { vi } from "vitest";
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
import type { SharedProviderAppId } from "@/shared/providers/domain";

export const DEFAULT_HOST_STATE: OpenWrtHostState = {
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

const DEFAULT_REQUEST_LOGS: OpenWrtPaginatedRequestLogs = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

export interface BridgeFixtureOptions {
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
  requestLogs?: Partial<Record<SharedProviderAppId, OpenWrtPaginatedRequestLogs>>;
  recentActivity?: Partial<
    Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>
  >;
  usageSummary?: Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>>;
  overrides?: Partial<OpenWrtSharedPageShellApi>;
}

function getAppRecord<T>(
  value: Partial<Record<SharedProviderAppId, T>> | undefined,
  appId: SharedProviderAppId,
  fallback: T,
): T {
  return value?.[appId] ?? fallback;
}

export function createBridgeFixture(
  options: BridgeFixtureOptions = {},
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

  const bridge: OpenWrtSharedPageShellApi = {
    getSelectedApp: vi.fn(() => selectedApp),
    setSelectedApp: vi.fn((appId) => {
      selectedApp = appId;
      host = { ...host, app: appId };

      return selectedApp;
    }),
    getServiceStatus: vi.fn(() => serviceStatus),
    getRestartState: vi.fn(() => restartState),
    setRestartState: vi.fn((nextState) => {
      restartState = {
        ...restartState,
        ...nextState,
      };
    }),
    subscribe: vi.fn(() => () => {}),
    refreshServiceStatus: vi.fn(async () => serviceStatus),
    showMessage: vi.fn((kind, text) => {
      message = { kind, text };
    }),
    clearMessage: vi.fn(() => {
      message = null;
    }),
    restartService: vi.fn(async () => serviceStatus),
    getHostState: vi.fn(() => host),
    getMessage: vi.fn(() => message),
    getProviderStats: vi.fn(async (appId) =>
      getAppRecord(options.providerStats, appId, []),
    ),
    getRequestDetail: vi.fn(
      async (appId: SharedProviderAppId, requestId: string) =>
        options.requestDetails?.[appId]?.[requestId] ?? null,
    ),
    getRequestLogs: vi.fn(async (appId) =>
      getAppRecord(options.requestLogs, appId, DEFAULT_REQUEST_LOGS),
    ),
    getRecentActivity: vi.fn(async (appId) =>
      getAppRecord(options.recentActivity, appId, []),
    ),
    getUsageSummary: vi.fn(async (appId) =>
      getAppRecord(options.usageSummary, appId, DEFAULT_USAGE_SUMMARY),
    ),
    refreshHostState: vi.fn(async () => host),
    saveHostConfig: vi.fn(async (nextHost: OpenWrtHostConfigPayload) => {
      host = {
        ...host,
        ...nextHost,
      };

      return host;
    }),
  };

  return {
    ...bridge,
    ...options.overrides,
  };
}
