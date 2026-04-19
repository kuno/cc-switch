import type {
  SharedProviderAppId,
  SharedProviderCapabilities,
  SharedProviderTokenField,
  SharedProviderView,
} from "../domain";

export const SHARED_PROVIDER_APP_PRESENTATION: Record<
  SharedProviderAppId,
  {
    label: string;
    accentClassName: string;
    chipClassName: string;
    activeCardClassName: string;
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
  },
  codex: {
    label: "Codex",
    accentClassName:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    chipClassName:
      "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    activeCardClassName:
      "border-emerald-500/40 bg-emerald-500/[0.08] shadow-sm shadow-emerald-500/10",
  },
  gemini: {
    label: "Gemini",
    accentClassName:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    chipClassName:
      "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    activeCardClassName:
      "border-blue-500/40 bg-blue-500/[0.08] shadow-sm shadow-blue-500/10",
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
  edit: boolean;
  activate: boolean;
  delete: boolean;
}

export function getSharedProviderDisplayName(
  provider: SharedProviderView,
): string {
  return provider.name || provider.providerId || "Provider";
}

export function getSharedProviderCardActionVisibility(
  capabilities: SharedProviderCapabilities,
  provider: SharedProviderView,
): SharedProviderCardActionVisibility {
  return {
    edit: capabilities.canEdit,
    activate:
      capabilities.canActivate &&
      Boolean(provider.providerId) &&
      !provider.active,
    delete: capabilities.canDelete,
  };
}
