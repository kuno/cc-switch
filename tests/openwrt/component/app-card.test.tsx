import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock } from "vitest";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import type { SharedProviderState } from "@/shared/providers/domain";
import {
  createProviderStat,
  createRecentActivity,
  createSharedProviderState,
  createUsageSummary,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

function renderAppCard(
  providerState: SharedProviderState = createSharedProviderState("claude"),
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
      loading={false}
      error={null}
      onOpenActivity={bridge.setSelectedApp}
      onOpenProviderPanel={bridge.setSelectedApp}
    />,
  );

  return {
    bridge,
    ...renderResult,
    user,
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

  it("renders the active provider icon when the provider state carries a persisted icon", () => {
    const { container } = renderAppCard(
      createSharedProviderState("claude", {
        icon: "deepseek",
        name: "DeepSeek Active",
      }),
    );

    expect(
      container.querySelector(".owt-app-card__mini-icon svg title")?.textContent,
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
});
