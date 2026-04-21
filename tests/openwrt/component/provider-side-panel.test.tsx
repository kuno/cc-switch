import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSidePanel, type ProviderSidePanelTab } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import { createProviderSidePanelProps, createProviderView } from "../provider-panel-fixtures";

const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyText: copyTextMock,
}));

function StatefulProviderSidePanel({
  initialTab = "general",
}: {
  initialTab?: ProviderSidePanelTab;
}) {
  const [tab, setTab] = useState<ProviderSidePanelTab>(initialTab);

  return (
    <ProviderSidePanel
      {...createProviderSidePanelProps({
        tab,
        callbacks: {
          onTabChange: setTab,
        },
      })}
    />
  );
}

describe("ProviderSidePanel", () => {
  beforeEach(() => {
    copyTextMock.mockReset();
    copyTextMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the shell, header, footer, and exactly three supported tabs", () => {
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
    const tabButtons = within(tablist).getAllByRole("button");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(tabButtons.map((button) => button.textContent?.trim())).toEqual([
      "General",
      "Credentials",
    ]);
    expect(
      within(dialog).getByRole("button", { name: "General" }),
    ).toHaveAttribute("data-active", "true");
    expect(
      within(dialog).getByRole("button", { name: "Close provider panel" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Anthropic · Claude Code"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save" }),
    ).toBeEnabled();
    expect(container.querySelector(".owt-provider-panel__scrim")).not.toBeNull();

    fireEvent.click(container.querySelector(".owt-provider-panel__scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close provider panel" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "Credentials" }));
    expect(onTabChange).toHaveBeenCalledWith("credentials");
  });

  it("switches visible content when the tab state changes", async () => {
    const user = userEvent.setup();

    const view = render(<StatefulProviderSidePanel />);

    expect(screen.getByLabelText("Provider name")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();

    view.unmount();
    render(<StatefulProviderSidePanel initialTab="preset" />);
    expect(
      screen.getByRole("button", {
        name: /Custom draft/i,
      }),
    ).toBeInTheDocument();
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

  it("renders rail metadata parity and keeps activate action in the footer", async () => {
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
      providerId: "claude-backup",
    });
    const { container } = render(
      <ProviderSidePanel
        {...createProviderSidePanelProps({
          providers: [activeProvider, selectedProvider],
          selectedProvider,
          selectedProviderId: selectedProvider.providerId,
          canActivate: true,
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
    const footerActions = container.querySelector<HTMLElement>(
      ".owt-provider-panel__footer-actions",
    );

    expect(activeRow).not.toBeNull();
    expect(selectedRow).not.toBeNull();
    expect(detailHead).not.toBeNull();
    expect(footerActions).not.toBeNull();

    expect(within(activeRow!).getByText("https://api.anthropic.com")).toHaveClass(
      "owt-provider-panel__rail-url",
    );
    expect(within(activeRow!).getByText("claude-primary")).toHaveClass(
      "owt-provider-panel__rail-id",
    );
    expect(within(activeRow!).getByText("Active")).toHaveClass(
      "owt-status-pill",
    );
    expect(within(selectedRow!).getByText("claude-backup")).toHaveClass(
      "owt-provider-panel__rail-id",
    );
    expect(
      selectedRow!.querySelector(".owt-provider-panel__provider-mark svg title")
        ?.textContent,
    ).toBe("DeepSeek");
    expect(
      detailHead!.querySelector(
        ".owt-provider-panel__provider-mark svg title",
      )?.textContent,
    ).toBe("DeepSeek");
    expect(within(selectedRow!).queryByText("Saved")).toBeNull();
    expect(
      within(detailHead!).queryByRole("button", { name: "Set active" }),
    ).toBeNull();
    expect(
      within(footerActions!).getByRole("button", { name: "Set active" }),
    ).toBeInTheDocument();

    const copyChip = screen.getByRole("button", {
      name: "Copy provider ID claude-backup",
    });

    await act(async () => {
      fireEvent.click(copyChip);
      await Promise.resolve();
    });

    expect(copyTextMock).toHaveBeenCalledWith("claude-backup");
    expect(copyChip).toHaveTextContent("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1600);
      await Promise.resolve();
    });
    expect(copyChip).toHaveTextContent("claude-backup");
  });
});
