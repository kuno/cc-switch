import { describe, expect, it } from "vitest";
import { resolveOpenWrtProviderIcon } from "@/openwrt-provider-ui/providerIcons";

describe("resolveOpenWrtProviderIcon", () => {
  it("prefers the inferred provider icon over a generic app icon", () => {
    expect(
      resolveOpenWrtProviderIcon("claude", {
        baseUrl: "https://api.kimi.com/coding/",
        icon: "anthropic",
        iconColor: "#D4915D",
        tokenField: "ANTHROPIC_AUTH_TOKEN",
      }),
    ).toMatchObject({
      icon: "kimi",
    });
  });

  it("keeps a custom persisted provider icon", () => {
    expect(
      resolveOpenWrtProviderIcon("claude", {
        baseUrl: "https://api.kimi.com/coding/",
        icon: "openrouter",
        tokenField: "ANTHROPIC_AUTH_TOKEN",
      }),
    ).toMatchObject({
      icon: "openrouter",
    });
  });
});
