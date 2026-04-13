import { describe, expect, it, vi } from "vitest";
import {
  createOpenWrtProviderAdapter,
  __private__,
  type OpenWrtProviderTransport,
} from "@/platform/openwrt/providers";
import type { SharedProviderEditorPayload } from "@/shared/providers/domain";

function createTransport(
  overrides: Partial<OpenWrtProviderTransport> = {},
): OpenWrtProviderTransport {
  return {
    listProviders: vi.fn().mockResolvedValue(null),
    listSavedProviders: vi.fn().mockResolvedValue(null),
    getActiveProvider: vi.fn().mockResolvedValue({
      ok: true,
      provider_json: JSON.stringify({
        configured: true,
        providerId: "openwrt-claude",
        name: "Claude Official",
        baseUrl: "https://api.anthropic.com",
        tokenField: "ANTHROPIC_AUTH_TOKEN",
        tokenConfigured: true,
        tokenMasked: "********1234",
      }),
    }),
    restartService: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

const SAMPLE_DRAFT: SharedProviderEditorPayload = {
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  tokenField: "OPENAI_API_KEY",
  token: "secret",
  model: "gpt-5.4",
  notes: "",
};

describe("OpenWrt provider adapter", () => {
  it("loads phase 2 provider state from the current rpc responses", async () => {
    const transport = createTransport({
      listProviders: vi.fn().mockResolvedValue({
        ok: true,
        providers_json: JSON.stringify({
          activeProviderId: "provider-b",
          providers: {
            "provider-a": {
              provider_id: "provider-a",
              name: "Alpha",
              base_url: "https://alpha.example.com",
            },
            "provider-b": {
              provider_id: "provider-b",
              name: "Beta",
              base_url: "https://beta.example.com",
            },
          },
        }),
      }),
      getActiveProvider: vi.fn().mockResolvedValue({
        ok: true,
        provider_json: JSON.stringify({
          configured: true,
          providerId: "provider-b",
          name: "Beta",
          baseUrl: "https://beta.example.com",
          tokenField: "ANTHROPIC_AUTH_TOKEN",
          tokenConfigured: true,
          tokenMasked: "********beta",
          active: true,
        }),
      }),
    });

    const adapter = createOpenWrtProviderAdapter(transport);
    const state = await adapter.listProviderState("claude");

    expect(state.phase2Available).toBe(true);
    expect(state.activeProviderId).toBe("provider-b");
    expect(state.providers).toHaveLength(2);
    expect(state.activeProvider.name).toBe("Beta");
  });

  it("falls back to the phase 1 active-provider bridge when saved-provider RPCs are absent", async () => {
    const adapter = createOpenWrtProviderAdapter(createTransport());
    const state = await adapter.listProviderState("claude");

    expect(state.phase2Available).toBe(false);
    expect(state.providers).toHaveLength(1);
    expect(state.activeProvider.providerId).toBe("openwrt-claude");
  });

  it("uses provider_id and id compatibility fallbacks for update and activate flows", async () => {
    const upsertProviderByProviderId = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Invalid argument" });
    const upsertProviderById = vi.fn().mockResolvedValue({ ok: true });
    const activateProviderByProviderId = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" });
    const activateProviderById = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        upsertProviderByProviderId,
        upsertProviderById,
        activateProviderByProviderId,
        activateProviderById,
      }),
    );

    await adapter.saveProvider("codex", SAMPLE_DRAFT, "provider-b");
    await adapter.activateProvider("codex", "provider-b");

    expect(upsertProviderByProviderId).toHaveBeenCalledOnce();
    expect(upsertProviderById).toHaveBeenCalledOnce();
    expect(activateProviderByProviderId).toHaveBeenCalledOnce();
    expect(activateProviderById).toHaveBeenCalledOnce();
  });

  it("falls back to upsert-active-provider when phase 2 save methods are unavailable", async () => {
    const upsertProvider = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "method not found" });
    const saveProvider = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "invalid argument" });
    const upsertActiveProvider = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        upsertProvider,
        saveProvider,
        upsertActiveProvider,
      }),
    );

    await adapter.saveProvider("codex", SAMPLE_DRAFT);

    expect(upsertProvider).toHaveBeenCalledOnce();
    expect(saveProvider).toHaveBeenCalledOnce();
    expect(upsertActiveProvider).toHaveBeenCalledOnce();
  });

  it("keeps the same compatibility failure classification as the LuCI bridge", () => {
    expect(
      __private__.isCompatibilityRpcFailure({
        ok: false,
        error: "Invalid argument",
      }),
    ).toBe(true);
    expect(
      __private__.isCompatibilityRpcFailure({
        ok: false,
        error: "Failed to restart service.",
      }),
    ).toBe(false);
  });
});
