import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCw,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  emptySharedProviderEditorPayload,
  getGenericPresetDescription,
  getSharedProviderPresetById,
  getSharedProviderPresets,
  inferSharedProviderPresetId,
  OPENWRT_SUPPORTED_PROVIDER_APPS,
  type SharedProviderAppId,
  type SharedProviderCapabilities,
  type SharedProviderEditorPayload,
  type SharedProviderState,
  type SharedProviderTokenField,
  type SharedProviderView,
} from "./domain";
import type {
  SharedProviderManagerProps,
  SharedProviderMutationAction,
  SharedProviderMutationEvent,
  SharedProviderShellState,
} from "./managerTypes";

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

const FIELD_CLASS_NAME =
  "flex h-9 w-full rounded-md border border-border-default bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50";

const APP_META: Record<
  SharedProviderAppId,
  {
    label: string;
    accentClassName: string;
    chipClassName: string;
  }
> = {
  claude: {
    label: "Claude",
    accentClassName:
      "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    chipClassName:
      "bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  },
  codex: {
    label: "Codex",
    accentClassName:
      "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300",
    chipClassName:
      "bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  },
  gemini: {
    label: "Gemini",
    accentClassName:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    chipClassName:
      "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  },
};

const TOKEN_FIELD_OPTIONS: Record<
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

function getProviderDisplayName(provider: SharedProviderView): string {
  return provider.name || provider.providerId || "Provider";
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

function LoadingState() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <p>Loading providers...</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/40 px-6 text-center">
      <AlertCircle className="h-6 w-6 text-destructive" />
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
}: {
  appId: SharedProviderAppId;
  canAdd: boolean;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
      <Plus className="h-6 w-6 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">
          No providers saved for {APP_META[appId].label} yet.
        </p>
        <p className="text-sm text-muted-foreground">
          {canAdd
            ? "Choose a preset or enter a custom endpoint and save your first provider."
            : "This adapter does not allow adding new providers for this app."}
        </p>
      </div>
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
  const [internalApp, setInternalApp] = useState<SharedProviderAppId>(
    initialApp,
  );
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
  const queryClient = useQueryClient();
  const currentApp = selectedApp ?? internalApp;
  const currentAppRef = useRef(currentApp);
  const presets = getSharedProviderPresets(currentApp);
  const tokenFieldOptions = TOKEN_FIELD_OPTIONS[currentApp];
  const fieldIdPrefix = useId();

  currentAppRef.current = currentApp;

  useEffect(() => {
    const nextPresetId = getDefaultPresetId(currentApp);
    setSelectedPresetId(nextPresetId);
    setEditingProvider(null);
    setPendingDelete(null);
    setNotice(null);
    setDraft(createDraftFromPreset(currentApp, nextPresetId));
  }, [currentApp]);

  const stateQuery = useQuery({
    queryKey: stateQueryKey(currentApp),
    queryFn: () => adapter.listProviderState(currentApp),
  });

  const capabilitiesQuery = useQuery({
    queryKey: capabilitiesQueryKey(currentApp),
    queryFn: () => adapter.getCapabilities(currentApp),
  });
  const canEditProviders =
    capabilitiesQuery.data?.canEdit ?? FALLBACK_CAPABILITIES.canEdit;

  useEffect(() => {
    if (!editingProvider || capabilitiesQuery.data == null || canEditProviders) {
      return;
    }

    const nextPresetId = getDefaultPresetId(currentApp);
    setEditingProvider(null);
    setPendingDelete(null);
    setSelectedPresetId(nextPresetId);
    setDraft(createDraftFromPreset(currentApp, nextPresetId));
  }, [canEditProviders, currentApp, editingProvider, capabilitiesQuery.data]);

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

  function handleAppChange(appId: SharedProviderAppId) {
    if (isMutating) {
      return;
    }

    if (selectedApp == null) {
      setInternalApp(appId);
    }

    onSelectedAppChange?.(appId);
  }

  function resetForm() {
    const nextPresetId = getDefaultPresetId(currentApp);
    setEditingProvider(null);
    setPendingDelete(null);
    setSelectedPresetId(nextPresetId);
    setDraft(createDraftFromPreset(currentApp, nextPresetId));
  }

  function handlePresetChange(nextPresetId: string) {
    setSelectedPresetId(nextPresetId);
    setDraft((currentDraft) =>
      applyPresetToDraft(currentApp, nextPresetId, currentDraft),
    );
  }

  function handleEdit(provider: SharedProviderView) {
    if (!canEditProviders || isMutating) {
      return;
    }

    const presetId = inferSharedProviderPresetId(currentApp, provider);

    setPendingDelete(null);
    setEditingProvider(provider);
    setSelectedPresetId(presetId);
    setDraft(createDraftFromProvider(provider));
  }

  async function handleRetry() {
    await Promise.all([stateQuery.refetch(), capabilitiesQuery.refetch()]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = trimDraft(draft);
    const capabilities = capabilitiesQuery.data ?? FALLBACK_CAPABILITIES;
    const canSubmit = editingProvider ? capabilities.canEdit : capabilities.canAdd;

    setNotice(null);

    if (!canSubmit) {
      setNotice({
        tone: "error",
        title: editingProvider ? "Edit unavailable." : "Add unavailable.",
        description: editingProvider
          ? `This adapter does not allow editing ${APP_META[currentApp].label} providers.`
          : `This adapter does not allow adding ${APP_META[currentApp].label} providers.`,
      });
      return;
    }

    saveMutation.mutate({
      appId: currentApp,
      providerId: editingProvider?.providerId ?? undefined,
      providerName:
        trimmed.name || editingProvider?.name || APP_META[currentApp].label,
      requiresServiceRestart: capabilities.requiresServiceRestart,
      draft: trimmed,
    });
  }

  if (!stateQuery.data || !capabilitiesQuery.data) {
    if (stateQuery.error || capabilitiesQuery.error) {
      return (
        <div className={cn("space-y-4", className)}>
          <ErrorState onRetry={() => void handleRetry()} />
        </div>
      );
    }

    return (
      <div className={cn("space-y-4", className)}>
        <LoadingState />
      </div>
    );
  }

  const state: SharedProviderState = stateQuery.data;
  const capabilities = capabilitiesQuery.data;
  const selectedPreset =
    selectedPresetId === "custom"
      ? null
      : getSharedProviderPresetById(currentApp, selectedPresetId);
  const hasProviders = state.providers.length > 0;
  const isMutating =
    saveMutation.isPending ||
    activateMutation.isPending ||
    deleteMutation.isPending;
  const canAddProviders = capabilities.canAdd;
  const canManageCurrentForm = editingProvider
    ? capabilities.canEdit
    : canAddProviders;
  const showEditorForm = editingProvider
    ? capabilities.canEdit
    : canAddProviders;
  const editorTitle = editingProvider
    ? "Edit provider"
    : canAddProviders
      ? "Add provider"
      : "Provider access";
  const editorDescription = editingProvider
    ? `Update ${getProviderDisplayName(editingProvider)} for ${APP_META[currentApp].label}.`
    : canAddProviders
      ? `Create a saved provider for ${APP_META[currentApp].label}.`
      : hasProviders && capabilities.canEdit
        ? `Adding saved providers for ${APP_META[currentApp].label} is disabled. Select an existing provider to edit it.`
        : `${APP_META[currentApp].label} providers are read-only for this adapter.`;
  const formDisabled = saveMutation.isPending || !canManageCurrentForm;

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
                        ? APP_META[appId].accentClassName
                        : "border-border-default bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                      isMutating && "cursor-not-allowed opacity-50",
                    )}
                    aria-pressed={active}
                    disabled={isMutating}
                    onClick={() => handleAppChange(appId)}
                  >
                    {APP_META[appId].label}
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">
                {APP_META[currentApp].label} saved providers
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {state.phase2Available
                  ? "Use the operations supported by this adapter to manage saved providers."
                  : "Legacy provider bridge detected. Compatibility mode is active for this app."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                  APP_META[currentApp].chipClassName,
                )}
              >
                {state.providers.length} saved
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRetry()}
                disabled={stateQuery.isFetching || capabilitiesQuery.isFetching}
              >
                {stateQuery.isFetching || capabilitiesQuery.isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Refresh
              </Button>
              {canAddProviders ? (
                <Button type="button" onClick={resetForm} disabled={isMutating}>
                  <Plus className="h-4 w-4" />
                  Add provider
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingDelete ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Delete provider?</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>
                    {getProviderDisplayName(pendingDelete)} will be removed from{" "}
                    {APP_META[currentApp].label}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        if (!pendingDelete.providerId) {
                          return;
                        }

                        deleteMutation.mutate({
                          appId: currentApp,
                          providerId: pendingDelete.providerId,
                          providerName: getProviderDisplayName(pendingDelete),
                          requiresServiceRestart:
                            capabilities.requiresServiceRestart,
                        });
                      }}
                      disabled={
                        deleteMutation.isPending ||
                        !pendingDelete.providerId ||
                        !capabilities.canDelete
                      }
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Confirm delete
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPendingDelete(null)}
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {!hasProviders ? (
              <EmptyState appId={currentApp} canAdd={canAddProviders} />
            ) : (
              <div className="space-y-3">
                {state.providers.map((provider) => {
                  const providerName = getProviderDisplayName(provider);

                  return (
                    <article
                      key={provider.providerId ?? providerName}
                      className={cn(
                        "rounded-xl border p-4 transition-colors",
                        provider.active
                          ? "border-blue-500/40 bg-blue-500/5"
                          : "border-border-default bg-background",
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium">{providerName}</h3>
                            {provider.active ? (
                              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                Active
                              </span>
                            ) : null}
                            {provider.tokenConfigured ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                Secret stored
                              </span>
                            ) : null}
                          </div>
                          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                            <p className="truncate">
                              <span className="font-medium text-foreground">
                                Base URL:
                              </span>{" "}
                              {provider.baseUrl || "-"}
                            </p>
                            <p className="truncate">
                              <span className="font-medium text-foreground">
                                Model:
                              </span>{" "}
                              {provider.model || "-"}
                            </p>
                            <p className="truncate">
                              <span className="font-medium text-foreground">
                                Token field:
                              </span>{" "}
                              {provider.tokenField}
                            </p>
                            <p className="truncate">
                              <span className="font-medium text-foreground">
                                Provider ID:
                              </span>{" "}
                              {provider.providerId || "-"}
                            </p>
                          </div>
                          {provider.notes ? (
                            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                              {provider.notes}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleEdit(provider)}
                            disabled={!capabilities.canEdit || isMutating}
                            aria-label={`Edit ${providerName}`}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
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
                            disabled={
                              !capabilities.canActivate ||
                              !provider.providerId ||
                              provider.active ||
                              isMutating
                            }
                            aria-label={`Activate ${providerName}`}
                          >
                            {activateMutation.isPending &&
                            activateMutation.variables?.providerId ===
                              provider.providerId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Zap className="h-4 w-4" />
                            )}
                            {provider.active ? "Active" : "Activate"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setPendingDelete(provider)}
                            disabled={!capabilities.canDelete || isMutating}
                            aria-label={`Delete ${providerName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">{editorTitle}</CardTitle>
            <p className="text-sm text-muted-foreground">{editorDescription}</p>
          </CardHeader>
          <CardContent>
            {showEditorForm ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-preset`}>Preset</Label>
                  <select
                    id={`${fieldIdPrefix}-preset`}
                    className={FIELD_CLASS_NAME}
                    value={selectedPresetId}
                    onChange={(event) => handlePresetChange(event.target.value)}
                    disabled={!capabilities.supportsPresets || formDisabled}
                  >
                    <option value="custom">Custom</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {selectedPreset
                      ? selectedPreset.description ||
                        getGenericPresetDescription()
                      : "Custom mode keeps the current fields editable without applying a preset."}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-name`}>Provider name</Label>
                    <Input
                      id={`${fieldIdPrefix}-name`}
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((currentDraft) => ({
                          ...currentDraft,
                          name: event.target.value,
                        }))
                      }
                      required
                      disabled={formDisabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-model`}>Model</Label>
                    <Input
                      id={`${fieldIdPrefix}-model`}
                      value={draft.model}
                      onChange={(event) =>
                        setDraft((currentDraft) => ({
                          ...currentDraft,
                          model: event.target.value,
                        }))
                      }
                      placeholder="Optional model override"
                      disabled={formDisabled}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-base-url`}>Base URL</Label>
                  <Input
                    id={`${fieldIdPrefix}-base-url`}
                    value={draft.baseUrl}
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        baseUrl: event.target.value,
                      }))
                    }
                    required
                    disabled={formDisabled}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-token-field`}>
                      Token field
                    </Label>
                    <select
                      id={`${fieldIdPrefix}-token-field`}
                      className={FIELD_CLASS_NAME}
                      value={draft.tokenField}
                      onChange={(event) =>
                        setDraft((currentDraft) => ({
                          ...currentDraft,
                          tokenField: event.target
                            .value as SharedProviderEditorPayload["tokenField"],
                        }))
                      }
                      disabled={formDisabled}
                    >
                      {tokenFieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-token`}>API token</Label>
                    <Input
                      id={`${fieldIdPrefix}-token`}
                      type="password"
                      value={draft.token}
                      onChange={(event) =>
                        setDraft((currentDraft) => ({
                          ...currentDraft,
                          token: event.target.value,
                        }))
                      }
                      placeholder={
                        editingProvider && capabilities.supportsBlankSecretPreserve
                          ? "Leave blank to keep the stored secret"
                          : "Enter the secret for this provider"
                      }
                      required={
                        !editingProvider ||
                        !capabilities.supportsBlankSecretPreserve
                      }
                      disabled={formDisabled}
                    />
                    {editingProvider &&
                    capabilities.supportsBlankSecretPreserve &&
                    editingProvider.tokenConfigured ? (
                      <p className="text-xs text-muted-foreground">
                        Leave the token blank to preserve the stored secret.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`${fieldIdPrefix}-notes`}>Notes</Label>
                  <Textarea
                    id={`${fieldIdPrefix}-notes`}
                    value={draft.notes}
                    onChange={(event) =>
                      setDraft((currentDraft) => ({
                        ...currentDraft,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Optional notes for this provider"
                    disabled={formDisabled}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={formDisabled}>
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : editingProvider ? (
                      <RotateCw className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {editingProvider ? "Update provider" : "Save provider"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={saveMutation.isPending}
                  >
                    {editingProvider ? "Cancel edit" : "Reset form"}
                  </Button>
                </div>
              </form>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {capabilities.canEdit
                    ? "Adding providers is unavailable."
                    : "Provider editing is unavailable."}
                </AlertTitle>
                <AlertDescription>
                  {capabilities.canEdit
                    ? hasProviders
                      ? `This adapter does not allow adding new ${APP_META[currentApp].label} providers. Select a saved provider to edit it instead.`
                      : `This adapter does not allow adding new ${APP_META[currentApp].label} providers.`
                    : `This adapter exposes ${APP_META[currentApp].label} providers without add/edit support.`}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
