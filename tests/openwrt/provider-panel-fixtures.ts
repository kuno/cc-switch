import {
  emptySharedProviderEditorPayload,
  emptySharedProviderView,
  getSharedProviderPresets,
  type SharedProviderAppId,
  type SharedProviderClaudeAuthSummary,
  type SharedProviderCodexAuthSummary,
  type SharedProviderEditorPayload,
  type SharedProviderState,
  type SharedProviderTokenField,
  type SharedProviderView,
} from "@/shared/providers/domain";
import {
  getSharedProviderPresetBrowseGroups,
  SHARED_PROVIDER_TOKEN_FIELD_OPTIONS,
} from "@/shared/providers/ui/presentation";
import type { ProviderSidePanelTab } from "@/openwrt-provider-ui/components/ProviderSidePanel";
import type { ProviderSidePanelPresetGroup } from "@/openwrt-provider-ui/components/ProviderSidePanelPresetTab";

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

const DEFAULT_BASE_URL_BY_APP: Record<SharedProviderAppId, string> = {
  claude: "https://api.anthropic.com",
  codex: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const DEFAULT_MODEL_BY_APP: Record<SharedProviderAppId, string> = {
  claude: "claude-sonnet-4-5",
  codex: "gpt-5.4",
  gemini: "gemini-2.5-pro",
};

type ProviderSidePanelCallbacks = {
  onClose: () => void;
  onSearchChange: (search: string) => void;
  onSelectProvider: (providerId: string) => void;
  onAddProvider: () => void;
  onTabChange: (tab: ProviderSidePanelTab) => void;
  onPresetSelect: (presetId: string) => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onWebsiteChange: (website: string) => void;
  onFileSelect: (file: File | null) => void;
  onUploadCodexAuth: () => void;
  onRemoveCodexAuth: () => void;
  onUploadClaudeAuth: () => void;
  onRemoveClaudeAuth: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
};

export interface ProviderSidePanelFixtureOptions {
  appId?: SharedProviderAppId;
  open?: boolean;
  loading?: boolean;
  error?: string | null;
  mode?: "new" | "edit";
  providers?: SharedProviderView[];
  filteredProviders?: SharedProviderView[];
  selectedProviderId?: string | null;
  selectedProvider?: SharedProviderView | null;
  draft?: SharedProviderEditorPayload;
  website?: string;
  tab?: ProviderSidePanelTab;
  search?: string;
  selectedPresetId?: string;
  presetGroups?: ProviderSidePanelPresetGroup[];
  tokenFieldOptions?: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  selectedFileName?: string;
  authPending?: boolean;
  savePending?: boolean;
  deletePending?: boolean;
  activatePending?: boolean;
  canActivate?: boolean;
  canDelete?: boolean;
  canSave?: boolean;
  saveIdle?: boolean;
  footerText?: string;
  callbacks?: Partial<ProviderSidePanelCallbacks>;
}

function buildDraftFromProvider(
  provider: SharedProviderView,
): SharedProviderEditorPayload {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    tokenField: provider.tokenField,
    token: "",
    model: provider.model,
    notes: provider.notes,
    authMode: provider.authMode,
  };
}

