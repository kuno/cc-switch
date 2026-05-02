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
import type {
  OpenWrtPageMessage,
  OpenWrtSharedPageShellApi,
} from "@/openwrt-provider-ui/pageTypes";
import type { ProviderSidePanelPresetGroup } from "@/openwrt-provider-ui/components/ProviderSidePanelPresetTab";
import { createBridgeFixture } from "./component/fixtures/bridge";

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
  onEdit: () => void;
  onPasteAuth: () => void;
  onClearAuth: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onToggleAppAutoFailover: (enabled: boolean) => void;
  onToggleProviderFailoverQueue: (inQueue: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
};

export interface ProviderSidePanelFixtureOptions {
  appId?: SharedProviderAppId;
  open?: boolean;
  loading?: boolean;
  error?: string | null;
  mode?: "new" | "edit";
  editing?: boolean;
  panelMode?: "detail" | "preset-picker";
  providers?: SharedProviderView[];
  filteredProviders?: SharedProviderView[];
  selectedProviderId?: string | null;
  selectedProvider?: SharedProviderView | null;
  draft?: SharedProviderEditorPayload;
  shell?: OpenWrtSharedPageShellApi;
  website?: string;
  tab?: ProviderSidePanelTab;
  search?: string;
  message?: OpenWrtPageMessage | null;
  selectedPresetId?: string | null;
  presetGroups?: ProviderSidePanelPresetGroup[];
  tokenFieldOptions?: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  savePending?: boolean;
  activatePending?: boolean;
  deletePending?: boolean;
  canActivate?: boolean;
  canDelete?: boolean;
  canSave?: boolean;
  saveIdle?: boolean;
  failoverControlsAvailable?: boolean;
  failoverControlsReady?: boolean;
  failoverControlsLoading?: boolean;
  appAutoFailoverEnabled?: boolean;
  appFailoverPending?: boolean;
  providerInFailoverQueue?: boolean;
  providerFailoverPending?: boolean;
  footerText?: string;
  callbacks?: Partial<ProviderSidePanelCallbacks>;
}

function buildDraftFromProvider(
  provider: SharedProviderView,
): SharedProviderEditorPayload {
  return {
    authContent: null,
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
  activeProviderId: string | null = providers.find(
    (provider) => provider.active,
  )?.providerId ?? null,
  phase2Available = true,
): SharedProviderState {
  const normalizedProviders = providers.map((provider) => ({
    ...provider,
    active:
      Boolean(activeProviderId) && provider.providerId === activeProviderId,
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
  const selectedProvider = Object.prototype.hasOwnProperty.call(
    options,
    "selectedProvider",
  )
    ? (options.selectedProvider ?? null)
    : (providers.find(
        (provider) => provider.providerId === options.selectedProviderId,
      ) ??
      providers.find((provider) => provider.active) ??
      providers[0] ??
      null);
  const mode = options.mode ?? (selectedProvider?.providerId ? "edit" : "new");
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
    onEdit: () => {},
    onPasteAuth: () => {},
    onClearAuth: () => {},
    onActivate: () => {},
    onDelete: () => {},
    onToggleAppAutoFailover: () => {},
    onToggleProviderFailoverQueue: () => {},
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
    shell: options.shell ?? createBridgeFixture({ selectedApp: appId }),
    loading: options.loading ?? false,
    error: options.error ?? null,
    mode,
    editing: options.editing ?? mode === "new",
    panelMode: options.panelMode ?? "detail",
    providers,
    filteredProviders: options.filteredProviders ?? providers,
    selectedProviderId: Object.prototype.hasOwnProperty.call(
      options,
      "selectedProviderId",
    )
      ? (options.selectedProviderId ?? null)
      : (selectedProvider?.providerId ?? null),
    selectedProvider,
    draft,
    website: options.website ?? deriveWebsite(draft.baseUrl),
    tab: options.tab ?? (mode === "edit" ? "configure" : "configure"),
    search: options.search ?? "",
    message: options.message ?? null,
    selectedPresetId: options.selectedPresetId ?? "custom",
    presetGroups: options.presetGroups ?? createPresetGroups(appId),
    tokenFieldOptions: options.tokenFieldOptions ?? [
      ...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS[appId],
    ],
    savePending: options.savePending ?? false,
    activatePending: options.activatePending ?? false,
    deletePending: options.deletePending ?? false,
    canActivate:
      options.canActivate ??
      (mode === "edit" &&
        !Boolean(options.editing) &&
        Boolean(selectedProvider?.providerId) &&
        !selectedProvider?.active),
    canDelete:
      options.canDelete ?? (mode === "edit" && Boolean(selectedProvider)),
    canSave: options.canSave ?? true,
    saveIdle: options.saveIdle ?? false,
    failoverControlsAvailable: options.failoverControlsAvailable ?? false,
    failoverControlsReady: options.failoverControlsReady ?? false,
    failoverControlsLoading: options.failoverControlsLoading ?? false,
    appAutoFailoverEnabled: options.appAutoFailoverEnabled ?? false,
    appFailoverPending: options.appFailoverPending ?? false,
    providerInFailoverQueue: options.providerInFailoverQueue ?? false,
    providerFailoverPending: options.providerFailoverPending ?? false,
    footerText:
      options.footerText ??
      (mode === "new" ? "New provider · not saved" : "Unsaved changes"),
    ...callbacks,
  };
}
