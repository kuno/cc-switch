import { useRef } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ActivityDrawerHost } from "@/openwrt-provider-ui/components/ActivityDrawerHost";
import type { ActivityDrawerHostHandle } from "@/openwrt-provider-ui/components/ActivityDrawerHost";
import { AppsGrid } from "@/openwrt-provider-ui/components/AppsGrid";
import {
  ProviderSidePanelHost,
  type ProviderSidePanelHandle,
} from "@/openwrt-provider-ui/components/ProviderSidePanelHost";
import {
  createProviderTransportFixture,
  createRequestLog,
} from "../fixtures/openwrtProviderUi";
import { createBridgeFixture } from "./fixtures/bridge";

function AppsGridSurfaceHarness({
  bridge,
}: {
  bridge: ReturnType<typeof createBridgeFixture>;
}) {
  const activityRef = useRef<ActivityDrawerHostHandle | null>(null);
  const providerRef = useRef<ProviderSidePanelHandle | null>(null);
  const transport = createProviderTransportFixture();

  return (
    <>
      <AppsGrid
        options={{
          target: document.body,
          shell: bridge,
          transport,
        }}
        onOpenActivity={(appId) => {
          bridge.setSelectedApp(appId);
          activityRef.current?.openForApp(appId);
        }}
        onOpenProviderPanel={(appId) => {
          bridge.setSelectedApp(appId);
          providerRef.current?.openForApp(appId);
        }}
      />
      <ActivityDrawerHost shell={bridge} shellRef={activityRef} />
      <ProviderSidePanelHost
        ref={providerRef}
        selectedApp={bridge.getSelectedApp()}
        shell={bridge}
        transport={transport}
      />
    </>
  );
}

function expectForbiddenSurfaces(container: HTMLElement) {
  expect(screen.queryByText("Failover")).not.toBeInTheDocument();
  expect(screen.queryByText("OpenClaw")).not.toBeInTheDocument();
  expect(screen.queryByText("Hermes")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Configure routes and provider details"),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".owt-legacy-preserved")).toBeNull();
  expect(
    container.querySelector('.owt-app-card[data-app="openclaw"]'),
  ).toBeNull();
  expect(
    container.querySelector('.owt-app-card[data-app="hermes"]'),
  ).toBeNull();
}

describe("AppsGrid hard rules", () => {
  it("never exposes legacy failover or unsupported app surfaces across the grid, provider panel, and activity drawer", async () => {
    const requestLog = createRequestLog("claude");
    const bridge = createBridgeFixture({
      requestLogs: {
        claude: {
          data: [requestLog],
          total: 1,
          page: 0,
          pageSize: 20,
        },
      },
      requestDetails: {
        claude: {
          [requestLog.requestId]: requestLog,
        },
      },
    });
    const user = userEvent.setup();
    const { container } = render(<AppsGridSurfaceHarness bridge={bridge} />);
    const claudeSurface = await screen.findByRole("button", {
      name: "Open Claude providers",
    });

    await user.click(claudeSurface);
    await screen.findByRole("dialog", { name: "Claude providers" });
    expectForbiddenSurfaces(container);

    await user.click(
      screen.getByRole("button", {
        name: "Close provider panel",
      }),
    );

    const claudeCard = container.querySelector(
      '.owt-app-card[data-app="claude"]',
    ) as HTMLElement;

    await user.click(within(claudeCard).getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog", { name: "Recent activity" });
    expectForbiddenSurfaces(container);
  });
});
