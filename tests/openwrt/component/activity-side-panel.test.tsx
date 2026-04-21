import { type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySidePanel } from "@/openwrt-provider-ui/components/ActivitySidePanel";
import type { OpenWrtPaginatedRequestLogs } from "@/openwrt-provider-ui/pageTypes";
import {
  ACTIVITY_DRAWER_APP_LOGS,
  CLAUDE_REQUEST_LOG,
  CLAUDE_REQUEST_LOG_SECONDARY,
  FIXED_ACTIVITY_NOW,
  createRequestLogsPage,
} from "../fixtures/activity";
import { createBridgeFixture } from "./fixtures/bridge";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function renderActivitySidePanel({
  appId = "claude",
  onClose = vi.fn(),
  shell = createBridgeFixture(),
}: {
  appId?: "claude" | "codex" | "gemini";
  onClose?: () => void;
  shell?: ReturnType<typeof createBridgeFixture>;
} = {}) {
  render(
    <ActivitySidePanel open appId={appId} onClose={onClose} shell={shell} />,
  );

  return {
    onClose,
    shell,
  };
}

function renderInShadowRoot(ui: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  shadowRoot.appendChild(container);
  const view = render(ui, {
    baseElement: container,
    container,
  });

  return {
    ...view,
    shadowRoot,
    cleanup() {
      view.unmount();
      host.remove();
    },
  };
}

function mockScrollbarWidth(width: number) {
  const innerWidthDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "innerWidth",
  );
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "clientWidth",
  );

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 1200 - width,
  });

  return () => {
    if (innerWidthDescriptor) {
      Object.defineProperty(window, "innerWidth", innerWidthDescriptor);
    } else {
      Reflect.deleteProperty(window, "innerWidth");
    }

    if (clientWidthDescriptor) {
      Object.defineProperty(
        document.documentElement,
        "clientWidth",
        clientWidthDescriptor,
      );
    } else {
      Reflect.deleteProperty(document.documentElement, "clientWidth");
    }
  };
}

describe("ActivitySidePanel", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_ACTIVITY_NOW);
  });

  afterEach(() => {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
    vi.restoreAllMocks();
  });

  it("renders dialog semantics and the empty state for the active app", async () => {
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([]),
      },
    });

    renderActivitySidePanel({ shell });

    const dialog = screen.getByRole("dialog");

    await screen.findByText("No recent requests for this filter.");

    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? "")).toHaveTextContent(
      "Recent activity",
    );
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent(
      "Claude",
    );
    expect(dialog).not.toHaveAttribute("aria-busy");
    expect(dialog.querySelector("[aria-live]")).toBeNull();
    expect(shell.getRequestLogs).toHaveBeenCalledWith("claude", 0, 6);
  });

  it("closes when the scrim is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderActivitySidePanel({ onClose });

    await screen.findByText("No recent requests for this filter.");
    await user.click(
      screen.getByRole("button", {
        name: "Close recent activity drawer",
      }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll with scrollbar compensation and restores prior styles on close", async () => {
    const restoreScrollbarWidth = mockScrollbarWidth(15);
    const onClose = vi.fn();
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([]),
      },
    });

    document.body.style.overflow = "clip";
    document.body.style.paddingRight = "6px";

    try {
      const view = render(
        <ActivitySidePanel
          open
          appId="claude"
          onClose={onClose}
          shell={shell}
        />,
      );

      await screen.findByText("No recent requests for this filter.");
      expect(document.body.style.overflow).toBe("hidden");
      expect(document.body.style.paddingRight).toBe("15px");

      view.rerender(
        <ActivitySidePanel
          open={false}
          appId="claude"
          onClose={onClose}
          shell={shell}
        />,
      );

      await waitFor(() => {
        expect(document.body.style.overflow).toBe("clip");
        expect(document.body.style.paddingRight).toBe("6px");
      });
    } finally {
      restoreScrollbarWidth();
    }
  });

  it("renders all-app request logs in compact rows without loading detail", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      requestLogs: ACTIVITY_DRAWER_APP_LOGS,
    });

    renderActivitySidePanel({ shell });

    await screen.findByText("Anthropic Direct");
    await user.click(
      screen.getByRole("button", {
        name: "All apps",
      }),
    );

    await screen.findByText("OpenAI Router");
    await screen.findByText("Google Gateway");

    expect(shell.getRequestLogs).toHaveBeenCalledWith("claude", 0, 6);
    expect(shell.getRequestLogs).toHaveBeenCalledWith("codex", 0, 6);
    expect(shell.getRequestLogs).toHaveBeenCalledWith("gemini", 0, 6);
    expect(shell.getRequestDetail).not.toHaveBeenCalled();
    expect(screen.getByText("gpt-5.4 · Codex · 14m ago")).toBeInTheDocument();
    expect(screen.getByText("1.2K tok")).toBeInTheDocument();
  });

  it("shows a loading state while refresh is in flight", async () => {
    const user = userEvent.setup();
    const refreshRequest = deferred<OpenWrtPaginatedRequestLogs>();
    const getRequestLogs = vi
      .fn()
      .mockResolvedValueOnce(createRequestLogsPage([CLAUDE_REQUEST_LOG]))
      .mockImplementationOnce(() => refreshRequest.promise);
    const shell = createBridgeFixture({
      overrides: {
        getRequestLogs,
      },
    });

    renderActivitySidePanel({ shell });

    await screen.findByText("Anthropic Direct");

    const refreshButton = screen.getByRole("button", {
      name: "Refresh recent activity",
    });

    await user.click(refreshButton);

    await screen.findByText("Loading recent requests…");
    expect(refreshButton).toBeDisabled();

    refreshRequest.resolve(
      createRequestLogsPage([CLAUDE_REQUEST_LOG_SECONDARY]),
    );

    await screen.findByText("Anthropic Burst");
    await waitFor(() => {
      expect(refreshButton).not.toBeDisabled();
    });
  });

  it("renders request log errors", async () => {
    const shell = createBridgeFixture({
      overrides: {
        getRequestLogs: vi.fn(async () => {
          throw new Error("Request log feed unavailable.");
        }),
      },
    });

    renderActivitySidePanel({ shell });

    await screen.findByText("Request log feed unavailable.");
  });

  it("does not request detail payloads in compact-list mode", async () => {
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([CLAUDE_REQUEST_LOG]),
      },
      overrides: {
        getRequestDetail: vi.fn(async () => {
          throw new Error("Request detail feed unavailable.");
        }),
      },
    });

    renderActivitySidePanel({ shell });

    await screen.findByText("Anthropic Direct");
    expect(shell.getRequestDetail).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Request detail feed unavailable."),
    ).not.toBeInTheDocument();
  });

  it("advances focus within the drawer when mounted in a shadow root", async () => {
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([]),
      },
    });
    const view = renderInShadowRoot(
      <ActivitySidePanel
        open
        appId="claude"
        onClose={() => {}}
        shell={shell}
      />,
    );

    try {
      await view.findByText("No recent requests for this filter.");

      const dialog = view.getByRole("dialog");
      const closeButton = within(dialog).getByRole("button", {
        name: "Close recent activity",
      });

      await waitFor(() =>
        expect(view.shadowRoot.activeElement).toBe(closeButton),
      );

      const tabEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
      });
      closeButton.dispatchEvent(tabEvent);

      expect(tabEvent.defaultPrevented).toBe(false);
    } finally {
      view.cleanup();
    }
  });
});
