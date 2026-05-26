import { useEffect, useRef } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { OpenWrtPageShell } from "@/openwrt-provider-ui/OpenWrtPageShell";
import {
  ActivityDrawerHost,
  type ActivityDrawerHostHandle,
} from "@/openwrt-provider-ui/components/ActivityDrawerHost";
import { ActivitySidePanel } from "@/openwrt-provider-ui/components/ActivitySidePanel";
import {
  AppNotificationStack,
  type AppNotification,
} from "@/openwrt-provider-ui/components/AppNotificationStack";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import { DaemonCard } from "@/openwrt-provider-ui/components/DaemonCard";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtPaginatedRequestLogs,
  OpenWrtPageMessage,
  OpenWrtPageTheme,
  OpenWrtProviderStat,
  OpenWrtRequestLog,
  OpenWrtStatusResponse,
  OpenWrtSharedPageShellApi,
  OpenWrtUsageSummary,
} from "@/openwrt-provider-ui/pageTypes";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  createPlainPageShellBridge,
  createProviderTransportFixture as createPageShellTransportFixture,
  REALISTIC_HOST_STATE,
} from "../../component/fixtures/pageShell";
import {
  ACTIVITY_DRAWER_APP_LOGS,
  ACTIVITY_DRAWER_REQUEST_DETAILS,
  FIXED_ACTIVITY_NOW,
  createRequestLogsPage,
} from "../../fixtures/activity";
import {
  createProviderStat,
  createProviderTransportFixture,
  createRecentActivity,
  createSharedProviderState,
  createShellStub,
  createUsageSummary,
} from "../../fixtures/openwrtProviderUi";
import { PROVIDER_SIDE_PANEL_HARNESSES } from "./provider-side-panel";

type HarnessScenario = {
  canvasClassName?: string;
  render: (request: HarnessRequest) => ReactElement;
};

export type HarnessRequest = {
  component: string;
  state: string;
  theme: OpenWrtPageTheme;
};

const STOPPED_HOST: OpenWrtHostState = {
  app: "claude",
  status: "stopped",
  health: "stopped",
  listenAddr: "127.0.0.1",
  listenPort: "15721",
  version: "3.13.0",
  serviceLabel: "CC Switch",
  httpProxy: "http://127.0.0.1:15721",
  httpsProxy: "http://127.0.0.1:15721",
  proxyEnabled: true,
  logLevel: "info",
};

const READY_HOST: OpenWrtHostState = {
  ...STOPPED_HOST,
  status: "running",
  health: "healthy",
};

const UNKNOWN_HOST: OpenWrtHostState = {
  ...READY_HOST,
  health: "unknown",
};

const UNREACHABLE_HOST: OpenWrtHostState = {
  ...READY_HOST,
  health: "degraded",
};

const SHELL_STOPPED_HOST: OpenWrtHostState = {
  ...REALISTIC_HOST_STATE,
  health: "stopped",
  status: "stopped",
};

const RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text: "Restart failed: The daemon timed out while reconnecting to 127.0.0.1:15721.",
};

const LONG_RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text: "Restart failed: The daemon timed out while reloading the provider routes for Claude, Codex, and Gemini after the restart request. Verify the upstream bridge, proxy listeners, and provider credentials before trying again.",
};

const EMPTY_REQUEST_LOGS = createRequestLogsPage([]);

const GRID_SUMMARIES = {
  claude: createUsageSummary({
    totalRequests: 182,
    totalCost: "5.62",
    successRate: 99.2,
  }),
  codex: createUsageSummary({
    totalRequests: 96,
    totalCost: "3.48",
    successRate: 98.7,
  }),
  gemini: createUsageSummary({
    totalRequests: 74,
    totalCost: "1.94",
    successRate: 97.9,
  }),
} satisfies Partial<
  Record<SharedProviderAppId, ReturnType<typeof createUsageSummary>>
>;

const GRID_PROVIDER_STATS = {
  claude: [
    createProviderStat("claude", {
      requestCount: 182,
      totalCost: "5.62",
      successRate: 99.2,
    }),
  ],
  codex: [
    createProviderStat("codex", {
      requestCount: 96,
      totalCost: "3.48",
      successRate: 98.7,
    }),
  ],
  gemini: [
    createProviderStat("gemini", {
      requestCount: 74,
      totalCost: "1.94",
      successRate: 97.9,
    }),
  ],
} satisfies Partial<Record<SharedProviderAppId, OpenWrtProviderStat[]>>;

