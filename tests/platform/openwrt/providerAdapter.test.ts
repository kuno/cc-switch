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

function createPhase2ListResponse(
  activeProviderId: string,
  providers: Record<string, Record<string, unknown>>,
) {
  return {
    ok: true,
    providers_json: JSON.stringify({
      activeProviderId,
      providers,
    }),
  };
}

function createActiveProviderResponse(
  providerId: string,
  appId: "claude" | "codex" | "gemini" = "claude",
) {
  const tokenFieldByApp = {
    claude: "ANTHROPIC_AUTH_TOKEN",
    codex: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  } as const;

  return {
    ok: true,
    provider_json: JSON.stringify({
      configured: true,
      providerId,
      name: providerId,
      baseUrl: `https://${providerId}.example.com`,
      tokenField: tokenFieldByApp[appId],
      tokenConfigured: true,
      tokenMasked: "********1234",
      active: true,
    }),
  };
}

describe("OpenWrt provider adapter", () => {
  it("loads phase 2 provider state from the current rpc responses", async () => {
    const transport = createTransport({
      listProviders: vi.fn().mockResolvedValue(
        createPhase2ListResponse("provider-b", {
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
        }),
      ),
      getActiveProvider: vi.fn().mockResolvedValue({
        ...createActiveProviderResponse("provider-b"),
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

  it("keeps the phase 1 fallback path when list RPC calls reject outright", async () => {
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        listProviders: vi
          .fn()
          .mockRejectedValue(new Error("method not found: list_providers")),
        listSavedProviders: vi
          .fn()
          .mockRejectedValue(new Error("method not found: list_saved_providers")),
      }),
    );
    const state = await adapter.listProviderState("claude");

    expect(state.phase2Available).toBe(false);
    expect(state.activeProvider.providerId).toBe("openwrt-claude");
  });

  it("surfaces real load RPC failures instead of hiding them behind legacy state", async () => {
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        listProviders: vi
          .fn()
          .mockResolvedValue({ ok: false, error: "Access denied" }),
      }),
    );

    await expect(adapter.listProviderState("claude")).rejects.toThrow(
      "Access denied",
    );
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

  it("falls back to upsert-active-provider when phase 2 save methods are omitted from the transport", async () => {
    const upsertActiveProvider = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        upsertActiveProvider,
      }),
    );

    await adapter.saveProvider("codex", SAMPLE_DRAFT);

    expect(upsertActiveProvider).toHaveBeenCalledOnce();
  });

  it("preserves a blank token when editing so the backend can keep the stored secret", async () => {
    const upsertProviderByProviderId = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        upsertProviderByProviderId,
      }),
    );

    await adapter.saveProvider(
      "codex",
      {
        ...SAMPLE_DRAFT,
        token: "",
      },
      "provider-b",
    );

    expect(upsertProviderByProviderId).toHaveBeenCalledWith("codex", "provider-b", {
      ...SAMPLE_DRAFT,
      token: "",
    });
  });

  it("reports the full capability surface when phase 2 provider RPCs are available", async () => {
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        listProviders: vi.fn().mockResolvedValue(
          createPhase2ListResponse("provider-b", {
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
          }),
        ),
        getActiveProvider: vi
          .fn()
          .mockResolvedValue(createActiveProviderResponse("provider-b", "codex")),
      }),
    );

    await expect(adapter.getCapabilities("codex")).resolves.toEqual({
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canActivate: true,
      supportsPresets: true,
      supportsBlankSecretPreserve: true,
      requiresServiceRestart: true,
    });
  });

  it("surfaces non-compatibility save failures instead of hiding them behind the phase 1 fallback", async () => {
    const upsertProvider = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Access denied" });
    const saveProvider = vi.fn().mockResolvedValue({ ok: true });
    const upsertActiveProvider = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        upsertProvider,
        saveProvider,
        upsertActiveProvider,
      }),
    );

    await expect(adapter.saveProvider("codex", SAMPLE_DRAFT)).rejects.toThrow(
      "Access denied",
    );
    expect(upsertProvider).toHaveBeenCalledOnce();
    expect(saveProvider).not.toHaveBeenCalled();
    expect(upsertActiveProvider).not.toHaveBeenCalled();
  });

  it("reports the limited capability surface for the phase 1 bridge", async () => {
    const adapter = createOpenWrtProviderAdapter(createTransport());
    const capabilities = await adapter.getCapabilities("claude");

    expect(capabilities).toEqual({
      canAdd: false,
      canEdit: true,
      canDelete: false,
      canActivate: false,
      supportsPresets: true,
      supportsBlankSecretPreserve: true,
      requiresServiceRestart: true,
    });
  });

  it("surfaces restart-service failures for the shared bundle path", async () => {
    const adapter = createOpenWrtProviderAdapter(
      createTransport({
        restartService: vi
          .fn()
          .mockResolvedValue({ ok: false, error: "restart blocked" }),
      }),
    );

    await expect(adapter.restartServiceIfNeeded()).rejects.toThrow(
      "restart blocked",
    );
  });

  it("notifies runtime hooks when an active provider edit requires a restart", async () => {
    const onProviderMutation = vi.fn();
    const transport = createTransport({
      listProviders: vi
        .fn()
        .mockResolvedValueOnce(
          createPhase2ListResponse("provider-a", {
            "provider-a": {
              provider_id: "provider-a",
              name: "Alpha",
              base_url: "https://alpha.example.com",
            },
          }),
        )
        .mockResolvedValueOnce(
          createPhase2ListResponse("provider-a", {
            "provider-a": {
              provider_id: "provider-a",
              name: "Alpha Updated",
              base_url: "https://alpha.example.com",
            },
          }),
        ),
      getActiveProvider: vi
        .fn()
        .mockResolvedValueOnce(createActiveProviderResponse("provider-a", "codex"))
        .mockResolvedValueOnce(createActiveProviderResponse("provider-a", "codex")),
      upsertProviderByProviderId: vi.fn().mockResolvedValue({ ok: true }),
    });
    const adapter = createOpenWrtProviderAdapter(transport, {
      getServiceRunning: vi.fn().mockResolvedValue(true),
      onProviderMutation,
    });

    await adapter.saveProvider("codex", SAMPLE_DRAFT, "provider-a");

    expect(onProviderMutation).toHaveBeenCalledOnce();
    expect(onProviderMutation).toHaveBeenCalledWith({
      appId: "codex",
      mutation: "save",
      providerId: "provider-a",
      serviceRunning: true,
      restartRequired: true,
      providerState: expect.objectContaining({
        activeProviderId: "provider-a",
        phase2Available: true,
      }),
      capabilities: expect.objectContaining({
        canDelete: true,
        canActivate: true,
        requiresServiceRestart: true,
      }),
    });
  });

  it("reports a non-restart mutation when the service is not running", async () => {
    const onProviderMutation = vi.fn();
    const transport = createTransport({
      listProviders: vi
        .fn()
        .mockResolvedValueOnce(
          createPhase2ListResponse("provider-a", {
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
          }),
        )
        .mockResolvedValueOnce(
          createPhase2ListResponse("provider-b", {
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
          }),
        ),
      getActiveProvider: vi
        .fn()
        .mockResolvedValueOnce(createActiveProviderResponse("provider-a", "codex"))
        .mockResolvedValueOnce(createActiveProviderResponse("provider-b", "codex")),
      activateProviderByProviderId: vi.fn().mockResolvedValue({ ok: true }),
    });
    const adapter = createOpenWrtProviderAdapter(transport, {
      getServiceRunning: vi.fn().mockResolvedValue(false),
      onProviderMutation,
    });

    await adapter.activateProvider("codex", "provider-b");

    expect(onProviderMutation).toHaveBeenCalledOnce();
    expect(onProviderMutation.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        appId: "codex",
        mutation: "activate",
        providerId: "provider-b",
        serviceRunning: false,
        restartRequired: false,
      }),
    );
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
