import type { AppId } from "@/lib/api";
import type { ProviderCategory } from "@/types";

export type SharedProviderAppId = Extract<AppId, "claude" | "codex" | "gemini">;

export type SharedProviderTokenField =
  | "ANTHROPIC_AUTH_TOKEN"
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "GEMINI_API_KEY";

export type SharedProviderPresetCategoryId = Extract<
  ProviderCategory,
  "official" | "cn_official" | "cloud_provider" | "aggregator" | "third_party"
>;

export interface SharedProviderPresetCategory {
  id: SharedProviderPresetCategoryId;
  label: string;
  hint: string;
}

export interface SharedProviderPreset {
  id: string;
  appId: SharedProviderAppId;
  label: string;
  providerName: string;
  baseUrl: string;
  tokenField: SharedProviderTokenField;
  model: string;
  description: string;
  sourcePresetName: string;
  category: SharedProviderPresetCategoryId;
  icon?: string;
  iconColor?: string;
  accentColor?: string;
  supportedOn: {
    desktop: boolean;
    openwrt: boolean;
  };
}

export interface SharedProviderPresetGroup {
  category: SharedProviderPresetCategory;
  presets: SharedProviderPreset[];
}

export interface SharedProviderView {
  configured: boolean;
  providerId: string | null;
  name: string;
  baseUrl: string;
  tokenField: SharedProviderTokenField;
  tokenConfigured: boolean;
  tokenMasked: string;
  model: string;
  notes: string;
  active: boolean;
}

export interface SharedProviderState {
  phase2Available: boolean;
  providers: SharedProviderView[];
  activeProviderId: string | null;
  activeProvider: SharedProviderView;
}

export interface SharedProviderEditorPayload {
  name: string;
  baseUrl: string;
  tokenField: SharedProviderTokenField;
  token: string;
  model: string;
  notes: string;
}

export interface SharedProviderCapabilities {
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canActivate: boolean;
  supportsPresets: boolean;
  supportsBlankSecretPreserve: boolean;
  requiresServiceRestart: boolean;
}
