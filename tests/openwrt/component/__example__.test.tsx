import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppNotificationStack } from "@/openwrt-provider-ui/components/AppNotificationStack";

describe("AppNotificationStack example", () => {
  it("renders nothing when there is no top-level notification", () => {
    const { container } = render(
      <AppNotificationStack notifications={[]} onDismiss={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
