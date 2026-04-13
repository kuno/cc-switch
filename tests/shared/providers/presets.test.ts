import { describe, expect, it } from "vitest";
import {
  getGenericPresetDescription,
  getSharedProviderPresetById,
  getSharedProviderPresets,
  inferSharedProviderPresetId,
  OPENWRT_SUPPORTED_PROVIDER_APPS,
} from "@/shared/providers/domain";
import type { SharedProviderAppId } from "@/shared/providers/domain";

describe("shared provider preset catalog", () => {
  it("exports desktop-backed OpenWrt preset catalogs for all supported apps", () => {
    for (const appId of OPENWRT_SUPPORTED_PROVIDER_APPS) {
      const presets = getSharedProviderPresets(appId);

      expect(presets.length).toBeGreaterThan(0);
      expect(new Set(presets.map((preset) => preset.id)).size).toBe(
        presets.length,
      );

      presets.forEach((preset) => {
        expect(preset.appId).toBe(appId);
        expect(preset.providerName).not.toHaveLength(0);
        expect(preset.baseUrl).toMatch(/^https:\/\/\S+$/);
        expect(preset.supportedOn).toEqual({
          desktop: true,
          openwrt: true,
        });
      });
    }
  });

  it("preserves the router catalog ids and lookup behavior", () => {
    expect(getSharedProviderPresetById("claude", "claude-openrouter")).toEqual(
      expect.objectContaining({
        sourcePresetName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api",
      }),
    );
    expect(getSharedProviderPresetById("codex", "codex-openrouter")).toEqual(
      expect.objectContaining({
        sourcePresetName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "gpt-5.4",
      }),
    );
    expect(getSharedProviderPresetById("gemini", "gemini-openrouter")).toEqual(
      expect.objectContaining({
        sourcePresetName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api",
        model: "gemini-3.1-pro",
      }),
    );
  });

  it("infers preset ids from normalized payloads", () => {
    const cases: Array<{
      appId: SharedProviderAppId;
      presetId: string;
      baseUrl: string;
      tokenField: string;
    }> = [
      {
        appId: "claude",
        presetId: "claude-aihubmix",
        baseUrl: "https://aihubmix.com/",
        tokenField: "ANTHROPIC_API_KEY",
      },
      {
        appId: "codex",
        presetId: "codex-sssaicode",
        baseUrl: "https://node-hk.sssaicode.com/api/v1/",
        tokenField: "OPENAI_API_KEY",
      },
      {
        appId: "gemini",
        presetId: "gemini-aicoding",
        baseUrl: "https://api.aicoding.sh/",
        tokenField: "GEMINI_API_KEY",
      },
    ];

    cases.forEach((entry) => {
      expect(
        inferSharedProviderPresetId(entry.appId, {
          baseUrl: entry.baseUrl,
          tokenField: entry.tokenField as never,
        }),
      ).toBe(entry.presetId);
    });
  });

  it("keeps explicit helper text only for presets that currently expose it on OpenWrt", () => {
    expect(
      getSharedProviderPresetById("claude", "claude-deepseek")?.description,
    ).toBe("DeepSeek Claude-compatible endpoint.");
    expect(
      getSharedProviderPresetById("codex", "codex-openrouter")?.description,
    ).toBe("OpenRouter Responses-compatible endpoint for Codex.");
    expect(
      getSharedProviderPresetById("gemini", "gemini-openrouter")?.description,
    ).toBe("OpenRouter Gemini-compatible endpoint.");
    expect(
      getSharedProviderPresetById("claude", "claude-aihubmix")?.description,
    ).toBe("");
    expect(getGenericPresetDescription()).toBe(
      "Preset selected. You can still adjust the fields below before saving.",
    );
  });
});
