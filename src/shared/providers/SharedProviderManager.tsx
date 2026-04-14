import {
  type FormEvent,
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  emptySharedProviderEditorPayload,
  getSharedProviderPresetById,
  getSharedProviderPresets,
  inferSharedProviderPresetId,
  OPENWRT_SUPPORTED_PROVIDER_APPS,
  supportsProviderFailoverControls,
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderEditorPayload,
  type SharedProviderFailoverState,
  type SharedProviderState,
  type SharedProviderView,
} from "./domain";
import type {
  SharedProviderManagerProps,
  SharedProviderMutationAction,
  SharedProviderMutationEvent,
  SharedProviderShellState,
} from "./managerTypes";
import {
  SharedProviderCard,
  SharedProviderDetailPanel,
  SharedProviderEditorPanel,
  SharedProviderToolbar,
} from "./ui";
import { filterSharedProviders } from "./ui/search";
import {
  getSharedProviderCardActionVisibility,
  getSharedProviderDisplayName,
  getSharedProviderMatchedPreset,
  getSharedProviderPresetBrowseGroups,
  SHARED_PROVIDER_APP_PRESENTATION,
} from "./ui/presentation";

type Notice = {
  tone: "success" | "warning" | "error";
  title: string;
  description: string;
};

type SaveMutationVariables = {
  appId: SharedProviderAppId;
  providerId?: string;
  providerName: string;
  requiresServiceRestart: boolean;
  draft: SharedProviderEditorPayload;
};

type ProviderMutationVariables = {
  appId: SharedProviderAppId;
  providerId: string;
  providerName: string;
  requiresServiceRestart: boolean;
};

const FALLBACK_CAPABILITIES: SharedProviderCapabilities = {
  canAdd: true,
  canEdit: true,
  canDelete: true,
  canActivate: true,
  supportsPresets: true,
  supportsBlankSecretPreserve: true,
  requiresServiceRestart: true,
};

const TOKEN_FIELD_OPTIONS = {
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
} as const;

function stateQueryKey(appId: SharedProviderAppId) {
  return ["shared-provider-manager", "state", appId] as const;
}

function capabilitiesQueryKey(appId: SharedProviderAppId) {
  return ["shared-provider-manager", "capabilities", appId] as const;
}

function failoverQueryKey(appId: SharedProviderAppId, providerId: string) {
  return ["shared-provider-manager", "failover", appId, providerId] as const;
}

function createSelectedProviderState(): Record<SharedProviderAppId, string | null> {
  return {
    claude: null,
    codex: null,
    gemini: null,
  };
}

function createDetailTabState(): Record<
  SharedProviderAppId,
  "general" | "failover" | "credentials"