const GRID_RECENT_ACTIVITY = {
  claude: [createRecentActivity("claude")],
  codex: [createRecentActivity("codex")],
  gemini: [createRecentActivity("gemini")],
} satisfies Partial<
  Record<SharedProviderAppId, ReturnType<typeof createRecentActivity>[]>
>;

function designProvider({
  active = false,
  appId,
  baseUrl,
  icon,
  name,
  providerId,
  tokenField,
}: {
  active?: boolean;
  appId: SharedProviderAppId;
  baseUrl: string;
  icon?: string;
  name: string;
  providerId: string;
  tokenField: string;
}) {
  return {
    active,
    baseUrl,
    configured: true,
    icon,
    model: "",
    name,
    notes: "",
    providerId,
    stats: null,
    tokenConfigured: true,
    tokenField,
    tokenMasked: "sk-****",
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
    appId,
  };
}

const DESIGN_SHELL_STATUS: OpenWrtStatusResponse = {
  daemon: {
    health: true,
    running: true,
    uptimeSeconds: 3600,
    lastError: null,
    checkedAt: "2026-04-22T00:00:00.000Z",
  },
  apps: {
    claude: {
      mode: "failover",
      proxyEnabled: true,
      health: true,
      healthReason: null,
      maxRetries: 3,
      usage: {
        totalRequests: 12307,
        totalCost: "157.47",
        totalInputTokens: 6_500_000,
        totalOutputTokens: 1_920_000,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        successRate: 99.2,
      },
      activeProvider: {
        providerId: "claude-minimax",
        name: "MiniMax en",
      },
      providers: {
        "claude-minimax": designProvider({
          active: true,
          appId: "claude",
          baseUrl: "https://api.minimax.io/v1",
          icon: "minimax",
          name: "MiniMax en",
          providerId: "claude-minimax",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        }),
        "claude-official": designProvider({
          appId: "claude",
          baseUrl: "https://api.anthropic.com/v1",
          icon: "claude",
          name: "Claude Official",
          providerId: "claude-official",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        }),
        "claude-deepseek": designProvider({
          appId: "claude",
          baseUrl: "https://api.deepseek.com/anthropic",
          icon: "deepseek",
          name: "DeepSeek",
          providerId: "claude-deepseek",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        }),
        "claude-qwen": designProvider({
          appId: "claude",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          icon: "qwen",
          name: "Qwen Coder",
          providerId: "claude-qwen",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        }),
        "claude-kimi": designProvider({
          appId: "claude",
          baseUrl: "https://api.moonshot.cn/anthropic",
          icon: "moonshot",
          name: "Kimi For Coding",
          providerId: "claude-kimi",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
        }),
      },
      failoverQueue: [
        { providerId: "claude-minimax", providerName: "MiniMax en", position: 0, active: true },
        { providerId: "claude-official", providerName: "Claude Official", position: 1 },
        { providerId: "claude-deepseek", providerName: "DeepSeek", position: 2 },
        { providerId: "claude-qwen", providerName: "Qwen Coder", position: 3 },
      ],
      failoverStatus: {},
    },
    codex: {
      mode: "failover",
      proxyEnabled: true,
      health: true,
      healthReason: null,
      maxRetries: 2,
      usage: {
        totalRequests: 4128,
        totalCost: "48.91",
        totalInputTokens: 1_680_000,
        totalOutputTokens: 450_000,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        successRate: 96.1,
      },
      activeProvider: {
        providerId: "codex-openai",
        name: "OpenAI Official",
      },
      providers: {
        "codex-openai": designProvider({
          active: true,
          appId: "codex",
          baseUrl: "https://api.openai.com/v1",
          icon: "openai",
          name: "OpenAI Official",
          providerId: "codex-openai",
          tokenField: "OPENAI_API_KEY",
        }),
        "codex-azure": designProvider({
          appId: "codex",
          baseUrl: "https://azure-openai.example.com/openai",
          icon: "openai",
          name: "Azure OpenAI",
          providerId: "codex-azure",
          tokenField: "OPENAI_API_KEY",
        }),
        "codex-packycode": designProvider({
          appId: "codex",
          baseUrl: "https://api.packycode.com/v1",
          icon: "packycode",
          name: "PackyCode",
          providerId: "codex-packycode",
          tokenField: "OPENAI_API_KEY",
        }),
        "codex-ctok": designProvider({
          appId: "codex",
          baseUrl: "https://api.ctok.ai/v1",
          icon: "openai",
          name: "CTok.ai",
          providerId: "codex-ctok",
          tokenField: "OPENAI_API_KEY",
        }),
        "codex-openrouter": designProvider({
          appId: "codex",
          baseUrl: "https://openrouter.ai/api/v1",
          icon: "openrouter",
          name: "OpenRouter",
          providerId: "codex-openrouter",
          tokenField: "OPENAI_API_KEY",
        }),
      },
      failoverQueue: [
        { providerId: "codex-openai", providerName: "OpenAI Official", position: 0, active: true },
        { providerId: "codex-azure", providerName: "Azure OpenAI", position: 1 },
        { providerId: "codex-packycode", providerName: "PackyCode", position: 2 },
        { providerId: "codex-ctok", providerName: "CTok.ai", position: 3 },
      ],
      failoverStatus: {},
      recentActivity: [
        createRecentActivity("codex", {
          statusCode: 429,
        }),
      ],
    },
    gemini: {
      mode: "failover",
      proxyEnabled: true,
      health: false,
      healthReason: "provider_error",
      maxRetries: 3,
      usage: {
        totalRequests: 2044,
        totalCost: "22.08",
        totalInputTokens: 820_000,
        totalOutputTokens: 250_000,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        successRate: 93.4,
      },
      activeProvider: {
        providerId: "gemini-google",
        name: "Google Official",
      },
      providers: {
        "gemini-google": designProvider({
          active: true,
          appId: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          icon: "gemini",
          name: "Google Official",
          providerId: "gemini-google",
          tokenField: "GEMINI_API_KEY",
        }),
        "gemini-packycode": designProvider({
          appId: "gemini",
          baseUrl: "https://api.packycode.com/v1",
          icon: "packycode",
          name: "PackyCode",
          providerId: "gemini-packycode",
          tokenField: "GEMINI_API_KEY",
        }),
        "gemini-ctok": designProvider({
          appId: "gemini",
          baseUrl: "https://api.ctok.ai/v1",
          icon: "gemini",
          name: "CTok.ai",
          providerId: "gemini-ctok",
          tokenField: "GEMINI_API_KEY",
        }),
        "gemini-openrouter": designProvider({
          appId: "gemini",
          baseUrl: "https://openrouter.ai/api/v1",
          icon: "gemini",
          name: "OpenRouter",
          providerId: "gemini-openrouter",
          tokenField: "GEMINI_API_KEY",
        }),
      },
      failoverQueue: [
        { providerId: "gemini-google", providerName: "Google Official", position: 0, active: true },
        { providerId: "gemini-packycode", providerName: "PackyCode", position: 1 },
        { providerId: "gemini-ctok", providerName: "CTok.ai", position: 2 },
        { providerId: "gemini-openrouter", providerName: "OpenRouter", position: 3 },
      ],
      failoverStatus: {
        "gemini-google": {
          health: {
            providerId: "gemini-google",
            observed: true,
            healthy: false,
            consecutiveFailures: 2,
            lastSuccessAt: "2026-04-19T10:00:00Z",
            lastFailureAt: "2026-04-19T12:00:00Z",
            lastError: "HTTP 503",
            updatedAt: "2026-04-19T12:00:00Z",
          },
        },
      },
    },
  },
};

