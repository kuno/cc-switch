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
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderEditorPayload,
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
  tone: "success" | "error";
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
  const serviceName = shellState?.serviceName?.trim() || "service";
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

  let description = `${providerName} was ${verb}. Restart the ${serviceName} to apply provider changes.`;

  if (shellState?.restartInFlight) {
    description += " Restart is already in progress.";
  } else if (shellState?.restartPending) {
    description += " Restart is still pending.";
  } else {
    description += " Use the LuCI restart control when ready.";
  }

  if (shellState?.serviceStatusLabel) {
    description += ` Current service status: ${shellState.serviceStatusLabel}.`;
  }

  return {
    tone: "success",
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
    return "Manage Claude, Codex, and Gemini providers through the shared OpenWrt-compatible React slice.";
  }

  if (!state.phase2Available) {
    return "Legacy provider bridge detected. Compatibility mode is active for this app.";
  }

  if (!capabilities.canAdd && !capabilities.canEdit) {
    return `${SHARED_PROVIDER_APP_PRESENTATION[appId].label} providers are visible here, but unsupported management actions stay hidden for this adapter.`;
  }

  if (!capabilities.canAdd) {
    return `Saved ${SHARED_PROVIDER_APP_PRESENTATION[appId].label} providers remain editable, but adding new entries is disabled for this adapter.`;
  }

  return "Use the operations supported by this adapter to manage saved providers.";
}

function LoadingState() {
  return (
    <div className="ccswitch-openwrt-state-shell space-y-4 rounded-2xl border border-dashed border-border-default bg-muted/10 p-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p>Loading providers...</p>
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
        <p className="font-medium">Unable to load providers.</p>
        <p className="text-sm text-muted-foreground">
          Retry after the adapter or OpenWrt RPC bridge is available again.
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
          No providers saved for {SHARED_PROVIDER_APP_PRESENTATION[appId].label}{" "}
          yet.
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {canAdd
            ? "Choose a preset or enter a custom endpoint, then save your first provider from the dedicated add panel."
            : "This adapter exposes providers for this app without add support."}
        </p>
      </div>
      {canAdd ? (
        <Button type="button" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Create provider
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
        <p className="font-medium">No providers match "{searchQuery}".</p>
        <p className="text-sm text-muted-foreground">
          Search only filters the current browser view. Clear it to show the
          full provider list again.
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

  const isMutating =
    saveMutation.isPending ||
    activateMutation.isPending ||
    deleteMutation.isPending;
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
  const isRefreshing = stateQuery.isFetching || capabilitiesQuery.isFetching;

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

  function handlePresetChange(nextPresetId: string) {
    setSelectedPresetId(nextPresetId);
    setDraft((currentDraft) =>
      applyPresetToDraft(currentApp, nextPresetId, currentDraft),
    );
  }

  async function handleRetry() {
    await Promise.all([stateQuery.refetch(), capabilitiesQuery.refetch()]);
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
          className="ccswitch-openwrt-page-header gap-4 border-b border-border-default bg-gradient-to-br from-background via-background to-muted/30 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-xl">Provider manager</CardTitle>
              <CardDescription className="max-w-2xl">
                Manage Claude, Codex, and Gemini providers through the shared
                OpenWrt-compatible React slice.
              </CardDescription>
            </div>
            <div
              data-ccswitch-region="provider-app-switch"
              data-ccswitch-layout="wrap-row"
              className="flex flex-wrap gap-2"
              aria-label="Provider apps"
            >
              {appIds.map((appId) => {
                const active = appId === currentApp;
                const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
                const tabId = `shared-provider-tab-${appId}`;
                const panelId = `shared-provider-panel-${appId}`;

                return (
                  <button
                    key={appId}
                    type="button"
                    ref={(element) => {
                      appSwitchRefs.current[appId] = element;
                    }}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      "ccswitch-openwrt-app-switch",
                      active
                        ? appPresentation.accentClassName
                        : "border-border-default bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                      isMutating && "cursor-not-allowed opacity-50",
                    )}
                    id={tabId}
                    aria-controls={panelId}
                    aria-selected={active}
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
            className="grid gap-3"
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
                <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  {capabilities.requiresServiceRestart
                    ? "Restart required after changes"
                    : "Changes apply immediately"}
                </span>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-lg font-semibold text-foreground">
                  {currentPresentation.label} saved providers
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
                  : "Activate a saved provider to pin the route used by the current app."}
              </p>
            </section>
          </div>

          {notice ? (
            <Alert
              variant={notice.tone === "error" ? "destructive" : "default"}
              className={cn(
                "ccswitch-openwrt-shell-alert",
                notice.tone === "success" &&
                  "border-emerald-500/30 bg-emerald-500/5 text-emerald-950 dark:text-emerald-100",
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
          id={`shared-provider-panel-${currentApp}`}
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
            restoreFocus(editorRestoreFocusRef, () => getCurrentAppSwitchButton());
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
            restoreFocus(deleteRestoreFocusRef, () => getCurrentAppSwitchButton());
          }
        }}
      >
        <DialogContent
          className="ccswitch-openwrt-provider-ui-dialog ccswitch-openwrt-dialog-shell max-w-sm"
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
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete {currentPresentation.label} provider
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {pendingDelete
                ? `Remove ${getSharedProviderDisplayName(pendingDelete)} from the saved ${currentPresentation.label} providers on this router.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 border-t-0 bg-transparent pt-2 sm:justify-end">
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
