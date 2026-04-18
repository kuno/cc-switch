import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AlertStrip, type AlertStripProps } from "@/openwrt-provider-ui/components/AlertStrip";
import type { OpenWrtPageMessage } from "@/openwrt-provider-ui/pageTypes";
import {
  createBridgeFixture,
  type BridgeFixtureOptions,
} from "./fixtures/bridge";

const RESTART_FAILED_MESSAGE: OpenWrtPageMessage = {
  kind: "error",
  text: "Restart failed: The daemon timed out while reconnecting.",
};

function buildAlertStripProps(
  options: BridgeFixtureOptions = {},
  onRestart?: AlertStripProps["onRestart"],
): {
  bridge: ReturnType<typeof createBridgeFixture>;
  props: AlertStripProps;
} {
  const bridge = createBridgeFixture(options);

  return {
    bridge,
    props: {
      host: bridge.getHostState(),
      isRunning: bridge.getServiceStatus().isRunning,
      restartInFlight: bridge.getRestartState?.().inFlight ?? false,
      message: bridge.getMessage(),
      onRestart: onRestart ?? bridge.restartService,
    },
  };
}

function renderAlertStrip(
  options: BridgeFixtureOptions = {},
  onRestart?: AlertStripProps["onRestart"],
) {
  const setup = buildAlertStripProps(options, onRestart);

  return {
    ...setup,
    ...render(<AlertStrip {...setup.props} />),
  };
}

describe("AlertStrip", () => {
  it("renders nothing when the daemon is healthy", () => {
    const { container } = renderAlertStrip({
      host: {
        app: "claude",
        status: "running",
        health: "healthy",
      },
      serviceStatus: {
        isRunning: true,
      },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the stopped state with a restart control", () => {
    renderAlertStrip({
      host: {
        status: "stopped",
        health: "stopped",
      },
      serviceStatus: {
        isRunning: false,
      },
    });

    const strip = screen.getByRole("status");

    expect(strip).toHaveAttribute("aria-live", "polite");
    expect(strip).toHaveAttribute("aria-busy", "false");
    expect(strip).toHaveTextContent("Daemon stopped.");
    expect(strip).toHaveTextContent(
      "All app routing is offline until the CC Switch service is restarted.",
    );
    expect(
      screen.getByRole("button", { name: "Restart now" }),
    ).toBeEnabled();
  });

  it("renders the unreachable state with endpoint and proxy details", () => {
    renderAlertStrip({
      host: {
        health: "degraded",
        httpProxy: "http://router.internal:15721",
      },
      serviceStatus: {
        isRunning: true,
      },
    });

    const strip = screen.getByRole("status");

    expect(strip).toHaveTextContent("Daemon not reachable.");
    expect(strip).toHaveTextContent("127.0.0.1:15721");
    expect(strip).toHaveTextContent("http://router.internal:15721");
    expect(
      screen.getByRole("button", { name: "Restart now" }),
    ).toBeEnabled();
  });

  it("fires the restart handler exactly once when clicked", async () => {
    const user = userEvent.setup();
    const { bridge } = renderAlertStrip({
      host: {
        status: "stopped",
        health: "stopped",
      },
      serviceStatus: {
        isRunning: false,
      },
    });

    await user.click(screen.getByRole("button", { name: "Restart now" }));

    expect(bridge.restartService).toHaveBeenCalledTimes(1);
  });

  it("communicates the restarting state with busy semantics and no action button", () => {
    const { container } = renderAlertStrip({
      restartState: {
        pending: false,
        inFlight: true,
      },
    });

    const strip = screen.getByRole("status");

    expect(strip).toHaveAttribute("aria-live", "polite");
    expect(strip).toHaveAttribute("aria-busy", "true");
    expect(strip).toHaveTextContent("Restarting daemon…");
    expect(strip).toHaveTextContent(
      "Waiting for OpenWrt to confirm the service at 127.0.0.1:15721.",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders restart failures as an alert with a retry control", () => {
    renderAlertStrip({
      message: RESTART_FAILED_MESSAGE,
    });

    const strip = screen.getByRole("alert");

    expect(strip).toHaveAttribute("aria-live", "assertive");
    expect(strip).toHaveAttribute("aria-busy", "false");
    expect(strip).toHaveTextContent("Restart failed:");
    expect(strip).toHaveTextContent(
      "The daemon timed out while reconnecting.",
    );
    expect(
      screen.getByRole("button", { name: "Retry restart" }),
    ).toBeEnabled();
  });

  it("surfaces restart failures after a pending restart settles with an error", () => {
    const initial = buildAlertStripProps({
      restartState: {
        pending: false,
        inFlight: true,
      },
    });
    const view = render(<AlertStrip {...initial.props} />);
    const failed = buildAlertStripProps(
      {
        message: RESTART_FAILED_MESSAGE,
      },
      initial.props.onRestart,
    );

    view.rerender(<AlertStrip {...failed.props} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Restart failed:");
    expect(
      screen.getByRole("button", { name: "Retry restart" }),
    ).toBeEnabled();
  });

  for (const scenario of [
    {
      name: "Restart now",
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
      name: "Retry restart",
      options: {
        message: RESTART_FAILED_MESSAGE,
      },
    },
  ]) {
    for (const key of ["{Enter}", "[Space]"] as const) {
      it(`activates "${scenario.name}" with ${key}`, async () => {
        const user = userEvent.setup();
        const { bridge } = renderAlertStrip(scenario.options);
        const button = screen.getByRole("button", { name: scenario.name });

        button.focus();
        expect(button).toHaveFocus();

        await user.keyboard(key);

        expect(bridge.restartService).toHaveBeenCalledTimes(1);
      });
    }
  }
});
