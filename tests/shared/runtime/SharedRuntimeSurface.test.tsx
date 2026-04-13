import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createSharedRuntimeSurfaceQueryClient,
  emptySharedRuntimeAppView,
  emptySharedRuntimeHealth,
  emptySharedRuntimeProvider,
  type RuntimeSurfacePlatformAdapter,
  SharedRuntimeSurface,
  type SharedRuntimeProviderHealth,
  type SharedRuntimeState,
} from "@/shared/runtime";

function createAdapter(state: SharedRuntimeState): RuntimeSurfacePlatformAdapter {
  return {
    getRuntimeState: vi.fn().mockResolvedValue(state),
  };
}

function createHealth(
  providerId: string,
  partial: Partial<SharedRuntimeProviderHealth> = {},
): SharedRuntimeProviderHealth {
  return {
    ...emptySharedRuntimeHealth(providerId),
    providerId,
    ...partial,
  };
}

function createState(): SharedRuntimeState {
  const claude = emptySharedRuntimeAppView("claude");
  claude.providerCount = 3;
  claude.proxyEnabled = true;
  claude.autoFailoverEnabled = true;
  claude.maxRetries = 4;
  claude.activeProviderId = "claude-primary";
  claude.activeProvider = {
    ...emptySharedRuntimeProvider(),
    configured: true,
    providerId: "claude-primary",
    name: "Claude Router Primary",
    model: "claude-sonnet-4-5",
    active: true,
  };
  claude.activeProviderHealth = createHealth("claude-primary", {
    observed: true,
    healthy: true,
    lastSuccessAt: "2026-04-13T07:14:00Z",
  });
  claude.failoverQueueDepth = 2;
  claude.failoverQueue = [
    {
      providerId: "claude-primary",
      providerName: "Claude Router Primary",
      sortIndex: 1,
      active: true,
      health: createHealth("claude-primary", {
        observed: true,
        healthy: true,
      }),
    },
    {
      providerId: "claude-backup",
      providerName: "Claude Backup",
      sortIndex: 2,
      active: false,
      health: createHealth("claude-backup", {
        observed: true,
        healthy: false,
        consecutiveFailures: 2,
        lastError: "upstream timeout",
      }),
    },
  ];
  claude.observedProviderCount = 2;
  claude.healthyProviderCount = 1;
  claude.unhealthyProviderCount = 1;

  const codex = emptySharedRuntimeAppView("codex");
  codex.providerCount = 1;
  codex.proxyEnabled = true;
  codex.autoFailoverEnabled = false;
  codex.activeProviderId = "codex-primary";
  codex.activeProvider = {
    ...emptySharedRuntimeProvider(),
    configured: true,
    providerId: "codex-primary",
    name: "Codex Router Primary",
    model: "gpt-5.4",
    active: true,
  };
  codex.activeProviderHealth = createHealth("codex-primary", {
    observed: true,
    healthy: true,
  });
  codex.failoverQueueDepth = 0;
  codex.failoverQueue = [];
  codex.observedProviderCount = 1;
  codex.healthyProviderCount = 1;
  codex.unhealthyProviderCount = 0;

  const gemini = emptySharedRuntimeAppView("gemini");
  gemini.providerCount = 2;
  gemini.proxyEnabled = false;
  gemini.autoFailoverEnabled = false;
  gemini.activeProviderId = "gemini-router";
  gemini.activeProvider = {
    ...emptySharedRuntimeProvider(),
    configured: true,
    providerId: "gemini-router",
    name: "Gemini Router",
    model: "gemini-3.1-pro",
    active: true,
  };
  gemini.activeProviderHealth = createHealth("gemini-router", {
    observed: false,
    healthy: true,
  });
  gemini.failoverQueueDepth = 1;
  gemini.failoverQueue = [
    {
      providerId: "gemini-router",
      providerName: "Gemini Router",
      sortIndex: 1,
      active: true,
      health: createHealth("gemini-router", {
        observed: false,
        healthy: true,
      }),
    },
  ];
  gemini.observedProviderCount = 0;
  gemini.healthyProviderCount = 0;
  gemini.unhealthyProviderCount = 0;

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
      activeConnections: 3,
      totalRequests: 21,
      successRequests: 18,
      failedRequests: 3,
      successRate: 85.7,
      uptimeSeconds: 42,
      failoverCount: 2,
      currentProviderName: "Claude Router Primary",
      currentProviderId: "claude-primary",
    },
    apps: [claude, codex, gemini],
  };
}

function renderSurface(state: SharedRuntimeState) {
  const queryClient = createSharedRuntimeSurfaceQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <SharedRuntimeSurface adapter={createAdapter(state)} />
    </QueryClientProvider>,
  );
}

describe("SharedRuntimeSurface", () => {
  it("renders fallback service state, queue ordering, and neutral unknown health", async () => {
    renderSurface(createState());

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Runtime status" }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText("Config fallback")).toBeInTheDocument();
    expect(screen.getByText("Daemon unreachable")).toBeInTheDocument();
    expect(screen.getByText("connection refused on 127.0.0.1:15721")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1:15721")).toBeInTheDocument();
    expect(screen.getByText("85.7%")).toBeInTheDocument();
    expect(screen.getByText("42s")).toBeInTheDocument();

    const claudeCard = screen.getByRole("article", {
      name: "Claude runtime card",
    });
    expect(
      within(claudeCard).getAllByText("Claude Router Primary").length,
    ).toBeGreaterThan(0);
    expect(
      within(claudeCard).getAllByText("Provider ID: claude-primary").length,
    ).toBeGreaterThan(0);
    expect(within(claudeCard).getByText("Queue depth: 2")).toBeInTheDocument();
    expect(within(claudeCard).getAllByText("Healthy").length).toBeGreaterThan(0);
    expect(within(claudeCard).getAllByText("Unhealthy").length).toBeGreaterThan(0);
    expect(within(claudeCard).getByText("P1")).toBeInTheDocument();
    expect(within(claudeCard).getByText("P2")).toBeInTheDocument();
    expect(within(claudeCard).getByText("Active provider")).toBeInTheDocument();
    expect(within(claudeCard).getByText("upstream timeout")).toBeInTheDocument();

    const geminiCard = screen.getByRole("article", {
      name: "Gemini runtime card",
    });
    expect(within(geminiCard).getAllByText("Gemini Router").length).toBeGreaterThan(0);
    expect(
      within(geminiCard).getAllByText(
        "No health observation has been recorded yet.",
      ).length,
    ).toBeGreaterThan(0);
    expect(within(geminiCard).getAllByText("Unknown").length).toBeGreaterThan(0);

    expect(
      screen.queryByRole("button", { name: /activate/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });
});
