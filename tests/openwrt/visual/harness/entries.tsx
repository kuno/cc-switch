import type { ComponentProps, ReactElement } from "react";
import { AlertStrip } from "@/openwrt-provider-ui/components/AlertStrip";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import type { OpenWrtProviderStat } from "@/openwrt-provider-ui/pageTypes";
import type {
  OpenWrtHostState,
  OpenWrtPageTheme,
} from "@/openwrt-provider-ui/pageTypes";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  createProviderStat,
  createProviderTransportFixture,
  createRecentActivity,
  createSharedProviderState,
  createShellStub,
  createUsageSummary,
} from "../../fixtures/openwrtProviderUi";

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

const HARNESSES: Record<string, Record<string, HarnessScenario>> = {
  AlertStrip: {
    stopped: {
      canvasClassName: "owt-visual-harness__canvas--wide",
      render: () => (
        <AlertStrip
          host={STOPPED_HOST}
          isRunning={false}
          restartInFlight={false}
          message={null}
          onRestart={() => {}}
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