function createHarnessOptions({
  host,
  serviceRunning,
}: {
  host: OpenWrtHostState;
  serviceRunning: boolean;
}) {
  return {
    target: document.body,
    transport: createProviderTransportFixture(),
    shell: createShellStub({
      selectedApp: host.app,
      host,
      serviceStatus: {
        isRunning: serviceRunning,
      },
      providerStats: GRID_PROVIDER_STATS,
      recentActivity: GRID_RECENT_ACTIVITY,
      usageSummary: GRID_SUMMARIES,
    }),
  };
}

type AppCardScenarioAppId = ComponentProps<typeof AppCard>["appId"];

function isSharedProviderAppId(
  appId: AppCardScenarioAppId,
): appId is SharedProviderAppId {
  return appId === "claude" || appId === "codex" || appId === "gemini";
}

function createAppCardScenario(
  props: Partial<ComponentProps<typeof AppCard>> = {},
): HarnessScenario {
  const appId = props.appId ?? "claude";
  const fixtureAppId = isSharedProviderAppId(appId) ? appId : "claude";
  const providerState =
    props.providerState === undefined
      ? createSharedProviderState(fixtureAppId)
      : props.providerState;

  return {
    render: () => (
      <AppCard
        appId={appId}
        hostState={props.hostState ?? READY_HOST}
        serviceRunning={props.serviceRunning ?? true}
        providerState={providerState}
        summary={props.summary ?? createUsageSummary()}
        providerStats={
          props.providerStats ?? [
            createProviderStat(fixtureAppId, { successRate: 98.9 }),
          ]
        }
        recentActivity={
          props.recentActivity ?? [createRecentActivity(fixtureAppId)]
        }
        loading={props.loading ?? false}
        error={props.error ?? null}
        onOpenActivity={props.onOpenActivity ?? (() => {})}
        onOpenProviderPanel={props.onOpenProviderPanel ?? (() => {})}
      />
    ),
  };
}

