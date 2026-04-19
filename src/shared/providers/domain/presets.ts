import { OPENWRT_SHARED_PROVIDER_PRESET_CATALOG } from "@/openwrt-provider-ui/openwrtProviderPresetCatalog";
import type {
  SharedProviderAppId,
  SharedProviderPreset,
  SharedProviderPresetCategory,
  SharedProviderPresetCategoryId,
  SharedProviderPresetGroup,
} from "./types";

const SHARED_PRESET_CATALOG: Record<
  SharedProviderAppId,
  SharedProviderPreset[]
> = OPENWRT_SHARED_PROVIDER_PRESET_CATALOG;

const SHARED_PROVIDER_PRESET_CATEGORY_ORDER: SharedProviderPresetCategoryId[] =
  ["official", "cn_official", "cloud_provider", "aggregator", "third_party"];

export const SHARED_PROVIDER_PRESET_CATEGORIES: Record<
  SharedProviderPresetCategoryId,
  SharedProviderPresetCategory
> = {
  official: {
    id: "official",
    label: "Official",
    hint: "First-party endpoints and direct platform defaults.",
  },
  cn_official: {
    id: "cn_official",
    label: "Regional",
    hint: "Provider-operated compatible endpoints with regional routing.",
  },
  cloud_provider: {
    id: "cloud_provider",
    label: "Cloud",
    hint: "Managed cloud gateways that proxy the provider API.",
  },
  aggregator: {
    id: "aggregator",
    label: "Aggregators",
    hint: "Compatibility gateways that fan out across multiple providers.",
  },
  third_party: {
    id: "third_party",
    label: "Third-party",
    hint: "Independent hosted gateways and compatible provider services.",
  },
};

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

export function getSharedProviderPresetCategory(
  categoryId: SharedProviderPresetCategoryId,
): SharedProviderPresetCategory {
  return SHARED_PROVIDER_PRESET_CATEGORIES[categoryId];
}

export function getSharedProviderPresetGroups(
  appId: SharedProviderAppId,
): SharedProviderPresetGroup[] {
  const presetsByCategory = new Map<
    SharedProviderPresetCategoryId,
    SharedProviderPreset[]
  >();

  SHARED_PRESET_CATALOG[appId].forEach((preset) => {
    const categoryPresets = presetsByCategory.get(preset.category) ?? [];
    categoryPresets.push(preset);
    presetsByCategory.set(preset.category, categoryPresets);
  });

  return SHARED_PROVIDER_PRESET_CATEGORY_ORDER.flatMap((categoryId) => {
    const presets = presetsByCategory.get(categoryId);

    if (!presets || presets.length === 0) {
      return [];
    }

    return [
      {
        category: getSharedProviderPresetCategory(categoryId),
        presets,
      },
    ];
  });
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
