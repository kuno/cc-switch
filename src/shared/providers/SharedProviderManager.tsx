import {
  type FormEvent,
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  type SharedProviderPreset,
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

type PresetGroupId = "official" | "platform" | "compatible";

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

function createSearchState(): Record<SharedProviderAppId, string> {
  return {
    claude: "",
    codex: "",
    gemini: "",
  };
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

function getPresetGroups(
  appId: SharedProviderAppId,
  presets: SharedProviderPreset[],
): Array<{
  id: PresetGroupId;
  label: string;
  hint: string;
  presets: SharedProviderPreset[];
}> {
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

function getMatchedPreset(
  appId: SharedProviderAppId,
  provider: SharedProviderView,
): SharedProviderPreset | null {
  const presetId = inferSharedProviderPresetId(appId, provider);

  if (presetId === "custom") {
    return null;
  }

  return getSharedProviderPresetById(appId, presetId);
}

function getProviderSearchText(
  appId: SharedProviderAppId,
  provider: SharedProviderView,
): string {
  const preset = getMatchedPreset(appId, provider);

  return [
    provider.name,
    provider.providerId,
    provider.baseUrl,
    provider.notes,
    preset?.label,
    preset?.providerName,
    preset?.sourcePresetName,
    preset?.description,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function getVisibleProviders(
  appId: SharedProviderAppId,
  providers: SharedProviderView[],
  searchQuery: string,
): SharedProviderView[] {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  if (!normalizedSearchQuery) {
    return providers;
  }

  return providers.filter((provider) =>
    getProviderSearchText(appId, provider).includes(normalizedSearchQuery),
  );
}

function getResultSummary(
  visibleCount: number,
  totalCount: number,
  searchQuery: string,
): string {
  const resultLabel = visibleCount === 1 ? "result" : "results";

  return `Showing ${visibleCount} ${resultLabel} for "${searchQuery}" out of ${totalCount}.`;
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
    return `${APP_META[appId].label} providers are visible here, but unsupported management actions stay hidden for this adapter.`;
  }

  if (!capabilities.canAdd) {
    return `Saved ${APP_META[appId].label} providers remain editable, but adding new entries is disabled for this adapter.`;
  }

  return "Use the operations supported by this adapter to manage saved providers.";
}

function LoadingState() {
  return (
    <div className="space-y-4 rounded-xl border border-dashed bg-muted/10 p-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p>Loading providers...</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="space-y-3 rounded-xl border bg-background p-4"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="h-3 animate-pulse rounded bg-muted" />
              <div className="h-3 animate-pulse rounded bg-muted" />
              <div className="h-3 animate-pulse rounded bg-muted" />
              <div className="h-3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-destructive/40 px-6 text-center">
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
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Plus className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">
          No providers saved for {APP_META[appId].label} yet.
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
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Search className="h-5 w-5" />
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

function ProviderCard({
  appId,
  capabilities,
  isMutating,
  onActivate,
  onDelete,
  onEdit,
  provider,
}: {
  appId: SharedProviderAppId;
  capabilities: SharedProviderCapabilities;
  isMutating: boolean;
  onActivate: (provider: SharedProviderView) => void;
  onDelete: (provider: SharedProviderView) => void;
  onEdit: (provider: SharedProviderView) => void;
  provider: SharedProviderView;
}) {
  const providerName = getProviderDisplayName(provider);
  const matchedPreset = getMatchedPreset(appId, provider);
  const canShowActions =
    capabilities.canEdit || capabilities.canActivate || capabilities.canDelete;

  return (
    <article
      className={cn(
        "flex h-full flex-col justify-between rounded-2xl border bg-background p-5 shadow-sm transition-colors",
        provider.active
          ? "border-blue-500/40 bg-blue-500/5 shadow-blue-500/10"
          : "border-border-default",
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold">
                {providerName}
              </h3>
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
            {matchedPreset ? (
              <p className="text-xs text-muted-foreground">
                Preset hint: {matchedPreset.label}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
              APP_META[appId].chipClassName,
            )}
          >
            {APP_META[appId].label}
          </span>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Base URL
            </dt>
            <dd className="break-all text-foreground">
              {provider.baseUrl || "-"}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Model
            </dt>
            <dd className="break-all text-foreground">
              {provider.model || "-"}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Token field
            </dt>
            <dd className="break-all text-foreground">{provider.tokenField}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Provider ID
            </dt>
            <dd className="break-all text-foreground">
              {provider.providerId || "-"}
            </dd>
          </div>
        </dl>

        {provider.notes ? (
          <div className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            {provider.notes}
          </div>
        ) : null}
      </div>

      {canShowActions ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {capabilities.canEdit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onEdit(provider)}
              disabled={isMutating}
              aria-label={`Edit ${providerName}`}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null}
          {capabilities.canActivate ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onActivate(provider)}
              disabled={!provider.providerId || provider.active || isMutating}
              aria-label={`Activate ${providerName}`}
            >
              <Zap className="h-4 w-4" />
              {provider.active ? "Active" : "Activate"}
            </Button>
          ) : null}
          {capabilities.canDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(provider)}
              disabled={isMutating}
              aria-label={`Delete ${providerName}`}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
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
  const queryClient = useQueryClient();
  const currentApp = selectedApp ?? internalApp;
  const currentAppRef = useRef(currentApp);
  const fieldIdPrefix = useId();
  const editorFormId = `${fieldIdPrefix}-provider-editor-form`;
  const presets = getSharedProviderPresets(currentApp);
  const presetGroups = getPresetGroups(currentApp, presets);
  const tokenFieldOptions = TOKEN_FIELD_OPTIONS[currentApp];
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
      ? getVisibleProviders(currentApp, state.providers, deferredSearchQuery)
      : [];
  const hasProviders = state != null && state.providers.length > 0;
  const selectedPreset =
    selectedPresetId === "custom"
      ? null
      : getSharedProviderPresetById(currentApp, selectedPresetId);
  const editorTitle = editingProvider ? "Edit provider" : "Add provider";
  const editorDescription = editingProvider
    ? `Update ${getProviderDisplayName(editingProvider)} for ${APP_META[currentApp].label}.`
    : `Create a saved provider for ${APP_META[currentApp].label}. Presets only update this local draft until you save.`;
  const isRefreshing = stateQuery.isFetching || capabilitiesQuery.isFetching;

  useEffect(() => {
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

    if (selectedApp == null) {
      setInternalApp(appId);
    }

    onSelectedAppChange?.(appId);
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

  async function confirmDelete() {
    if (!pendingDelete?.providerId || !capabilities.canDelete) {
      return;
    }

    deleteMutation.mutate({
      appId: currentApp,
      providerId: pendingDelete.providerId,
      providerName: getProviderDisplayName(pendingDelete),
      requiresServiceRestart: capabilities.requiresServiceRestart,
    });
  }

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

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              {APP_META[currentApp].label} saved providers
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {getProviderRegionDescription(
                currentApp,
                state,
                capabilitiesQuery.data,
              )}
            </p>
          </div>
          {state ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                APP_META[currentApp].chipClassName,
              )}
            >
              {state.providers.length} saved
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {hasRegionError ? (
            <ErrorState onRetry={() => void handleRetry()} />
          ) : isRegionLoading ? (
            <LoadingState />
          ) : state ? (
            <>
              <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search providers"
                    placeholder={`Search ${APP_META[currentApp].label} providers`}
                    value={searchQuery}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    className="pl-9 pr-10"
                    disabled={!hasProviders && searchQuery.length === 0}
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={clearSearch}
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 lg:items-end">
                  {deferredSearchQuery.trim() ? (
                    <p className="text-sm text-muted-foreground">
                      {getResultSummary(
                        filteredProviders.length,
                        state.providers.length,
                        deferredSearchQuery.trim(),
                      )}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleRetry()}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      Refresh
                    </Button>
                    {capabilities.canAdd ? (
                      <Button
                        type="button"
                        onClick={openAddEditor}
                        disabled={isMutating}
                      >
                        <Plus className="h-4 w-4" />
                        Add provider
                      </Button>
                    ) : null}
                  </div>
                </div>
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
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredProviders.map((provider) => (
                    <ProviderCard
                      key={
                        provider.providerId ?? getProviderDisplayName(provider)
                      }
                      appId={currentApp}
                      capabilities={capabilities}
                      isMutating={isMutating}
                      onActivate={(targetProvider) => {
                        if (!targetProvider.providerId) {
                          return;
                        }

                        activateMutation.mutate({
                          appId: currentApp,
                          providerId: targetProvider.providerId,
                          providerName: getProviderDisplayName(targetProvider),
                          requiresServiceRestart:
                            capabilities.requiresServiceRestart,
                        });
                      }}
                      onDelete={(targetProvider) =>
                        setPendingDelete(targetProvider)
                      }
                      onEdit={openEditEditor}
                      provider={provider}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={isEditorOpen}
        onOpenChange={(open) => {
          if (!open && !saveMutation.isPending) {
            resetEditorForApp(currentApp);
          }
        }}
      >
        <DialogContent className="max-w-5xl p-0" zIndex="top">
          <DialogHeader>
            <DialogTitle>{editorTitle}</DialogTitle>
            <DialogDescription>{editorDescription}</DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "grid gap-6 px-6 py-5",
              capabilities.supportsPresets
                ? "lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
                : "grid-cols-1",
            )}
          >
            {capabilities.supportsPresets ? (
              <section className="space-y-4">
                <div className="space-y-1">
                  <Label>Presets</Label>
                  <p className="text-sm text-muted-foreground">
                    Preset selection only fills the local draft fields supported
                    on OpenWrt. Nothing is written until you save.
                  </p>
                </div>
                <div className="space-y-4 rounded-2xl border bg-muted/20 p-4">
                  <Button
                    type="button"
                    variant={
                      selectedPresetId === "custom" ? "default" : "outline"
                    }
                    className="w-full justify-start"
                    onClick={() => handlePresetChange("custom")}
                    disabled={saveMutation.isPending}
                  >
                    Custom endpoint
                  </Button>
                  <div className="max-h-[24rem] space-y-4 overflow-y-auto pr-1">
                    {presetGroups.map((group) => (
                      <div key={group.id} className="space-y-2">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{group.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.hint}
                          </p>
                        </div>
                        <div className="grid gap-2">
                          {group.presets.map((preset) => (
                            <Button
                              key={preset.id}
                              type="button"
                              variant={
                                selectedPresetId === preset.id
                                  ? "default"
                                  : "outline"
                              }
                              className="h-auto min-h-11 justify-start whitespace-normal px-3 py-2 text-left"
                              onClick={() => handlePresetChange(preset.id)}
                              disabled={saveMutation.isPending}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-background px-4 py-3 text-sm text-muted-foreground">
                  {selectedPreset
                    ? selectedPreset.description ||
                      getGenericPresetDescription()
                    : "Custom mode keeps the current draft editable without applying a preset."}
                </div>
              </section>
            ) : null}

            <section className="space-y-4">
              <form
                id={editorFormId}
                className="space-y-4"
                onSubmit={handleSubmit}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`${fieldIdPrefix}-name`}>
                      Provider name
                    </Label>
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
                      disabled={saveMutation.isPending}
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
                      disabled={saveMutation.isPending}
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
                    disabled={saveMutation.isPending}
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
                      disabled={saveMutation.isPending}
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
                        editingProvider &&
                        capabilities.supportsBlankSecretPreserve
                          ? "Leave blank to keep the stored secret"
                          : "Enter the secret for this provider"
                      }
                      required={
                        !editingProvider ||
                        !capabilities.supportsBlankSecretPreserve
                      }
                      disabled={saveMutation.isPending}
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
                    disabled={saveMutation.isPending}
                  />
                </div>
              </form>
            </section>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => resetEditorForApp(currentApp)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={editorFormId}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingProvider ? (
                <RotateCw className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {editingProvider ? "Update provider" : "Save provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setPendingDelete(null);
          }
        }}
      >
        <DialogContent className="max-w-sm" zIndex="alert">
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete provider?
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              {pendingDelete
                ? `${getProviderDisplayName(pendingDelete)} will be removed from ${APP_META[currentApp].label}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 border-t-0 bg-transparent pt-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingDelete(null)}
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
