import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  OpenWrtHostState,
  OpenWrtStatusResponse,
  OpenWrtUsageSummary,
} from "@/openwrt-provider-ui/pageTypes";
import type { OpenWrtProviderTransport } from "@/platform/openwrt/providers";
import {
  APP_OPTIONS,
  AppsGrid,
} from "@/openwrt-provider-ui/components/AppsGrid";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  createProviderTransportFixture,
  createUsageSummary,
  OPENWRT_APP_IDS,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture, DEFAULT_HOST_STATE } from "./fixtures/bridge";
import {
  createDeferred,
  createProviderTransportFixture as createComponentProviderTransportFixture,
} from "./fixtures/providerTransport";

type RenderAppsGridOptions = {
  bridge?: ReturnType<typeof createBridgeFixture>;
  onOpenActivity?: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel?: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
  providerMutationVersion?: number;
  transport?: OpenWrtProviderTransport;
};

function renderAppsGrid(options: RenderAppsGridOptions = {}) {
  const bridge = options.bridge ?? createBridgeFixture();
  const transport = options.transport ?? createProviderTransportFixture();
  const providerMutationVersion = options.providerMutationVersion ?? 0;
  const onOpenActivity = options.onOpenActivity ?? bridge.setSelectedApp;
  const onOpenProviderPanel =
    options.onOpenProviderPanel ?? bridge.setSelectedApp;
  const user = userEvent.setup();
  const props = {
    options: {
      target: document.body,
      shell: bridge,
      transport,
    },
    onOpenActivity,
    onOpenProviderPanel,
  } as const;

  const renderResult = render(
    <AppsGrid {...props} providerMutationVersion={providerMutationVersion} />,
  );

  return {
    bridge,
    rerenderAppsGrid(nextProviderMutationVersion: number) {
      renderResult.rerender(
        <AppsGrid
          {...props}
          providerMutationVersion={nextProviderMutationVersion}
        />,
      );
    },
    transport,
    user,
    ...renderResult,
  };
}

function getAppCard(container: HTMLElement, appId: string) {
  const card = container.querySelector<HTMLElement>(
    `.owt-app-card[data-app="${appId}"]`,
  );

  if (!card) {
    throw new Error(`Missing ${appId} card`);
  }

  return card;
}

function getGroupGrids(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".owt-group-grid"));
}

function padToEven(count: number): number {
  return count % 2 === 1 ? count + 1 : count;
}

function mockVisibilityState(
  initialState: DocumentVisibilityState = "visible",
) {
  let visibilityState = initialState;
  const restore = vi
    .spyOn(document, "visibilityState", "get")
    .mockImplementation(() => visibilityState);

  return {
    set(nextState: DocumentVisibilityState) {
      visibilityState = nextState;
    },
    restore() {
      restore.mockRestore();
    },
  };
}

const STATUS_APP_META: Record<
  SharedProviderAppId,
  { label: string; baseUrl: string; tokenField: string }
> = {
  claude: {
    label: "Claude",
    baseUrl: "https://claude.example.com/v1",
    tokenField: "ANTHROPIC_AUTH_TOKEN",
  },
  codex: {
    label: "Codex",
    baseUrl: "https://api.openai.com/v1",
    tokenField: "OPENAI_API_KEY",
  },
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    tokenField: "GEMINI_API_KEY",
  },
};

