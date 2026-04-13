import { act, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  emptySharedRuntimeAppView,
  emptySharedRuntimeProvider,
  mountSharedRuntimeSurface,
  type RuntimeSurfacePlatformAdapter,
  type SharedRuntimeState,
} from "@/shared/runtime";

function createState(activeProviderName: string): SharedRuntimeState {
  const claude = emptySharedRuntimeAppView("claude");
  claude.providerCount = 1;
  claude.proxyEnabled = true;
  claude.activeProviderId = activeProviderName.toLowerCase().replace(/\s+/g, "-");
  claude.activeProvider = {
    ...emptySharedRuntimeProvider(),
    configured: true,
    providerId: claude.activeProviderId,
    name: activeProviderName,
    model: "claude-sonnet-4-5",
    active: true,
  };

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
      activeConnections: 1,
      totalRequests: 10,
      successRequests: 9,
      failedRequests: 1,
      successRate: 90,
      uptimeSeconds: 30,
      failoverCount: 1,
      currentProviderName: activeProviderName,
      currentProviderId: claude.activeProviderId,
    },
    apps: [claude],
  };
}

function createAdapter(state: SharedRuntimeState): RuntimeSurfacePlatformAdapter {
  return {
    getRuntimeState: vi.fn().mockResolvedValue(state),
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

    expect(initialAdapter.getRuntimeState).toHaveBeenCalled();
    expect(updatedAdapter.getRuntimeState).toHaveBeenCalled();

    await act(async () => {
      mounted.unmount();
    });

    expect(container.innerHTML).toBe("");
    container.remove();
  });
});
