import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, type Mock } from "vitest";
import { AppCard } from "@/openwrt-provider-ui/components/AppCard";
import {
  createProviderStat,
  createRecentActivity,
  createSharedProviderState,
  createUsageSummary,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

function renderAppCard() {
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

  render(
    <AppCard
      appId="claude"
      hostState={bridge.getHostState()}
      serviceRunning={bridge.getServiceStatus().isRunning}
      providerState={createSharedProviderState("claude")}
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
});
