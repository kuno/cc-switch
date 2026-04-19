import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSidePanel, type ProviderSidePanelTab } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import { createProviderSidePanelProps, createProviderView } from "../provider-panel-fixtures";

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
      "Preset",
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

    render(<StatefulProviderSidePanel />);

    expect(screen.getByLabelText("Provider name")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Credentials",
      }),
    );
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Preset",
      }),
    );
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
});
