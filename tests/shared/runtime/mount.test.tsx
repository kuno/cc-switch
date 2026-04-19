import { act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptySharedProviderView } from "@/shared/providers/domain";
import {
  mountSharedRuntimeSurface,
  type RuntimeSurfacePlatformAdapter,
  type SharedRuntimeStatusView,
} from "@/shared/runtime";

function createState(activeProviderName: string): SharedRuntimeStatusView {
  const providerId = activeProviderName.toLowerCase().replace(/\s+/g, "-");
  return {
    service: {
      running: true,
      reachable: true,
      listenAddress: "127.0.0.1",
      listenPort: 15721,
      proxyEnabled: true,
      enableLogging: true,
      statusSource: "live-status",
      statusError: null,
    },
    runtime: {
      running: true,
      address: "127.0.0.1",
      port: 15721,
      activeConnections: 1,
      totalRequests: 10,
      successRequests: 9,
      failedRequests: 1,
      successRate: 90,
      uptimeSeconds: 30,
      currentProvider: activeProviderName,
      currentProviderId: providerId,
      lastRequestAt: null,
      lastError: null,
      failoverCount: 1,
      activeTargets: [
        {
          appType: "claude",
          providerName: activeProviderName,
          providerId,
        },
      ],
    },
    apps: [
      {
        app: "claude",
        providerCount: 1,
        proxyEnabled: true,
        autoFailoverEnabled: false,
        maxRetries: 1,
        activeProviderId: providerId,
        activeProvider: {
          ...emptySharedProviderView("claude"),
          configured: true,
          providerId,
          name: activeProviderName,
          model: "claude-sonnet-4-5",
          active: true,
        },
        activeProviderHealth: null,
        usingLegacyDefault: false,
        failoverQueueDepth: 0,
        failoverQueue: [],
        observedProviderCount: 0,
        healthyProviderCount: 0,
        unhealthyProviderCount: 0,
      },
      {
        app: "codex",
        providerCount: 0,
        proxyEnabled: false,
        autoFailoverEnabled: false,
        maxRetries: 0,
        activeProviderId: null,
        activeProvider: emptySharedProviderView("codex"),
        activeProviderHealth: null,
        usingLegacyDefault: false,
        failoverQueueDepth: 0,
        failoverQueue: [],
        observedProviderCount: 0,
        healthyProviderCount: 0,
        unhealthyProviderCount: 0,
      },
      {
        app: "gemini",
        providerCount: 0,
        proxyEnabled: false,
        autoFailoverEnabled: false,
        maxRetries: 0,
        activeProviderId: null,
        activeProvider: emptySharedProviderView("gemini"),
        activeProviderHealth: null,
        usingLegacyDefault: false,
        failoverQueueDepth: 0,
        failoverQueue: [],
        observedProviderCount: 0,
        healthyProviderCount: 0,
        unhealthyProviderCount: 0,
      },
    ],
  };
}

function createAdapter(
  state: SharedRuntimeStatusView,
): RuntimeSurfacePlatformAdapter {
  return {
    getRuntimeSurface: vi.fn().mockResolvedValue(state),
  };
}

describe("mountSharedRuntimeSurface", () => {
  it("mounts, updates with a new adapter, and unmounts cleanly", async () => {
    const initialAdapter = createAdapter(createState("Claude Router Primary"));
    const updatedAdapter = createAdapter(createState("Claude Router Failover"));
    const container = document.createElement("div");
    document.body.appendChild(container);

    let mounted!: ReturnType<typeof mountSharedRuntimeSurface>;

    await act(async () => {
      mounted = mountSharedRuntimeSurface(container, {
        adapter: initialAdapter,
      });
    });

    await waitFor(() =>
      expect(within(container).getByText("Claude Router Primary")).toBeInTheDocument(),
    );

    await act(async () => {
      mounted.update({
        adapter: updatedAdapter,
      });
    });

    await waitFor(() =>
      expect(within(container).getByText("Claude Router Failover")).toBeInTheDocument(),
    );

    expect(initialAdapter.getRuntimeSurface).toHaveBeenCalled();
    expect(updatedAdapter.getRuntimeSurface).toHaveBeenCalled();

    await act(async () => {
      mounted.unmount();
    });

    expect(container.innerHTML).toBe("");
    container.remove();
  });
});
