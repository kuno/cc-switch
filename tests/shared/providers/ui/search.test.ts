import { describe, expect, it } from "vitest";
import {
  filterSharedProviders,
  getSharedProviderSearchSummary,
  matchesSharedProviderSearch,
  type SharedProviderView,
} from "@/shared/providers";

function createProvider(
  partial: Partial<SharedProviderView> & {
    providerId: string;
    name: string;
    baseUrl: string;
  },
): SharedProviderView {
  return {
    configured: true,
    providerId: partial.providerId,
    name: partial.name,
    baseUrl: partial.baseUrl,
    tokenField: partial.tokenField ?? "OPENAI_API_KEY",
    tokenConfigured: partial.tokenConfigured ?? true,
    tokenMasked: partial.tokenMasked ?? "********",
    model: partial.model ?? "",
    notes: partial.notes ?? "",
    active: partial.active ?? false,
  };
}

describe("shared provider search primitives", () => {
  it("matches provider fields and inferred preset labels", () => {
    const provider = createProvider({
      providerId: "router-openrouter",
      name: "Router fallback",
      baseUrl: "https://openrouter.ai/api/v1",
      notes: "Rack router path",
      model: "gpt-5.4",
    });

    expect(
      matchesSharedProviderSearch("codex", provider, "router-openrouter"),
    ).toBe(true);
    expect(matchesSharedProviderSearch("codex", provider, "rack router")).toBe(
      true,
    );
    expect(matchesSharedProviderSearch("codex", provider, "OpenRouter")).toBe(
      true,
    );
    expect(matchesSharedProviderSearch("codex", provider, "unmatched")).toBe(
      false,
    );
  });

  it("filters providers locally and preserves all providers for an empty query", () => {
    const providers = [
      createProvider({
        providerId: "alpha",
        name: "Alpha",
        baseUrl: "https://alpha.example.com/v1",
      }),
      createProvider({
        providerId: "beta",
        name: "Beta",
        baseUrl: "https://beta.example.com/v1",
        notes: "regional codex route",
      }),
    ];

    expect(filterSharedProviders("codex", providers, "")).toHaveLength(2);
    expect(filterSharedProviders("codex", providers, "regional")).toEqual([
      providers[1],
    ]);
  });

  it("builds result-count copy only when search is active", () => {
    expect(getSharedProviderSearchSummary("", 2, 3)).toBeNull();
    expect(getSharedProviderSearchSummary("alpha", 1, 3)).toBe(
      '1 of 3 providers match "alpha".',
    );
    expect(getSharedProviderSearchSummary("alpha", 1, 1)).toBe(
      '1 result for "alpha".',
    );
  });
});
