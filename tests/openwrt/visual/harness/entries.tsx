import { useEffect, useRef } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  ActivityDrawerHost,
  type ActivityDrawerHostHandle,
} from "@/openwrt-provider-ui/components/ActivityDrawerHost";
import { ActivitySidePanel } from "@/openwrt-provider-ui/components/ActivitySidePanel";
import { AlertStrip } from "@/openwrt-provider-ui/components/AlertStrip";
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
  OpenWrtSharedPageShellApi,
  OpenWrtUsageSummary,
} from "@/openwrt-provider-ui/pageTypes";
import type { SharedProviderAppId } from "@/shared/providers/domain";
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
  render: () => ReactElement;
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

const RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text: "Restart failed: The daemon timed out while reconnecting to 127.0.0.1:15721.",
};

const LONG_RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text:
    "Restart failed: The daemon timed out while reloading the provider routes for Claude, Codex, and Gemini after the restart request. Verify the upstream bridge, proxy listeners, and provider credentials before trying again.",
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

function createAppCardScenario(
  props: Partial<ComponentProps<typeof AppCard>> = {},
): HarnessScenario {
  const appId = props.appId ?? "claude";
  const providerState =
    props.providerState === undefined
      ? createSharedProviderState(appId)
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
            createProviderStat(appId, { successRate: 98.9 }),
          ]
        }
        recentActivity={props.recentActivity ?? [createRecentActivity(appId)]}
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

      const row = document.querySelector<HTMLButtonElement>(
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

function getMessageToneClass(message: OpenWrtPageMessage | null): string {
  if (!message) {
    return "";
  }

  if (message.kind === "success") {
    return "ccswitch-openwrt-page-note--success";
  }

  if (message.kind === "error") {
    return "ccswitch-openwrt-page-note--error";
  }

  return "ccswitch-openwrt-page-note--info";
}

function renderAlertStrip({
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
  return (
    <AlertStrip
      host={host}
      isRunning={isRunning}
      restartInFlight={restartInFlight}
      message={message}
      onRestart={() => {}}
    />
  );
}

function renderDaemonCardScenario({
  host,
  isRunning,
  message = null,
  restartInFlight = false,
  restartPending = false,
}: {
  host: OpenWrtHostState;
  isRunning: boolean;
  message?: OpenWrtPageMessage | null;
  restartInFlight?: boolean;
  restartPending?: boolean;
}) {
  return (
    <DaemonCard
      host={host}
      draft={createDraft(host)}
      isRunning={isRunning}
      isDirty={false}
      saveInFlight={false}
      restartInFlight={restartInFlight}
      restartPending={restartPending}
      message={message}
      messageToneClass={getMessageToneClass(message)}
      onDraftChange={() => {}}
      onSave={() => {}}
      onRestart={() => {}}
    />
  );
}

const HARNESSES: Record<string, Record<string, HarnessScenario>> = {
  AlertStrip: {
    healthy: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => renderAlertStrip({}),
    },
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAlertStrip({
          host: STOPPED_HOST,
          isRunning: false,
        }),
    },
    unreachable: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAlertStrip({
          host: UNREACHABLE_HOST,
        }),
    },
    restarting: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAlertStrip({
          restartInFlight: true,
        }),
    },
    "restart-failed": {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () =>
        renderAlertStrip({
          message: RESTART_FAILED_MESSAGE,
        }),
    },
    "restart-failed-long": {
      canvasClassName: "owt-visual-harness__canvas--narrow",
      render: () =>
        renderAlertStrip({
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
          message: {
            kind: "info",
            text: "Provider changes were saved and need a restart.",
          },
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
          message: {
            kind: "error",
            text: "Restart failed: daemon status unavailable.",
          },
        }),
    },
  },
};

export function getHarnessRequest(url: URL): HarnessRequest {
  const component = url.searchParams.get("component") ?? "AlertStrip";
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