function createStatusResponse(
  options: {
    configuredApps?: Partial<Record<SharedProviderAppId, boolean>>;
    usageSummary?: Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>>;
  } = {},
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
      OPENWRT_APP_IDS.map((appId) => {
        const providerId = `${appId}-primary`;
        const providerName = `${STATUS_APP_META[appId].label} Primary`;
        const configured = options.configuredApps?.[appId] ?? true;

        return [
          appId,
          {
            mode: "normal",
            proxyEnabled: true,
            health: configured ? true : null,
            healthReason: configured ? "ok" : "no_provider_configured",
            maxRetries: 3,
            usage: options.usageSummary?.[appId] ?? createUsageSummary(),
            activeProvider: configured
              ? {
                  providerId,
                  name: providerName,
                }
              : null,
            providers: configured
              ? {
                  [providerId]: {
                    providerId,
                    name: providerName,
                    configured: true,
                    active: true,
                    baseUrl: STATUS_APP_META[appId].baseUrl,
                    tokenField: STATUS_APP_META[appId].tokenField,
                    tokenConfigured: true,
                    tokenMasked: "sk-****",
                    stats: null,
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
                }
              : {},
            failoverQueue: [],
            failoverStatus: {},
          },
        ];
      }),
    ) as OpenWrtStatusResponse["apps"],
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AppsGrid", () => {
  it("defines five home app options", () => {
    expect(APP_OPTIONS).toHaveLength(5);
    expect([...APP_OPTIONS]).toEqual([
      ...OPENWRT_APP_IDS,
      "opencode",
      "openclaw",
    ]);
  });

  it("renders configured skeleton cards while the initial app data is loading", () => {
    const { container } = renderAppsGrid();

    expect(container.querySelectorAll(".owt-app-card--skeleton")).toHaveLength(
      padToEven(APP_OPTIONS.length),
    );
    expect(
      container.querySelectorAll(
        '.owt-app-card--skeleton[data-animated="true"]',
      ),
    ).toHaveLength(padToEven(APP_OPTIONS.length));
    expect(
      container.querySelectorAll(".owt-app-card__skeleton-active"),
    ).toHaveLength(padToEven(APP_OPTIONS.length));
    expect(screen.queryByText("Not configured")).toBeNull();
  });

  it("pads the configured grid to an even tile count after the initial load settles", async () => {
    const { container } = renderAppsGrid();

    await screen.findAllByRole("button", {
      name: /Open (Claude|Codex|Gemini) providers/,
    });

    const groupGrids = getGroupGrids(container);

    expect(groupGrids).toHaveLength(2);
    expect(groupGrids[0].querySelectorAll(".owt-app-card")).toHaveLength(
      padToEven(OPENWRT_APP_IDS.length),
    );
    expect(groupGrids[1].querySelectorAll(".owt-app-card")).toHaveLength(
      APP_OPTIONS.length - OPENWRT_APP_IDS.length,
    );
    expect(container.querySelectorAll(".owt-app-card")).toHaveLength(
      padToEven(OPENWRT_APP_IDS.length) +
        (APP_OPTIONS.length - OPENWRT_APP_IDS.length),
    );
    expect(container.querySelectorAll(".owt-app-card--skeleton")).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll(
        '.owt-app-card--skeleton[data-animated="true"]',
      ),
    ).toHaveLength(0);
  });

  it("keeps tab and shift-tab order aligned with the three card surfaces", async () => {
    const { user } = renderAppsGrid();
    const mainButtons = await screen.findAllByRole("button", {
      name: /Open (Claude|Codex|Gemini) providers/,
    });
    const openButtons = screen.getAllByTitle("Show recent requests");

    await user.tab();
    expect(mainButtons[0]).toHaveFocus();

    await user.tab();
    expect(openButtons[0]).toHaveFocus();

    await user.tab();
    expect(mainButtons[1]).toHaveFocus();

    await user.tab({ shift: true });
    expect(openButtons[0]).toHaveFocus();

    await user.tab({ shift: true });
    expect(mainButtons[0]).toHaveFocus();
  });

  it("routes card clicks through the provider-panel callback with the matching app id", async () => {
    const { bridge, user } = renderAppsGrid();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const codexButton = await screen.findByRole("button", {
      name: "Open Codex providers",
    });

    await user.click(codexButton);

    expect(setSelectedApp).toHaveBeenCalledWith("codex");
  });

  it("toggles only per-app proxy state without restarting the daemon", async () => {
    const bridge = createBridgeFixture();
    const { transport } = createComponentProviderTransportFixture();
    const { user } = renderAppsGrid({ bridge, transport });

    const claudeProxySwitch = await screen.findByRole("switch", {
      name: "Proxy enabled for Claude",
    });

    await user.click(claudeProxySwitch);

    expect(transport.setProxyEnabled).toHaveBeenCalledWith("claude", false);
    expect(bridge.restartService).not.toHaveBeenCalled();
  });

  it("renders five home cards while fetching one backend status snapshot", async () => {
    const transport = createProviderTransportFixture();
    const listProvidersSpy = vi.spyOn(transport, "listProviders");
    const weirdHostState = {
      ...DEFAULT_HOST_STATE,
      app: "openclaw",
    } as unknown as OpenWrtHostState;
    const bridge = createBridgeFixture({
      overrides: {
        getHostState: vi.fn(() => weirdHostState),
        getSelectedApp: vi.fn(() => "hermes" as unknown as SharedProviderAppId),
      },
    });
    const getStatus = bridge.getStatus as unknown as Mock;
    const { container } = renderAppsGrid({
      bridge,
      transport,
    });

    await waitFor(() => {
      expect(getStatus).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.getAllByRole("button", {
        name: /Open (Claude|Codex|Gemini) providers/,
      }),
    ).toHaveLength(OPENWRT_APP_IDS.length);
    expect(
      screen.getByRole("button", { name: "OpenCode not configured" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: "OpenClaw not configured" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(listProvidersSpy).not.toHaveBeenCalled();
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".owt-app-card[data-app]"),
      ).map((card) => card.dataset.app),
    ).toEqual([...APP_OPTIONS]);
  });

  it("uses activeProvider over stale failover currentRole when marking the active queue row", async () => {
    const status = createStatusResponse();
    const claudeStatus = status.apps.claude;
    status.apps.claude = {
      ...claudeStatus,
      maxRetries: claudeStatus?.maxRetries ?? 3,
      mode: "failover",
      activeProvider: {
        providerId: "kimi",
        name: "Kimi For Coding",
      },
      providers: {
        official: {
          name: "Claude Official",
          configured: true,
          baseUrl: "https://api.anthropic.com",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
          stats: null,
          quota: null,
        },
        kimi: {
          name: "Kimi For Coding",
          configured: true,
          baseUrl: "https://api.kimi.com/coding/",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
          stats: null,
          quota: null,
        },
      },
      failoverQueue: [
        {
          providerId: "official",
          name: "Claude Official",
          position: 0,
        },
        {
          providerId: "kimi",
          name: "Kimi For Coding",
          position: 1,
        },
      ],
      failoverStatus: {
        official: {
          inFailoverQueue: true,
          queuePosition: 0,
          currentRole: "active",
          available: false,
          health: { observed: true, healthy: true, consecutiveFailures: 0 },
        },
        kimi: {
          inFailoverQueue: true,
          queuePosition: 1,
          currentRole: "standby",
          available: true,
          health: { observed: true, healthy: true, consecutiveFailures: 0 },
        },
      },
    };
    const bridge = createBridgeFixture({ status });
    const { container } = renderAppsGrid({ bridge });

    await screen.findByText("Kimi For Coding");
    const claudeCard = getAppCard(container, "claude");
    const activeRows = claudeCard.querySelectorAll(
      '.owt-app-card__queue-row[data-state="active"]',
    );

    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]).toHaveTextContent("Kimi For Coding");
    expect(activeRows[0]).toHaveTextContent("openwrt.appCard.queue.active");
    expect(within(claudeCard).getByText("Claude Official")).toBeInTheDocument();
  });

  it("renders OpenCode and OpenClaw as unconfigured inert cards", async () => {
    const { container } = renderAppsGrid();

    await screen.findByRole("button", {
      name: "OpenCode not configured",
    });
    const groupGrids = getGroupGrids(container);
    const unconfiguredGrid = groupGrids[1];

    expect(
      container.querySelector(".owt-group-head .owt-group-label"),
    ).toHaveTextContent("Not configured");
    expect(groupGrids).toHaveLength(2);
    expect(within(unconfiguredGrid).getByText("OpenCode")).toBeInTheDocument();
    expect(within(unconfiguredGrid).getByText("OpenClaw")).toBeInTheDocument();
    const opencodeCard = getAppCard(container, "opencode");
    const openclawCard = getAppCard(container, "openclaw");

    expect(opencodeCard).toHaveClass(
      "owt-app-card--empty",
      "owt-app-card--inert",
    );
    expect(openclawCard).toHaveClass(
      "owt-app-card--empty",
      "owt-app-card--inert",
    );
    expect(
      within(opencodeCard).queryByText("Add a provider →"),
    ).not.toBeInTheDocument();
    expect(
      within(openclawCard).queryByText("Add a provider →"),
    ).not.toBeInTheDocument();
  });

  it("synthesizes inert card data without backend calls for OpenCode and OpenClaw", async () => {
    const bridge = createBridgeFixture();
    const transport = createProviderTransportFixture();
    const listProvidersSpy = vi.spyOn(transport, "listProviders");
    const listSavedProvidersSpy = vi.spyOn(transport, "listSavedProviders");
    const getActiveProviderSpy = vi.spyOn(transport, "getActiveProvider");
    const getStatus = bridge.getStatus as unknown as Mock;
    const getUsageSummary = bridge.getUsageSummary as unknown as Mock;
    const getProviderStats = bridge.getProviderStats as unknown as Mock;
    const getRecentActivity = bridge.getRecentActivity as unknown as Mock;

    renderAppsGrid({ bridge, transport });

    await waitFor(() => {
      expect(getStatus).toHaveBeenCalledTimes(1);
    });

    expect(listProvidersSpy).not.toHaveBeenCalled();
    expect(listSavedProvidersSpy).not.toHaveBeenCalled();
    expect(getActiveProviderSpy).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
    expect(getProviderStats).not.toHaveBeenCalled();
    expect(getRecentActivity).not.toHaveBeenCalled();
  });

  it("does not open the provider panel from inert placeholder card clicks", async () => {
    const onOpenProviderPanel = vi.fn();
    const { user } = renderAppsGrid({ onOpenProviderPanel });
    const opencodeButton = await screen.findByRole("button", {
      name: "OpenCode not configured",
    });
    const openclawButton = screen.getByRole("button", {
      name: "OpenClaw not configured",
    });

    expect(opencodeButton).toHaveAttribute("aria-disabled", "true");
    expect(openclawButton).toHaveAttribute("aria-disabled", "true");

    await user.click(opencodeButton);
    await user.click(openclawButton);

    expect(onOpenProviderPanel).not.toHaveBeenCalled();
  });

  it("polls the aggregate status snapshot every 60 seconds", async () => {
    vi.useFakeTimers();
    const bridge = createBridgeFixture();
    renderAppsGrid({ bridge });

    await flushMicrotasks();
    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();

    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushMicrotasks();

    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while the page is hidden and refetches immediately when visible again", async () => {
    vi.useFakeTimers();
    const visibility = mockVisibilityState("visible");
    const bridge = createBridgeFixture();
    renderAppsGrid({ bridge });

    await flushMicrotasks();
    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();

    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockClear();

    visibility.set("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(getStatus).not.toHaveBeenCalled();

    visibility.set("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushMicrotasks();

    expect(getStatus).toHaveBeenCalledTimes(1);

    getStatus.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushMicrotasks();

    expect(getStatus).toHaveBeenCalledTimes(1);
    visibility.restore();
  });

  it("preserves the previous summary when a status poll request fails", async () => {
    vi.useFakeTimers();
    const initialUsage = {
      claude: createUsageSummary({ totalRequests: 10 }),
      codex: createUsageSummary({ totalRequests: 20 }),
      gemini: createUsageSummary({ totalRequests: 30 }),
    } satisfies Record<
      SharedProviderAppId,
      ReturnType<typeof createUsageSummary>
    >;
    const bridge = createBridgeFixture({
      status: createStatusResponse({
        usageSummary: initialUsage,
      }),
    });
    const { container } = renderAppsGrid({ bridge });

    await flushMicrotasks();
    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();

    const getStatus = bridge.getStatus as unknown as Mock;
    const firstPollUsage = {
      claude: createUsageSummary({ totalRequests: 101 }),
      codex: createUsageSummary({ totalRequests: 202 }),
      gemini: createUsageSummary({ totalRequests: 303 }),
    } satisfies Record<
      SharedProviderAppId,
      ReturnType<typeof createUsageSummary>
    >;

    getStatus.mockClear();
    getStatus
      .mockResolvedValueOnce(
        createStatusResponse({
          usageSummary: firstPollUsage,
        }),
      )
      .mockRejectedValueOnce(new Error("Transient status failure"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushMicrotasks();

    expect(
      within(getAppCard(container, "claude")).getByText("101"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "codex")).getByText("202"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "gemini")).getByText("303"),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await flushMicrotasks();

    expect(
      within(getAppCard(container, "claude")).getByText("101"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "codex")).getByText("202"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "gemini")).getByText("303"),
    ).toBeInTheDocument();
  });

  it("keeps configured cards out of the not-configured group when a status refresh fails", async () => {
    const bridge = createBridgeFixture({
      status: createStatusResponse({
        usageSummary: {
          claude: createUsageSummary({ totalRequests: 10 }),
          codex: createUsageSummary({ totalRequests: 20 }),
          gemini: createUsageSummary({ totalRequests: 30 }),
        },
      }),
    });
    const { container, rerenderAppsGrid } = renderAppsGrid({
      bridge,
      providerMutationVersion: 0,
    });

    await screen.findByRole("button", {
      name: "Open Claude providers",
    });
    const initialGrids = getGroupGrids(container);
    expect(initialGrids).toHaveLength(2);
    expect(initialGrids[0]).toContainElement(getAppCard(container, "claude"));
    expect(initialGrids[1]).not.toContainElement(
      getAppCard(container, "claude"),
    );

    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockRejectedValueOnce(new Error("Transient status failure"));

    rerenderAppsGrid(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument();
    });
    const refreshedGrids = getGroupGrids(container);
    expect(refreshedGrids).toHaveLength(2);
    expect(refreshedGrids[0]).toContainElement(getAppCard(container, "claude"));
    expect(refreshedGrids[1]).not.toContainElement(
      getAppCard(container, "claude"),
    );
    expect(
      screen.queryByRole("button", { name: "Add a Claude provider" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the same app-card node when status changes an app from unconfigured to configured", async () => {
    const bridge = createBridgeFixture({
      status: createStatusResponse({
        configuredApps: {
          claude: false,
          codex: false,
          gemini: false,
        },
      }),
    });
    const { container, rerenderAppsGrid } = renderAppsGrid({
      bridge,
      providerMutationVersion: 0,
    });

    await screen.findByRole("button", {
      name: "Add a Claude provider",
    });

    const initialClaudeCard = getAppCard(container, "claude");
    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockResolvedValueOnce(
      createStatusResponse({
        configuredApps: {
          claude: true,
          codex: false,
          gemini: false,
        },
      }),
    );

    rerenderAppsGrid(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument();
    });

    expect(getAppCard(container, "claude")).toBe(initialClaudeCard);
  });

  it("preserves the previous summary during a provider-mutation refresh when the status request fails", async () => {
    const bridge = createBridgeFixture({
      status: createStatusResponse({
        usageSummary: {
          claude: createUsageSummary({ totalRequests: 10 }),
          codex: createUsageSummary({ totalRequests: 20 }),
          gemini: createUsageSummary({ totalRequests: 30 }),
        },
      }),
    });
    const { container, rerenderAppsGrid } = renderAppsGrid({
      bridge,
      providerMutationVersion: 0,
    });

    await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockRejectedValueOnce(new Error("Transient status failure"));

    rerenderAppsGrid(1);

    await waitFor(() =>
      expect(
        within(getAppCard(container, "claude")).getByText("10"),
      ).toBeInTheDocument(),
    );

    expect(
      within(getAppCard(container, "codex")).getByText("20"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "gemini")).getByText("30"),
    ).toBeInTheDocument();
  });

  it("does not flip existing cards back into loading state during a provider-mutation refresh", async () => {
    const bridge = createBridgeFixture();
    const { container, rerenderAppsGrid } = renderAppsGrid({
      bridge,
      providerMutationVersion: 0,
    });

    await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    const pendingStatusRefresh = createDeferred<OpenWrtStatusResponse>();
    const getStatus = bridge.getStatus as unknown as Mock;
    getStatus.mockReturnValueOnce(pendingStatusRefresh.promise);

    rerenderAppsGrid(1);
    await flushMicrotasks();

    expect(getAppCard(container, "claude")).toHaveAttribute(
      "data-loading",
      "false",
    );
    expect(getAppCard(container, "codex")).toHaveAttribute(
      "data-loading",
      "false",
    );
    expect(getAppCard(container, "gemini")).toHaveAttribute(
      "data-loading",
      "false",
    );

    pendingStatusRefresh.resolve(createStatusResponse());

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument();
    });
  });

  it("does not use stale per-app polling methods", async () => {
    const bridge = createBridgeFixture({
      usageSummary: {
        claude: createUsageSummary({ totalRequests: 10 }),
        codex: createUsageSummary({ totalRequests: 20 }),
        gemini: createUsageSummary({ totalRequests: 30 }),
      },
    });
    renderAppsGrid({ bridge });

    await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    expect(bridge.getStatus).toHaveBeenCalledTimes(1);
    expect(bridge.getUsageSummary).not.toHaveBeenCalled();
    expect(bridge.getProviderStats).not.toHaveBeenCalled();
    expect(bridge.getRecentActivity).not.toHaveBeenCalled();
  });
});
