import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createOpenWrtProviderAdapter,
  type OpenWrtProviderTransport,
} from "@/platform/openwrt/providers";
import {
  emptySharedProviderEditorPayload,
  getSharedProviderPresetById,
  getSharedProviderPresets,
  inferSharedProviderPresetId,
  type SharedProviderAppId,
  type SharedProviderEditorPayload,
  type SharedProviderState,
  type SharedProviderView,
} from "@/shared/providers/domain";
import {
  getSharedProviderPresetBrowseGroups,
  SHARED_PROVIDER_TOKEN_FIELD_OPTIONS,
} from "@/shared/providers/ui/presentation";
import type { OpenWrtSharedPageShellApi } from "../pageTypes";
import {
  ProviderSidePanel,
  type ProviderSidePanelTab,
} from "./ProviderSidePanel";
import type { ProviderSidePanelPresetGroup } from "./ProviderSidePanelPresetTab";

type ProviderSidePanelMode = "new" | "edit";

type ProviderSidePanelHostProps = {
  shell: OpenWrtSharedPageShellApi;
  transport: OpenWrtProviderTransport;
  selectedApp: SharedProviderAppId;
};

export interface ProviderSidePanelHandle {
  close: () => void;
  openForApp: (appId: SharedProviderAppId, providerId?: string) => void;
}

function getAppLabel(appId: SharedProviderAppId): string {
  if (appId === "claude") {
    return "Claude";
  }

  if (appId === "codex") {
    return "Codex";
  }

  return "Gemini";
}

function getProviderName(
  providerId: string | null,
  providerState: SharedProviderState,
): string {
  if (providerId) {
    const matchedProvider =
      providerState.providers.find((provider) => provider.providerId === providerId) ??
      (providerState.activeProvider.providerId === providerId
        ? providerState.activeProvider
        : null);

    if (matchedProvider?.name.trim()) {
      return matchedProvider.name.trim();
    }
  }

  if (providerState.activeProvider.name.trim()) {
    return providerState.activeProvider.name.trim();
  }

  return providerId || "Provider";
}

function getMutationMessage(
  mutation: "save" | "activate" | "delete",
  providerName: string,
  serviceRunning: boolean,
  restartRequired: boolean,
): {
  kind: "info" | "success";
  text: string;
} {
  const verb =
    mutation === "save"
      ? "saved"
      : mutation === "activate"
        ? "activated"
        : "deleted";

  if (restartRequired) {
    return {
      kind: "info",
      text: `${providerName} was ${verb}. Restart the service to apply provider changes.`,
    };
  }

  if (!serviceRunning) {
    return {
      kind: "success",
      text: `${providerName} was ${verb}. The service is stopped, so no restart is needed right now.`,
    };
  }

  return {
    kind: "success",
    text: `${providerName} was ${verb}. Changes are available immediately.`,
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
    authMode: provider.authMode,
  };
}

function normalizeDraftForCompare(draft: SharedProviderEditorPayload) {
  return {
    name: draft.name,
    baseUrl: draft.baseUrl,
    tokenField: draft.tokenField,
    token: draft.token,
    model: draft.model,
    notes: draft.notes,
    authMode: draft.authMode || "",
  };
}

function areDraftsEqual(
  left: SharedProviderEditorPayload,
  right: SharedProviderEditorPayload,
): boolean {
  const normalizedLeft = normalizeDraftForCompare(left);
  const normalizedRight = normalizeDraftForCompare(right);

  return (
    normalizedLeft.name === normalizedRight.name &&
    normalizedLeft.baseUrl === normalizedRight.baseUrl &&
    normalizedLeft.tokenField === normalizedRight.tokenField &&
    normalizedLeft.token === normalizedRight.token &&
    normalizedLeft.model === normalizedRight.model &&
    normalizedLeft.notes === normalizedRight.notes &&
    normalizedLeft.authMode === normalizedRight.authMode
  );
}

