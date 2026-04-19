import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySidePanel } from "@/openwrt-provider-ui/components/ActivitySidePanel";
import type { OpenWrtPaginatedRequestLogs } from "@/openwrt-provider-ui/pageTypes";
import {
  ACTIVITY_DRAWER_APP_LOGS,
  ACTIVITY_DRAWER_REQUEST_DETAILS,
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

describe("ActivitySidePanel", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_ACTIVITY_NOW);
  });

  afterEach(() => {
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

  it("renders all-app request logs and opens detail for the selected entry", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      requestLogs: ACTIVITY_DRAWER_APP_LOGS,
      requestDetails: ACTIVITY_DRAWER_REQUEST_DETAILS,
    });

    renderActivitySidePanel({ shell });

    await screen.findByText("Anthropic Direct");
    await user.click(
      screen.getByRole("button", {
        name: "All apps",
      }),
    );

    await screen.findByText("OpenAI Router");
    await user.click(
      screen.getByRole("button", {
        name: "Open OpenAI Router request req-codex-101",
      }),
    );

    await screen.findByRole("heading", {
      name: "Request detail",
    });

    expect(shell.getRequestLogs).toHaveBeenCalledWith("claude", 0, 6);
    expect(shell.getRequestLogs).toHaveBeenCalledWith("codex", 0, 6);
    expect(shell.getRequestLogs).toHaveBeenCalledWith("gemini", 0, 6);
    expect(shell.getRequestDetail).toHaveBeenCalledWith(
      "codex",
      "req-codex-101",
    );
    expect(screen.getAllByText("gpt-5.4")).toHaveLength(2);
    expect(screen.getByText("Upstream gateway timeout")).toBeInTheDocument();
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
      name: "Refresh",
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

  it("renders request detail errors", async () => {
    const user = userEvent.setup();
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
    await user.click(
      screen.getByRole("button", {
        name: "Open Anthropic Direct request req-claude-001",
      }),
    );

    await screen.findByText("Request detail feed unavailable.");
  });
});
