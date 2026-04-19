import type {
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderPreset,
  SharedProviderTokenField,
  SharedProviderView,
} from "../domain";
import {
  getSharedProviderPresetById,
  inferSharedProviderPresetId,
} from "../domain";

type PresetGroupId = "official" | "platform" | "compatible";

const PRESET_GROUP_META: Record<
  PresetGroupId,
  { label: string; hint: string }
> = {
  official: {
    label: "Official",
    hint: "Direct vendor endpoints with the default auth shape for this app.",
  },
  platform: {
    label: "Platform templates",
    hint: "Managed cloud templates that usually need account-specific endpoint values.",
  },
  compatible: {
    label: "Compatible gateways",
    hint: "Third-party or proxy-compatible endpoints that fill the draft locally before save.",
  },
};

export const SHARED_PROVIDER_APP_PRESENTATION: Record<
  SharedProviderAppId,
  {
    label: string;
    accentClassName: string;
    chipClassName: string;
    activeCardClassName: string;
    accentBarClassName: string;
    panelClassName: string;
  }
> = {
  claude: {
    label: "Claude",
    accentClassName:
      "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    chipClassName:
      "bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
    activeCardClassName:
      "border-orange-500/40 bg-orange-500/[0.08] shadow-sm shadow-orange-500/10",
    accentBarClassName:
      "bg-gradient-to-r from-orange-400/90 via-orange-500/80 to-amber-400/90",
    panelClassName:
      "border-orange-500/25 bg-orange-500/[0.08] shadow-sm shadow-orange-500/10",
  },
  codex: {
    label: "Codex",
    accentClassName:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    chipClassName:
      "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    activeCardClassName:
      "border-emerald-500/40 bg-emerald-500/[0.08] shadow-sm shadow-emerald-500/10",
    accentBarClassName:
      "bg-gradient-to-r from-emerald-400/90 via-emerald-500/80 to-teal-400/90",
    panelClassName:
      "border-emerald-500/25 bg-emerald-500/[0.08] shadow-sm shadow-emerald-500/10",
  },
  gemini: {
    label: "Gemini",
    accentClassName:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    chipClassName:
      "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    activeCardClassName:
      "border-blue-500/40 bg-blue-500/[0.08] shadow-sm shadow-blue-500/10",
    accentBarClassName:
      "bg-gradient-to-r from-sky-400/90 via-blue-500/80 to-indigo-400/90",
    panelClassName:
      "border-blue-500/25 bg-blue-500/[0.08] shadow-sm shadow-blue-500/10",
  },
};

export const SHARED_PROVIDER_TOKEN_FIELD_OPTIONS: Record<
  SharedProviderAppId,
  Array<{ value: SharedProviderTokenField; label: string }>
> = {
  claude: [
    {
      value: "ANTHROPIC_AUTH_TOKEN",
      label: "ANTHROPIC_AUTH_TOKEN",
    },
    {
      value: "ANTHROPIC_API_KEY",
      label: "ANTHROPIC_API_KEY",
    },
  ],
  codex: [
    {
      value: "OPENAI_API_KEY",
      label: "OPENAI_API_KEY",
    },
  ],
  gemini: [
    {
      value: "GEMINI_API_KEY",
      label: "GEMINI_API_KEY",
    },
  ],
};

export interface SharedProviderCardActionVisibility {
  duplicate: boolean;
  edit: boolean;
  activate: boolean;
  delete: boolean;
}

export interface SharedProviderActionVisibilityOptions {
  selected?: boolean;
}

export interface SharedProviderPresetBrowseGroup {
  id: PresetGroupId;
  label: string;
  hint: string;
  presets: SharedProviderPreset[];
}

function getPresetGroupId(
  appId: SharedProviderAppId,
  preset: SharedProviderPreset,
): PresetGroupId {
  const normalized =
    `${preset.id} ${preset.label} ${preset.description}`.toLowerCase();

  if (normalized.includes("azure")) {
    return "platform";
  }

  const officialHostByApp: Record<SharedProviderAppId, string> = {
    claude: "api.anthropic.com",
    codex: "api.openai.com",
    gemini: "generativelanguage.googleapis.com",
  };

  if (
    normalized.includes("official") ||
    preset.baseUrl.toLowerCase().includes(officialHostByApp[appId])
  ) {
    return "official";
  }

  return "compatible";
}

export function getSharedProviderDisplayName(
  provider: SharedProviderView,
): string {
  return provider.name || provider.providerId || "Provider";
}

export function getSharedProviderMatchedPreset(
  appId: SharedProviderAppId,
  provider: SharedProviderView,
): SharedProviderPreset | null {
  const presetId = inferSharedProviderPresetId(appId, provider);

  if (presetId === "custom") {
    return null;
  }

  return getSharedProviderPresetById(appId, presetId);
}

export function getSharedProviderPresetBrowseGroups(
  appId: SharedProviderAppId,
  presets: SharedProviderPreset[],
): SharedProviderPresetBrowseGroup[] {
  const grouped: Record<PresetGroupId, SharedProviderPreset[]> = {
    official: [],
    platform: [],
    compatible: [],
  };

  for (const preset of presets) {
    grouped[getPresetGroupId(appId, preset)].push(preset);
  }

  return (Object.keys(PRESET_GROUP_META) as PresetGroupId[])
    .map((groupId) => ({
      id: groupId,
      label: PRESET_GROUP_META[groupId].label,
      hint: PRESET_GROUP_META[groupId].hint,
      presets: grouped[groupId],
    }))
    .filter((group) => group.presets.length > 0);
}

export function getSharedProviderCardActionVisibility(
  capabilities: SharedProviderCapabilities,
  provider: SharedProviderView,
  options: SharedProviderActionVisibilityOptions = {},
): SharedProviderCardActionVisibility {
  const selected = options.selected ?? false;

  return {
    duplicate: capabilities.canAdd && !selected,
    edit: capabilities.canEdit,
    activate:
      capabilities.canActivate &&
      Boolean(provider.providerId) &&
      !provider.active,
    delete: capabilities.canDelete,
  };
}