function createActivityShellStub({
  selectedApp = "claude",
  host = READY_HOST,
  requestLogs = {},
  requestDetails = {},
  requestLogsPending = false,
  requestDetailPending = false,
  requestLogsError = null,
  requestDetailError = null,
}: {
  selectedApp?: SharedProviderAppId;
  host?: OpenWrtHostState;
  requestLogs?: Partial<
    Record<SharedProviderAppId, OpenWrtPaginatedRequestLogs>
  >;
  requestDetails?: Partial<
    Record<SharedProviderAppId, Record<string, OpenWrtRequestLog | null>>
  >;
  requestLogsPending?: boolean;
  requestDetailPending?: boolean;
  requestLogsError?: string | null;
  requestDetailError?: string | null;
}): OpenWrtSharedPageShellApi {
  let activeApp = selectedApp;
  const usageSummary: OpenWrtUsageSummary = {
    totalRequests: 0,
    totalCost: "0.00",
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    successRate: 100,
  };

  return {
    getSelectedApp: () => activeApp,
    setSelectedApp: (appId) => {
      activeApp = appId;
      return activeApp;
    },
    getServiceStatus: () => ({
      isRunning: true,
    }),
    getRestartState: () => ({
      pending: false,
      inFlight: false,
    }),
    setRestartState: () => {},
    subscribe: () => () => {},
    refreshServiceStatus: async () => ({
      isRunning: true,
    }),
    showMessage: () => {},
    clearMessage: () => {},
    restartService: async () => ({
      isRunning: true,
    }),
    getHostState: () => host,
    getMessage: () => null,
    getProviderStats: async () => [],
    getQuota: async () => ({
      providers: [],
      timestamp: "2026-04-22T00:00:00.000Z",
    }),
    getStatus: async () => ({
      daemon: {
        health: true,
        running: true,
        uptimeSeconds: 3600,
        lastError: null,
        checkedAt: "2026-04-22T00:00:00.000Z",
      },
      apps: {
        claude: {
          mode: "normal",
          proxyEnabled: true,
          health: true,
          healthReason: null,
          maxRetries: 3,
          usage: usageSummary,
          activeProvider: null,
          providers: {},
          failoverQueue: [],
          failoverStatus: {},
        },
        codex: {
          mode: "normal",
          proxyEnabled: true,
          health: true,
          healthReason: null,
          maxRetries: 3,
          usage: usageSummary,
          activeProvider: null,
          providers: {},
          failoverQueue: [],
          failoverStatus: {},
        },
        gemini: {
          mode: "normal",
          proxyEnabled: true,
          health: true,
          healthReason: null,
          maxRetries: 3,
          usage: usageSummary,
          activeProvider: null,
          providers: {},
          failoverQueue: [],
          failoverStatus: {},
        },
      },
    }),
    getRequestDetail: async (appId, requestId) => {
      if (requestDetailPending) {
        return await new Promise<OpenWrtRequestLog | null>(() => {});
      }

      if (requestDetailError) {
        throw new Error(requestDetailError);
      }

      return requestDetails[appId]?.[requestId] ?? null;
    },
    getRequestLogs: async (appId) => {
      if (requestLogsPending) {
        return await new Promise<OpenWrtPaginatedRequestLogs>(() => {});
      }

      if (requestLogsError) {
        throw new Error(requestLogsError);
      }

      return requestLogs[appId] ?? EMPTY_REQUEST_LOGS;
    },
    getRecentActivity: async () => [],
    getUsageSummary: async () => usageSummary,
    refreshHostState: async () => host,
    saveHostConfig: async () => host,
  };
}

