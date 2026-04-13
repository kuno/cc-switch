import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type AppId = "claude" | "codex" | "gemini";

type PresetOption = {
  id: string;
  label: string;
  providerName: string;
  baseUrl: string;
  tokenField: string;
  model: string;
  description: string;
};

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
  getPresetOptions(appId: string): PresetOption[];
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

const EXPECTED_PRESET_IDS: Record<AppId, string[]> = {
  claude: [
    "claude-official",
    "claude-deepseek",
    "claude-zhipu-glm",
    "claude-zhipu-glm-en",
    "claude-bailian",
    "claude-bailian-coding",
    "claude-kimi",
    "claude-kimi-coding",
    "claude-modelscope",
    "claude-longcat",
    "claude-minimax",
    "claude-minimax-en",
    "claude-doubaoseed",
    "claude-bailing",
    "claude-aihubmix",
    "claude-siliconflow",
    "claude-siliconflow-en",
    "claude-dmxapi",
    "claude-packycode",
    "claude-cubence",
    "claude-aigocode",
    "claude-rightcode",
    "claude-aicodemirror",
    "claude-aicoding",
    "claude-crazyrouter",
    "claude-sssaicode",
    "claude-compshare",
    "claude-micu",
    "claude-x-code-api",
    "claude-ctok",
    "claude-openrouter",
    "claude-novita-ai",
    "claude-xiaomi-mimo",
  ],
  codex: [
    "codex-openai-official",
    "codex-azure-openai",
    "codex-aihubmix",
    "codex-dmxapi",
    "codex-packycode",
    "codex-cubence",
    "codex-aigocode",
    "codex-rightcode",
    "codex-aicodemirror",
    "codex-aicoding",
    "codex-crazyrouter",
    "codex-sssaicode",
    "codex-compshare",
    "codex-micu",
    "codex-x-code-api",
    "codex-ctok",
    "codex-openrouter",
  ],
  gemini: [
    "gemini-google-official",
    "gemini-packycode",
    "gemini-cubence",
    "gemini-aigocode",
    "gemini-aicodemirror",
    "gemini-aicoding",
    "gemini-crazyrouter",
    "gemini-sssaicode",
    "gemini-ctok",
    "gemini-openrouter",
  ],
};

const ALLOWED_TOKEN_FIELDS: Record<AppId, string[]> = {
  claude: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"],
  codex: ["OPENAI_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
};

const LEGACY_PRESET_DESCRIPTIONS: Record<string, string> = {
  "claude-official": "Official Anthropic Claude endpoint.",
  "claude-deepseek": "DeepSeek Claude-compatible endpoint.",
  "claude-kimi": "Moonshot Kimi Claude-compatible endpoint.",
  "claude-minimax": "MiniMax Claude-compatible endpoint.",
  "codex-openai-official": "Official OpenAI Responses endpoint for Codex.",
  "codex-azure-openai":
    "Azure OpenAI Codex endpoint template. Replace YOUR_RESOURCE_NAME before saving.",
  "codex-openrouter": "OpenRouter Responses-compatible endpoint for Codex.",
  "codex-packycode": "PackyCode Codex-compatible endpoint.",
  "gemini-google-official": "Official Google Gemini API endpoint.",
  "gemini-openrouter": "OpenRouter Gemini-compatible endpoint.",
  "gemini-packycode": "PackyCode Gemini-compatible endpoint.",
  "gemini-ctok": "CTok Gemini-compatible endpoint.",
};

const GENERIC_SELECTED_PRESET_DESCRIPTION =
  "Preset selected. You can still adjust the fields below before saving.";

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

function makePresetRefs() {
  return {
    nameInput: { value: "" },
    baseUrlInput: { value: "" },
    tokenFieldSelect: { value: "" },
    modelInput: { value: "" },
    presetDescriptionNode: { textContent: "" },
  };
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function expectExpandedPresetCatalog(settingsView: SettingsView, appId: AppId) {
  const presets = settingsView.getPresetOptions(appId);
  const ids = presets.map((preset) => preset.id);
  const normalizedTargets = new Set<string>();

  expect(ids).toEqual(EXPECTED_PRESET_IDS[appId]);
  expect(new Set(ids).size).toBe(ids.length);

  presets.forEach((preset) => {
    expect(preset.id.startsWith(`${appId}-`)).toBe(true);
    expect(preset.label).not.toHaveLength(0);
    expect(preset.providerName).not.toHaveLength(0);
    expect(preset.baseUrl).toMatch(/^https:\/\/\S+$/);
    expect(ALLOWED_TOKEN_FIELDS[appId]).toContain(preset.tokenField);
    expect(typeof preset.model).toBe("string");
    expect(typeof preset.description).toBe("string");

    const normalizedTarget = `${normalizeBaseUrl(preset.baseUrl)}::${preset.tokenField}`;
    expect(normalizedTargets.has(normalizedTarget)).toBe(false);
    normalizedTargets.add(normalizedTarget);

    expect(
      settingsView.inferPresetIdFromPayload(appId, {
        baseUrl: `${preset.baseUrl}/`,
        tokenField: preset.tokenField,
      }),
    ).toBe(preset.id);
  });
}

describe("LuCI provider state parsing", () => {
  const settingsView = loadSettingsView();

  it("exposes the expanded desktop-aligned preset catalog with stable ids and valid inference for all OpenWrt apps", () => {
    expectExpandedPresetCatalog(settingsView, "claude");
    expectExpandedPresetCatalog(settingsView, "codex");
    expectExpandedPresetCatalog(settingsView, "gemini");

    expect(settingsView.getPresetOptions("claude")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "claude-zhipu-glm" }),
        expect.objectContaining({
          id: "claude-aihubmix",
          tokenField: "ANTHROPIC_API_KEY",
        }),
        expect.objectContaining({
          id: "claude-xiaomi-mimo",
          model: "mimo-v2-pro",
        }),
      ]),
    );
    expect(settingsView.getPresetOptions("codex")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "codex-aihubmix" }),
        expect.objectContaining({ id: "codex-sssaicode" }),
        expect.objectContaining({
          id: "codex-openrouter",
          description: "OpenRouter Responses-compatible endpoint for Codex.",
        }),
      ]),
    );
    expect(settingsView.getPresetOptions("gemini")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gemini-aicoding" }),
        expect.objectContaining({ id: "gemini-sssaicode" }),
        expect.objectContaining({
          id: "gemini-ctok",
          description: "CTok Gemini-compatible endpoint.",
        }),
      ]),
    );
  });

  it("restores legacy preset descriptions while keeping the generic helper for newer catalog additions", () => {
    const refs = makePresetRefs();

    Object.entries(LEGACY_PRESET_DESCRIPTIONS).forEach(
      ([presetId, expectedDescription]) => {
        const appId = presetId.split("-")[0] as AppId;

        settingsView.applyPresetToInputs(appId, presetId, refs);

        expect(refs.presetDescriptionNode.textContent).toBe(
          expectedDescription,
        );
        expect(
          settingsView
            .getPresetOptions(appId)
            .find((preset) => preset.id === presetId)?.description,
        ).toBe(expectedDescription);
      },
    );

    settingsView.applyPresetToInputs("claude", "claude-aihubmix", refs);
    expect(refs.presetDescriptionNode.textContent).toBe(
      GENERIC_SELECTED_PRESET_DESCRIPTION,
    );
  });

  it("autofills preset metadata and infers matching presets from saved payloads", () => {
    const refs = makePresetRefs();

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
