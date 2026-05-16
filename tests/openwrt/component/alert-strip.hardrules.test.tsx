import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppNotificationStack } from "@/openwrt-provider-ui/components/AppNotificationStack";

describe("AppNotificationStack hard rules", () => {
  it("does not render the old red alert strip surface", () => {
    const { container } = render(
      <AppNotificationStack
        notifications={[
          {
            id: "daemon:stopped",
            kind: "error",
            title: "Daemon stopped.",
            detail: "All app routing is offline until restart.",
          },
        ]}
        onDismiss={() => {}}
      />,
    );

    expect(container.querySelector(".owt-alert-strip")).toBeNull();
    expect(container.querySelector(".owt-alert-overlay")).toBeNull();
    expect(container.querySelector(".owt-notification-popup")).not.toBeNull();
  });
});
