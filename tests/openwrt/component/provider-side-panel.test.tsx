import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderSidePanel,
  type ProviderSidePanelTab,
} from "@/openwrt-provider-ui/components/ProviderSidePanel";
import { createBridgeFixture } from "./fixtures/bridge";
import {
  createProviderSidePanelProps,
  createProviderView,
} from "../provider-panel-fixtures";
import {
  createPlainPageShellBridge,
  REALISTIC_HOST_STATE,
} from "./fixtures/pageShell";

const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyText: copyTextMock,
}));

function StatefulProviderSidePanel({
  initialTab = "status",
  shell,
}: {
  initialTab?: ProviderSidePanelTab;
  shell?: ReturnType<typeof createPlainPageShellBridge>;
}) {
  const [tab, setTab] = useState<ProviderSidePanelTab>(initialTab);

  return (
    <ProviderSidePanel
      {...createProviderSidePanelProps({
        shell,
        tab,
        callbacks: {
          onTabChange: setTab,
        },
      })}
    />
  );
}

function createEmptyActivityShell() {
  return createPlainPageShellBridge({
    host: {
      ...REALISTIC_HOST_STATE,
      app: "claude",
    },
    requestLogs: {
      claude: [],
      codex: [],
      gemini: [],
    },
  });
}

describe("ProviderSidePanel", () => {
  beforeEach(() => {
    copyTextMock.mockReset();
    copyTextMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the shell with Status, Statistics, Configure, and Activities tabs", async () => {
    const onClose = vi.fn();
    const onTabChange = vi.fn();
    const provider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const { container } = render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [provider],
          selectedProvider: provider,
          selectedProviderId: provider.providerId,
          shell: createEmptyActivityShell(),
          tab: "status",
          callbacks: {
            onClose,
            onTabChange,
          },
        })}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Claude providers",
    });
    const tablist = screen.getByRole("tablist");
    const tabButtons = within(tablist).getAllByRole("button", {
      hidden: false,
    });

    expect(await screen.findByText("Provider state")).toBeInTheDocument();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(tabButtons.map((button) => button.textContent?.trim())).toEqual([
      "Status",
      "Statistics",
      "Configure",
      "Activities",
    ]);
    expect(
      within(dialog).queryByRole("button", { name: "Set active" }),
    ).toBeNull();

    fireEvent.click(container.querySelector(".owt-provider-panel__scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close provider panel" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "Configure" }));
    expect(onTabChange).toHaveBeenCalledWith("configure");
  });

  it("switches visible content between Activities and Configure", async () => {
    const user = userEvent.setup();

    render(
      <StatefulProviderSidePanel
        initialTab="activities"
        shell={createEmptyActivityShell()}
      />,
    );

    expect(await screen.findByText("No recent activity")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Configure",
      }),
    );

    expect(screen.getByText("Provider Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows provider status summary as the first workspace tab", async () => {
    const provider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const shell = createPlainPageShellBridge({
      host: {
        ...REALISTIC_HOST_STATE,
        app: "claude",
      },
    });

    shell.getStatus = vi.fn().mockResolvedValue({
      apps: {
        claude: {
          activeProvider: {
            providerId: "claude-primary",
            name: "Claude Primary",
          },
          failoverStatus: {
            "claude-primary": {
              inFailoverQueue: true,
            },
          },
          health: true,
          maxRetries: 3,
          providers: {
            "claude-primary": {
              name: "Claude Primary",
              health: {
                healthy: true,
                lastError: null,
              },
              stats: {
                avgLatencyMs: 684,
                requestCount: 111,
                successRate: 87.5,
                totalCost: "1.01",
                totalTokens: 236_400,
              },
              quota: {
                tokensRemaining: 42_000,
                tokensLimit: 100_000,
                windows: [
                  {
                    name: "five_hour",
                    utilization: 0.42,
                  },
                ],
              },
            },
          },
        },
      },
    });

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [provider],
          selectedProvider: provider,
          selectedProviderId: provider.providerId,
          shell,
          tab: "status",
        })}
      />,
    );

    expect(await screen.findByText("Provider state")).toBeInTheDocument();
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Success rate")).toBeInTheDocument();
    expect(screen.getByText("87.5%")).toBeInTheDocument();
    expect(screen.getByText("P50 latency")).toBeInTheDocument();
    expect(screen.getByText("684 ms")).toBeInTheDocument();
    expect(screen.getByText("Requests")).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    expect(screen.getByText("236.4K")).toBeInTheDocument();
    expect(screen.getByText("$1.01")).toBeInTheDocument();
    expect(screen.getByText("Left quota")).toBeInTheDocument();
    expect(screen.getByText("42,000 / 100,000 tokens")).toBeInTheDocument();
    expect(screen.getByText("58% remaining")).toBeInTheDocument();
    expect(screen.getByText("Health checks")).toBeInTheDocument();
    expect(screen.getAllByText("OK").length).toBeGreaterThan(0);
  });

  it("shows provider statistics and left token quota", async () => {
    const provider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const shell = createPlainPageShellBridge({
      host: {
        ...REALISTIC_HOST_STATE,
        app: "claude",
      },
    });

    shell.getStatus = vi.fn().mockResolvedValue({
      apps: {
        claude: {
          maxRetries: 3,
          providers: {
            "claude-primary": {
              name: "Claude Primary",
              stats: {
                avgLatencyMs: 684,
                requestCount: 111,
                successRate: 87.5,
                totalCost: "1.01",
                totalTokens: 236_400,
              },
              quota: {
                tokensRemaining: 42_000,
                tokensLimit: 100_000,
                windows: [
                  {
                    name: "five_hour",
                    utilization: 0.42,
                  },
                ],
              },
            },
          },
        },
      },
    });

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [provider],
          selectedProvider: provider,
          selectedProviderId: provider.providerId,
          shell,
          tab: "statistics",
        })}
      />,
    );

    expect(await screen.findByText("Requests")).toBeInTheDocument();
    expect(screen.getByText("111")).toBeInTheDocument();
    expect(screen.getByText("236.4K")).toBeInTheDocument();
    expect(screen.getByText("87.5%")).toBeInTheDocument();
    expect(screen.getByText("$1.01")).toBeInTheDocument();
    expect(screen.getByText("684 ms")).toBeInTheDocument();
    expect(screen.getByText("Left quota")).toBeInTheDocument();
    expect(screen.getByText("42,000 / 100,000 tokens")).toBeInTheDocument();
    expect(screen.getByText("58% remaining")).toBeInTheDocument();
  });

  it("renders routing mode tabs and failover queue actions", () => {
    const onToggleAppAutoFailover = vi.fn();
    const onToggleProviderFailoverQueue = vi.fn();
    const provider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const standbyProvider = createProviderView("claude", {
      active: false,
      name: "Claude Standby",
      providerId: "claude-standby",
    });

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          appAutoFailoverEnabled: true,
          failoverControlsAvailable: true,
          failoverControlsReady: true,
          providerInFailoverQueue: false,
          providers: [provider, standbyProvider],
          selectedProvider: provider,
          selectedProviderId: provider.providerId,
          callbacks: {
            onToggleAppAutoFailover,
            onToggleProviderFailoverQueue,
          },
        })}
        failoverQueueProviderIds={["claude-primary"]}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Claude providers",
    });
    const modeTabs = within(
      within(dialog).getByRole("tablist", {
        name: "Claude routing mode",
      }),
    );
    const normalTab = modeTabs.getByRole("tab", { name: "Manual" });
    const failoverTab = modeTabs.getByRole("tab", { name: "Failover" });
    const addToQueueButton = within(dialog).getByRole("button", {
      name: "Add Claude Primary to failover queue",
    });

    expect(normalTab).toHaveAttribute("aria-selected", "false");
    expect(failoverTab).toHaveAttribute("aria-selected", "true");
    expect(
      within(dialog).queryByRole("button", { name: "Set active" }),
    ).toBeNull();
    const primaryRailRow = within(dialog)
      .getAllByRole("button", { name: /Claude Primary/i })
      .find((button) =>
        button.classList.contains("owt-provider-panel__provider-row"),
      );
    expect(primaryRailRow).toBeDefined();
    expect(within(primaryRailRow!).getByText("In queue")).toHaveClass(
      "owt-status-pill",
    );
    expect(
      within(
        within(dialog).getByRole("button", { name: /Claude Standby/i }),
      ).getByText("Standby"),
    ).toHaveClass("owt-status-pill");

    fireEvent.click(normalTab);
    fireEvent.click(addToQueueButton);

    expect(onToggleAppAutoFailover).toHaveBeenCalledWith(false);
    expect(onToggleProviderFailoverQueue).toHaveBeenCalledWith(true);
  });

  it("shows active actions only in manual routing mode", () => {
    const provider = createProviderView("claude", {
      active: false,
      name: "Claude Backup",
      providerId: "claude-backup",
    });

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          appAutoFailoverEnabled: false,
          canActivate: true,
          failoverControlsAvailable: true,
          failoverControlsReady: true,
          providerInFailoverQueue: false,
          providers: [provider],
          selectedProvider: provider,
          selectedProviderId: provider.providerId,
        })}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Claude providers",
    });

    expect(
      within(dialog).getByRole("button", { name: "Set active" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", {
        name: "Add Claude Backup to failover queue",
      }),
    ).toBeNull();
  });

  it("renders loading and error state content when requested", () => {
    const { rerender } = render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          loading: true,
          canSave: false,
        })}
      />,
    );

    expect(screen.getByText("Loading provider workspace…")).toBeInTheDocument();

    rerender(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          error: "Failed to load provider workspace.",
        })}
      />,
    );

    expect(
      screen.getByText("Failed to load provider workspace."),
    ).toBeInTheDocument();
  });

  it("renders compact rail rows in provider-state order and supports copying the provider id", async () => {
    vi.useFakeTimers();
    const activeProvider = createProviderView("claude", {
      active: true,
      baseUrl: "https://api.anthropic.com",
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const selectedProvider = createProviderView("claude", {
      active: false,
      baseUrl: "https://api.deepseek.com/anthropic",
      name: "Claude Backup",
      providerId: "provider_wg88tuk8z9y0p4q1",
    });
    const { container } = render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          canDelete: true,
          providers: [activeProvider, selectedProvider],
          selectedProvider,
          selectedProviderId: selectedProvider.providerId,
        })}
      />,
    );

    const rows = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".owt-provider-panel__provider-row",
      ),
    );
    const activeRow = rows.find((row) =>
      within(row).queryByText("Claude Primary"),
    );
    const selectedRow = rows.find((row) =>
      within(row).queryByText("Claude Backup"),
    );
    const detailHead = container.querySelector<HTMLElement>(
      ".owt-provider-panel__detail-head",
    );
    const detailCopy = container.querySelector<HTMLElement>(
      ".owt-provider-panel__detail-copy",
    );
    const detailMeta = container.querySelector<HTMLElement>(
      ".owt-provider-panel__detail-meta",
    );

    expect(activeRow).not.toBeNull();
    expect(selectedRow).not.toBeNull();
    expect(detailHead).not.toBeNull();
    expect(detailCopy).not.toBeNull();
    expect(detailMeta).not.toBeNull();

    expect(rows[0]).toBe(activeRow);
    expect(within(activeRow!).getByText("Claude Primary")).toBeInTheDocument();
    expect(within(activeRow!).getByText("Active")).toHaveClass(
      "owt-status-pill",
    );
    expect(
      within(activeRow!).queryByText("https://api.anthropic.com"),
    ).toBeNull();
    expect(within(activeRow!).queryByText("claude-primary")).toBeNull();
    expect(
      within(selectedRow!).queryByText("https://api.deepseek.com/anthropic"),
    ).toBeNull();
    expect(
      within(selectedRow!).queryByText("provider_wg88tuk8z9y0p4q1"),
    ).toBeNull();
    expect(
      within(detailHead!).getByRole("button", { name: "Delete provider" }),
    ).toBeInTheDocument();
    expect(
      within(detailHead!).getByRole("button", { name: "Set active" }),
    ).toBeInTheDocument();
    expect(within(detailMeta!).queryByText("Saved")).toBeNull();
    expect(within(detailMeta!).queryByText("Active")).toBeNull();

    const copyChip = within(detailCopy!).getByRole("button", {
      name: "Copy provider ID provider_wg88tuk8z9y0p4q1",
    });
    expect(
      within(detailMeta!).queryByRole("button", {
        name: "Copy provider ID provider_wg88tuk8z9y0p4q1",
      }),
    ).toBeNull();
    expect(copyChip.textContent?.length ?? 0).toBeLessThan(
      selectedProvider.providerId!.length,
    );

    await act(async () => {
      fireEvent.click(copyChip);
      await Promise.resolve();
    });

    expect(copyTextMock).toHaveBeenCalledWith("provider_wg88tuk8z9y0p4q1");
    expect(copyChip).toHaveTextContent("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1600);
      await Promise.resolve();
    });
    expect(copyChip).not.toHaveTextContent("provider_wg88tuk8z9y0p4q1");
  });

  it("does not render provider drawer reorder handles", () => {
    const primaryProvider = createProviderView("claude", {
      active: true,
      name: "Claude Primary",
      providerId: "claude-primary",
    });
    const backupProvider = createProviderView("claude", {
      active: false,
      name: "Claude Backup",
      providerId: "claude-backup",
    });

    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [primaryProvider, backupProvider],
          filteredProviders: [backupProvider],
          search: "backup",
          selectedProvider: backupProvider,
          selectedProviderId: backupProvider.providerId,
        })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Reorder Claude Backup" }),
    ).toBeNull();
  });

  it("shows server-scoped activities for the selected provider", async () => {
    render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          shell: createBridgeFixture({
            requestLogs: {
              claude: {
                data: [
                  {
                    appType: "claude",
                    cacheCreationCostUsd: "0",
                    cacheCreationTokens: 0,
                    cacheReadCostUsd: "0",
                    cacheReadTokens: 0,
                    costMultiplier: "1",
                    createdAt: Date.now(),
                    inputCostUsd: "0.01",
                    inputTokens: 100,
                    isStreaming: false,
                    latencyMs: 320,
                    model: "claude-sonnet-4-5",
                    outputCostUsd: "0.02",
                    outputTokens: 140,
                    providerId: "claude-primary",
                    providerName: "Claude Primary",
                    requestId: "req-1",
                    statusCode: 200,
                    totalCostUsd: "0.03",
                  },
                ],
                total: 1,
                page: 0,
                pageSize: 20,
              },
            },
          }),
          tab: "activities",
        })}
      />,
    );

    const activityStatus = await screen.findByText("HTTP 200");
    const activityRow = activityStatus.closest(
      ".owt-provider-panel__activity-row",
    );

    expect(activityRow).not.toBeNull();
    expect(
      within(activityRow as HTMLElement).getByText("Claude Primary"),
    ).toBeInTheDocument();
    expect(
      within(activityRow as HTMLElement).getByText(/0\.03/),
    ).toBeInTheDocument();
  });
});
