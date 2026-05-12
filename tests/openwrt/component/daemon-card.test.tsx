import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DaemonCard,
  type DaemonCardProps,
} from "@/openwrt-provider-ui/components/DaemonCard";
import type {
  OpenWrtHostConfigPayload,
  OpenWrtHostState,
  OpenWrtSharedPageShellApi,
} from "@/openwrt-provider-ui/pageTypes";
import {
  createBridgeFixture,
  type BridgeFixtureOptions,
} from "./fixtures/bridge";

function createDraft(host: OpenWrtHostState): OpenWrtHostConfigPayload {
  return {
    listenAddr: host.listenAddr,
    listenPort: host.listenPort,
    httpProxy: host.httpProxy,
    httpsProxy: host.httpsProxy,
    logLevel: host.logLevel,
  };
}

function buildDaemonCardProps(
  bridge: OpenWrtSharedPageShellApi,
  overrides: Partial<DaemonCardProps> = {},
): DaemonCardProps {
  const host = bridge.getHostState();

  return {
    host,
    draft: createDraft(host),
    isRunning: bridge.getServiceStatus().isRunning,
    isDirty: false,
    saveInFlight: false,
    restartInFlight: bridge.getRestartState?.().inFlight ?? false,
    restartPending: bridge.getRestartState?.().pending ?? false,
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onRestart: vi.fn(() => {
      void bridge.restartService();
    }),
    ...overrides,
  };
}

function renderDaemonCard(
  options: BridgeFixtureOptions = {},
  overrides: Partial<DaemonCardProps> = {},
) {
  const bridge = createBridgeFixture(options);
  const props = buildDaemonCardProps(bridge, overrides);
  const view = render(<DaemonCard {...props} />);
  const card = view.container.querySelector<HTMLElement>(".owt-daemon-card");

  if (!card) {
    throw new Error("Expected daemon card to render");
  }

  return {
    ...view,
    bridge,
    props,
    card,
  };
}

function getCardElements(card: HTMLElement) {
  return {
    statusChip: card.querySelector(".owt-daemon-status"),
    healthChip: card.querySelector(".owt-daemon-health"),
    restartButton: within(card).getByRole("button", { name: /Restart/ }),
  };
}

function InteractiveDaemonCard({
  bridge,
}: {
  bridge: OpenWrtSharedPageShellApi;
}) {
  const initialHost = bridge.getHostState();
  const [host, setHost] = useState(initialHost);
  const [draft, setDraft] = useState(() => createDraft(initialHost));
  const [serviceStatus, setServiceStatus] = useState(bridge.getServiceStatus());
  const [restartState, setRestartState] = useState(
    bridge.getRestartState?.() ?? {
      pending: false,
      inFlight: false,
    },
  );

  async function handleRestart() {
    if (restartState.inFlight) {
      return;
    }

    const optimisticState = {
      pending: restartState.pending,
      inFlight: true,
    };

    bridge.setRestartState?.(optimisticState);
    setRestartState(optimisticState);

    try {
      const nextStatus = await bridge.restartService();
      const settledState = {
        pending: false,
        inFlight: false,
      };

      bridge.setRestartState?.(settledState);
      setRestartState(settledState);
      setServiceStatus(nextStatus);
      setHost((current) => ({
        ...current,
        status: nextStatus.isRunning ? "running" : "stopped",
        health: nextStatus.isRunning ? "healthy" : "stopped",
      }));
    } catch (error) {
      const settledState = {
        pending: restartState.pending,
        inFlight: false,
      };
      const detail =
        error instanceof Error ? error.message : "Failed to restart service.";

      bridge.setRestartState?.(settledState);
      bridge.showMessage("error", `Restart failed: ${detail}`);
      setRestartState(settledState);
    }
  }

  return (
    <DaemonCard
      host={host}
      draft={draft}
      isRunning={serviceStatus.isRunning}
      isDirty={false}
      saveInFlight={false}
      restartInFlight={restartState.inFlight}
      restartPending={restartState.pending}
      onDraftChange={(key, value) =>
        setDraft((current) => ({
          ...current,
          [key]: value,
        }))
      }
      onSave={() => {}}
      onRestart={() => {
        void handleRestart();
      }}
    />
  );
}

