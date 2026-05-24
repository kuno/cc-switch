import { vi } from "vitest";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtBackupList,
  OpenWrtPageMessage,
  OpenWrtPaginatedRequestLogs,
  OpenWrtProviderStat,
  QuotaResponse,
  OpenWrtRecentActivityItem,
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
  OpenWrtStatusResponse,
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

const DEFAULT_QUOTA_RESPONSE: QuotaResponse = {
  providers: [],
  timestamp: "2026-04-22T00:00:00.000Z",
};

const DEFAULT_BACKUP_LIST: OpenWrtBackupList = {
  backups: [],
  dataDir: "/etc/cc-switch",
  backupScope: "database",
  databaseFile: "cc-switch.db",
  backupsDir: "backups",
  uciConfigFile: "/etc/config/ccswitch",
  uciRestoreSupported: false,
  currentSchemaVersion: 17,
  supportedSchemaVersion: 17,
  daemonVersion: "3.13.0",
};

const BACKEND_APP_IDS = ["claude", "codex", "gemini"] as const;
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
const APP_TOKEN_FIELDS: Record<SharedProviderAppId, string> = {
  claude: "ANTHROPIC_AUTH_TOKEN",
  codex: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
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
  requestLogs?: Partial<
    Record<SharedProviderAppId, OpenWrtPaginatedRequestLogs>
  >;
  recentActivity?: Partial<
    Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>
  >;
  quota?: QuotaResponse;
  backups?: OpenWrtBackupList;
  status?: OpenWrtStatusResponse;
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

function paginateRequestLogs(
  response: OpenWrtPaginatedRequestLogs,
  page = 0,
  pageSize = response.pageSize || 20,
): OpenWrtPaginatedRequestLogs {
  const safePage = Math.max(0, page);
  const safePageSize = Math.max(1, pageSize);
  const start = safePage * safePageSize;
  const end = start + safePageSize;

  return {
    data: response.data.slice(start, end),
    total: response.total ?? response.data.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

function createDefaultStatusResponse(
  options: BridgeFixtureOptions,
): OpenWrtStatusResponse {
  return {
    daemon: {
      health: true,
      running: true,
      uptimeSeconds: 3600,
      lastError: null,
      checkedAt: "2026-04-22T00:00:00.000Z",
    },
    apps: Object.fromEntries(
      BACKEND_APP_IDS.map((appId) => {
        const providerId = `${appId}-primary`;
        const providerName = `${APP_LABELS[appId]} Primary`;

        return [
          appId,
          {
            mode: "normal",
            proxyEnabled: true,
            health: true,
            healthReason: null,
            maxRetries: 3,
            usage: getAppRecord(
              options.usageSummary,
              appId,
              DEFAULT_USAGE_SUMMARY,
            ),
            activeProvider: {
              providerId,
              name: providerName,
            },
            providers: {
              [providerId]: {
                providerId,
                name: providerName,
                configured: true,
                active: true,
                baseUrl: APP_BASE_URLS[appId],
                tokenField: APP_TOKEN_FIELDS[appId],
                tokenConfigured: true,
                tokenMasked: "sk-****",
                stats: getAppRecord(options.providerStats, appId, [])[0] ?? null,
                quota: null,
                health: {
                  providerId,
                  observed: true,
                  healthy: true,
                  consecutiveFailures: 0,
                  lastSuccessAt: null,
                  lastFailureAt: null,
                  lastError: null,
                  updatedAt: null,
                },
              },
            },
            failoverQueue: [],
            failoverStatus: {},
          },
        ];
      }),
    ) as OpenWrtStatusResponse["apps"],
  };
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
    getQuota: vi.fn(async () => options.quota ?? DEFAULT_QUOTA_RESPONSE),
    getStatus: vi.fn(
      async () => options.status ?? createDefaultStatusResponse(options),
    ),
    getRequestDetail: vi.fn(
      async (appId: SharedProviderAppId, requestId: string) =>
        options.requestDetails?.[appId]?.[requestId] ?? null,
    ),
    getRequestLogs: vi.fn(async (appId, page, pageSize, providerId) => {
      const response = getAppRecord(
        options.requestLogs,
        appId,
        DEFAULT_REQUEST_LOGS,
      );

      return paginateRequestLogs(
        {
          ...response,
          data: providerId
            ? response.data.filter((entry) => entry.providerId === providerId)
            : response.data,
        },
        page,
        pageSize,
      );
    }),
    getRecentActivity: vi.fn(async (appId) =>
      getAppRecord(options.recentActivity, appId, []),
    ),
    getUsageSummary: vi.fn(async (appId) =>
      getAppRecord(options.usageSummary, appId, DEFAULT_USAGE_SUMMARY),
    ),
    listBackups: vi.fn(async () => options.backups ?? DEFAULT_BACKUP_LIST),
    createBackup: vi.fn(async () => ({
      backup: {
        filename: "cc-switch-20260523-120000.db",
        sizeBytes: 4096,
        createdAt: "2026-05-23T12:00:00Z",
        schemaVersion: 17,
        supportedSchemaVersion: 17,
      },
      backupScope: "database",
    })),
    downloadBackup: vi.fn(async (filename) => ({
      filename,
      dataBase64: "U1FMaXRl",
    })),
    importBackup: vi.fn(async (filename) => ({
      backup: {
        filename: filename || "imported.db",
        sizeBytes: 4096,
        createdAt: "2026-05-23T12:00:00Z",
        schemaVersion: 17,
        supportedSchemaVersion: 17,
      },
      backupScope: "database",
    })),
    deleteBackup: vi.fn(async (filename) => ({
      deletedFilename: filename,
    })),
    restoreBackup: vi.fn(async (filename) => ({
      restoredBackup: {
        filename,
        sizeBytes: 4096,
        createdAt: "2026-05-23T12:00:00Z",
        schemaVersion: 17,
        supportedSchemaVersion: 17,
      },
      safetyBackup: {
        filename: "cc-switch-safety-20260523-120001.db",
        sizeBytes: 4096,
        createdAt: "2026-05-23T12:00:01Z",
        schemaVersion: 17,
        supportedSchemaVersion: 17,
      },
      backupScope: "database",
      uciRestoreSupported: false,
    })),
    downloadConfigBackup: vi.fn(async () => ({
      filename: "ccswitch-backup-2026-05-24.tar.gz",
      dataBase64: "H4sIAAAAAAAA",
    })),
    dryRunConfigRestore: vi.fn(async () => ({
      manifest: {
        formatVersion: 1,
        exportedAt: "2026-05-24T00:00:00Z",
        daemonVersion: "3.14.1-test",
        packageVersion: "3.14.1-test-1",
        schemaVersion: 12,
        supportedSchemaVersion: 12,
        appCount: 3,
        providerCount: 5,
        includesCredentials: true,
        authFileCount: 2,
        rollbackSupported: false,
        configPath: "/etc/config/ccswitch",
        authPaths: ["data/codex_auth/provider.json"],
      },
    })),
    startConfigRestore: vi.fn(async () => ({
      jobId: "restore-job-1",
    })),
    getConfigRestoreJob: vi.fn(async () => ({
      step: "verify" as const,
      state: "done" as const,
      error: null,
      rolledBack: null,
    })),
    probeConfigBackupRestore: vi.fn(async () => ({
      available: true,
      rollbackSupported: false,
      jobPersistence: "process",
      restartDuringRestore: false,
    })),
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