function FrozenNow({ children }: { children: ReactNode }) {
  const originalNowRef = useRef<typeof Date.now | null>(null);

  if (!originalNowRef.current) {
    originalNowRef.current = Date.now;
    Date.now = () => FIXED_ACTIVITY_NOW;
  }

  useEffect(() => {
    return () => {
      if (originalNowRef.current) {
        Date.now = originalNowRef.current;
      }
    };
  }, []);

  return <>{children}</>;
}

function DrawerScene({ children }: { children: ReactNode }) {
  return (
    <FrozenNow>
      <div className="owt-visual-harness__drawer-scene">
        <div className="owt-visual-harness__drawer-preview">
          <div className="owt-visual-harness__drawer-preview-copy">
            <span className="owt-visual-harness__drawer-preview-label">
              Visual fixture
            </span>
            <strong>OpenWrt provider shell scaffold</strong>
            <p>
              Stable backdrop content for Activity drawer regression coverage.
            </p>
          </div>

          <div className="owt-visual-harness__drawer-preview-tiles">
            <div className="owt-visual-harness__drawer-preview-tile" />
            <div className="owt-visual-harness__drawer-preview-tile" />
            <div className="owt-visual-harness__drawer-preview-tile" />
          </div>
        </div>

        {children}
      </div>
    </FrozenNow>
  );
}

