import { describe, expect, it } from "vitest";
import {
  emptySharedProviderEditorPayload,
  emptySharedProviderView,
  normalizeSharedProviderView,
  parseSharedProviderState,
} from "@/shared/providers/domain";

describe("shared provider state helpers", () => {
  it("uses app-specific default token fields in empty views and editor payloads", () => {
    expect(emptySharedProviderView("claude").tokenField).toBe(
      "ANTHROPIC_AUTH_TOKEN",
    );
    expect(emptySharedProviderEditorPayload("codex").tokenField).toBe(
      "OPENAI_API_KEY",
    );
    expect(emptySharedProviderView("gemini").tokenField).toBe("GEMINI_API_KEY");
  });

  it("normalizes provider responses with legacy snake_case fields", () => {
    expect(
      normalizeSharedProviderView(
        {
          provider_id: "alpha",
          name: "Alpha",
          base_url: "https://alpha.example.com",
          token_field: "ANTHROPIC_API_KEY",
          token_configured: true,
          token_masked: "********1234",
          is_current: true,
        },
        null,
        null,
        "claude",
      ),
    ).toEqual(
      expect.objectContaining({
        configured: true,
        providerId: "alpha",
        baseUrl: "https://alpha.example.com",
        tokenField: "ANTHROPIC_API_KEY",
        tokenConfigured: true,
        tokenMasked: "********1234",
        active: true,
      }),
    );
  });

  it("prefers item-level active flags and otherwise falls back to the phase 1 hint", () => {
    const explicit = parseSharedProviderState(
      {
        providers: [
          { provider_id: "alpha", name: "Alpha", active: true },
          { provider_id: "beta", name: "Beta" },
        ],
      },
      normalizeSharedProviderView(
        {
          provider_id: "beta",
          name: "Beta",
          base_url: "https://beta.example.com",
        },
        "beta",
        null,
        "claude",
      ),
      "claude",
    );

    expect(explicit?.activeProviderId).toBe("alpha");
    expect(
      explicit?.providers.find((provider) => provider.providerId === "alpha")
        ?.active,
    ).toBe(true);

    const fallback = parseSharedProviderState(
      {
        providers: {
          alpha: { provider_id: "alpha", name: "Alpha" },
          beta: { provider_id: "beta", name: "Beta" },
        },
      },
      normalizeSharedProviderView(
        {
          provider_id: "beta",
          name: "Beta",
          base_url: "https://beta.example.com",
        },
        "beta",
        null,
        "claude",
      ),
      "claude",
    );

    expect(fallback?.activeProviderId).toBe("beta");
    expect(fallback?.activeProvider.providerId).toBe("beta");
  });
});
