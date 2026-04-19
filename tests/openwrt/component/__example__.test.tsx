import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertStrip } from "@/openwrt-provider-ui/components/AlertStrip";
import { createBridgeFixture } from "./fixtures/bridge";

describe("AlertStrip example", () => {
  it("renders nothing when the daemon is healthy", () => {
    const bridge = createBridgeFixture({
      host: {
        app: "claude",
        status: "running",
        health: "healthy",
      },
      serviceStatus: {
        isRunning: true,
      },
    });

    const { container } = render(
      <AlertStrip
        host={bridge.getHostState()}
        isRunning={bridge.getServiceStatus().isRunning}
        restartInFlight={bridge.getRestartState?.().inFlight ?? false}
        message={bridge.getMessage()}
        onRestart={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
