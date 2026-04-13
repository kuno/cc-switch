import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptySharedProviderView } from "@/shared/providers/domain";
import {
  createSharedRuntimeSurfaceQueryClient,
  SharedRuntimeSurface,
  type RuntimeSurfacePlatformAdapter,
  type SharedRuntimeStatusView,
} from "@/shared/runtime";

function createRuntimeSurfaceState(): SharedRuntimeStatusView {
  return {
    service: {
      running: false,
      reachable: false,
      listenAddress: "127.0.0.1",
      listenPort: 15721,
      proxyEnabled: true,
      enableLogging: true,
      statusSource: "config-fallback",
      statusError: "connection refused on 127.0.0.1:15721",
    },
    runtime: {
      running: false,
      address: "127.0.0.1",
      port: 15721,
      activeConnections: 3,
      totalRequests: 21,
      successRequests: 18,
      failedRequests: 3,
      successRate: 85.7,
      uptimeSeconds: 42,
      currentProvider: "Claude Router Primary",
      currentProviderId: "claude-primary",
      lastRequestAt: null,
      lastError: "upstream timeout",
      failoverCount: 2,
      activeTargets: [
        {
          appType: "claude",
          providerName: "Claude Router Primary",
          providerId: "claude-primary",
        },
      ],
    },
    apps: [
      {
        app: "claude",
        providerCount: 3,
        proxyEnabled: true,
        autoFailoverEnabled: true,
        maxRetries: 4,
        activeProviderId: "claude-primary",
        activeProvider: {
          ...emptySharedProviderView("claude"),
          configured: true,
          providerId: "claude-primary",
          name: "Claude Router Primary",
          model: "claude-sonnet-4-5",
          active: true,
        },
        activeProviderHealth: {
          providerId: "claude-primary",
          observed: true,
          healthy: true,
          consecutiveFailures: 0,
          lastSuccessAt: "2026-04-13T07:14:00Z",
          lastFailureAt: null,
          lastError: null,
          updatedAt: "2026-04-13T07:14:00Z",
        },
        usingLegacyDefault: false,
        failoverQueueDepth: 2,
        failoverQueue: [
          {
            providerId: "claude-primary",
            providerName: "Claude Router Primary",
            sortIndex: 0,
            active: true,
            health: {
              providerId: "claude-primary",
              observed: true,
              healthy: true,
              consecutiveFailures: 0,
              lastSuccessAt: "2026-04-13T07:14:00Z",
              lastFailureAt: null,
              lastError: null,
              updatedAt: "2026-04-13T07:14:00Z",
            },
          },
          {
            providerId: "claude-backup",
            providerName: "Claude Backup",
            sortIndex: 1,
            active: false,
            health: {
              providerId: "claude-backup",
              observed: true,
              healthy: false,
              consecutiveFailures: 2,
              lastSuccessAt: null,
              lastFailureAt: "2026-04-13T07:16:00Z",
              lastError: "upstream timeout",
              updatedAt: "2026-04-13T07:16:00Z",
            },
          },
        ],
        observedProviderCount: 2,
        healthyProviderCount: 1,
        unhealthyProviderCount: 1,
      },
      {
        app: "codex",
        providerCount: 1,
        proxyEnabled: true,
        autoFailoverEnabled: false,
        maxRetries: 2,
        activeProviderId: "codex-primary",
        activeProvider: {
          ...emptySharedProviderView("codex"),
          configured: true,
          providerId: "codex-primary",
          name: "Codex Router Primary",
          model: "gpt-5.4",
          active: true,
        },
        activeProviderHealth: {
          providerId: "codex-primary",
          observed: true,
          healthy: true,
          consecutiveFailures: 0,
          lastSuccessAt: "2026-04-13T07:12:00Z",
          lastFailureAt: null,
          lastError: null,
          updatedAt: "2026-04-13T07:12:00Z",
        },
        usingLegacyDefault: false,
        failoverQueueDepth: 0,
        failoverQueue: [],
        observedProviderCount: 1,
        healthyProviderCount: 1,
        unhealthyProviderCount: 0,
      },
      {
        app: "gemini",
        providerCount: 2,
        proxyEnabled: false,
        autoFailoverEnabled: false,
        maxRetries: 1,
        activeProviderId: "gemini-router",
        activeProvider: {
          ...emptySharedProviderView("gemini"),
          configured: true,
          providerId: "gemini-router",
          name: "Gemini Router",
          model: "gemini-3.1-pro",
          active: true,
        },
        activeProviderHealth: {
          providerId: "gemini-router",
          observed: false,
          healthy: true,
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastError: null,
          updatedAt: null,
        },
        usingLegacyDefault: false,
        failoverQueueDepth: 1,
        failoverQueue: [
          {
            providerId: "gemini-router",
            providerName: "Gemini Router",
            sortIndex: 0,
            active: true,
            health: {
              providerId: "gemini-router",
              observed: false,
              healthy: true,
              consecutiveFailures: 0,
              lastSuccessAt: null,
              lastFailureAt: null,
              lastError: null,
              updatedAt: null,
            },
          },
        ],
        observedProviderCount: 0,
        healthyProviderCount: 0,
        unhealthyProviderCount: 0,
      },
    ],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createAvailableProviders(appId: "claude" | "codex" | "gemini") {
  return (
    {
      claude: [
        {
          providerId: "claude-spare",
          providerName: "Claude Spare",
          model: "claude-haiku-4-5",
        },
      ],
      codex: [
        {
          providerId: "codex-backup",
          providerName: "Codex Backup",
          model: "gpt-5.4-mini",
        },
      ],
      gemini: [
        {
          providerId: "gemini-backup",
          providerName: "Gemini Backup",
          model: "gemini-2.5-flash",
        },
      ],
    } as const
  )[appId];
}

type ControlRuntimeAdapter = RuntimeSurfacePlatformAdapter &
  Required<
    Pick<
      RuntimeSurfacePlatformAdapter,
      | "getAvailableFailoverProviders"
      | "addToFailoverQueue"
      | "removeFromFailoverQueue"
      | "setAutoFailoverEnabled"
    >
  >;

function createControlAdapter(
  overrides: Partial<RuntimeSurfacePlatformAdapter> = {},
  runtimeStates: SharedRuntimeStatusView[] = [createRuntimeSurfaceState()],
): ControlRuntimeAdapter {
  let runtimeIndex = 0;

  return {
    getRuntimeSurface: vi.fn().mockImplementation(async () => {
      const nextIndex = Math.min(runtimeIndex, runtimeStates.length - 1);
      runtimeIndex += 1;
      return runtimeStates[nextIndex]!;
    }),
    getAvailableFailoverProviders: vi
      .fn()
      .mockImplementation(async (appId) => createAvailableProviders(appId)),
    addToFailoverQueue: vi.fn().mockResolvedValue(undefined),
    removeFromFailoverQueue: vi.fn().mockResolvedValue(undefined),
    setAutoFailoverEnabled: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderSurface(adapter: RuntimeSurfacePlatformAdapter) {
  const queryClient = createSharedRuntimeSurfaceQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <SharedRuntimeSurface adapter={adapter} />
    </QueryClientProvider>,
  );
}

function getAppCard(appLabel: "Claude" | "Codex" | "Gemini") {
  return within(screen.getByRole("region", { name: `${appLabel} runtime card` }));
}

describe("SharedRuntimeSurface", () => {
  it("keeps the Phase 7 surface read-only when failover controls are unavailable", async () => {
    const adapter = {
      getRuntimeSurface: vi.fn().mockResolvedValue(createRuntimeSurfaceState()),
    } satisfies RuntimeSurfacePlatformAdapter;

    renderSurface(adapter);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Runtime Surface" }),
      ).toBeInTheDocument(),
    );

    expect(
      screen.getByRole("heading", { name: "Service Summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Runtime detail: connection refused on 127.0.0.1:15721"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Read only")).toHaveLength(3);
    expect(screen.queryByText("Failover controls")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() =>
      expect(adapter.getRuntimeSurface).toHaveBeenCalledTimes(2),
    );
  });

  it("exposes stable layout hooks for the embedded runtime surface", async () => {
    const adapter = {
      getRuntimeSurface: vi.fn().mockResolvedValue(createRuntimeSurfaceState()),
    } satisfies RuntimeSurfacePlatformAdapter;

    const { container } = renderSurface(adapter);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Runtime Surface" }),
      ).toBeInTheDocument(),
    );

    const runtimeSurface = container.querySelector(
      '[data-ccswitch-region="runtime-surface"]',
    );

    expect(runtimeSurface).toHaveAttribute(
      "data-ccswitch-layout",
      "embedded-stack",
    );

    const runtimeHeader = runtimeSurface?.querySelector(
      '[data-ccswitch-region="runtime-header"]',
    );
    const runtimeBody = runtimeSurface?.querySelector(
      '[data-ccswitch-region="runtime-body"]',
    );
    const runtimeSummary = runtimeSurface?.querySelector(
      '[data-ccswitch-region="runtime-summary"]',
    );
    const runtimeAppGrid = runtimeSurface?.querySelector(
      '[data-ccswitch-region="runtime-app-grid"]',
    );

    expect(runtimeHeader).toHaveAttribute(
      "data-ccswitch-layout",
      "stack-to-row",
    );
    expect(runtimeHeader).not.toHaveClass("sm:flex-row");
    expect(runtimeBody).toHaveAttribute(
      "data-ccswitch-layout",
      "embedded-stack",
    );
    expect(runtimeSummary).toContainElement(
      screen.getByRole("heading", { name: "Service Summary" }),
    );
    expect(runtimeAppGrid).toHaveAttribute(
      "data-ccswitch-layout",
      "responsive-grid",
    );
    expect(runtimeAppGrid).toContainElement(
      screen.getByRole("region", { name: "Claude runtime card" }),
    );
    expect(runtimeAppGrid).toContainElement(
      screen.getByRole("region", { name: "Codex runtime card" }),
    );
    expect(runtimeAppGrid).toContainElement(
      screen.getByRole("region", { name: "Gemini runtime card" }),
    );
  });

  it("disables only the active app card controls while a mutation is pending", async () => {
    const addDeferred = createDeferred<void>();
    const adapter = createControlAdapter({
      addToFailoverQueue: vi.fn().mockImplementation(() => addDeferred.promise),
    });
    const user = userEvent.setup();
    renderSurface(adapter);

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Codex runtime card" }),
      ).toBeInTheDocument(),
    );

    const codexCard = getAppCard("Codex");
    const claudeCard = getAppCard("Claude");

    await waitFor(() =>
      expect(
        codexCard.getByRole("button", { name: "Add to queue" }),
      ).toBeEnabled(),
    );

    const addToQueueButton = codexCard.getByRole("button", {
      name: "Add to queue",
    });
    addToQueueButton.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(codexCard.getByRole("button", { name: "Add to queue" })).toBeDisabled();
      expect(
        codexCard.getByRole("switch", { name: "Codex auto-failover" }),
      ).toBeDisabled();
    });

    expect(claudeCard.getByRole("button", { name: "Add to queue" })).toBeEnabled();
    expect(
      claudeCard.getByRole("switch", { name: "Claude auto-failover" }),
    ).toBeEnabled();

    addDeferred.resolve();

    await waitFor(() =>
      expect(codexCard.getByRole("button", { name: "Add to queue" })).toBeEnabled(),
    );
  });

  it("refetches the runtime surface after a successful control mutation", async () => {
    const initialState = createRuntimeSurfaceState();
    const updatedState = createRuntimeSurfaceState();
    updatedState.apps = updatedState.apps.map((app) =>
      app.app === "claude"
        ? {
            ...app,
            autoFailoverEnabled: false,
          }
        : app,
    );
    const adapter = createControlAdapter({}, [initialState, updatedState]);
    const user = userEvent.setup();

    renderSurface(adapter);

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Claude runtime card" }),
      ).toBeInTheDocument(),
    );

    const claudeCard = getAppCard("Claude");

    await waitFor(() =>
      expect(
        claudeCard.getByRole("switch", { name: "Claude auto-failover" }),
      ).toBeEnabled(),
    );

    const autoFailoverSwitch = claudeCard.getByRole("switch", {
      name: "Claude auto-failover",
    });
    autoFailoverSwitch.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(adapter.setAutoFailoverEnabled).toHaveBeenCalledWith(
        "claude",
        false,
      ),
    );
    await waitFor(() =>
      expect(adapter.getRuntimeSurface).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        claudeCard.getByText("Auto-failover disabled"),
      ).toBeInTheDocument(),
    );
  });

  it("keeps the last good snapshot visible and shows an inline error when a control mutation fails", async () => {
    const adapter = createControlAdapter({
      removeFromFailoverQueue: vi
        .fn()
        .mockRejectedValue(new Error("router write rejected")),
    });

    renderSurface(adapter);

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Claude runtime card" }),
      ).toBeInTheDocument(),
    );

    const claudeCard = getAppCard("Claude");

    await waitFor(() =>
      expect(
        claudeCard.getByRole("button", {
          name: "Remove Claude Backup from Claude failover queue",
        }),
      ).toBeEnabled(),
    );

    fireEvent.click(
      claudeCard.getByRole("button", {
        name: "Remove Claude Backup from Claude failover queue",
      }),
    );

    await waitFor(() =>
      expect(
        claudeCard.getByText("Last control action failed"),
      ).toBeInTheDocument(),
    );
    expect(claudeCard.getByText("router write rejected")).toBeInTheDocument();
    expect(claudeCard.getByText("Claude Backup")).toBeInTheDocument();
    expect(adapter.getRuntimeSurface).toHaveBeenCalledTimes(1);
  });
});
