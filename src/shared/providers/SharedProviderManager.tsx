import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  emptySharedProviderEditorPayload,
  getSharedProviderPresetById,
  getSharedProviderPresetGroups,
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
  SHARED_PROVIDER_APP_PRESENTATION,
  SHARED_PROVIDER_TOKEN_FIELD_OPTIONS,
  SharedProviderAccessState,
  SharedProviderCard,
  SharedProviderEditorPanel,
  SharedProviderEmptyState,
  SharedProviderErrorState,
  SharedProviderLoadingState,
  SharedProviderToolbar,
  filterSharedProviders,
  getSharedProviderCardActionVisibility,
  getSharedProviderDisplayName,
} from "./ui";

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
  return getSharedProviderPresetGroups(appId)[0]?.presets[0]?.id ?? "custom";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    getDefaultPresetId(initialApp),
  );
  const [editingProvider, setEditingProvider] =
    useState<SharedProviderView | null>(null);
  const [draft, setDraft] = useState<SharedProviderEditorPayload>(
    createDraftFromPreset(initialApp, getDefaultPresetId(initialApp)),
  );
  const [pendingDelete, setPendingDelete] = useState<SharedProviderView | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const queryClient = useQueryClient();
  const currentApp = selectedApp ?? internalApp;
  const currentAppRef = useRef(currentApp);

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
      const nextPresetId = getDefaultPresetId(variables.appId);
      const isCurrentApp = currentAppRef.current === variables.appId;

      await queryClient.invalidateQueries({
        queryKey: stateQueryKey(variables.appId),
      });

      if (isCurrentApp) {
        setEditingProvider(null);
        setPendingDelete(null);
        setSelectedPresetId(nextPresetId);
        setDraft(createDraftFromPreset(variables.appId, nextPresetId));
        setIsEditorOpen(false);
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
      const nextPresetId = getDefaultPresetId(variables.appId);
      const isCurrentApp = currentAppRef.current === variables.appId;

      await queryClient.invalidateQueries({
        queryKey: stateQueryKey(variables.appId),
      });

      if (isCurrentApp) {
        if (
          editingProvider?.providerId &&
          editingProvider.providerId === variables.providerId
        ) {
          setEditingProvider(null);
          setSelectedPresetId(nextPresetId);
          setDraft(createDraftFromPreset(variables.appId, nextPresetId));
          setIsEditorOpen(false);
        }

        setPendingDelete(null);
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

      setNotice(buildErrorNotice("Delete", error));
    },
  });

  const capabilities = capabilitiesQuery.data ?? FALLBACK_CAPABILITIES;
  const isMutating =
    saveMutation.isPending ||
    activateMutation.isPending ||
    deleteMutation.isPending;
  const canEditProviders =
    capabilitiesQuery.data?.canEdit ?? FALLBACK_CAPABILITIES.canEdit;
  const canAddProviders =
    capabilitiesQuery.data?.canAdd ?? FALLBACK_CAPABILITIES.canAdd;

  function resetEditorState(appId: SharedProviderAppId) {
    const nextPresetId = getDefaultPresetId(appId);
    setEditingProvider(null);
    setSelectedPresetId(nextPresetId);
    setDraft(createDraftFromPreset(appId, nextPresetId));
  }

  function closeEditorPanel(appId: SharedProviderAppId) {
    resetEditorState(appId);
    setIsEditorOpen(false);
  }

  useEffect(() => {
    setSearchQuery("");
    setPendingDelete(null);
    setNotice(null);
    closeEditorPanel(currentApp);
  }, [currentApp]);

  useEffect(() => {
    if (!isEditorOpen || capabilitiesQuery.data == null) {
      return;
    }

    const canManageCurrentForm = editingProvider
      ? capabilitiesQuery.data.canEdit
      : capabilitiesQuery.data.canAdd;

    if (!canManageCurrentForm) {
      closeEditorPanel(currentApp);
    }
  }, [capabilitiesQuery.data, currentApp, editingProvider, isEditorOpen]);

  function handleAppChange(appId: SharedProviderAppId) {
    if (isMutating) {
      return;
    }

    if (selectedApp == null) {
      setInternalApp(appId);
    }

    onSelectedAppChange?.(appId);
  }

  function handleOpenAddPanel() {
    if (!canAddProviders || isMutating) {
      return;
    }

    setNotice(null);
    setPendingDelete(null);
    resetEditorState(currentApp);
    setIsEditorOpen(true);
  }

  function handleEdit(provider: SharedProviderView) {
    if (!canEditProviders || isMutating) {
      return;
    }

    const presetId = inferSharedProviderPresetId(currentApp, provider);

    setNotice(null);
    setPendingDelete(null);
    setEditingProvider(provider);
    setSelectedPresetId(presetId);
    setDraft(createDraftFromProvider(provider));
    setIsEditorOpen(true);
  }

  function handlePresetChange(nextPresetId: string) {
    setSelectedPresetId(nextPresetId);
    setDraft((currentDraft) =>
      applyPresetToDraft(currentApp, nextPresetId, currentDraft),
    );
  }

  function handlePanelOpenChange(open: boolean) {
    if (saveMutation.isPending) {
      return;
    }

    if (!open) {
      closeEditorPanel(currentApp);
      return;
    }

    setIsEditorOpen(true);
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
          ? `This adapter does not allow editing ${SHARED_PROVIDER_APP_PRESENTATION[currentApp].label} providers.`
          : `This adapter does not allow adding ${SHARED_PROVIDER_APP_PRESENTATION[currentApp].label} providers.`,
      });
      return;
    }

    saveMutation.mutate({
      appId: currentApp,
      providerId: editingProvider?.providerId ?? undefined,
      providerName:
        trimmed.name ||
        editingProvider?.name ||
        SHARED_PROVIDER_APP_PRESENTATION[currentApp].label,
      requiresServiceRestart: capabilities.requiresServiceRestart,
      draft: trimmed,
    });
  }

  if (!stateQuery.data || !capabilitiesQuery.data) {
    if (stateQuery.error || capabilitiesQuery.error) {
      return (
        <div className={cn("space-y-4", className)}>
          <SharedProviderErrorState onRetry={() => void handleRetry()} />
        </div>
      );
    }

    return (
      <div className={cn("space-y-4", className)}>
        <SharedProviderLoadingState appId={currentApp} />
      </div>
    );
  }

  const resolvedState: SharedProviderState = stateQuery.data!;
  const appLabel = SHARED_PROVIDER_APP_PRESENTATION[currentApp].label;
  const selectedPreset =
    selectedPresetId === "custom"
      ? null
      : getSharedProviderPresetById(currentApp, selectedPresetId);
  const presetGroups = getSharedProviderPresetGroups(currentApp);
  const filteredProviders = filterSharedProviders(
    currentApp,
    resolvedState.providers,
    searchQuery,
  );
  const hasProviders = resolvedState.providers.length > 0;
  const activatePendingProviderId =
    activateMutation.variables?.providerId ?? null;
  const accessState =
    !capabilities.canEdit && !capabilities.canAdd
      ? {
          tone: "warning" as const,
          title: "Provider editing is unavailable.",
          description: `This adapter exposes ${appLabel} providers without add/edit support.`,
        }
      : !capabilities.canAdd
        ? {
            tone: "info" as const,
            title: "Adding providers is unavailable.",
            description: hasProviders
              ? `This adapter does not allow adding new ${appLabel} providers. Select a saved provider to edit it instead.`
              : `This adapter does not allow adding new ${appLabel} providers.`,
          }
        : null;

  return (
    <div className={cn("space-y-4", className)}>
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-xl">Provider manager</CardTitle>
              <p className="text-sm text-muted-foreground">
                Manage Claude, Codex, and Gemini providers through the shared
                OpenWrt-compatible React slice.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {appIds.map((appId) => {
                const active = appId === currentApp;
                return (
                  <button
                    key={appId}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? SHARED_PROVIDER_APP_PRESENTATION[appId]
                            .accentClassName
                        : "border-border-default bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                      isMutating && "cursor-not-allowed opacity-50",
                    )}
                    aria-pressed={active}
                    disabled={isMutating}
                    onClick={() => handleAppChange(appId)}
                  >
                    {SHARED_PROVIDER_APP_PRESENTATION[appId].label}
                  </button>
                );
              })}
            </div>
          </div>

          {notice ? (
            <Alert
              variant={notice.tone === "error" ? "destructive" : "default"}
              className={cn(
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
      </Card>

      <Card>
        <CardHeader className="space-y-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              {appLabel} saved providers
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {resolvedState.phase2Available
                ? "Use the operations supported by this adapter to manage saved providers."
                : "Legacy provider bridge detected. Compatibility mode is active for this app."}
            </p>
          </div>
          <SharedProviderToolbar
            appId={currentApp}
            searchQuery={searchQuery}
            visibleCount={filteredProviders.length}
            totalCount={resolvedState.providers.length}
            disabled={isMutating}
            isRefreshing={stateQuery.isFetching || capabilitiesQuery.isFetching}
            onSearchQueryChange={setSearchQuery}
            onRefresh={() => void handleRetry()}
            onAddProvider={canAddProviders ? handleOpenAddPanel : undefined}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {accessState ? (
            <SharedProviderAccessState
              tone={accessState.tone}
              title={accessState.title}
              description={accessState.description}
            />
          ) : null}

          {!hasProviders ? (
            <SharedProviderEmptyState
              appId={currentApp}
              canAdd={canAddProviders}
              onAddProvider={canAddProviders ? handleOpenAddPanel : undefined}
            />
          ) : filteredProviders.length === 0 ? (
            <SharedProviderEmptyState
              appId={currentApp}
              canAdd={canAddProviders}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery("")}
            />
          ) : (
            <div className="space-y-3">
              {filteredProviders.map((provider) => {
                const providerName = getSharedProviderDisplayName(provider);
                const presetId = inferSharedProviderPresetId(
                  currentApp,
                  provider,
                );
                const preset =
                  presetId === "custom"
                    ? null
                    : getSharedProviderPresetById(currentApp, presetId);

                return (
                  <SharedProviderCard
                    key={provider.providerId ?? providerName}
                    appId={currentApp}
                    provider={provider}
                    presetLabel={preset?.label ?? null}
                    actionVisibility={getSharedProviderCardActionVisibility(
                      capabilities,
                      provider,
                    )}
                    isBusy={isMutating}
                    isActivatePending={
                      activateMutation.isPending &&
                      activatePendingProviderId === provider.providerId
                    }
                    onEdit={() => handleEdit(provider)}
                    onActivate={() => {
                      if (!provider.providerId) {
                        return;
                      }

                      activateMutation.mutate({
                        appId: currentApp,
                        providerId: provider.providerId,
                        providerName,
                        requiresServiceRestart:
                          capabilities.requiresServiceRestart,
                      });
                    }}
                    onDelete={() => setPendingDelete(provider)}
                  />
                );
              })}
            </div>
          )}
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
        tokenFieldOptions={SHARED_PROVIDER_TOKEN_FIELD_OPTIONS[currentApp]}
        disabled={
          saveMutation.isPending ||
          !(editingProvider ? capabilities.canEdit : capabilities.canAdd)
        }
        savePending={saveMutation.isPending}
        supportsPresets={capabilities.supportsPresets}
        supportsBlankSecretPreserve={capabilities.supportsBlankSecretPreserve}
        hasStoredSecret={Boolean(editingProvider?.tokenConfigured)}
        onOpenChange={handlePanelOpenChange}
        onPresetChange={handlePresetChange}
        onDraftChange={setDraft}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        isOpen={pendingDelete != null}
        title="Delete provider?"
        message={
          pendingDelete
            ? `${getSharedProviderDisplayName(pendingDelete)} will be removed from ${appLabel}.`
            : ""
        }
        confirmText="Confirm delete"
        onConfirm={() => {
          if (!pendingDelete?.providerId) {
            return;
          }

          deleteMutation.mutate({
            appId: currentApp,
            providerId: pendingDelete.providerId,
            providerName: getSharedProviderDisplayName(pendingDelete),
            requiresServiceRestart: capabilities.requiresServiceRestart,
          });
        }}
        onCancel={() => {
          if (!deleteMutation.isPending) {
            setPendingDelete(null);
          }
        }}
      />
    </div>
  );
}