function deriveWebsite(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

export function createProviderView(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderView> = {},
): SharedProviderView {
  return {
    ...emptySharedProviderView(appId),
    configured: true,
    providerId: `${appId}-primary`,
    name: `${APP_LABELS[appId]} Primary`,
    baseUrl: DEFAULT_BASE_URL_BY_APP[appId],
    tokenConfigured: true,
    tokenMasked: "********",
    model: DEFAULT_MODEL_BY_APP[appId],
    notes: "",
    active: false,
    ...overrides,
  };
}

export function createProviderDraft(
  appId: SharedProviderAppId,
  overrides: Partial<SharedProviderEditorPayload> = {},
): SharedProviderEditorPayload {
  return {
    ...emptySharedProviderEditorPayload(appId),
    name: `${APP_LABELS[appId]} Primary`,
    baseUrl: DEFAULT_BASE_URL_BY_APP[appId],
    model: DEFAULT_MODEL_BY_APP[appId],
    notes: "",
    ...overrides,
  };
}

export function createProviderState(
  appId: SharedProviderAppId,
  providers: SharedProviderView[],
  activeProviderId: string | null = providers.find((provider) => provider.active)
    ?.providerId ?? null,
  phase2Available = true,
): SharedProviderState {
  const normalizedProviders = providers.map((provider) => ({
    ...provider,
    active:
      Boolean(activeProviderId) &&
      provider.providerId === activeProviderId,
  }));
  const activeProvider =
    normalizedProviders.find(
      (provider) => provider.providerId === activeProviderId,
    ) ?? emptySharedProviderView(appId);

  return {
    phase2Available,
    providers: normalizedProviders,
    activeProviderId,
    activeProvider,
  };
}

export function createCodexAuthSummary(
  overrides: Partial<SharedProviderCodexAuthSummary> = {},
): SharedProviderCodexAuthSummary {
  return {
    accountId: "acct-openwrt",
    expiresAt: 1_790_000_000,
    refreshTokenPresent: true,
    ...overrides,
  };
}

export function createClaudeAuthSummary(
  overrides: Partial<SharedProviderClaudeAuthSummary> = {},
): SharedProviderClaudeAuthSummary {
  return {
    expiresAtMs: 1_790_000_000_000,
    scopes: ["user:profile", "user:inference"],
    refreshTokenPresent: true,
    subscriptionType: "pro",
    ...overrides,
  };
}

export function createPresetGroups(
  appId: SharedProviderAppId,
): ProviderSidePanelPresetGroup[] {
  return getSharedProviderPresetBrowseGroups(
    appId,
    getSharedProviderPresets(appId),
  ).map((group) => ({
    id: group.id,
    label: group.label,
    hint: group.hint,
    presets: group.presets,
  }));
}

export function createProviderSidePanelProps(
  options: ProviderSidePanelFixtureOptions = {},
) {
  const appId = options.appId ?? "claude";
  const defaultSelectedProvider = createProviderView(appId, {
    active: true,
    notes: "Pinned for router traffic",
  });
  const providers = options.providers ?? [defaultSelectedProvider];
  const selectedProvider =
    Object.prototype.hasOwnProperty.call(options, "selectedProvider")
      ? (options.selectedProvider ?? null)
      : providers.find(
            (provider) => provider.providerId === options.selectedProviderId,
          ) ??
          providers.find((provider) => provider.active) ??
          providers[0] ??
          null;
  const mode =
    options.mode ?? (selectedProvider?.providerId ? "edit" : "new");
  const draft =
    options.draft ??
    (selectedProvider
      ? buildDraftFromProvider(selectedProvider)
      : createProviderDraft(appId, {
          name: "",
          baseUrl: "",
          model: "",
          notes: "",
        }));
  const noopCallbacks: ProviderSidePanelCallbacks = {
    onClose: () => {},
    onSearchChange: () => {},
    onSelectProvider: () => {},
    onAddProvider: () => {},
    onTabChange: () => {},
    onPresetSelect: () => {},
    onDraftChange: () => {},
    onWebsiteChange: () => {},
    onFileSelect: () => {},
    onUploadCodexAuth: () => {},
    onRemoveCodexAuth: () => {},
    onUploadClaudeAuth: () => {},
    onRemoveClaudeAuth: () => {},
    onActivate: () => {},
    onDelete: () => {},
    onCancel: () => {},
    onSave: () => {},
  };
  const callbacks = {
    ...noopCallbacks,
    ...options.callbacks,
  };

  return {
    appId,
    open: options.open ?? true,
    loading: options.loading ?? false,
    error: options.error ?? null,
    mode,
    providers,
    filteredProviders: options.filteredProviders ?? providers,
    selectedProviderId: Object.prototype.hasOwnProperty.call(
      options,
      "selectedProviderId",
    )
      ? (options.selectedProviderId ?? null)
      : selectedProvider?.providerId ?? null,
    selectedProvider,
    draft,
    website: options.website ?? deriveWebsite(draft.baseUrl),
    tab: options.tab ?? "general",
    search: options.search ?? "",
    selectedPresetId: options.selectedPresetId ?? "custom",
    presetGroups: options.presetGroups ?? createPresetGroups(appId),
    tokenFieldOptions:
      options.tokenFieldOptions ?? [...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS[appId]],
    selectedFileName: options.selectedFileName ?? "",
    authPending: options.authPending ?? false,
    savePending: options.savePending ?? false,
    deletePending: options.deletePending ?? false,
    activatePending: options.activatePending ?? false,
    canActivate: options.canActivate ?? false,
    canDelete: options.canDelete ?? (mode === "edit" && Boolean(selectedProvider)),
    canSave: options.canSave ?? true,
    saveIdle: options.saveIdle ?? false,
    footerText:
      options.footerText ??
      (mode === "new"
        ? `Create a new ${APP_LABELS[appId]} route from this draft.`
        : selectedProvider?.active
          ? "Editing the active provider route."
          : `Editing ${selectedProvider?.name || selectedProvider?.providerId || "saved provider"}.`),
    ...callbacks,
  };
}
