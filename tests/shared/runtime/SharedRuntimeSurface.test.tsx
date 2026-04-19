import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderSurface(adapter: RuntimeSurfacePlatformAdapter) {
  const queryClient = createSharedRuntimeSurfaceQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <SharedRuntimeSurface adapter={adapter} />
    </QueryClientProvider>,
  );
}

describe("SharedRuntimeSurface", () => {
  it("composes the service summary and app cards using the shared runtime primitives", async () => {
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
    expect(screen.getByText("Runtime detail: connection refused on 127.0.0.1:15721")).toBeInTheDocument();
    expect(screen.getAllByText("Claude Router Primary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex Router Primary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gemini Router").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Read only").length).toBe(3);
    expect(
      screen.queryByRole("button", { name: /edit|activate|delete/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() =>
      expect(adapter.getRuntimeSurface).toHaveBeenCalledTimes(2),
    );
  });
});
