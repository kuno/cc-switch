import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { OpenWrtHostState } from "@/openwrt-provider-ui/pageTypes";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import {
  createProviderTransportFixture,
  OPENWRT_APP_IDS,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture, DEFAULT_HOST_STATE } from "./fixtures/bridge";

function renderAppsGrid({
  bridge = createBridgeFixture(),
  transport = createProviderTransportFixture(),
} = {}) {
  const user = userEvent.setup();

  const renderResult = render(
    <AppsGrid
      options={{
        target: document.body,
        shell: bridge,
        transport,
      }}
      onOpenActivity={bridge.setSelectedApp}
      onOpenProviderPanel={bridge.setSelectedApp}
    />,
  );

  return {
    bridge,
    transport,
    user,
    ...renderResult,
  };
}

describe("AppsGrid", () => {
  it("keeps tab and shift-tab order aligned with the three card surfaces", async () => {
    const { user } = renderAppsGrid();
    const mainButtons = await screen.findAllByRole("button", {
      name: /Open (Claude|Codex|Gemini) providers/,
    });
    const openButtons = screen.getAllByRole("button", { name: "Open" });

    await user.tab();
    expect(mainButtons[0]).toHaveFocus();

    await user.tab();
    expect(openButtons[0]).toHaveFocus();

    await user.tab();
    expect(mainButtons[1]).toHaveFocus();

    await user.tab({ shift: true });
    expect(openButtons[0]).toHaveFocus();

    await user.tab({ shift: true });
    expect(mainButtons[0]).toHaveFocus();
  });

  it("routes card clicks through the provider-panel callback with the matching app id", async () => {
    const { bridge, user } = renderAppsGrid();
    const setSelectedApp = bridge.setSelectedApp as unknown as Mock;
    const codexButton = await screen.findByRole("button", {
      name: "Open Codex providers",
    });

    await user.click(codexButton);

    expect(setSelectedApp).toHaveBeenCalledWith("codex");
  });

  it("still renders only the supported three cards when the bridge exposes unusual app data", async () => {
    const transport = createProviderTransportFixture();
    const listProvidersSpy = vi.spyOn(transport, "listProviders");
    const weirdHostState = {
      ...DEFAULT_HOST_STATE,
      app: "openclaw",
    } as unknown as OpenWrtHostState;
    const bridge = createBridgeFixture({
      overrides: {
        getHostState: vi.fn(() => weirdHostState),
        getSelectedApp: vi.fn(() => "hermes" as unknown as SharedProviderAppId),
      },
    });
    const { container } = renderAppsGrid({
      bridge,
      transport,
    });

    await waitFor(() => {
      expect(listProvidersSpy).toHaveBeenCalledTimes(OPENWRT_APP_IDS.length);
    });

    expect(
      screen.getAllByRole("button", {
        name: /Open (Claude|Codex|Gemini) providers/,
      }),
    ).toHaveLength(OPENWRT_APP_IDS.length);
    expect(listProvidersSpy.mock.calls.map(([appId]) => appId)).toEqual(
      OPENWRT_APP_IDS,
    );
    expect(
      Array.from(container.querySelectorAll(".owt-app-card")).map((card) =>
        card.getAttribute("data-app"),
      ),
    ).toEqual(OPENWRT_APP_IDS);
  });
});