> {
  return {
    claude: "general",
    codex: "general",
    gemini: "general",
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

function getDefaultPresetId(appId: SharedProviderAppId): string {
  return getSharedProviderPresets(appId)[0]?.id ?? "custom";
}

function createDraftFromPreset(
  appId: SharedProviderAppId,
  presetId: string,
): SharedProviderEditorPayload {
  const draft = emptySharedProviderEditorPayload(appId);

  if (presetId === "custom") {
    return draft;
  }

  const preset = getSharedProviderPresetById(appId, presetId);

  if (!preset) {
    return draft;
  }

  return {
    ...draft,
    name: preset.providerName,
    baseUrl: preset.baseUrl,
    tokenField: preset.tokenField,
    model: preset.model,
  };
}

function applyPresetToDraft(
  appId: SharedProviderAppId,
  presetId: string,
  draft: SharedProviderEditorPayload,
): SharedProviderEditorPayload {
  if (presetId === "custom") {
    return draft;
  }

  const preset = getSharedProviderPresetById(appId, presetId);

  if (!preset) {
    return draft;
  }

  return {
    ...draft,
    name: preset.providerName,
    baseUrl: preset.baseUrl,
    tokenField: preset.tokenField,
    model: preset.model,
  };
}

function createDraftFromProvider(
  provider: SharedProviderView,
): SharedProviderEditorPayload {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    tokenField: provider.tokenField,
    token: "",
    model: provider.model,
    notes: provider.notes,
  };
}

function createDuplicateProviderName(
  providerName: string,
  providers: SharedProviderView[],
): string {
  const baseName = providerName.trim() || "Provider";
  const copyBaseName = `${baseName} copy`;
  const existingNames = new Set(
    providers
      .map((provider) => provider.name.trim().toLowerCase())
      .filter(Boolean),
  );

  if (!existingNames.has(copyBaseName.toLowerCase())) {
    return copyBaseName;
  }

  let suffix = 2;
  let candidate = `${copyBaseName} ${suffix}`;

  while (existingNames.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${copyBaseName} ${suffix}`;
  }

  return candidate;
}

function createDuplicateDraftFromProvider(
  provider: SharedProviderView,
  providers: SharedProviderView[],
): SharedProviderEditorPayload {
  return {
    ...createDraftFromProvider(provider),
    name: createDuplicateProviderName(
      getSharedProviderDisplayName(provider),
      providers,
    ),
    token: "",
  };
}

function getMutationVerb(action: SharedProviderMutationAction): string {
  if (action === "saved") {
    return "saved";
  }

  if (action === "activated") {
    return "activated";
  }

  return "deleted";
}

function buildSuccessNotice(
  event: SharedProviderMutationEvent,
  shellState?: SharedProviderShellState,
): Notice {
  const providerName = event.providerName || "Provider";
  const verb = getMutationVerb(event.action);
  const title =
    event.action === "saved"
      ? "Provider saved."
      : event.action === "activated"
        ? "Provider activated."
        : "Provider deleted.";

  if (!event.requiresServiceRestart) {
    return {
      tone: "success",
      title,
      description: `${providerName} was ${verb}. Changes are available immediately.`,
    };
  }

  let description = `${providerName} was ${verb}. Restart the service to apply provider changes.`;

  if (shellState?.restartInFlight) {
    description += " A service restart is already in progress.";
  } else if (shellState?.restartPending) {
    description += " A service restart is still pending.";
  } else {
    description += " Use the LuCI restart control when ready.";
  }

  if (shellState?.serviceName?.trim()) {
    description += ` Service: ${shellState.serviceName.trim()}.`;
  }

  if (shellState?.serviceStatusLabel) {
    description += ` Current service status: ${shellState.serviceStatusLabel}.`;
  }

  return {
    tone: "warning",
    title,
    description,
  };
}

function buildErrorNotice(action: string, error: unknown): Notice {
  return {
    tone: "error",
    title: `${action} failed.`,
    description: getErrorMessage(error),
  };
}

function trimDraft(
  draft: SharedProviderEditorPayload,
): SharedProviderEditorPayload {
  return {
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    tokenField: draft.tokenField,
    token: draft.token.trim(),
    model: draft.model.trim(),
    notes: draft.notes.trim(),
  };
}

function createSearchState(): Record<SharedProviderAppId, string> {
  return {
    claude: "",
    codex: "",
    gemini: "",
  };
}

function getProviderRegionDescription(
  appId: SharedProviderAppId,
  state: SharedProviderState | undefined,
  capabilities: SharedProviderCapabilities | undefined,
): string {
  if (!state || !capabilities) {
    return "Manage saved providers for Claude, Codex, and Gemini from one shared OpenWrt surface.";
  }

  if (!state.phase2Available) {
    return "LuCI fallback mode is active for this app. Saved providers stay visible, but some actions may be limited.";
  }

  if (!capabilities.canAdd && !capabilities.canEdit) {
    return `${SHARED_PROVIDER_APP_PRESENTATION[appId].label} providers stay visible here, but this surface is read-only for provider changes on this router.`;
  }

  if (!capabilities.canAdd) {
    return `Saved ${SHARED_PROVIDER_APP_PRESENTATION[appId].label} providers stay editable here, but adding a provider is unavailable on this router.`;
  }

  return "Review saved providers and use the actions available for this router.";
}

function LoadingState() {
  return (
    <div className="ccswitch-openwrt-state-shell space-y-4 rounded-2xl border border-dashed border-border-default bg-muted/10 p-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p>Loading provider settings...</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="ccswitch-openwrt-group ccswitch-openwrt-group--raised space-y-3 rounded-2xl border border-border-default/70 bg-background p-4"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="h-16 animate-pulse rounded-2xl bg-muted" />
              <div className="h-16 animate-pulse rounded-2xl bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ccswitch-openwrt-state-shell ccswitch-openwrt-state-shell--warning flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-destructive/40 px-6 text-center">
      <div className="rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Could not load provider settings.</p>
        <p className="text-sm text-muted-foreground">
          Retry after the OpenWrt service or RPC bridge is available again.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyState({
  appId,
  canAdd,
  onAdd,
}: {
  appId: SharedProviderAppId;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="ccswitch-openwrt-state-shell flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Plus className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">
          No {SHARED_PROVIDER_APP_PRESENTATION[appId].label} providers saved.
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {canAdd
            ? "Save a provider to start routing this app through the router."
            : "This router can show saved providers here, but adding a provider is unavailable."}
        </p>
      </div>
      {canAdd ? (
        <Button type="button" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add provider
        </Button>
      ) : null}
    </div>
  );
}

function SearchEmptyState({
  searchQuery,
  onClear,
}: {
  searchQuery: string;
  onClear: () => void;
}) {
  return (
    <div className="ccswitch-openwrt-state-shell flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">No saved providers match "{searchQuery}".</p>
        <p className="text-sm text-muted-foreground">
          Clear the search to review every saved provider again.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onClear}>
        Clear search
      </Button>
    </div>
  );
}

export function SharedProviderManager({
  adapter,
  appIds = OPENWRT_SUPPORTED_PROVIDER_APPS,
  selectedApp,
  defaultApp,
  onSelectedAppChange,
  onRestartRequired,
  shellState,
  className,
}: SharedProviderManagerProps) {
  const initialApp = selectedApp ?? defaultApp ?? appIds[0] ?? "claude";
  const [internalApp, setInternalApp] =
    useState<SharedProviderAppId>(initialApp);
  const [searchByApp, setSearchByApp] = useState(createSearchState);
  const [selectedProviderByApp, setSelectedProviderByApp] = useState(
    createSelectedProviderState,
  );
  const [detailTabByApp, setDetailTabByApp] = useState(createDetailTabState);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    getDefaultPresetId(initialApp),
  );
  const [editingProvider, setEditingProvider] =
    useState<SharedProviderView | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SharedProviderEditorPayload>(
    createDraftFromPreset(initialApp, getDefaultPresetId(initialApp)),
  );
  const [pendingDelete, setPendingDelete] = useState<SharedProviderView | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const appSwitchRefs = useRef<
    Partial<Record<SharedProviderAppId, HTMLButtonElement | null>>
  >({});
  const editorInitialFocusRef = useRef<HTMLInputElement | null>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const editorRestoreFocusRef = useRef<HTMLElement | null>(null);
  const deleteRestoreFocusRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const currentApp = selectedApp ?? internalApp;
  const currentAppRef = useRef(currentApp);
  const previousAppRef = useRef(currentApp);
  const searchQuery = searchByApp[currentApp] ?? "";
  const deferredSearchQuery = useDeferredValue(searchQuery);

  currentAppRef.current = currentApp;

  const stateQuery = useQuery({
    queryKey: stateQueryKey(currentApp),
    queryFn: () => adapter.listProviderState(currentApp),
  });

  const capabilitiesQuery = useQuery({
    queryKey: capabilitiesQueryKey(currentApp),
    queryFn: () => adapter.getCapabilities(currentApp),
  });

  const saveMutation = useMutation({
    mutationFn: async (variables: SaveMutationVariables) => {
      await adapter.saveProvider(
        variables.appId,
        variables.draft,
        variables.providerId,
      );
    },
    onSuccess: async (_, variables) => {
      const event: SharedProviderMutationEvent = {
        action: "saved",
        appId: variables.appId,
        providerId: variables.providerId ?? null,
        providerName: variables.providerName,
        requiresServiceRestart: variables.requiresServiceRestart,
      };
      const isCurrentApp = currentAppRef.current === variables.appId;

      await queryClient.invalidateQueries({
        queryKey: stateQueryKey(variables.appId),
      });

      if (isCurrentApp) {
        resetEditorForApp(variables.appId);
        setPendingDelete(null);
        setNotice(buildSuccessNotice(event, shellState));
        restoreFocus(editorRestoreFocusRef, () => getCurrentAppSwitchButton());
      }

      if (variables.requiresServiceRestart) {
        onRestartRequired?.(event);
      }
    },
    onError: (error, variables) => {
      if (currentAppRef.current !== variables.appId) {
        return;
      }

      setNotice(buildErrorNotice("Save", error));
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (variables: ProviderMutationVariables) => {
      await adapter.activateProvider(variables.appId, variables.providerId);
    },
    onSuccess: async (_, variables) => {
      const event: SharedProviderMutationEvent = {
        action: "activated",
        appId: variables.appId,
        providerId: variables.providerId,
        providerName: variables.providerName,
        requiresServiceRestart: variables.requiresServiceRestart,
      };

      await queryClient.invalidateQueries({
        queryKey: stateQueryKey(variables.appId),
      });

      if (currentAppRef.current === variables.appId) {
        setNotice(buildSuccessNotice(event, shellState));
      }

      if (variables.requiresServiceRestart) {
        onRestartRequired?.(event);
      }
    },
    onError: (error, variables) => {
      if (currentAppRef.current !== variables.appId) {
        return;
      }

      setNotice(buildErrorNotice("Activate", error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (variables: ProviderMutationVariables) => {
      await adapter.deleteProvider(variables.appId, variables.providerId);
    },
    onSuccess: async (_, variables) => {
      const event: SharedProviderMutationEvent = {
        action: "deleted",
        appId: variables.appId,
        providerId: variables.providerId,
        providerName: variables.providerName,
        requiresServiceRestart: variables.requiresServiceRestart,
      };
      const isCurrentApp = currentAppRef.current === variables.appId;

      await queryClient.invalidateQueries({
        queryKey: stateQueryKey(variables.appId),
      });

      if (isCurrentApp) {
        if (
          editingProvider?.providerId &&
          editingProvider.providerId === variables.providerId
        ) {
          resetEditorForApp(variables.appId);
        }

        setPendingDelete(null);
        setNotice(buildSuccessNotice(event, shellState));
        restoreFocus(deleteRestoreFocusRef, () => getCurrentAppSwitchButton());
      }

      if (variables.requiresServiceRestart) {
        onRestartRequired?.(event);
      }
    },
    onError: (error, variables) => {
      if (currentAppRef.current !== variables.appId) {
        return;
      }

      setNotice(buildErrorNotice("Delete", error));
    },
  });

  const isRegionLoading =
    (stateQuery.data == null || capabilitiesQuery.data == null) &&
    !(stateQuery.error || capabilitiesQuery.error);
  const hasRegionError = Boolean(stateQuery.error || capabilitiesQuery.error);
  const capabilities = capabilitiesQuery.data ?? FALLBACK_CAPABILITIES;
  const state = stateQuery.data;
  const filteredProviders =
    state != null
      ? filterSharedProviders(currentApp, state.providers, deferredSearchQuery)
      : [];
  const hasProviders = state != null && state.providers.length > 0;
  const selectedPreset =
    selectedPresetId === "custom"
      ? null
      : getSharedProviderPresetById(currentApp, selectedPresetId);
  const presetGroups = getSharedProviderPresetBrowseGroups(
    currentApp,
    getSharedProviderPresets(currentApp),
  );
  const tokenFieldOptions = TOKEN_FIELD_OPTIONS[currentApp];
  const currentPresentation = SHARED_PROVIDER_APP_PRESENTATION[currentApp];
  const currentActiveProvider =
    state?.providers.find((provider) => provider.active) ?? null;
  const selectedProvider =
    (state &&
      filteredProviders.find(
        (provider) => provider.providerId === selectedProviderByApp[currentApp],
      )) ??
    currentActiveProvider ??
    filteredProviders[0] ??
    null;
  const isRefreshing = stateQuery.isFetching || capabilitiesQuery.isFetching;
  const supportsFailoverControls = supportsProviderFailoverControls(adapter);

  const failoverQuery = useQuery({
    queryKey: failoverQueryKey(currentApp, selectedProvider?.providerId ?? ""),
    queryFn: () =>
      adapter.getProviderFailoverState!(
        currentApp,
        selectedProvider!.providerId!,
      ),
    enabled:
      supportsFailoverControls &&
      Boolean(selectedProvider?.providerId) &&
      detailTabByApp[currentApp] === "failover",
  });

  const addToFailoverQueueMutation = useMutation({
    mutationFn: async (variables: {
      appId: SharedProviderAppId;
      providerId: string;
    }) => adapter.addToFailoverQueue!(variables.appId, variables.providerId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stateQueryKey(variables.appId) }),
        queryClient.invalidateQueries({
          queryKey: failoverQueryKey(variables.appId, variables.providerId),
        }),
      ]);
    },
    onError: (error) => setNotice(buildErrorNotice("Add to failover queue", error)),
  });

  const removeFromFailoverQueueMutation = useMutation({
    mutationFn: async (variables: {
      appId: SharedProviderAppId;
      providerId: string;
    }) => adapter.removeFromFailoverQueue!(variables.appId, variables.providerId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stateQueryKey(variables.appId) }),
        queryClient.invalidateQueries({
          queryKey: failoverQueryKey(variables.appId, variables.providerId),
        }),
      ]);
    },
    onError: (error) =>
      setNotice(buildErrorNotice("Remove from failover queue", error)),
  });

  const autoFailoverMutation = useMutation({
    mutationFn: async (variables: {
      appId: SharedProviderAppId;
      enabled: boolean;
      providerId: string;
    }) => adapter.setAutoFailoverEnabled!(variables.appId, variables.enabled),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stateQueryKey(variables.appId) }),
        queryClient.invalidateQueries({
          queryKey: failoverQueryKey(variables.appId, variables.providerId),
        }),
      ]);
    },
    onError: (error) =>
      setNotice(buildErrorNotice("Update auto failover", error)),
  });

  const reorderFailoverQueueMutation = useMutation({
    mutationFn: async (variables: {
      appId: SharedProviderAppId;
      providerId: string;
      providerIds: string[];
    }) => adapter.reorderFailoverQueue!(variables.appId, variables.providerIds),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stateQueryKey(variables.appId) }),
        queryClient.invalidateQueries({
          queryKey: failoverQueryKey(variables.appId, variables.providerId),
        }),
      ]);
    },
    onError: (error) =>
      setNotice(buildErrorNotice("Reorder failover queue", error)),
  });

  const maxRetriesMutation = useMutation({
    mutationFn: async (variables: {
      appId: SharedProviderAppId;
      providerId: string;
      value: number;
    }) => adapter.setMaxRetries!(variables.appId, variables.value),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stateQueryKey(variables.appId) }),
        queryClient.invalidateQueries({
          queryKey: failoverQueryKey(variables.appId, variables.providerId),
        }),
      ]);
    },
    onError: (error) => setNotice(buildErrorNotice("Update max retries", error)),
  });

  const isMutating =
    saveMutation.isPending ||
    activateMutation.isPending ||
    deleteMutation.isPending ||
    addToFailoverQueueMutation.isPending ||
    removeFromFailoverQueueMutation.isPending ||
    autoFailoverMutation.isPending ||
    reorderFailoverQueueMutation.isPending ||
    maxRetriesMutation.isPending;

  function getCurrentAppSwitchButton(appId: SharedProviderAppId = currentApp) {
    return appSwitchRefs.current[appId] ?? null;
  }

  function rememberFocusTarget(targetRef: typeof editorRestoreFocusRef) {
    const activeElement = document.activeElement;
    targetRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
  }

  function focusElement(element: HTMLElement | null | undefined) {
    if (!element || !element.isConnected) {
      return false;
    }

    const candidate = element as HTMLElement & { disabled?: boolean };
    if (candidate.disabled) {
      return false;
    }

    element.focus();
    return true;
  }

  function restoreFocus(
    targetRef: typeof editorRestoreFocusRef,
    fallback?: () => HTMLElement | null,
  ) {
    const target = targetRef.current;
    targetRef.current = null;

    queueMicrotask(() => {
      if (focusElement(target)) {
        return;
      }

      focusElement(fallback?.() ?? null);
    });
  }

  useLayoutEffect(() => {
    if (previousAppRef.current === currentApp) {
      return;
    }

    previousAppRef.current = currentApp;
    resetEditorForApp(currentApp);
    setPendingDelete(null);
    setNotice(null);
  }, [currentApp]);

  useEffect(() => {
    if (!isEditorOpen || capabilitiesQuery.data == null) {
      return;
    }

    const canKeepEditorOpen = editingProvider
      ? capabilitiesQuery.data.canEdit
      : capabilitiesQuery.data.canAdd;

    if (canKeepEditorOpen) {
      return;
    }

    resetEditorForApp(currentApp);
  }, [capabilitiesQuery.data, currentApp, editingProvider, isEditorOpen]);

  useEffect(() => {
    if (state == null) {
      return;
    }

    const currentSelection = selectedProviderByApp[currentApp];
    const hasCurrentSelection = state.providers.some(
      (provider) => provider.providerId === currentSelection,
    );

    if (hasCurrentSelection) {
      return;
    }

    const fallbackProvider =
      state.providers.find((provider) => provider.active) ?? state.providers[0];

    setSelectedProviderByApp((currentSelectionByApp) => ({
      ...currentSelectionByApp,
      [currentApp]: fallbackProvider?.providerId ?? null,
    }));
  }, [currentApp, selectedProviderByApp, state]);

  function resetEditorForApp(appId: SharedProviderAppId) {
    const nextPresetId = getDefaultPresetId(appId);

    setIsEditorOpen(false);
    setEditingProvider(null);
    setSelectedPresetId(nextPresetId);
    setDraft(createDraftFromPreset(appId, nextPresetId));
  }

  function openAddEditor() {
    if (!capabilities.canAdd || isMutating) {
      return;
    }

    const nextPresetId = getDefaultPresetId(currentApp);

    rememberFocusTarget(editorRestoreFocusRef);
    setPendingDelete(null);
    setEditingProvider(null);
    setSelectedPresetId(nextPresetId);
    setDraft(createDraftFromPreset(currentApp, nextPresetId));
    setIsEditorOpen(true);
  }

  function openEditEditor(provider: SharedProviderView) {
    if (!capabilities.canEdit || isMutating) {
      return;
    }

    const presetId = inferSharedProviderPresetId(currentApp, provider);

    rememberFocusTarget(editorRestoreFocusRef);
    setPendingDelete(null);
    setEditingProvider(provider);
    setSelectedPresetId(presetId);
    setDraft(createDraftFromProvider(provider));
    setIsEditorOpen(true);
  }

  function openDuplicateEditor(provider: SharedProviderView) {
    if (!capabilities.canAdd || isMutating || state == null) {
      return;
    }

    const presetId = inferSharedProviderPresetId(currentApp, provider);

    rememberFocusTarget(editorRestoreFocusRef);
    setPendingDelete(null);
    setEditingProvider(null);
    setSelectedPresetId(presetId);
    setDraft(createDuplicateDraftFromProvider(provider, state.providers));
    setIsEditorOpen(true);
  }

  function handleAppChange(appId: SharedProviderAppId) {
    if (isMutating) {
      return;
    }

    editorRestoreFocusRef.current = null;
    deleteRestoreFocusRef.current = null;
    resetEditorForApp(appId);
    setPendingDelete(null);
    setNotice(null);

    if (selectedApp == null) {
      setInternalApp(appId);
    }

    onSelectedAppChange?.(appId);
  }

  function handleAppSwitchKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    sourceAppId: SharedProviderAppId,
  ) {
    if (isMutating) {
      return;
    }

    const currentIndex = appIds.indexOf(sourceAppId);
    let nextAppId: SharedProviderAppId | null = null;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextAppId = appIds[(currentIndex + 1) % appIds.length] ?? null;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextAppId =
          appIds[(currentIndex - 1 + appIds.length) % appIds.length] ?? null;
        break;
      case "Home":
        nextAppId = appIds[0] ?? null;
        break;
      case "End":
        nextAppId = appIds[appIds.length - 1] ?? null;
        break;
      default:
        return;
    }

    event.preventDefault();

    if (!nextAppId || nextAppId === sourceAppId) {
      return;
    }

    handleAppChange(nextAppId);
    queueMicrotask(() => {
      getCurrentAppSwitchButton(nextAppId)?.focus();
    });
  }

  function handleSearchChange(value: string) {
    setSearchByApp((currentSearch) => ({
      ...currentSearch,
      [currentApp]: value,
    }));
  }

  function clearSearch() {
    handleSearchChange("");
  }

  function handleSelectProvider(provider: SharedProviderView) {
    setSelectedProviderByApp((currentSelectionByApp) => ({
      ...currentSelectionByApp,
      [currentApp]: provider.providerId,
    }));
  }

  function handlePresetChange(nextPresetId: string) {
    setSelectedPresetId(nextPresetId);
    setDraft((currentDraft) =>
      applyPresetToDraft(currentApp, nextPresetId, currentDraft),
    );
  }

  async function handleRetry() {
    await Promise.all([stateQuery.refetch(), capabilitiesQuery.refetch()]);
  }

  function handleToggleSelectedProviderFailover(inQueue: boolean) {
    if (!selectedProvider?.providerId || !supportsFailoverControls) {
      return;
    }

    setNotice(null);

    if (inQueue) {
      removeFromFailoverQueueMutation.mutate({
        appId: currentApp,
        providerId: selectedProvider.providerId,
      });
      return;
    }

    addToFailoverQueueMutation.mutate({
      appId: currentApp,
      providerId: selectedProvider.providerId,
    });
  }

  function handleAutoFailoverChange(enabled: boolean) {
    if (!selectedProvider?.providerId || !supportsFailoverControls) {
      return;
    }

    setNotice(null);
    autoFailoverMutation.mutate({
      appId: currentApp,
      enabled,
      providerId: selectedProvider.providerId,
    });
  }

  function handleFailoverQueueReorder(nextProviderIds: string[]) {
    if (!selectedProvider?.providerId || !supportsFailoverControls) {
      return;
    }

    setNotice(null);
    reorderFailoverQueueMutation.mutate({
      appId: currentApp,
      providerId: selectedProvider.providerId,
      providerIds: nextProviderIds,
    });
  }

  function handleMaxRetriesSave(value: number) {
    if (!selectedProvider?.providerId || !supportsFailoverControls) {
      return;
    }

    setNotice(null);
    maxRetriesMutation.mutate({
      appId: currentApp,
      providerId: selectedProvider.providerId,
      value,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = trimDraft(draft);
    const canSubmit = editingProvider
      ? capabilities.canEdit
      : capabilities.canAdd;

    setNotice(null);

    if (!canSubmit) {
      setNotice({
        tone: "error",
        title: editingProvider ? "Edit unavailable." : "Add unavailable.",
        description: editingProvider
          ? `This adapter does not allow editing ${currentPresentation.label} providers.`
          : `This adapter does not allow adding ${currentPresentation.label} providers.`,
      });
      return;
    }

    saveMutation.mutate({
      appId: currentApp,
      providerId: editingProvider?.providerId ?? undefined,
      providerName:
        trimmed.name || editingProvider?.name || currentPresentation.label,
      requiresServiceRestart: capabilities.requiresServiceRestart,
      draft: trimmed,
    });
  }

  async function confirmDelete() {
    if (!pendingDelete?.providerId || !capabilities.canDelete) {
      return;
    }

    deleteMutation.mutate({
      appId: currentApp,
      providerId: pendingDelete.providerId,
      providerName: getSharedProviderDisplayName(pendingDelete),
      requiresServiceRestart: capabilities.requiresServiceRestart,
    });
  }

  return (
    <div
      data-ccswitch-region="provider-surface"
      data-ccswitch-layout="embedded-stack"
      aria-busy={isRefreshing || isMutating}
      className={cn(
        "ccswitch-openwrt-page-section ccswitch-openwrt-page-section--providers space-y-3",
        className,
      )}
    >
      <Card className="ccswitch-openwrt-surface-card overflow-hidden rounded-[28px] border-border-default/80 shadow-sm">
        <CardHeader
          data-ccswitch-region="provider-header"
          data-ccswitch-layout="embedded-stack"
          className="ccswitch-openwrt-page-header gap-5 border-b border-border-default bg-gradient-to-br from-background via-background to-muted/30 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-xl">Provider workspace</CardTitle>
              <CardDescription className="max-w-2xl">
                Manage saved providers from one compact OpenWrt workspace. The
                app picker stays compact and can scale beyond a fixed tab strip.
              </CardDescription>
            </div>
            <div
              data-ccswitch-region="provider-app-picker"
              data-ccswitch-layout="compact-row"
              className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border-default/80 bg-muted/25 p-1.5 shadow-sm"
              aria-label="Provider apps"
            >
              {appIds.map((appId) => {
                const active = appId === currentApp;
                const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];

                return (
                  <button
                    key={appId}
                    type="button"
                    ref={(element) => {
                      appSwitchRefs.current[appId] = element;
                    }}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      "ccswitch-openwrt-app-switch",
                      active
                        ? appPresentation.accentClassName
                        : "border-border-default bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                      isMutating && "cursor-not-allowed opacity-50",
                    )}
                    aria-pressed={active}
                    disabled={isMutating}
                    onClick={() => handleAppChange(appId)}
                    onKeyDown={(event) => handleAppSwitchKeyDown(event, appId)}
                  >
                    {appPresentation.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            data-ccswitch-region="provider-summary-grid"
            data-ccswitch-layout="stack-to-split"
            className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"
          >
            <section
              data-ccswitch-region="provider-summary"
              className="ccswitch-openwrt-group ccswitch-openwrt-group--raised rounded-[24px] border border-border-default/80 bg-background/80 p-4 shadow-sm sm:p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    currentPresentation.chipClassName,
                  )}
                >
                  {currentPresentation.label}
                </span>
                {state ? (
                  <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                    {state.providers.length} saved
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-lg font-semibold text-foreground">
                  {currentPresentation.label} provider routing
                </p>
                <p className="text-sm text-muted-foreground">
                  {getProviderRegionDescription(
                    currentApp,
                    state,
                    capabilitiesQuery.data,
                  )}
                </p>
              </div>
            </section>

            <section
              data-ccswitch-region="provider-active-route"
              className={cn(
                "ccswitch-openwrt-group rounded-[24px] border p-4 shadow-sm sm:p-5",
                currentActiveProvider
                  ? currentPresentation.panelClassName
                  : "border-border-default/80 bg-muted/15",
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Active route
              </p>
              <p className="mt-3 text-base font-semibold text-foreground">
                {currentActiveProvider
                  ? `Current provider: ${getSharedProviderDisplayName(
                      currentActiveProvider,
                    )}`
                  : "No active provider selected"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {currentActiveProvider
                  ? currentActiveProvider.baseUrl || "Base URL unavailable"
                  : "Activate a saved provider to route requests for this app."}
              </p>
              {currentActiveProvider?.providerId ? (
                <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Provider ID: {currentActiveProvider.providerId}
                </p>
              ) : null}
            </section>
          </div>

          {notice ? (
            <Alert
              variant={notice.tone === "error" ? "destructive" : "default"}
              className={cn(
                "ccswitch-openwrt-shell-alert",
                notice.tone === "success" &&
                  "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-100",
                notice.tone === "warning" &&
                  "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100",
              )}
            >
              {notice.tone === "success" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle>{notice.title}</AlertTitle>
              <AlertDescription>{notice.description}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>

        <CardContent
          data-ccswitch-region="provider-body"
          data-ccswitch-layout="embedded-stack"
          className="space-y-3 p-4 pt-4 sm:p-5"
        >
          {hasRegionError ? (
            <ErrorState onRetry={() => void handleRetry()} />
          ) : isRegionLoading ? (
            <LoadingState />
          ) : state ? (
            <>
              <div data-ccswitch-region="provider-toolbar">
                <SharedProviderToolbar
                  appId={currentApp}
                  searchQuery={searchQuery}
                  visibleCount={filteredProviders.length}
                  totalCount={state.providers.length}
                  disabled={isMutating}
                  searchDisabled={!hasProviders && searchQuery.length === 0}
                  isRefreshing={isRefreshing}
                  onSearchQueryChange={handleSearchChange}
                  onRefresh={() => void handleRetry()}
                  onAddProvider={
                    capabilities.canAdd ? openAddEditor : undefined
                  }
                />
              </div>

              {!hasProviders ? (
                <EmptyState
                  appId={currentApp}
                  canAdd={capabilities.canAdd}
                  onAdd={openAddEditor}
                />
              ) : filteredProviders.length === 0 ? (
                <SearchEmptyState
                  searchQuery={deferredSearchQuery.trim()}
                  onClear={clearSearch}
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.88fr)_minmax(0,1.12fr)]">
                  <div
                    data-ccswitch-region="provider-card-grid"
                    data-ccswitch-layout="responsive-grid"
                    className="grid gap-3"
                  >
                    {filteredProviders.map((provider) => {
                      const matchedPreset = getSharedProviderMatchedPreset(
                        currentApp,
                        provider,
                      );

                      return (
                        <SharedProviderCard
                          key={
                            provider.providerId ??
                            getSharedProviderDisplayName(provider)
                          }
                          appId={currentApp}
                          provider={provider}
                          presetLabel={matchedPreset?.label ?? null}
                          actionVisibility={getSharedProviderCardActionVisibility(
                            capabilities,
                            provider,
                          )}
                          isBusy={isMutating}
                          isActivatePending={
                            activateMutation.isPending &&
                            activateMutation.variables?.providerId ===
                              provider.providerId
                          }
                          selected={
                            Boolean(provider.providerId) &&
                            provider.providerId === selectedProvider?.providerId
                          }
                          onSelect={() => handleSelectProvider(provider)}
                          onDuplicate={() => openDuplicateEditor(provider)}
                          onEdit={() => openEditEditor(provider)}
                          onActivate={() => {
                            if (!provider.providerId) {
                              return;
                            }

                            activateMutation.mutate({
                              appId: currentApp,
                              providerId: provider.providerId,
                              providerName:
                                getSharedProviderDisplayName(provider),
                              requiresServiceRestart:
                                capabilities.requiresServiceRestart,
                            });
                          }}
                          onDelete={() => {
                            rememberFocusTarget(deleteRestoreFocusRef);
                            setPendingDelete(provider);
                          }}
                        />
                      );
                    })}
                  </div>

                  {selectedProvider ? (
                    <SharedProviderDetailPanel
                      appId={currentApp}
                      provider={selectedProvider}
                      detailTab={detailTabByApp[currentApp]}
                      supportsFailoverControls={supportsFailoverControls}
                      failoverState={
                        detailTabByApp[currentApp] === "failover"
                          ? (failoverQuery.data as SharedProviderFailoverState | undefined)
                          : undefined
                      }
                      failoverLoading={failoverQuery.isLoading}
                      failoverError={
                        failoverQuery.error instanceof Error
                          ? failoverQuery.error.message
                          : failoverQuery.error
                            ? String(failoverQuery.error)
                            : null
                      }
                      actionVisibility={getSharedProviderCardActionVisibility(
                        capabilities,
                        selectedProvider,
                      )}
                      isBusy={isMutating}
                      isActivatePending={
                        activateMutation.isPending &&
                        activateMutation.variables?.providerId ===
                          selectedProvider.providerId
                      }
                      onDetailTabChange={(tab) =>
                        setDetailTabByApp((currentTabs) => ({
                          ...currentTabs,
                          [currentApp]: tab,
                        }))
                      }
                      onToggleFailoverQueue={handleToggleSelectedProviderFailover}
                      onAutoFailoverEnabledChange={handleAutoFailoverChange}
                      onReorderFailoverQueue={handleFailoverQueueReorder}
                      onSetMaxRetries={handleMaxRetriesSave}
                      onDuplicate={() => openDuplicateEditor(selectedProvider)}
                      onEdit={() => openEditEditor(selectedProvider)}
                      onActivate={() => {
                        if (!selectedProvider.providerId) {
                          return;
                        }

                        activateMutation.mutate({
                          appId: currentApp,
                          providerId: selectedProvider.providerId,
                          providerName:
                            getSharedProviderDisplayName(selectedProvider),
                          requiresServiceRestart:
                            capabilities.requiresServiceRestart,
                        });
                      }}
                    />
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <SharedProviderEditorPanel
        open={isEditorOpen}
        appId={currentApp}
        mode={editingProvider ? "edit" : "add"}
        draft={draft}
        selectedPresetId={selectedPresetId}
        selectedPreset={selectedPreset}
        presetGroups={presetGroups}
        tokenFieldOptions={tokenFieldOptions}
        disabled={saveMutation.isPending}
        savePending={saveMutation.isPending}
        supportsPresets={capabilities.supportsPresets}
        supportsBlankSecretPreserve={capabilities.supportsBlankSecretPreserve}
        hasStoredSecret={Boolean(editingProvider?.tokenConfigured)}
        initialFocusRef={editorInitialFocusRef}
        onOpenChange={(open) => {
          if (!open && !saveMutation.isPending) {
            resetEditorForApp(currentApp);
            restoreFocus(editorRestoreFocusRef, () =>
              getCurrentAppSwitchButton(),
            );
          }
        }}
        onPresetChange={handlePresetChange}
        onDraftChange={setDraft}
        onSubmit={handleSubmit}
      />

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setPendingDelete(null);
            restoreFocus(deleteRestoreFocusRef, () =>
              getCurrentAppSwitchButton(),
            );
          }
        }}
      >
        <DialogContent
          className="ccswitch-openwrt-provider-ui-dialog ccswitch-openwrt-provider-ui-dialog--compact ccswitch-openwrt-dialog-shell max-w-sm overflow-hidden p-0"
          overlayClassName="ccswitch-openwrt-provider-ui-overlay"
          zIndex="alert"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            deleteCancelButtonRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader className="space-y-3 border-b border-border-default bg-gradient-to-br from-background via-background to-muted/30">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete provider
            </DialogTitle>
          </DialogHeader>
          <div
            className="min-h-0 overflow-y-auto px-6 py-4"
            data-ccswitch-dialog-scroll-region
          >
            <DialogDescription className="text-sm leading-relaxed">
              {pendingDelete
                ? `Delete ${getSharedProviderDisplayName(pendingDelete)} from the saved ${currentPresentation.label} providers on this router.`
                : ""}
            </DialogDescription>
          </div>
          <DialogFooter className="flex gap-2 border-t border-border-default bg-muted/20 sm:justify-end">
            <Button
              ref={deleteCancelButtonRef}
              type="button"
              variant="outline"
              onClick={() => {
                setPendingDelete(null);
                restoreFocus(deleteRestoreFocusRef, () =>
                  getCurrentAppSwitchButton(),
                );
              }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={
                deleteMutation.isPending ||
                !pendingDelete?.providerId ||
                !capabilities.canDelete
              }
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