describe("DaemonCard", () => {
  it.each([
    {
      name: "running",
      options: {
        host: {
          status: "running",
          health: "healthy",
        },
        serviceStatus: {
          isRunning: true,
        },
      },
      expected: {
        status: "Daemon",
        dataRunning: "true",
        health: "Healthy",
      },
    },
    {
      name: "stopped",
      options: {
        host: {
          status: "stopped",
          health: "stopped",
        },
        serviceStatus: {
          isRunning: false,
        },
      },
      expected: {
        status: "Daemon",
        dataRunning: "false",
        health: "Stopped",
      },
    },
    {
      name: "restart pending",
      options: {
        host: {
          status: "running",
          health: "healthy",
        },
        serviceStatus: {
          isRunning: true,
        },
        restartState: {
          pending: true,
          inFlight: false,
        },
      },
      expected: {
        status: "Daemon",
        dataRunning: "true",
        health: "Healthy",
      },
    },
    {
      name: "restarting",
      options: {
        host: {
          status: "running",
          health: "healthy",
        },
        serviceStatus: {
          isRunning: true,
        },
        restartState: {
          pending: true,
          inFlight: true,
        },
      },
      expected: {
        status: "Daemon",
        dataRunning: "true",
        health: "Restarting…",
      },
    },
    {
      name: "unknown health",
      options: {
        host: {
          status: "running",
          health: "unknown",
        },
        serviceStatus: {
          isRunning: true,
        },
      },
      expected: {
        status: "Daemon",
        dataRunning: "true",
        health: "Unknown",
      },
    },
  ] satisfies Array<{
    name: string;
    options: BridgeFixtureOptions;
    expected: {
      status: string;
      dataRunning: string;
      health: string;
    };
  }>)(
    "renders the expected daemon labels for $name",
    ({ options, expected }) => {
      const { card } = renderDaemonCard(options);
      const { statusChip, healthChip, restartButton } = getCardElements(card);

      expect(statusChip).toHaveTextContent(expected.status);
      expect(statusChip).toHaveAttribute("data-running", expected.dataRunning);
      expect(healthChip).toHaveTextContent(expected.health);
      expect(
        card.querySelector(".ccswitch-openwrt-page-note"),
      ).toBeNull();

      if (options.restartState?.inFlight) {
        expect(restartButton).toHaveAccessibleName("Restarting…");
        expect(restartButton).toBeDisabled();
      } else {
        expect(restartButton).toHaveAccessibleName("Restart");
      }
      expect(card.querySelector(".owt-daemon-card__footer")).toBeNull();
    },
  );

  it("keeps restart enabled when stopped and disables it while restart is in flight", () => {
    const stoppedRender = renderDaemonCard({
      host: {
        status: "stopped",
        health: "stopped",
      },
      serviceStatus: {
        isRunning: false,
      },
    });

    expect(getCardElements(stoppedRender.card).restartButton).toBeEnabled();
    stoppedRender.unmount();

    const restartingRender = renderDaemonCard({
      restartState: {
        pending: true,
        inFlight: true,
      },
    });

    expect(getCardElements(restartingRender.card).restartButton).toBeDisabled();
  });

  it("surfaces optimistic restart copy while the request is in flight", () => {
    const { card } = renderDaemonCard({
      restartState: {
        pending: true,
        inFlight: true,
      },
    });
    const { restartButton } = getCardElements(card);

    expect(restartButton).toHaveAccessibleName("Restarting…");
    expect(restartButton).toBeDisabled();
  });

  it("calls restartService once when restart is double-clicked and the card flips into flight", async () => {
    const user = userEvent.setup();
    let resolveRestart: ((value: { isRunning: boolean }) => void) | undefined;
    const bridge = createBridgeFixture({
      host: {
        status: "stopped",
        health: "stopped",
      },
      serviceStatus: {
        isRunning: false,
      },
      overrides: {
        restartService: vi.fn(
          () =>
            new Promise<{ isRunning: boolean }>((resolve) => {
              resolveRestart = resolve;
            }),
        ),
      },
    });

    render(<InteractiveDaemonCard bridge={bridge} />);

    const restartButton = screen.getByRole("button", { name: "Restart" });

    await user.dblClick(restartButton);

    expect(bridge.restartService).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();

    await act(async () => {
      resolveRestart?.({ isRunning: true });
    });
  });

  it("activates restart from the keyboard with Enter and Space", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    const { card } = renderDaemonCard({}, { onRestart });
    const { restartButton } = getCardElements(card);

    restartButton.focus();
    await user.keyboard("[Enter]");
    restartButton.focus();
    await user.keyboard("[Space]");

    expect(onRestart).toHaveBeenCalledTimes(2);
  });

  it("never renders an inline message note and keeps restart reachable when status is unknown", () => {
    const { card } = renderDaemonCard({
      host: {
        status: "running",
        health: "unknown",
      },
      serviceStatus: {
        isRunning: true,
      },
      message: {
        kind: "error",
        text: "Restart failed: daemon status unavailable.",
      },
    });
    const { restartButton } = getCardElements(card);

    expect(card.querySelector(".ccswitch-openwrt-page-note")).toBeNull();
    expect(restartButton).toBeEnabled();
  });
});
