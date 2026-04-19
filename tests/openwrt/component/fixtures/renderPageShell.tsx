import { render } from "@testing-library/react";
import { OpenWrtPageShell } from "@/openwrt-provider-ui/OpenWrtPageShell";
import type { OpenWrtPaginatedRequestLogs } from "@/openwrt-provider-ui/pageTypes";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import { createBridgeFixture, type BridgeFixtureOptions } from "./bridge";
import {
  createProviderTransportFixture,
  OPENWRT_PAGE_THEME_STORAGE_KEY,
  OPENWRT_PROVIDER_UI_THEME_CLASS,
  REALISTIC_HOST_STATE,
  REALISTIC_PROVIDER_STATS,
  REALISTIC_PROVIDER_STATES,
  REALISTIC_RECENT_ACTIVITY,
  REALISTIC_REQUEST_DETAILS,
  REALISTIC_REQUEST_LOGS,
  REALISTIC_USAGE_SUMMARIES,
} from "./pageShell";

function createRequestLogsRecord(): Record<
  SharedProviderAppId,
  OpenWrtPaginatedRequestLogs
> {
  return {
    claude: {
      data: REALISTIC_REQUEST_LOGS.claude,
      total: REALISTIC_REQUEST_LOGS.claude.length,
      page: 0,
      pageSize: REALISTIC_REQUEST_LOGS.claude.length,
    },
    codex: {
      data: REALISTIC_REQUEST_LOGS.codex,
      total: REALISTIC_REQUEST_LOGS.codex.length,
      page: 0,
      pageSize: REALISTIC_REQUEST_LOGS.codex.length,
    },
    gemini: {
      data: REALISTIC_REQUEST_LOGS.gemini,
      total: REALISTIC_REQUEST_LOGS.gemini.length,
      page: 0,
      pageSize: REALISTIC_REQUEST_LOGS.gemini.length,
    },
  };
}

export function createRealisticBridgeOptions(
  overrides: BridgeFixtureOptions = {},
): BridgeFixtureOptions {
  const {
    host,
    providerStats,
    recentActivity,
    requestDetails,
    requestLogs,
    restartState,
    serviceStatus,
    usageSummary,
    ...rest
  } = overrides;

  return {
    ...rest,
    host: {
      ...REALISTIC_HOST_STATE,
      ...host,
    },
    providerStats: providerStats ?? REALISTIC_PROVIDER_STATS,
    recentActivity: recentActivity ?? REALISTIC_RECENT_ACTIVITY,
    requestDetails: requestDetails ?? REALISTIC_REQUEST_DETAILS,
    requestLogs: requestLogs ?? createRequestLogsRecord(),
    restartState: restartState ?? {
      inFlight: false,
      pending: false,
    },
    serviceStatus: serviceStatus ?? {
      isRunning: true,
    },
    usageSummary: usageSummary ?? REALISTIC_USAGE_SUMMARIES,
  };
}

export function renderOpenWrtPageShell({
  bridgeOptions,
  initialTheme,
}: {
  bridgeOptions?: BridgeFixtureOptions;
  initialTheme?: "light" | "dark";
} = {}) {
  document.body.classList.add(OPENWRT_PROVIDER_UI_THEME_CLASS);
  if (initialTheme) {
    window.localStorage.setItem(OPENWRT_PAGE_THEME_STORAGE_KEY, initialTheme);
  }

  const bridge = createBridgeFixture(
    createRealisticBridgeOptions(bridgeOptions),
  );
  const transport = createProviderTransportFixture(REALISTIC_PROVIDER_STATES);
  const view = render(
    <OpenWrtPageShell
      options={{
        shell: bridge,
        target: document.createElement("div"),
        transport,
      }}
    />,
  );

  return {
    ...view,
    bridge,
    transport,
  };
}
