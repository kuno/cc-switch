import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import type {
  SharedProviderFailoverState,
  SharedProviderAppId,
  SharedProviderState,
} from "@/shared/providers/domain";
import {
  createProviderStat,
  createRecentActivity,
  createSharedProviderState,
  createUsageSummary,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

function renderAppCard(
  providerState: SharedProviderState = createSharedProviderState("claude"),
  options: {
    failoverState?: SharedProviderFailoverState | null;
    failoverPending?: boolean;
    optimisticAutoFailoverEnabled?: boolean | null;
    onOpenProviderPanel?: (
      appId: SharedProviderAppId,
      providerId?: string,
    ) => void;
    onSetAutoFailover?: (appId: SharedProviderAppId, enabled: boolean) => void;
  } = {},
) {
  const bridge = createBridgeFixture({
    selectedApp: "codex",
    host: {
      app: "codex",
      status: "running",
      health: "healthy",
    },
    serviceStatus: {
      isRunning: true,
    },
  });
  const user = userEvent.setup();

  const renderResult = render(
    <AppCard
      appId="claude"
      hostState={bridge.getHostState()}
      serviceRunning={bridge.getServiceStatus().isRunning}
      providerState={providerState}
      summary={createUsageSummary()}
      providerStats={[createProviderStat("claude")]}
      recentActivity={[createRecentActivity("claude")]}
      failoverState={options.failoverState}
      failoverPending={options.failoverPending}
      optimisticAutoFailoverEnabled={options.optimisticAutoFailoverEnabled}
      loading={false}
      error={null}
      onOpenActivity={bridge.setSelectedApp}
      onOpenProviderPanel={options.onOpenProviderPanel ?? bridge.setSelectedApp}
      onSetAutoFailover={options.onSetAutoFailover}
    />,
  );

  return {
    bridge,
    ...renderResult,
    user,
  };
}

function createFailoverState(
  overrides: Partial<SharedProviderFailoverState> = {},
): SharedProviderFailoverState {
  return {
    providerId: "claude-primary",
    proxyEnabled: true,
    autoFailoverEnabled: false,
    maxRetries: 3,
    activeProviderId: "claude-primary",
    inFailoverQueue: true,
    queuePosition: 0,
    sortIndex: 0,
    providerHealth: {
      providerId: "claude-primary",
      observed: true,
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      updatedAt: null,
    },
    failoverQueueDepth: 2,
    failoverQueue: [
      {
        providerId: "claude-primary",
        providerName: "Claude Primary",
        sortIndex: 0,
        active: true,
        health: {
          providerId: "claude-primary",
          observed: true,
          healthy: true,
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastError: null,
          updatedAt: null,
        },
      },
      {
        providerId: "claude-backup",
        providerName: "Claude Backup",
        sortIndex: 1,
        active: false,
        health: {
          providerId: "claude-backup",
          observed: false,
          healthy: false,
          consecutiveFailures: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastError: null,
          updatedAt: null,
        },
      },
    ],
    ...overrides,
  };
}

describe("AppCard", () => {
  it("exposes the provider surface as a named button", () => {
    renderAppCard();

    expect(
      screen.getByRole("button", { name: "Open Claude providers" }),
    ).toBeInTheDocument();
  });

  it("routes clicks through the provider callback with the card app id", async () => {
    const { bridge, user } = renderAppCard();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const trigger = screen.getByRole("button", {
      name: "Open Claude providers",
    });

    await user.click(trigger);

    expect(setSelectedApp).toHaveBeenCalledWith("claude");
  });

  it("activates the provider callback on Enter", async () => {
    const { bridge, user } = renderAppCard();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const trigger = screen.getByRole("button", {
      name: "Open Claude providers",
    });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(setSelectedApp).toHaveBeenCalledWith("claude");
  });

  it("activates the provider callback on Space", async () => {
    const { bridge, user } = renderAppCard();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const trigger = screen.getByRole("button", {
      name: "Open Claude providers",
    });

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard(" ");
    expect(setSelectedApp).toHaveBeenCalledWith("claude");
  });

  it("opens the active provider directly from the normal-mode provider section", async () => {
    const onOpenProviderPanel = vi.fn();
    const { user } = renderAppCard(createSharedProviderState("claude"), {
      onOpenProviderPanel,
    });

    await user.click(screen.getByText("Claude Primary"));

    expect(onOpenProviderPanel).toHaveBeenCalledWith(
      "claude",
      "claude-primary",
    );
  });

  it("renders the active provider icon when the provider state carries a persisted icon", () => {
    const { container } = renderAppCard(
      createSharedProviderState("claude", {
        icon: "deepseek",
        name: "DeepSeek Active",
      }),
    );

    expect(
      container.querySelector(".owt-app-card__mini-icon svg title")
        ?.textContent,
    ).toBe("DeepSeek");
  });

  it("renders the mockup unconfigured placeholder CTA with a neutral dot chip", () => {
    const { container } = renderAppCard(
      createSharedProviderState("claude", {
        active: false,
        configured: false,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Add a Claude provider" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No provider configured yet")).toBeInTheDocument();
    expect(screen.getByText("Add a provider →")).toBeInTheDocument();
    expect(container.querySelector(".owt-chip.owt-chip--dot")).not.toBeNull();
  });

  it("switches app routing mode from the card segmented control", async () => {
    const onSetAutoFailover = vi.fn();
    const { user } = renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState(),
      onSetAutoFailover,
    });
    const modeTabs = within(
      screen.getByRole("tablist", { name: "Claude routing mode" }),
    );

    expect(modeTabs.getByRole("tab", { name: "Manual" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(modeTabs.getByRole("tab", { name: "Failover" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await user.click(modeTabs.getByRole("tab", { name: "Failover" }));

    expect(onSetAutoFailover).toHaveBeenCalledWith("claude", true);
  });

  it("shows a pending animation on the optimistic routing mode target", () => {
    const { container } = renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState({ autoFailoverEnabled: false }),
      failoverPending: true,
      optimisticAutoFailoverEnabled: true,
      onSetAutoFailover: vi.fn(),
    });
    const modeTabs = within(
      screen.getByRole("tablist", { name: "Claude routing mode" }),
    );

    expect(modeTabs.getByRole("tab", { name: "Manual" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(modeTabs.getByRole("tab", { name: "Failover" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tablist", { name: "Claude routing mode" }),
    ).toHaveAttribute("data-pending", "true");
    expect(container.querySelector("[data-mode-body='true']")).toHaveAttribute(
      "data-pending",
      "true",
    );
    expect(
      screen.getByText("Auto-failover on · max 3 retries"),
    ).toBeInTheDocument();
  });

  it("renders proxy-off as a bypassed visual state without interactive mode controls", () => {
    const { container } = renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState({
        proxyEnabled: false,
        autoFailoverEnabled: true,
      }),
      onSetAutoFailover: vi.fn(),
    });
    const card = container.querySelector(".owt-app-card");

    expect(card).toHaveClass("owt-app-card--bypassed");
    expect(
      screen.getByText(/^(Bypassed|openwrt\.appCard\.bypassed)$/),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".owt-app-card__proxy-toggle"),
    ).toHaveAttribute("data-proxy-enabled", "false");
    expect(
      screen.queryByRole("tablist", { name: "Claude routing mode" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Proxy .* Claude/i }),
    ).not.toBeInTheDocument();
  });

  it("renders queue priority instead of active provider details in failover mode", () => {
    renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState({ autoFailoverEnabled: true }),
      onSetAutoFailover: vi.fn(),
    });

    expect(screen.queryByText("Active provider")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Claude Primary")).toBeInTheDocument();
    expect(screen.getByText("Serving traffic")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Claude Backup")).toBeInTheDocument();
    expect(screen.getByText("Standby · 0 retries used")).toBeInTheDocument();
    expect(screen.getByText("STANDBY")).toBeInTheDocument();
    expect(
      screen.getByText("Auto-failover on · max 3 retries"),
    ).toBeInTheDocument();
    expect(screen.getByText("Head: 1 of 2")).toBeInTheDocument();
  });

  it("opens a failover queue provider directly from its queue row", async () => {
    const onOpenProviderPanel = vi.fn();
    const { user } = renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState({ autoFailoverEnabled: true }),
      onOpenProviderPanel,
      onSetAutoFailover: vi.fn(),
    });

    await user.click(screen.getByText("Claude Backup"));

    expect(onOpenProviderPanel).toHaveBeenCalledWith("claude", "claude-backup");
  });

  it("stacks the routing mode switch below the running status chip", () => {
    const { container } = renderAppCard(createSharedProviderState("claude"), {
      failoverState: createFailoverState(),
      onSetAutoFailover: vi.fn(),
    });

    const actions = container.querySelector(".owt-app-card__head-actions");
    const statusChip = actions?.querySelector("[data-owt-chip='true']");
    const modeToggle = actions?.querySelector("[data-mode-toggle='true']");

    expect(actions).toBeTruthy();
    expect(statusChip).toBeTruthy();
    expect(modeToggle).toBeTruthy();
    expect(statusChip?.compareDocumentPosition(modeToggle!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders provider icons in failover queue rows", () => {
    const { container } = renderAppCard(
      createSharedProviderState("claude", {
        icon: "deepseek",
        name: "Claude Primary",
      }),
      {
        failoverState: createFailoverState({ autoFailoverEnabled: true }),
        onSetAutoFailover: vi.fn(),
      },
    );

    expect(container.querySelectorAll(".owt-app-card__queue-icon").length).toBe(
      2,
    );
    expect(
      container.querySelector(".owt-app-card__queue-icon svg title")
        ?.textContent,
    ).toBe("DeepSeek");
  });

  it("shows cost estimate help without opening the provider panel", async () => {
    const { bridge, user } = renderAppCard();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const info = screen.getByRole("button", {
      name: "About this cost number",
    });

    expect(info).toBeInTheDocument();
    expect(screen.getByText("Estimated, not billed.")).toBeInTheDocument();

    await user.click(info);

    expect(setSelectedApp).not.toHaveBeenCalled();
  });
});