function ActivityDrawerHostHarness({
  openOnMount = false,
  selectedApp = "claude",
  shell,
}: {
  openOnMount?: boolean;
  selectedApp?: SharedProviderAppId;
  shell: OpenWrtSharedPageShellApi;
}) {
  const shellRef = useRef<ActivityDrawerHostHandle | null>(null);

  useEffect(() => {
    if (!openOnMount) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      shellRef.current?.openForApp(selectedApp);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [openOnMount, selectedApp]);

  return (
    <DrawerScene>
      <ActivityDrawerHost shell={shell} shellRef={shellRef} />
    </DrawerScene>
  );
}

function ActivitySidePanelHarness({
  appId = "claude",
  autoOpenDetail = false,
  shell,
}: {
  appId?: SharedProviderAppId;
  autoOpenDetail?: boolean;
  shell: OpenWrtSharedPageShellApi;
}) {
  const detailOpenedRef = useRef(false);

  useEffect(() => {
    if (!autoOpenDetail) {
      return;
    }

    let frame = 0;

    const tryOpenDetail = () => {
      if (detailOpenedRef.current) {
        return;
      }

      const row = document
        .getElementById("root")
        ?.shadowRoot?.querySelector<HTMLButtonElement>(
          ".owt-activity-drawer__row",
        );

      if (row) {
        detailOpenedRef.current = true;
        row.click();
        return;
      }

      frame = window.requestAnimationFrame(tryOpenDetail);
    };

    frame = window.requestAnimationFrame(tryOpenDetail);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [autoOpenDetail]);

  return (
    <DrawerScene>
      <ActivitySidePanel open appId={appId} onClose={() => {}} shell={shell} />
    </DrawerScene>
  );
}

function createDraft(host: OpenWrtHostState): OpenWrtHostConfigPayload {
  return {
    listenAddr: host.listenAddr,
    listenPort: host.listenPort,
    httpProxy: host.httpProxy,
    httpsProxy: host.httpsProxy,
    logLevel: host.logLevel,
  };
}

function renderAppNotification({
  host = READY_HOST,
  isRunning = true,
  restartInFlight = false,
  message = null,
}: {
  host?: OpenWrtHostState;
  isRunning?: boolean;
  restartInFlight?: boolean;
  message?: OpenWrtPageMessage | null;
}) {
  const notifications: AppNotification[] = [];

  if (restartInFlight) {
    notifications.push({
      id: "daemon:restarting",
      kind: "warning",
      title: "Restarting daemon...",
      detail: `Waiting for OpenWrt to confirm the service at ${host.listenAddr}:${host.listenPort}.`,
      busy: true,
    });
  } else if (message?.kind === "error") {
    notifications.push({
      id: "daemon:restart-failed",
      kind: "error",
      title: "Restart failed:",
      detail: message.text.replace(/^restart failed:\s*/i, ""),
      action: {
        label: "Retry restart",
        onClick: () => {},
      },
    });
  } else if (!isRunning || host.status !== "running") {
    notifications.push({
      id: "daemon:stopped",
      kind: "error",
      title: "Daemon stopped.",
      detail: "All app routing is offline until the CC Switch service is restarted.",
      action: {
        label: "Restart now",
        onClick: () => {},
      },
    });
  } else if (host.health === "degraded") {
    notifications.push({
      id: "daemon:unreachable",
      kind: "error",
      title: "Daemon not reachable.",
      detail: `The daemon at ${host.listenAddr}:${host.listenPort} did not respond.`,
      action: {
        label: "Restart now",
        onClick: () => {},
      },
    });
  }

  return (
    <AppNotificationStack notifications={notifications} onDismiss={() => {}} />
  );
}

function renderDaemonCardScenario({
  host,
  isRunning,
  restartInFlight = false,
  restartPending = false,
  backupState,
}: {
  host: OpenWrtHostState;
  isRunning: boolean;
  restartInFlight?: boolean;
  restartPending?: boolean;
  backupState?: "checking" | "pending" | "available" | "error";
}) {
  const backupProps =
    backupState === "checking"
      ? {
          onDownloadConfigBackup: async () => ({
            filename: "ccswitch-backup-2026-05-26.tar.gz",
            dataBase64: "YQ==",
          }),
          onDryRunConfigRestore: async () => ({
            manifest: {
              formatVersion: 1,
              exportedAt: "2026-05-26T00:00:00Z",
              daemonVersion: "3.14.1-test",
              schemaVersion: 12,
              supportedSchemaVersion: 12,
              appCount: 3,
              providerCount: 5,
              includesCredentials: true,
              authFileCount: 2,
              rollbackSupported: false,
              configPath: "/etc/config/ccswitch",
              authPaths: [],
            },
          }),
          onStartConfigRestore: async () => ({ jobId: "restore-job-1" }),
          onGetConfigRestoreJob: async () => ({
            step: "verify" as const,
            state: "done" as const,
            error: null,
            rolledBack: false,
          }),
          onProbeConfigBackupRestore: () => new Promise<{ available: boolean }>(() => {}),
        }
      : backupState === "available"
        ? {
            onDownloadConfigBackup: async () => ({
              filename: "ccswitch-backup-2026-05-26.tar.gz",
              dataBase64: "YQ==",
            }),
            onDryRunConfigRestore: async () => ({
              manifest: {
                formatVersion: 1,
                exportedAt: "2026-05-26T00:00:00Z",
                daemonVersion: "3.14.1-test",
                schemaVersion: 12,
                supportedSchemaVersion: 12,
                appCount: 3,
                providerCount: 5,
                includesCredentials: true,
                authFileCount: 2,
                rollbackSupported: false,
                configPath: "/etc/config/ccswitch",
                authPaths: [],
              },
            }),
            onStartConfigRestore: async () => ({ jobId: "restore-job-1" }),
            onGetConfigRestoreJob: async () => ({
              step: "verify" as const,
              state: "done" as const,
              error: null,
              rolledBack: false,
            }),
            onProbeConfigBackupRestore: async () => ({ available: true }),
          }
        : backupState === "error"
          ? {
              onDownloadConfigBackup: async () => ({
                filename: "ccswitch-backup-2026-05-26.tar.gz",
                dataBase64: "YQ==",
              }),
              onDryRunConfigRestore: async () => ({
                manifest: {
                  formatVersion: 1,
                  exportedAt: "2026-05-26T00:00:00Z",
                  daemonVersion: "3.14.1-test",
                  schemaVersion: 12,
                  supportedSchemaVersion: 12,
                  appCount: 3,
                  providerCount: 5,
                  includesCredentials: true,
                  authFileCount: 2,
                  rollbackSupported: false,
                  configPath: "/etc/config/ccswitch",
                  authPaths: [],
                },
              }),
              onStartConfigRestore: async () => ({ jobId: "restore-job-1" }),
              onGetConfigRestoreJob: async () => ({
                step: "verify" as const,
                state: "done" as const,
                error: null,
                rolledBack: false,
              }),
              onProbeConfigBackupRestore: async () => {
                throw new Error("Capability probe timed out.");
              },
            }
          : {};

  return (
    <DaemonCard
      host={host}
      draft={createDraft(host)}
      isRunning={isRunning}
      isDirty={false}
      saveInFlight={false}
      restartInFlight={restartInFlight}
      restartPending={restartPending}
      onDraftChange={() => {}}
      onSave={() => {}}
      onRestart={() => {}}
      {...backupProps}
    />
  );
}

const HARNESSES: Record<string, Record<string, HarnessScenario>> = {
  AppNotification: {
    healthy: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => renderAppNotification({}),
    },
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAppNotification({
          host: STOPPED_HOST,
          isRunning: false,
        }),
    },
    unreachable: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAppNotification({
          host: UNREACHABLE_HOST,
        }),
    },
    restarting: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAppNotification({
          restartInFlight: true,
        }),
    },
    "restart-failed": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAppNotification({
          message: RESTART_FAILED_MESSAGE,
        }),
    },
    "restart-failed-long": {
      canvasClassName: "owt-visual-harness__canvas--narrow",
      render: () =>
        renderAppNotification({
          message: LONG_RESTART_FAILED_MESSAGE,
        }),
    },
  },
  ActivityDrawerHost: {
    closed: {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivityDrawerHostHarness
          shell={createActivityShellStub({
            requestLogs: {
              claude: EMPTY_REQUEST_LOGS,
            },
          })}
        />
      ),
    },
    "open-empty": {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivityDrawerHostHarness
          openOnMount
          shell={createActivityShellStub({
            requestLogs: {
              claude: EMPTY_REQUEST_LOGS,
            },
          })}
        />
      ),
    },
  },
  ActivitySidePanel: {
    populated: {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivitySidePanelHarness
          shell={createActivityShellStub({
            requestLogs: {
              claude: ACTIVITY_DRAWER_APP_LOGS.claude,
            },
          })}
        />
      ),
    },
    detail: {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivitySidePanelHarness
          autoOpenDetail
          shell={createActivityShellStub({
            requestLogs: {
              claude: ACTIVITY_DRAWER_APP_LOGS.claude,
            },
            requestDetails: ACTIVITY_DRAWER_REQUEST_DETAILS,
          })}
        />
      ),
    },
    loading: {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivitySidePanelHarness
          shell={createActivityShellStub({
            requestLogsPending: true,
          })}
        />
      ),
    },
    error: {
      canvasClassName: "owt-visual-harness__canvas--drawer",
      render: () => (
        <ActivitySidePanelHarness
          shell={createActivityShellStub({
            requestLogsError: "Request log feed unavailable.",
          })}
        />
      ),
    },
  },
  AppsGrid: {
    default: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => (
        <AppsGrid
          options={createHarnessOptions({
            host: {
              ...STOPPED_HOST,
              app: "claude",
            },
            serviceRunning: false,
          })}
          onOpenActivity={() => {}}
          onOpenProviderPanel={() => {}}
        />
      ),
    },
    "claude-active": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => (
        <AppsGrid
          options={createHarnessOptions({
            host: {
              ...READY_HOST,
              app: "claude",
            },
            serviceRunning: true,
          })}
          onOpenActivity={() => {}}
          onOpenProviderPanel={() => {}}
        />
      ),
    },
    "codex-active": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => (
        <AppsGrid
          options={createHarnessOptions({
            host: {
              ...READY_HOST,
              app: "codex",
            },
            serviceRunning: true,
          })}
          onOpenActivity={() => {}}
          onOpenProviderPanel={() => {}}
        />
      ),
    },
  },
  AppCard: {
    default: createAppCardScenario({
      hostState: {
        ...READY_HOST,
        app: "codex",
      },
    }),
    healthy: createAppCardScenario({
      hostState: {
        ...READY_HOST,
        app: "claude",
        health: "healthy",
      },
    }),
    degraded: createAppCardScenario({
      hostState: {
        ...READY_HOST,
        app: "claude",
        health: "degraded",
      },
    }),
    attention: createAppCardScenario({
      hostState: {
        ...READY_HOST,
        app: "codex",
      },
      recentActivity: [
        createRecentActivity("claude", {
          requestId: "claude-error-preview",
          statusCode: 503,
        }),
      ],
    }),
    unavailable: createAppCardScenario({
      hostState: {
        ...READY_HOST,
        app: "codex",
      },
      recentActivity: [],
      error: "Router data is unavailable right now.",
    }),
    loading: createAppCardScenario({
      providerState: null,
      summary: null,
      providerStats: [],
      recentActivity: [],
      loading: true,
    }),
    "not-configured": createAppCardScenario({
      providerState: null,
      summary: null,
      providerStats: [],
      recentActivity: [],
      loading: false,
    }),
  },
  ProviderSidePanel: PROVIDER_SIDE_PANEL_HARNESSES,
  DaemonCard: {
    running: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
        }),
    },
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: STOPPED_HOST,
          isRunning: false,
        }),
    },
    pending: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          restartPending: true,
        }),
    },
    restarting: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          restartInFlight: true,
        }),
    },
    error: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: UNKNOWN_HOST,
          isRunning: true,
        }),
    },
    "backup-admin-checking": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          backupState: "checking",
        }),
    },
    "backup-admin-pending": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          backupState: "pending",
        }),
    },
    "backup-admin-available": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          backupState: "available",
        }),
    },
    "backup-admin-error": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          backupState: "error",
        }),
    },
    "backup-admin-row": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderDaemonCardScenario({
          host: READY_HOST,
          isRunning: true,
          backupState: "pending",
        }),
    },
  },
  shell: {
    default: {
      canvasClassName: "owt-visual-harness__canvas--shell",
      render: () => (
        <OpenWrtPageShell
          options={{
            shell: createPlainPageShellBridge({
              status: DESIGN_SHELL_STATUS,
              recentActivity: {
                claude: [createRecentActivity("claude")],
                codex: [
                  createRecentActivity("codex", {
                    statusCode: 429,
                  }),
                ],
                gemini: [createRecentActivity("gemini")],
              },
            }),
            target: document.createElement("div"),
            transport: createPageShellTransportFixture(),
          }}
        />
      ),
    },
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--shell",
      render: () => (
        <OpenWrtPageShell
          options={{
            shell: createPlainPageShellBridge({
              host: SHELL_STOPPED_HOST,
              restartState: {
                inFlight: false,
                pending: true,
              },
              serviceStatus: {
                isRunning: false,
              },
            }),
            target: document.createElement("div"),
            transport: createPageShellTransportFixture(),
          }}
        />
      ),
    },
  },
};

export function getHarnessRequest(url: URL): HarnessRequest {
  const component = url.searchParams.get("component") ?? "AppNotification";
  const state = url.searchParams.get("state") ?? "stopped";
  const themeParam = url.searchParams.get("theme");
  const theme: OpenWrtPageTheme = themeParam === "dark" ? "dark" : "light";

  return {
    component,
    state,
    theme,
  };
}

export function resolveHarnessScenario(
  request: HarnessRequest,
): HarnessScenario {
  const componentScenarios = HARNESSES[request.component];

  if (!componentScenarios) {
    throw new Error(`Unknown component "${request.component}".`);
  }

  const scenario = componentScenarios[request.state];

  if (!scenario) {
    throw new Error(
      `Unknown state "${request.state}" for component "${request.component}".`,
    );
  }

  return scenario;
}

export function listHarnessComponents(): string[] {
  return Object.keys(HARNESSES);
}
