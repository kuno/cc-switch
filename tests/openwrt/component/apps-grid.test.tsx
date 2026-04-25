import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { OpenWrtHostState } from "@/openwrt-provider-ui/pageTypes";
import {
  APP_OPTIONS,
  AppsGrid,
} from "@/openwrt-provider-ui/components/AppsGrid";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  createProviderListResponse,
  createProviderTransportFixture,
  createUsageSummary,
  OPENWRT_APP_IDS,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture, DEFAULT_HOST_STATE } from "./fixtures/bridge";

type RenderAppsGridOptions = {
  bridge?: ReturnType<typeof createBridgeFixture>;
  onOpenActivity?: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel?: (appId: SharedProviderAppId) => void;
  providerMutationVersion?: number;
  transport?: ReturnType<typeof createProviderTransportFixture>;
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
      container.querySelectorAll(".owt-app-card__skeleton-active"),
    ).toHaveLength(padToEven(APP_OPTIONS.length));
    expect(screen.queryByText("Not configured")).toBeNull();
  });

  it("pads the configured grid to an even tile count after the initial load settles", async () => {
    const { container } = renderAppsGrid();

    await screen.findAllByRole("button", {
      name: /Open (Claude|Codex|Gemini) providers/,
    });

    expect(container.querySelectorAll(".owt-app-card")).toHaveLength(
      padToEven(OPENWRT_APP_IDS.length) +
        (APP_OPTIONS.length - OPENWRT_APP_IDS.length),
    );
    expect(container.querySelectorAll(".owt-app-card--skeleton")).toHaveLength(
      1,
    );
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

  it("renders five home cards while still fetching only the supported three backend apps", async () => {
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
    const { container } = renderAppsGrid({
      bridge,
      transport,
    });

    await waitFor(() => {
      expect(listProvidersSpy).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    });

    expect(
      screen.getAllByRole("button", {
        name: /Open (Claude|Codex|Gemini) providers/,
      }),
    ).toHaveLength(OPENWRT_APP_IDS.length);
    expect(
      screen.getByRole("button", { name: "OpenCode not configured" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "OpenClaw not configured" }),
    ).toBeDisabled();
    expect(listProvidersSpy.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".owt-app-card[data-app]"),
      ).map((card) => card.dataset.app),
    ).toEqual([...APP_OPTIONS]);
  });

  it("renders OpenCode and OpenClaw as unconfigured inert cards", async () => {
    const { container } = renderAppsGrid();

    await screen.findByRole("button", {
      name: "OpenCode not configured",
    });

    const unconfiguredGroup = container.querySelector<HTMLElement>(
      ".owt-group-grid--unconfigured",
    );

    expect(unconfiguredGroup).not.toBeNull();
    expect(
      within(unconfiguredGroup!).getByText("OpenCode"),
    ).toBeInTheDocument();
    expect(
      within(unconfiguredGroup!).getByText("OpenClaw"),
    ).toBeInTheDocument();
    expect(getAppCard(container, "opencode")).toHaveClass(
      "owt-app-card--empty",
      "owt-app-card--inert",
    );
    expect(getAppCard(container, "openclaw")).toHaveClass(
      "owt-app-card--empty",
      "owt-app-card--inert",
    );
  });

  it("synthesizes inert card data without backend calls for OpenCode and OpenClaw", async () => {
    const bridge = createBridgeFixture();
    const transport = createProviderTransportFixture();
    const listProvidersSpy = vi.spyOn(transport, "listProviders");
    const listSavedProvidersSpy = vi.spyOn(transport, "listSavedProviders");
    const getActiveProviderSpy = vi.spyOn(transport, "getActiveProvider");
    const getUsageSummary = bridge.getUsageSummary as unknown as Mock;
    const getProviderStats = bridge.getProviderStats as unknown as Mock;
    const getRecentActivity = bridge.getRecentActivity as unknown as Mock;

    renderAppsGrid({ bridge, transport });

    await waitFor(() => {
      expect(listProvidersSpy).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    });

    expect(listProvidersSpy.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(listSavedProvidersSpy.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(getActiveProviderSpy.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(getUsageSummary.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(getProviderStats.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(getRecentActivity.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
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

    expect(opencodeButton).toBeDisabled();
    expect(opencodeButton).toHaveAttribute("aria-disabled", "true");
    expect(openclawButton).toBeDisabled();
    expect(openclawButton).toHaveAttribute("aria-disabled", "true");

    await user.click(opencodeButton);
    await user.click(openclawButton);

    expect(onOpenProviderPanel).not.toHaveBeenCalled();
  });

  it("polls usage summaries once per app every 10 seconds", async () => {
    vi.useFakeTimers();
    const bridge = createBridgeFixture();
    renderAppsGrid({ bridge });

    await flushMicrotasks();
    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();

    const getUsageSummary = bridge.getUsageSummary as unknown as Mock;
    getUsageSummary.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await flushMicrotasks();

    expect(getUsageSummary).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    expect(getUsageSummary.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
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

    const getUsageSummary = bridge.getUsageSummary as unknown as Mock;
    getUsageSummary.mockClear();

    visibility.set("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(getUsageSummary).not.toHaveBeenCalled();

    visibility.set("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushMicrotasks();

    expect(getUsageSummary).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);

    getUsageSummary.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await flushMicrotasks();

    expect(getUsageSummary).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    visibility.restore();
  });

  it("preserves the previous summary for apps whose poll request fails", async () => {
    vi.useFakeTimers();
    const bridge = createBridgeFixture({
      usageSummary: {
        claude: createUsageSummary({ totalRequests: 10 }),
        codex: createUsageSummary({ totalRequests: 20 }),
        gemini: createUsageSummary({ totalRequests: 30 }),
      },
    });
    const { container } = renderAppsGrid({ bridge });

    await flushMicrotasks();
    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();

    const getUsageSummary = bridge.getUsageSummary as unknown as Mock;
    const firstPoll = {
      claude: createUsageSummary({ totalRequests: 101 }),
      codex: createUsageSummary({ totalRequests: 202 }),
      gemini: createUsageSummary({ totalRequests: 303 }),
    } satisfies Record<
      SharedProviderAppId,
      ReturnType<typeof createUsageSummary>
    >;
    const secondPoll = {
      claude: createUsageSummary({ totalRequests: 111 }),
      codex: new Error("Transient summary failure"),
      gemini: createUsageSummary({ totalRequests: 333 }),
    } satisfies Record<
      SharedProviderAppId,
      Error | ReturnType<typeof createUsageSummary>
    >;
    let pollBatch = 0;
    let callsInBatch = 0;

    getUsageSummary.mockClear();
    getUsageSummary.mockImplementation(async (appId: SharedProviderAppId) => {
      const nextValue = (pollBatch === 0 ? firstPoll : secondPoll)[appId];
      callsInBatch += 1;

      if (callsInBatch === OPENWRT_APP_IDS.length) {
        callsInBatch = 0;
        pollBatch += 1;
      }

      if (nextValue instanceof Error) {
        throw nextValue;
      }

      return nextValue;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
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
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await flushMicrotasks();

    expect(
      within(getAppCard(container, "claude")).getByText("111"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "codex")).getByText("202"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "gemini")).getByText("333"),
    ).toBeInTheDocument();
    expect(
      within(getAppCard(container, "codex")).queryByText("222"),
    ).not.toBeInTheDocument();
  });

  it("keeps configured cards out of the not-configured group when one provider-state RPC fails during refresh", async () => {
    const transport = createProviderTransportFixture();
    const { container, rerenderAppsGrid } = renderAppsGrid({
      transport,
      providerMutationVersion: 0,
    });

    await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    expect(
      within(
        container.querySelector<HTMLElement>(".owt-group-grid--unconfigured")!,
      ).queryByText("Claude"),
    ).not.toBeInTheDocument();

    vi.spyOn(transport, "listSavedProviders").mockImplementation(
      async (appId) =>
        appId === "claude"
          ? Promise.reject(new Error("Transient saved-provider failure"))
          : createProviderListResponse(appId),
    );

    rerenderAppsGrid(1);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Claude providers" }),
      ).toBeInTheDocument();
    });

    expect(
      within(
        container.querySelector<HTMLElement>(".owt-group-grid--unconfigured")!,
      ).queryByText("Claude"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add a Claude provider" }),
    ).not.toBeInTheDocument();
  });
});
