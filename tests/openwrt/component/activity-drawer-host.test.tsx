import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityDrawerHost,
  type ActivityDrawerHostHandle,
} from "@/openwrt-provider-ui/components/ActivityDrawerHost";
import {
  CLAUDE_REQUEST_LOG,
  FIXED_ACTIVITY_NOW,
  createRequestLogsPage,
} from "../fixtures/activity";
import { createBridgeFixture } from "./fixtures/bridge";

function ActivityDrawerHostLauncher({
  shell,
}: {
  shell: ReturnType<typeof createBridgeFixture>;
}) {
  const shellRef = useRef<ActivityDrawerHostHandle | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          shellRef.current?.openForApp("claude");
        }}
      >
        Open recent activity
      </button>
      <button type="button">Outside action</button>
      <ActivityDrawerHost shell={shell} shellRef={shellRef} />
    </>
  );
}

describe("ActivityDrawerHost", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_ACTIVITY_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the dialog hidden until the host handle opens it", async () => {
    const shellRef = {
      current: null as ActivityDrawerHostHandle | null,
    };
    const shell = createBridgeFixture({
      requestLogs: {
        codex: createRequestLogsPage([]),
      },
    });

    render(<ActivityDrawerHost shell={shell} shellRef={shellRef} />);

    const hiddenDialog = screen.getByRole("dialog", { hidden: true });

    expect(shellRef.current).not.toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hiddenDialog.closest(".owt-activity-drawer")).toHaveAttribute(
      "data-open",
      "false",
    );

    await act(async () => {
      shellRef.current?.openForApp("codex");
    });

    await screen.findByRole("dialog");
    expect(hiddenDialog.closest(".owt-activity-drawer")).toHaveAttribute(
      "data-open",
      "true",
    );
    expect(shell.getRequestLogs).toHaveBeenCalledWith("codex", 0, 6);

    await act(async () => {
      shellRef.current?.close();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(hiddenDialog.closest(".owt-activity-drawer")).toHaveAttribute(
      "data-open",
      "false",
    );
  });

  it("traps focus inside the drawer and restores the trigger after Escape", async () => {
    const user = userEvent.setup();
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([CLAUDE_REQUEST_LOG]),
      },
    });

    render(<ActivityDrawerHostLauncher shell={shell} />);

    const trigger = screen.getByRole("button", {
      name: "Open recent activity",
    });

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    const closeButton = await screen.findByRole("button", {
      name: "Close recent activity",
    });
    const allAppsButton = await screen.findByRole("button", {
      name: "All apps",
    });
    const activeAppButton = screen.getByRole("button", {
      name: "Claude",
    });
    const refreshButton = screen.getByRole("button", {
      name: "Refresh",
    });
    const requestRow = await screen.findByRole("button", {
      name: "Open Anthropic Direct request req-claude-001",
    });

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    await user.tab();
    expect(allAppsButton).toHaveFocus();

    await user.tab();
    expect(activeAppButton).toHaveFocus();

    await user.tab();
    expect(refreshButton).toHaveFocus();

    await user.tab();
    expect(requestRow).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(requestRow).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});
