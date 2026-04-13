import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ProviderView = {
  configured: boolean;
  providerId: string | null;
  name: string;
  baseUrl: string;
  tokenField: string;
  tokenConfigured: boolean;
  tokenMasked: string;
  model: string;
  notes: string;
  active: boolean;
};

type ProviderState = {
  phase2Available: boolean;
  providers: ProviderView[];
  activeProviderId: string | null;
  activeProvider: ProviderView;
};

type SettingsView = {
  emptyProviderView(): ProviderView;
  getPresetOptions(appId: string): Array<{
    id: string;
    providerName: string;
    baseUrl: string;
    tokenField: string;
    model: string;
  }>;
  inferPresetIdFromPayload(
    appId: string,
    payload: Partial<Pick<ProviderView, "baseUrl" | "tokenField">>,
  ): string;
  applyPresetToInputs(
    appId: string,
    presetId: string,
    refs: {
      nameInput: { value: string };
      baseUrlInput: { value: string };
      tokenFieldSelect: { value: string };
      modelInput: { value: string };
      presetDescriptionNode: { textContent: string };
    },
  ): void;
  normalizeProviderView(
    provider: Record<string, unknown>,
    fallbackId: string | null,
    activeProviderId: string | null,
  ): ProviderView;
  parsePhase2ProviderState(
    listResponse: Record<string, unknown> | null,
    activeHint: ProviderView,
  ): ProviderState | null;
};

function loadSettingsView(): SettingsView {
  const source = readFileSync(
    path.resolve(
      process.cwd(),
      "openwrt/luci-app-ccswitch/htdocs/luci-static/resources/view/ccswitch/settings.js",
    ),
    "utf8",
  );
  const factory = new Function(
    "view",
    "form",
    "uci",
    "rpc",
    "ui",
    "_",
    "localStorage",
    source,
  );

  return factory(
    {
      extend(definition: SettingsView) {
        return definition;
      },
    },
    {},
    {},
    {
      declare() {
        return () => Promise.resolve({});
      },
    },
    {},
    (value: string) => value,
    {
      getItem() {
        return null;
      },
      setItem() {},
    },
  ) as SettingsView;
}

function makeActiveHint(
  settingsView: SettingsView,
  providerId: string,
  name: string,
): ProviderView {
  return settingsView.normalizeProviderView(
    {
      provider_id: providerId,
      name,
      base_url: `https://${providerId}.example.com`,
    },
    providerId,
    null,
  );
}

describe("LuCI provider state parsing", () => {
  const settingsView = loadSettingsView();

  it("exposes the expanded desktop-aligned preset catalog for all OpenWrt apps", () => {
    expect(settingsView.getPresetOptions("claude")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "claude-zhipu-glm" }),
        expect.objectContaining({ id: "claude-aihubmix", tokenField: "ANTHROPIC_API_KEY" }),
        expect.objectContaining({ id: "claude-xiaomi-mimo", model: "mimo-v2-pro" }),
      ]),
    );
    expect(settingsView.getPresetOptions("codex")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex-aihubmix" }),
        expect.objectContaining({ id: "codex-sssaicode" }),
        expect.objectContaining({ id: "codex-openrouter" }),
      ]),
    );
    expect(settingsView.getPresetOptions("gemini")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gemini-aicoding" }),
        expect.objectContaining({ id: "gemini-sssaicode" }),
        expect.objectContaining({ id: "gemini-openrouter" }),
      ]),
    );
  });

  it("autofills preset metadata and infers matching presets from saved payloads", () => {
    const refs = {
      nameInput: { value: "" },
      baseUrlInput: { value: "" },
      tokenFieldSelect: { value: "" },
      modelInput: { value: "" },
      presetDescriptionNode: { textContent: "" },
    };

    settingsView.applyPresetToInputs("claude", "claude-aihubmix", refs);
    expect(refs.nameInput.value).toBe("AiHubMix");
    expect(refs.baseUrlInput.value).toBe("https://aihubmix.com");
    expect(refs.tokenFieldSelect.value).toBe("ANTHROPIC_API_KEY");
    expect(refs.modelInput.value).toBe("");
    expect(
      settingsView.inferPresetIdFromPayload("claude", {
        baseUrl: "https://aihubmix.com/",
        tokenField: "ANTHROPIC_API_KEY",
      }),
    ).toBe("claude-aihubmix");

    settingsView.applyPresetToInputs("codex", "codex-sssaicode", refs);
    expect(refs.nameInput.value).toBe("SSSAiCode");
    expect(refs.baseUrlInput.value).toBe("https://node-hk.sssaicode.com/api/v1");
    expect(refs.tokenFieldSelect.value).toBe("OPENAI_API_KEY");
    expect(refs.modelInput.value).toBe("gpt-5.4");
    expect(
      settingsView.inferPresetIdFromPayload("codex", {
        baseUrl: "https://node-hk.sssaicode.com/api/v1/",
        tokenField: "OPENAI_API_KEY",
      }),
    ).toBe("codex-sssaicode");

    settingsView.applyPresetToInputs("gemini", "gemini-aicoding", refs);
    expect(refs.nameInput.value).toBe("AICoding");
    expect(refs.baseUrlInput.value).toBe("https://api.aicoding.sh");
    expect(refs.tokenFieldSelect.value).toBe("GEMINI_API_KEY");
    expect(refs.modelInput.value).toBe("gemini-3.1-pro");
    expect(
      settingsView.inferPresetIdFromPayload("gemini", {
        baseUrl: "https://api.aicoding.sh/",
        tokenField: "GEMINI_API_KEY",
      }),
    ).toBe("gemini-aicoding");
  });

  it("preserves item-level active when phase 2 omits the top-level activeProviderId", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: [
          { provider_id: "alpha", name: "Alpha", active: true },
          { provider_id: "beta", name: "Beta" },
        ],
      },
      makeActiveHint(settingsView, "beta", "Beta"),
    );

    expect(state?.activeProviderId).toBe("alpha");
    expect(state?.activeProvider.providerId).toBe("alpha");
    expect(state?.providers.find((provider) => provider.providerId === "alpha")?.active).toBe(true);
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(false);
  });

  it("preserves item-level is_current ahead of the phase 1 hint", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: {
          alpha: { provider_id: "alpha", name: "Alpha" },
          beta: { provider_id: "beta", name: "Beta", is_current: true },
        },
      },
      makeActiveHint(settingsView, "alpha", "Alpha"),
    );

    expect(state?.activeProviderId).toBe("beta");
    expect(state?.activeProvider.providerId).toBe("beta");
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(true);
  });

  it("keeps the phase 1 hint fallback when phase 2 provides no active flags", () => {
    const state = settingsView.parsePhase2ProviderState(
      {
        providers: {
          alpha: { provider_id: "alpha", name: "Alpha" },
          beta: { provider_id: "beta", name: "Beta" },
        },
      },
      makeActiveHint(settingsView, "beta", "Beta"),
    );

    expect(state?.activeProviderId).toBe("beta");
    expect(state?.activeProvider.providerId).toBe("beta");
    expect(state?.providers.find((provider) => provider.providerId === "beta")?.active).toBe(true);
  });
});
