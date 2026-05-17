import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

function createDraft(host: OpenWrtHostState): OpenWrtHostConfigPayload {
  return {
    listenAddr: host.listenAddr,
    listenPort: host.listenPort,
    upstreamProxy: host.upstreamProxy ?? host.httpsProxy ?? host.httpProxy,
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
      expect(statusChip?.querySelector(".owt-daemon-health")).toBe(healthChip);
      expect(card.querySelector(".owt-daemon-status__dot")).toBeNull();
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

  it("shows a single upstream proxy token instead of separate HTTP and HTTPS fields", () => {
    const { card } = renderDaemonCard({
      host: {
        httpProxy: "http://legacy-proxy.local:8080",
        httpsProxy: "socks5://router-proxy.local:1080",
      },
    });

    expect(card).toHaveTextContent("Upstream proxy");
    expect(card).toHaveTextContent("socks5://router-proxy.local:1080");
    expect(
      within(card).queryByLabelText("HTTP proxy"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByLabelText("HTTPS proxy"),
    ).not.toBeInTheDocument();
  });

  it("opens the proxy popover and saves the edited proxy through upstreamProxy", async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    const { card } = renderDaemonCard(
      {
        host: {
          upstreamProxy: "http://old-proxy.local:8080",
          httpProxy: "",
          httpsProxy: "http://old-proxy.local:8080",
        },
      },
      { onDraftChange },
    );

    await user.click(
      within(card).getByRole("button", {
        name: /http:\/\/old-proxy\.local:8080/i,
      }),
    );
    const dialog = within(card).getByRole("dialog", {
      name: "Upstream proxy",
    });
    const dialogQueries = within(dialog);
    const input = dialogQueries.getByLabelText("URL");
    await user.clear(input);
    await user.type(input, "socks5://router-proxy.local:1080");
    await user.click(dialogQueries.getByRole("button", { name: "Save" }));

    expect(onDraftChange).toHaveBeenCalledWith(
      "upstreamProxy",
      "socks5://router-proxy.local:1080",
    );
  });

  it("uses the proxy token state for reachability errors without rendering a duplicate status icon", async () => {
    const user = userEvent.setup();
    const onTestUpstreamProxy = vi.fn(async () => ({
      configured: true,
      httpProxyConfigured: false,
      httpsProxyConfigured: true,
      source: "daemon",
      proxyUrl: "http://bad-proxy.local:8080",
      testUrl: "https://api.anthropic.com/v1/models",
      tested: true,
      success: false,
      status: null,
      latencyMs: null,
      error: "connect ECONNREFUSED",
    }));
    const { card } = renderDaemonCard(
      {
        host: {
          upstreamProxy: "http://bad-proxy.local:8080",
          httpProxy: "",
          httpsProxy: "http://bad-proxy.local:8080",
        },
      },
      { onTestUpstreamProxy },
    );

    const proxyToken = within(card).getByRole("button", {
      name: /http:\/\/bad-proxy\.local:8080/i,
    });
    await user.click(proxyToken);
    await user.click(
      within(card).getByRole("button", {
        name: "Re-check reachability",
      }),
    );

    await waitFor(() =>
      expect(onTestUpstreamProxy).toHaveBeenCalledWith(
        "http://bad-proxy.local:8080",
      ),
    );
    await waitFor(() =>
      expect(proxyToken).toHaveClass("owt-inline-token--fail"),
    );
    expect(card).toHaveTextContent("connect ECONNREFUSED");
    expect(
      card.querySelector(".owt-inline-token__status"),
    ).not.toBeInTheDocument();
  });

  it("still supports manual daemon log refresh from the diagnostics summary", async () => {
    const user = userEvent.setup();
    const onLoadDaemonLogTail = vi.fn(async () => ({
      source: "daemon",
      path: "/var/log/ccswitch.log",
      linesRequested: 80,
      bytesRequested: 262144,
      linesReturned: 2,
      bytesRead: 128,
      fileSize: 128,
      entries: [
        "2026-05-16T10:00:00Z INFO daemon started",
        "2026-05-16T10:00:01Z WARN upstream proxy slow",
      ],
      truncated: false,
    }));
    const { card } = renderDaemonCard({}, { onLoadDaemonLogTail });

    expect(onLoadDaemonLogTail).not.toHaveBeenCalled();
    await user.click(
      within(card).getByRole("button", {
        name: "Refresh",
      }),
    );

    await waitFor(() =>
      expect(onLoadDaemonLogTail).toHaveBeenCalledWith(80, 262144),
    );
    expect(card).toHaveTextContent("daemon started");
    expect(card).toHaveTextContent("upstream proxy slow");
  });

  it("polls the daemon log tail every 3 seconds only while diagnostics is open", async () => {
    vi.useFakeTimers();
    const onLoadDaemonLogTail = vi.fn(async () => ({
      source: "daemon",
      path: "/var/log/ccswitch.log",
      linesRequested: 80,
      bytesRequested: 262144,
      linesReturned: 1,
      bytesRead: 64,
      fileSize: 64,
      entries: ["2026-05-16T10:00:00Z INFO daemon started"],
      truncated: false,
    }));
    const { card, unmount } = renderDaemonCard({}, { onLoadDaemonLogTail });
    const drawer = card.querySelector<HTMLDetailsElement>(".owt-log-drawer");

    if (!drawer) {
      throw new Error("Expected diagnostics drawer to render");
    }

    expect(onLoadDaemonLogTail).not.toHaveBeenCalled();

    await act(async () => {
      drawer.open = true;
      fireEvent(
        drawer,
        new Event("toggle", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    expect(onLoadDaemonLogTail).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(onLoadDaemonLogTail).toHaveBeenCalledTimes(2);

    await act(async () => {
      drawer.open = false;
      fireEvent(
        drawer,
        new Event("toggle", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(onLoadDaemonLogTail).toHaveBeenCalledTimes(2);

    unmount();
    vi.useRealTimers();
  });

  it("auto-scrolls diagnostics logs to the latest entry after polling appends lines", async () => {
    vi.useFakeTimers();
    let scrollHeight = 240;
    const onLoadDaemonLogTail = vi
      .fn()
      .mockResolvedValueOnce({
        source: "daemon",
        path: "/var/log/ccswitch.log",
        linesRequested: 80,
        bytesRequested: 262144,
        linesReturned: 1,
        bytesRead: 64,
        fileSize: 64,
        entries: ["2026-05-16T10:00:00Z INFO daemon started"],
        truncated: false,
      })
      .mockResolvedValueOnce({
        source: "daemon",
        path: "/var/log/ccswitch.log",
        linesRequested: 80,
        bytesRequested: 262144,
        linesReturned: 2,
        bytesRead: 128,
        fileSize: 128,
        entries: [
          "2026-05-16T10:00:00Z INFO daemon started",
          "2026-05-16T10:00:03Z INFO accepted request",
        ],
        truncated: false,
      });
    const { card, unmount } = renderDaemonCard({}, { onLoadDaemonLogTail });
    const drawer = card.querySelector<HTMLDetailsElement>(".owt-log-drawer");
    const viewer = card.querySelector<HTMLDivElement>(".owt-log-viewer");

    if (!drawer || !viewer) {
      throw new Error("Expected diagnostics drawer and log viewer to render");
    }

    Object.defineProperty(viewer, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    await act(async () => {
      drawer.open = true;
      fireEvent(
        drawer,
        new Event("toggle", {
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(viewer.scrollTop).toBe(240);
    viewer.scrollTop = 0;
    scrollHeight = 480;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(card).toHaveTextContent("accepted request");
    expect(viewer.scrollTop).toBe(480);

    unmount();
    vi.useRealTimers();
  });
});
