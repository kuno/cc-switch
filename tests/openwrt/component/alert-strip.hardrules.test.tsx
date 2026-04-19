import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertStrip } from "@/openwrt-provider-ui/components/AlertStrip";
import type { OpenWrtPageMessage } from "@/openwrt-provider-ui/pageTypes";
import {
  createBridgeFixture,
  type BridgeFixtureOptions,
} from "./fixtures/bridge";

const RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text: "Restart failed: The daemon timed out while reconnecting.",
};

function renderAlertStrip(options: BridgeFixtureOptions = {}) {
  const bridge = createBridgeFixture(options);

  return render(
    <AlertStrip
      host={bridge.getHostState()}
      isRunning={bridge.getServiceStatus().isRunning}
      restartInFlight={bridge.getRestartState?.().inFlight ?? false}
      message={bridge.getMessage()}
      onRestart={bridge.restartService}
    />,
  );
}

describe("AlertStrip hard rules", () => {
  for (const scenario of [
    {
      name: "stopped",
      options: {
        host: {
          status: "stopped" as const,
          health: "stopped" as const,
        },
        serviceStatus: {
          isRunning: false,
        },
      },
    },
    {
      name: "unreachable",
      options: {
        host: {
          health: "degraded" as const,
        },
      },
    },
    {
      name: "restarting",
      options: {
        restartState: {
          pending: false,
          inFlight: true,
        },
      },
    },
    {
      name: "restart-failed",
      options: {
        message: RESTART_FAILED_MESSAGE,
      },
    },
  ]) {
    it(`keeps forbidden legacy content out of the ${scenario.name} strip`, () => {
      const { container } = renderAlertStrip(scenario.options);
      const strip = container.querySelector(".owt-alert-strip");

      expect(strip).not.toBeNull();
      expect(strip).not.toHaveTextContent(/Failover/i);
      expect(strip).not.toHaveTextContent(/OpenClaw/i);
      expect(strip).not.toHaveTextContent(/Hermes/i);
      expect(strip).not.toHaveTextContent(
        /Configure routes and provider details/i,
      );
      expect(strip?.querySelector(".owt-legacy-preserved")).toBeNull();
    });
  }
});
