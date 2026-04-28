import type { SharedProviderPreset } from "@/shared/providers/domain";

export type PresetUiTag =
  | "official"
  | "open_source"
  | "aggregator"
  | "third_party"
  | "universal"
  | "custom"
  | "partner";

export type PresetUiBadgeTone = "warn" | "accent" | "success" | "neutral";

export type PresetUiVariant = "default" | "partner" | "universal" | "custom";

export interface PresetUiBadge {
  label: string;
  tone: PresetUiBadgeTone;
}

export interface PresetUiMeta {
  tags: PresetUiTag[];
  badges: PresetUiBadge[];
  tone: PresetUiBadgeTone;
  variant: PresetUiVariant;
  promoLabel?: string;
}

export const PRESET_UI_TAG_LABELS: Record<PresetUiTag, string> = {
  official: "Official",
  open_source: "Open-source",
  aggregator: "Aggregator",
  third_party: "Third Party",
  universal: "Universal",
  custom: "Custom",
  partner: "Partner",
};

const CATEGORY_UI_META: Record<
  string,
  Pick<PresetUiMeta, "tags" | "badges" | "tone">
> = {
  official: {
    tags: ["official"],
    badges: [{ label: "Official", tone: "warn" }],
    tone: "warn",
  },
  cn_official: {
    tags: ["official"],
    badges: [{ label: "Official", tone: "warn" }],
    tone: "warn",
  },
  cloud_provider: {
    tags: ["third_party"],
    badges: [{ label: "Cloud", tone: "accent" }],
    tone: "accent",
  },
  aggregator: {
    tags: ["aggregator"],
    badges: [{ label: "Aggregator", tone: "accent" }],
    tone: "accent",
  },
  third_party: {
    tags: ["third_party"],
    badges: [{ label: "Third Party", tone: "neutral" }],
    tone: "neutral",
  },
  open_source: {
    tags: ["open_source"],
    badges: [{ label: "Open-source", tone: "neutral" }],
    tone: "neutral",
  },
  "open-source": {
    tags: ["open_source"],
    badges: [{ label: "Open-source", tone: "neutral" }],
    tone: "neutral",
  },
  universal: {
    tags: ["universal"],
    badges: [{ label: "Universal", tone: "success" }],
    tone: "success",
  },
  custom: {
    tags: ["custom"],
    badges: [{ label: "Custom", tone: "neutral" }],
    tone: "neutral",
  },
};

type PresetWithUiHints = SharedProviderPreset & {
  isPartner?: boolean;
  partner?: boolean;
  promoLabel?: string;
  supportsAppIds?: string[];
};

function hasUniversalSupport(preset: PresetWithUiHints): boolean {
  return (
    Array.isArray(preset.supportsAppIds) && preset.supportsAppIds.length > 1
  );
}

function isPartnerPreset(preset: PresetWithUiHints): boolean {
  return preset.isPartner === true || preset.partner === true;
}

function copyCategoryMeta(
  category: string,
): Pick<PresetUiMeta, "tags" | "badges" | "tone"> {
  const meta = CATEGORY_UI_META[category] ?? CATEGORY_UI_META.third_party;

  return {
    tags: [...meta.tags],
    badges: meta.badges.map((badge) => ({ ...badge })),
    tone: meta.tone,
  };
}

export function getCustomPresetUiMeta(): PresetUiMeta {
  return {
    ...copyCategoryMeta("custom"),
    variant: "custom",
  };
}

export function getPresetUiMeta(preset: SharedProviderPreset): PresetUiMeta {
  const presetWithHints = preset as PresetWithUiHints;
  const category = String(preset.category);
  const promoLabel = presetWithHints.promoLabel?.trim() || undefined;

  if (isPartnerPreset(presetWithHints)) {
    return {
      tags: ["partner", "third_party"],
      badges: [
        { label: "Partner", tone: "accent" },
        ...(promoLabel ? [{ label: promoLabel, tone: "accent" as const }] : []),
      ],
      tone: "accent",
      variant: "partner",
      promoLabel,
    };
  }

  if (hasUniversalSupport(presetWithHints) || category === "universal") {
    return {
      ...copyCategoryMeta("universal"),
      variant: "universal",
      promoLabel,
    };
  }

  return {
    ...copyCategoryMeta(category),
    variant: "default",
    promoLabel,
  };
}