function allowsOptionalToken(authMode?: string): boolean {
  return authMode === "client_passthrough" || authMode === "codex_oauth";
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

function getProviderById(
  providerState: SharedProviderState | null,
  providerId: string | null,
): SharedProviderView | null {
  if (!providerState || !providerId) {
    return null;
  }

  return (
    providerState.providers.find((provider) => provider.providerId === providerId) ??
    null
  );
}

function getDefaultProviderId(state: SharedProviderState): string | null {
  if (state.activeProviderId) {
    return state.activeProviderId;
  }

  return state.providers[0]?.providerId ?? null;
}

function getProviderIdFromDraft(
  providerState: SharedProviderState,
  draft: SharedProviderEditorPayload,
): string | null {
  return (
    providerState.providers.find(
      (provider) =>
        provider.name === draft.name &&
        provider.baseUrl === draft.baseUrl &&
        provider.tokenField === draft.tokenField,
    )?.providerId ?? null
  );
}

function createNewDraft(appId: SharedProviderAppId): SharedProviderEditorPayload {
  return emptySharedProviderEditorPayload(appId);
}

function getSaveValidity(
  mode: ProviderSidePanelMode,
  provider: SharedProviderView | null,
  draft: SharedProviderEditorPayload,
): boolean {
  if (!draft.name.trim() || !draft.baseUrl.trim()) {
    return false;
  }

  if (allowsOptionalToken(draft.authMode)) {
    return true;
  }

  if (draft.token.trim()) {
    return true;
  }

  return mode === "edit" && Boolean(provider?.tokenConfigured);
}

function filterProviders(
  providers: SharedProviderView[],
  query: string,
): SharedProviderView[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return providers;
  }

  return providers.filter((provider) =>
    `${provider.name} ${provider.baseUrl} ${provider.providerId ?? ""}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function buildPresetGroups(
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

export const ProviderSidePanelHost = forwardRef<
  ProviderSidePanelHandle,
  ProviderSidePanelHostProps
>(function ProviderSidePanelHost(
  { shell, transport, selectedApp },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState<SharedProviderAppId>(selectedApp);
  const [providerState, setProviderState] = useState<SharedProviderState | null>(null);
  const [mode, setMode] = useState<ProviderSidePanelMode>("new");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SharedProviderEditorPayload>(() =>
    createNewDraft(selectedApp),
  );
  const [baselineDraft, setBaselineDraft] =
    useState<SharedProviderEditorPayload | null>(null);
  const [website, setWebsite] = useState("");
  const [tab, setTab] = useState<ProviderSidePanelTab>("general");
  const [search, setSearch] = useState("");
  const [selectedAuthFile, setSelectedAuthFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [activatePending, setActivatePending] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const loadRequestIdRef = useRef(0);
  const deferredSearch = useDeferredValue(search);
  const selectedProvider = getProviderById(providerState, selectedProviderId);
  const presetGroups = useMemo(() => buildPresetGroups(appId), [appId]);
  const filteredProviders = useMemo(
    () => filterProviders(providerState?.providers ?? [], deferredSearch),
    [deferredSearch, providerState?.providers],
  );
  const selectedPresetId = useMemo(() => {
    if (!draft.baseUrl.trim()) {
      return "custom";
    }

    return inferSharedProviderPresetId(appId, {
      baseUrl: draft.baseUrl,
      tokenField: draft.tokenField,
    });
  }, [appId, draft.baseUrl, draft.tokenField]);
  const canSave = getSaveValidity(mode, selectedProvider, draft);
  const saveIdle =
    mode === "edit" && baselineDraft ? areDraftsEqual(draft, baselineDraft) : false;
  const canDelete =
    mode === "edit" && Boolean(selectedProvider?.providerId) && providerState?.phase2Available;
  const canActivate =
    mode === "edit" &&
    Boolean(selectedProvider?.providerId) &&
    Boolean(providerState?.phase2Available) &&
    !selectedProvider?.active;

  const providerAdapter = useMemo(
    () =>
      createOpenWrtProviderAdapter(transport, {
        getServiceRunning() {
          return shell.getServiceStatus().isRunning;
        },
        async onProviderMutation(event) {
          if (event.restartRequired) {
            shell.setRestartState?.({
              pending: true,
            });
          }

          const message = getMutationMessage(
            event.mutation,
            getProviderName(event.providerId, event.providerState),
            event.serviceRunning,
            event.restartRequired,
          );
          shell.showMessage(message.kind, message.text);
        },
      }),
    [shell, transport],
  );

  function syncSelectionFromState(
    nextAppId: SharedProviderAppId,
    nextState: SharedProviderState,
    nextMode: ProviderSidePanelMode,
    providerId: string | null,
  ) {
    if (nextMode === "edit" && providerId) {
      const provider = getProviderById(nextState, providerId);

      if (provider) {
        const nextDraft = createDraftFromProvider(provider);
        setAppId(nextAppId);
        setProviderState(nextState);
        setMode("edit");
        setSelectedProviderId(provider.providerId);
        setDraft(nextDraft);
        setBaselineDraft(nextDraft);
        setWebsite(deriveWebsite(provider.baseUrl));
        setSelectedAuthFile(null);
        setTab("general");
        return;
      }
    }

    setAppId(nextAppId);
    setProviderState(nextState);
    setMode("new");
    setSelectedProviderId(null);
    setDraft(createNewDraft(nextAppId));
    setBaselineDraft(null);
    setWebsite("");
    setSelectedAuthFile(null);
    setTab("preset");
  }

  async function loadWorkspace(
    nextAppId: SharedProviderAppId,
    nextProviderId: string | null = null,
    preferredMode: ProviderSidePanelMode | null = null,
  ) {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const nextState = await providerAdapter.listProviderState(nextAppId);

      if (loadRequestIdRef.current !== requestId) {
        return;
      }

      const resolvedProviderId =
        nextProviderId || getDefaultProviderId(nextState);
      const resolvedMode =
        preferredMode ?? (resolvedProviderId ? "edit" : "new");

      syncSelectionFromState(
        nextAppId,
        nextState,
        resolvedMode,
        resolvedProviderId,
      );
    } catch (loadError) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }

      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  function closePanel() {
    setOpen(false);
    setSelectedAuthFile(null);
    setSearch("");
  }

  function openForApp(nextAppId: SharedProviderAppId, providerId?: string) {
    setOpen(true);
    setSearch("");
    void loadWorkspace(nextAppId, providerId ?? null, providerId ? "edit" : null);
  }

  useImperativeHandle(ref, () => ({
    close: closePanel,
    openForApp,
  }));

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleAddProvider() {
    setMode("new");
    setSelectedProviderId(null);
    setDraft(createNewDraft(appId));
    setBaselineDraft(null);
    setWebsite("");
    setSelectedAuthFile(null);
    setTab("preset");
  }

  function handleSelectProvider(providerId: string) {
    if (!providerState) {
      return;
    }

    syncSelectionFromState(appId, providerState, "edit", providerId);
  }

  function handlePresetSelect(presetId: string) {
    const preset = getSharedProviderPresetById(appId, presetId);

    if (!preset) {
      if (mode === "new") {
        const nextDraft = createNewDraft(appId);
        setSelectedProviderId(null);
        setDraft(nextDraft);
        setBaselineDraft(null);
        setWebsite("");
      }
      return;
    }

    const nextDraft: SharedProviderEditorPayload = {
      ...draft,
      name: preset.providerName,
      baseUrl: preset.baseUrl,
      tokenField: preset.tokenField,
      model: preset.model,
      authMode: preset.authMode,
      token: "",
    };

    setDraft(nextDraft);
    setWebsite(deriveWebsite(preset.baseUrl));
    if (mode === "new") {
      setBaselineDraft(null);
    }
  }

  async function refreshSelectionAfterMutation(
    nextAppId: SharedProviderAppId,
    nextMode: ProviderSidePanelMode,
    preferredProviderId: string | null,
    draftHint: SharedProviderEditorPayload,
  ) {
    const nextState = await providerAdapter.listProviderState(nextAppId);
    const resolvedProviderId =
      preferredProviderId ||
      getProviderIdFromDraft(nextState, draftHint) ||
      getDefaultProviderId(nextState);

    syncSelectionFromState(
      nextAppId,
      nextState,
      nextMode,
      nextMode === "edit" ? resolvedProviderId : null,
    );
  }

  async function handleSave() {
    if (!canSave || savePending || loading) {
      return;
    }

    setSavePending(true);
    try {
      await providerAdapter.saveProvider(
        appId,
        draft,
        mode === "edit" ? selectedProvider?.providerId ?? undefined : undefined,
      );
      await refreshSelectionAfterMutation(
        appId,
        "edit",
        mode === "edit" ? selectedProvider?.providerId ?? null : null,
        draft,
      );
    } catch (saveError) {
      shell.showMessage(
        "error",
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setSavePending(false);
    }
  }

  async function handleDelete() {
    if (!selectedProvider?.providerId || !canDelete || deletePending) {
      return;
    }

    const confirmed = window.confirm(
      `Delete provider "${selectedProvider.name || selectedProvider.providerId}"? This removes the route from the daemon.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletePending(true);
    try {
      await providerAdapter.deleteProvider(appId, selectedProvider.providerId);
      const nextState = await providerAdapter.listProviderState(appId);
      const nextProviderId = getDefaultProviderId(nextState);
      syncSelectionFromState(
        appId,
        nextState,
        nextProviderId ? "edit" : "new",
        nextProviderId,
      );
    } catch (deleteError) {
      shell.showMessage(
        "error",
        deleteError instanceof Error ? deleteError.message : String(deleteError),
      );
    } finally {
      setDeletePending(false);
    }
  }

  async function handleActivate() {
    if (!selectedProvider?.providerId || !canActivate || activatePending) {
      return;
    }

    setActivatePending(true);
    try {
      await providerAdapter.activateProvider(appId, selectedProvider.providerId);
      await refreshSelectionAfterMutation(
        appId,
        "edit",
        selectedProvider.providerId,
        draft,
      );
    } catch (activateError) {
      shell.showMessage(
        "error",
        activateError instanceof Error
          ? activateError.message
          : String(activateError),
      );
    } finally {
      setActivatePending(false);
    }
  }

  async function handleUploadCodexAuth() {
    if (
      authPending ||
      !selectedProvider?.providerId ||
      !selectedAuthFile ||
      !providerAdapter.uploadCodexAuth
    ) {
      return;
    }

    setAuthPending(true);
    try {
      await providerAdapter.uploadCodexAuth(
        appId,
        selectedProvider.providerId,
        await selectedAuthFile.text(),
      );
      await refreshSelectionAfterMutation(
        appId,
        "edit",
        selectedProvider.providerId,
        draft,
      );
      setSelectedAuthFile(null);
    } catch (uploadError) {
      shell.showMessage(
        "error",
        uploadError instanceof Error ? uploadError.message : String(uploadError),
      );
    } finally {
      setAuthPending(false);
    }
  }

  async function handleRemoveCodexAuth() {
    if (
      authPending ||
      !selectedProvider?.providerId ||
      !providerAdapter.removeCodexAuth
    ) {
      return;
    }

    setAuthPending(true);
    try {
      await providerAdapter.removeCodexAuth(appId, selectedProvider.providerId);
      await refreshSelectionAfterMutation(
        appId,
        "edit",
        selectedProvider.providerId,
        draft,
      );
      setSelectedAuthFile(null);
    } catch (removeError) {
      shell.showMessage(
        "error",
        removeError instanceof Error ? removeError.message : String(removeError),
      );
    } finally {
      setAuthPending(false);
    }
  }

  const footerText =
    mode === "new"
      ? `Create a new ${getAppLabel(appId)} route from this draft.`
      : selectedProvider?.active
        ? "Editing the active provider route."
        : `Editing ${selectedProvider?.name || selectedProvider?.providerId || "saved provider"}.`;

  return (
    <ProviderSidePanel
      appId={appId}
      open={open}
      loading={loading}
      error={error}
      mode={mode}
      providers={providerState?.providers ?? []}
      filteredProviders={filteredProviders}
      selectedProviderId={selectedProviderId}
      selectedProvider={selectedProvider}
      draft={draft}
      website={website}
      tab={tab}
      search={search}
      selectedPresetId={selectedPresetId}
      presetGroups={presetGroups}
      tokenFieldOptions={[...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS[appId]]}
      selectedFileName={selectedAuthFile?.name ?? ""}
      authPending={authPending}
      savePending={savePending}
      deletePending={deletePending}
      activatePending={activatePending}
      canActivate={canActivate}
      canDelete={Boolean(canDelete)}
      canSave={canSave}
      saveIdle={saveIdle}
      footerText={footerText}
      onClose={closePanel}
      onSearchChange={setSearch}
      onSelectProvider={handleSelectProvider}
      onAddProvider={handleAddProvider}
      onTabChange={setTab}
      onPresetSelect={handlePresetSelect}
      onDraftChange={setDraft}
      onWebsiteChange={setWebsite}
      onFileSelect={setSelectedAuthFile}
      onUploadCodexAuth={() => {
        void handleUploadCodexAuth();
      }}
      onRemoveCodexAuth={() => {
        void handleRemoveCodexAuth();
      }}
      onActivate={() => {
        void handleActivate();
      }}
      onDelete={() => {
        void handleDelete();
      }}
      onCancel={closePanel}
      onSave={() => {
        void handleSave();
      }}
    />
  );
});
