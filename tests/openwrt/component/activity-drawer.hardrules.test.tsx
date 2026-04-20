import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySidePanel } from "@/openwrt-provider-ui/components/ActivitySidePanel";
import {
  CLAUDE_REQUEST_LOG,
  FIXED_ACTIVITY_NOW,
  createRequestLogsPage,
} from "../fixtures/activity";
import { createBridgeFixture } from "./fixtures/bridge";

describe("Activity drawer hard rules", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_ACTIVITY_NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never renders removed legacy or provider-manager content", async () => {
    const shell = createBridgeFixture({
      requestLogs: {
        claude: createRequestLogsPage([CLAUDE_REQUEST_LOG]),
      },
    });
    const { container } = render(
      <ActivitySidePanel
        open
        appId="claude"
        onClose={() => {}}
        shell={shell}
      />,
    );

    await screen.findByText("Anthropic Direct");

    expect(screen.queryByText("Failover")).not.toBeInTheDocument();
    expect(screen.queryByText("OpenClaw")).not.toBeInTheDocument();
    expect(screen.queryByText("Hermes")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Request detail" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Open Anthropic Direct request req-claude-001",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Configure routes and provider details"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".owt-legacy-preserved")).toBeNull();
    expect(container.innerHTML).not.toContain("SharedProviderManager");
  });
});
