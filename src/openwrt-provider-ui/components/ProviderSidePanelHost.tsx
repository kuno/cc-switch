import {
  forwardRef,
  memo,
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
import { lockBodyScroll } from "../utils/bodyScrollLock";
import {
  ProviderSidePanel,
  type ProviderSidePanelTab,
} from "./ProviderSidePanel";
import type { ProviderSidePanelPresetGroup } from "./ProviderSidePanelPresetTab";

type ProviderSidePanelMode = "new" | "edit";
type ProviderSidePanelViewMode = "detail" | "preset-picker";

type ProviderSidePanelHostProps = {
  onOpenChange?: (open: boolean) => void;
  onProviderMutation?: () => void;
  shell: OpenWrtSharedPageShellApi;
  transport: OpenWrtProviderTransport;
  selectedApp: SharedProviderAppId;
};

export interface ProviderSidePanelHandle {
  close: () => void;
  openForApp: (appId: SharedProviderAppId, providerId?: string) => void;
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
    authContent: null,
    authMode: provider.authMode,
    baseUrl: provider.baseUrl,
    model: provider.model,
    name: provider.name,
    notes: provider.notes,
    token: "",
    tokenField: provider.tokenField,
  };
}

function normalizeDraftForCompare(draft: SharedProviderEditorPayload) {
  return {
    authContent: draft.authContent ?? null,
    authMode: draft.authMode || "",
    baseUrl: draft.baseUrl,
    model: draft.model,
    name: draft.name,
    notes: draft.notes,
    token: draft.token,
    tokenField: draft.tokenField,
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
    normalizedLeft.authMode === normalizedRight.authMode &&
    normalizedLeft.authContent === normalizedRight.authContent
  );
}

