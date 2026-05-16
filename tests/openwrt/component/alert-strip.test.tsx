import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AppNotificationStack,
  type AppNotification,
} from "@/openwrt-provider-ui/components/AppNotificationStack";

const ERROR_NOTIFICATION: AppNotification = {
  id: "daemon:restart-failed:test",
  kind: "error",
  title: "Restart failed:",
  detail: "The daemon timed out while reconnecting.",
  action: {
    label: "Retry restart",
    onClick: vi.fn(),
  },
};

describe("AppNotificationStack", () => {
  it("renders nothing without notifications", () => {
    const { container } = render(
      <AppNotificationStack notifications={[]} onDismiss={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders top-level errors as dismissible notification popups", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <AppNotificationStack
        notifications={[ERROR_NOTIFICATION]}
        onDismiss={onDismiss}
      />,
    );

    const popup = screen.getByRole("alert");

    expect(popup).toHaveAttribute("aria-live", "assertive");
    expect(popup).toHaveAttribute("aria-busy", "false");
    expect(popup).toHaveTextContent("Restart failed:");
    expect(popup).toHaveTextContent("The daemon timed out while reconnecting.");

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalledWith("daemon:restart-failed:test");
  });

  it("runs notification actions from the same popup surface", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <AppNotificationStack
        notifications={[
          {
            ...ERROR_NOTIFICATION,
            action: {
              label: "Retry restart",
              onClick: onAction,
            },
          },
        ]}
        onDismiss={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Retry restart" }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("marks busy notifications as polite status updates", () => {
    render(
      <AppNotificationStack
        notifications={[
          {
            id: "daemon:restarting:test",
            kind: "warning",
            title: "Restarting daemon…",
            detail: "Waiting for OpenWrt to confirm the service.",
            busy: true,
          },
        ]}
        onDismiss={() => {}}
      />,
    );

    const popup = screen.getByRole("status");

    expect(popup).toHaveAttribute("aria-live", "polite");
    expect(popup).toHaveAttribute("aria-busy", "true");
    expect(popup.querySelector(".animate-spin")).not.toBeNull();
  });
});
