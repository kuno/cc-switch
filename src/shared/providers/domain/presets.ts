import { OPENWRT_SHARED_PROVIDER_PRESET_CATALOG } from "@/openwrt-provider-ui/openwrtProviderPresetCatalog";
import type { SharedProviderAppId, SharedProviderPreset } from "./types";

const SHARED_PRESET_CATALOG: Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> = OPENWRT_SHARED_PROVIDER_PRESET_CATALOG;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getSharedProviderPresetCatalog(): Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> {
  return SHARED_PRESET_CATALOG;
}

export function getSharedProviderPresets(
  appId: SharedProviderAppId,
): SharedProviderPreset[] {
  return SHARED_PRESET_CATALOG[appId];
}

export function getSharedProviderPresetById(
  appId: SharedProviderAppId,
  presetId: string,
): SharedProviderPreset | null {
  return (
    SHARED_PRESET_CATALOG[appId].find((preset) => preset.id === presetId) ??
    null
  );
}

export function inferSharedProviderPresetId(
  appId: SharedProviderAppId,
  payload: Partial<Pick<SharedProviderPreset, "baseUrl" | "tokenField">>,
): string {
  const normalizedBaseUrl = normalizeUrl(payload.baseUrl ?? "");
  const normalizedTokenField = payload.tokenField ?? "";

  for (const preset of SHARED_PRESET_CATALOG[appId]) {
    if (
      normalizeUrl(preset.baseUrl) === normalizedBaseUrl &&
      (!normalizedTokenField || preset.tokenField === normalizedTokenField)
    ) {
      return preset.id;
    }
  }

  return "custom";
}

export function getGenericPresetDescription(): string {
  return "Preset selected. You can still adjust the fields below before saving.";
}

export const OPENWRT_SUPPORTED_PROVIDER_APPS: SharedProviderAppId[] = [
  "claude",
  "codex",
  "gemini",
];