function allowsOptionalToken(authMode?: string): boolean {
  return (
    authMode === "client_passthrough" ||
    authMode === "codex_oauth" ||
    authMode === "claude_oauth"
  );
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

function hasInvalidAuthJson(authContent: string | null | undefined): boolean {
  if (!authContent || authContent === "") {
    return false;
  }

  try {
    JSON.parse(authContent);
    return false;
  } catch {
    return true;
  }
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

function getFooterText(
  mode: ProviderSidePanelMode,
  editing: boolean,
  saveIdle: boolean,
): string {
  if (mode === "new") {
    return "New provider · not saved";
  }

  if (!editing) {
    return "";
  }

  return saveIdle ? "Editing" : "Unsaved changes";
}

function normalizeAuthContentInput(value: string): string | null {
  return value.trim() ? value : null;
}

const ProviderSidePanelHostComponent = forwardRef<
  ProviderSidePanelHandle,
  ProviderSidePanelHostProps
>(function ProviderSidePanelHost(
  { onOpenChange, onProviderMutation, shell, transport, selectedApp },
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
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<ProviderSidePanelTab>("configure");
  const [panelMode, setPanelMode] =
    useState<ProviderSidePanelViewMode>("detail");
  const [search, setSearch] = useState("");
  const [pickerSelectedPresetId, setPickerSelectedPresetId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const loadRequestIdRef = useRef(0);
  const unlockBodyScrollRef = useRef<(() => void) | null>(null);
  const deferredSearch = useDeferredValue(search);
  const selectedProvider = getProviderById(providerState, selectedProviderId);
  const presetGroups = useMemo(() => buildPresetGroups(appId), [appId]);
  const tokenFieldOptions = useMemo(
    () => [...SHARED_PROVIDER_TOKEN_FIELD_OPTIONS[appId]],
    [appId],
  );
  const filteredProviders = useMemo(
    () => filterProviders(providerState?.providers ?? [], deferredSearch),
    [deferredSearch, providerState?.providers],
  );
  const draftPresetId = useMemo(() => {
    if (!draft.baseUrl.trim()) {
      return "custom";
    }

    return inferSharedProviderPresetId(appId, {
      baseUrl: draft.baseUrl,
      tokenField: draft.tokenField,
    });
  }, [appId, draft.baseUrl, draft.tokenField]);
  const website = deriveWebsite(draft.baseUrl);
  const canSave =
    getSaveValidity(mode, selectedProvider, draft) &&
    !hasInvalidAuthJson(draft.authContent);
  const saveIdle =
    mode === "edit" && baselineDraft ? areDraftsEqual(draft, baselineDraft) : false;
  const canDelete =
    mode === "edit" &&
    Boolean(selectedProvider?.providerId) &&
    Boolean(providerState?.phase2Available);

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
          onProviderMutation?.();
        },
      }),
    [onProviderMutation, shell, transport],
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
        setEditing(false);
        setPanelMode("detail");
        setPickerSelectedPresetId(null);
        setTab("activities");
        return;
      }
    }

    setAppId(nextAppId);
    setProviderState(nextState);
    setMode("new");
    setSelectedProviderId(null);
    setDraft(createNewDraft(nextAppId));
    setBaselineDraft(null);
    setEditing(false);
    setPanelMode("preset-picker");
    setPickerSelectedPresetId(null);
    setTab("configure");
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
    setSearch("");
    setPanelMode("detail");
    setPickerSelectedPresetId(null);
    setEditing(false);
  }

  function openForApp(nextAppId: SharedProviderAppId, providerId?: string) {
    setOpen(true);
    setSearch("");
    setPanelMode("detail");
    setPickerSelectedPresetId(null);
    void loadWorkspace(nextAppId, providerId ?? null, providerId ? "edit" : null);
  }

  useImperativeHandle(ref, () => ({
    close: closePanel,
    openForApp,
  }));

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const unlockBodyScroll = lockBodyScroll();
    unlockBodyScrollRef.current = unlockBodyScroll;

    return () => {
      if (unlockBodyScrollRef.current === unlockBodyScroll) {
        unlockBodyScrollRef.current = null;
      }

      unlockBodyScroll();
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
    setPickerSelectedPresetId(
      mode === "new" && !selectedProviderId ? draftPresetId : null,
    );
    setEditing(false);
    setPanelMode("preset-picker");
    setTab("configure");
  }

  function handleSelectProvider(providerId: string) {
    if (!providerState) {
      return;
    }

    syncSelectionFromState(appId, providerState, "edit", providerId);
  }

  function handlePresetSelect(presetId: string) {
    const preset = getSharedProviderPresetById(appId, presetId);
    const nextDraftBase = createNewDraft(appId);

    if (!preset) {
      setMode("new");
      setSelectedProviderId(null);
      setDraft(nextDraftBase);
      setBaselineDraft(nextDraftBase);
      setEditing(true);
      setPanelMode("detail");
      setPickerSelectedPresetId(null);
      setTab("configure");
      return;
    }

    const nextDraft: SharedProviderEditorPayload = {
      ...nextDraftBase,
      authMode: preset.authMode,
      baseUrl: preset.baseUrl,
      model: preset.model,
      name: preset.providerName,
      token: "",
      tokenField: preset.tokenField,
    };

    setMode("new");
    setSelectedProviderId(null);
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setEditing(true);
    setPanelMode("detail");
    setPickerSelectedPresetId(null);
    setTab("configure");
  }

  function handlePresetCancel() {
    if (providerState?.providers.length) {
      syncSelectionFromState(
        appId,
        providerState,
        "edit",
        selectedProviderId ?? getDefaultProviderId(providerState),
      );
      return;
    }

    closePanel();
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

  function handleCancel() {
    if (panelMode === "preset-picker") {
      handlePresetCancel();
      return;
    }

    if (mode === "edit" && editing && baselineDraft) {
      setDraft(baselineDraft);
      setEditing(false);
      return;
    }

    closePanel();
  }

  function handlePasteAuth() {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) {
          return;
        }

        let nextValue = text;

        try {
          nextValue = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          // Keep the pasted text as-is when it is not valid JSON yet.
        }

        setDraft((currentDraft) => ({
          ...currentDraft,
          authContent: normalizeAuthContentInput(nextValue),
        }));
      })
      .catch(() => undefined);
  }

  const footerText = getFooterText(mode, editing, saveIdle);

  return (
    <ProviderSidePanel
      appId={appId}
      open={open}
      showScrim={false}
      shell={shell}
      loading={loading}
      error={error}
      mode={mode}
      panelMode={panelMode}
      providers={providerState?.providers ?? []}
      filteredProviders={filteredProviders}
      selectedProviderId={selectedProviderId}
      selectedProvider={selectedProvider}
      draft={draft}
      editing={editing || mode === "new"}
      website={website}
      tab={tab}
      search={search}
      selectedPresetId={pickerSelectedPresetId}
      presetGroups={presetGroups}
      tokenFieldOptions={tokenFieldOptions}
      savePending={savePending}
      deletePending={deletePending}
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
      onPresetCancel={handlePresetCancel}
      onDraftChange={setDraft}
      onEdit={() => {
        setTab("configure");
        setEditing(true);
      }}
      onPasteAuth={handlePasteAuth}
      onClearAuth={() => {
        setDraft((currentDraft) => ({
          ...currentDraft,
          authContent: "",
        }));
      }}
      onDelete={() => {
        void handleDelete();
      }}
      onCancel={handleCancel}
      onSave={() => {
        void handleSave();
      }}
    />
  );
});

export const ProviderSidePanelHost = memo(ProviderSidePanelHostComponent);
