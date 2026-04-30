import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Copy,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { copyText } from "@/lib/clipboard";
import type {
  SharedProviderAppId,
  SharedProviderEditorPayload,
  SharedProviderTokenField,
  SharedProviderView,
} from "@/shared/providers/domain";
import type {
  OpenWrtPageMessage,
  OpenWrtSharedPageShellApi,
} from "../pageTypes";
import { getOpenWrtAppIconUrl, OpenWrtProviderIcon } from "../providerIcons";
import { ProviderSidePanelActivitiesTab } from "./ProviderSidePanelActivitiesTab";
import { ProviderSidePanelConfigureTab } from "./ProviderSidePanelConfigureTab";
import { getActiveElementInTree } from "./focusTree";
import {
  ProviderSidePanelPresetTab,
  type ProviderSidePanelPresetGroup,
} from "./ProviderSidePanelPresetTab";

export type ProviderSidePanelTab = "activities" | "configure";

interface ProviderSidePanelProps {
  appId: SharedProviderAppId;
  open: boolean;
  showScrim?: boolean;
  shell: OpenWrtSharedPageShellApi;
  loading: boolean;
  error: string | null;
  mode: "new" | "edit";
  panelMode?: "detail" | "preset-picker";
  providers: SharedProviderView[];
  filteredProviders: SharedProviderView[];
  selectedProviderId: string | null;
  selectedProvider: SharedProviderView | null;
  draft: SharedProviderEditorPayload;
  editing: boolean;
  website: string;
  tab: ProviderSidePanelTab;
  search: string;
  message?: OpenWrtPageMessage | null;
  selectedPresetId: string | null;
  presetGroups: ProviderSidePanelPresetGroup[];
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  savePending: boolean;
  activatePending: boolean;
  deletePending: boolean;
  canActivate: boolean;
  canDelete: boolean;
  canSave: boolean;
  saveIdle: boolean;
  failoverControlsAvailable?: boolean;
  failoverControlsReady?: boolean;
  failoverControlsLoading?: boolean;
  appAutoFailoverEnabled?: boolean;
  appFailoverPending?: boolean;
  providerInFailoverQueue?: boolean;
  providerFailoverPending?: boolean;
  providerReorderAvailable?: boolean;
  providerReorderPending?: boolean;
  providerReorderDisabled?: boolean;
  footerText: string;
  onClose: () => void;
  onSearchChange: (search: string) => void;
  onSelectProvider: (providerId: string) => void;
  onAddProvider: () => void;
  onTabChange: (tab: ProviderSidePanelTab) => void;
  onPresetSelect: (presetId: string) => void;
  onPresetCancel?: () => void;
  onDraftChange: (draft: SharedProviderEditorPayload) => void;
  onEdit: () => void;
  onPasteAuth: () => void;
  onClearAuth: () => void;
  onActivate: () => void;
  onDelete: () => void;
  onToggleAppAutoFailover?: (enabled: boolean) => void;
  onToggleProviderFailoverQueue?: (inQueue: boolean) => void;
  onReorderProviders?: (providerIds: string[]) => void;
  onCancel: () => void;
  onSave: () => void;
}

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

const APP_SUBTITLES: Record<SharedProviderAppId, string> = {
  claude: "Anthropic · Claude Code",
  codex: "OpenAI · Codex CLI",
  gemini: "Google · Gemini CLI",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function formatProviderIdChipLabel(providerId: string): string {
  if (providerId.length <= 15) {
    return providerId;
  }

  return `${providerId.slice(0, 10)}...${providerId.slice(-4)}`;
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

interface SortableProviderRailItemProps {
  appId: SharedProviderAppId;
  provider: SharedProviderView;
  selectedProviderId: string | null;
  showDragHandle: boolean;
  dragDisabled: boolean;
  onSelectProvider: (providerId: string) => void;
}

interface ProviderRailRowProps extends SortableProviderRailItemProps {
  setNodeRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  dragAttributes?: HTMLAttributes<HTMLButtonElement>;
  dragListeners?: HTMLAttributes<HTMLButtonElement>;
}

function ProviderRailRow({
  appId,
  provider,
  selectedProviderId,
  showDragHandle,
  dragDisabled,
  onSelectProvider,
  setNodeRef,
  style,
  isDragging = false,
  dragAttributes,
  dragListeners,
}: ProviderRailRowProps) {
  const providerLabel = provider.name || provider.providerId || "Provider";
  const sortableDisabled = dragDisabled || !provider.providerId;

  return (
    <div
      ref={setNodeRef}
      className="owt-provider-panel__provider-item"
      data-dragging={isDragging}
      data-reorderable={showDragHandle ? "true" : "false"}
      style={style}
    >
      {showDragHandle ? (
        <button
          type="button"
          className="owt-provider-panel__provider-drag"
          disabled={sortableDisabled}
          title={
            sortableDisabled
              ? "Clear search to reorder providers"
              : `Drag to reorder ${providerLabel}`
          }
          {...dragAttributes}
          {...dragListeners}
          aria-label={`Reorder ${providerLabel}`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className="owt-provider-panel__provider-row"
        data-active={provider.providerId === selectedProviderId}
        onClick={() =>
          provider.providerId
            ? onSelectProvider(provider.providerId)
            : undefined
        }
      >
        <div className="owt-provider-panel__provider-mark" data-app={appId}>
          <OpenWrtProviderIcon
            appId={appId}
            name={providerLabel}
            size={18}
            source={provider}
          />
        </div>
        <div className="owt-provider-panel__provider-copy">
          <div className="owt-provider-panel__provider-name">
            {providerLabel}
          </div>
        </div>
        {provider.active ? (
          <span className="owt-status-pill" data-tone="success">
            <span className="owt-status-pill__dot" aria-hidden="true" />
            Active
          </span>
        ) : null}
      </button>
    </div>
  );
}

function SortableProviderRailItem({
  appId,
  provider,
  selectedProviderId,
  showDragHandle,
  dragDisabled,
  onSelectProvider,
}: SortableProviderRailItemProps) {
  const providerKey = provider.providerId || provider.name;
  const sortableDisabled = dragDisabled || !provider.providerId;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: providerKey,
    disabled: sortableDisabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ProviderRailRow
      appId={appId}
      provider={provider}
      selectedProviderId={selectedProviderId}
      showDragHandle={showDragHandle}
      dragDisabled={dragDisabled}
      onSelectProvider={onSelectProvider}
      setNodeRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
}

export function ProviderSidePanel({
  appId,
  open,
  shell,
  loading,
  error,
  mode,
  panelMode = "detail",
  providers,
  filteredProviders,
  selectedProviderId,
  selectedProvider,
  draft,
  editing,
  website,
  tab,
  search,
  message = null,
  selectedPresetId,
  presetGroups,
  tokenFieldOptions,
  savePending,
  activatePending,
  deletePending,
  canActivate,
  canDelete,
  canSave,
  saveIdle,
  failoverControlsAvailable = false,
  failoverControlsReady = false,
  failoverControlsLoading = false,
  appAutoFailoverEnabled = false,
  appFailoverPending = false,
  providerInFailoverQueue = false,
  providerFailoverPending = false,
  providerReorderAvailable = false,
  providerReorderPending = false,
  providerReorderDisabled = false,
  footerText,
  showScrim = true,
  onClose,
  onSearchChange,
  onSelectProvider,
  onAddProvider,
  onTabChange,
  onPresetSelect,
  onPresetCancel,
  onDraftChange,
  onEdit,
  onPasteAuth,
  onClearAuth,
  onActivate,
  onDelete,
  onToggleAppAutoFailover,
  onToggleProviderFailoverQueue,
  onReorderProviders,
  onCancel,
  onSave,
}: ProviderSidePanelProps) {
  const providerName =
    (mode === "new"
      ? draft.name.trim() || "New provider"
      : selectedProvider?.name.trim()) || "Provider";
  const detailProviderId = selectedProvider?.providerId ?? null;
  const railProviders = filteredProviders;
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const saveFlashTimeoutRef = useRef<number | null>(null);
  const previousSavePendingRef = useRef(savePending);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const [copiedProviderId, setCopiedProviderId] = useState<string | null>(null);
  const [showSaveFlash, setShowSaveFlash] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const showFailoverCheckboxes =
    failoverControlsAvailable && mode === "edit" && Boolean(detailProviderId);
  const failoverCheckboxesDisabled =
    !failoverControlsReady ||
    failoverControlsLoading ||
    savePending ||
    activatePending ||
    deletePending;
  const providerIdsForReorder = railProviders
    .map((provider) => provider.providerId)
    .filter((providerId): providerId is string => Boolean(providerId));
  const showProviderReorder = providerReorderAvailable && providers.length > 1;
  const canReorderProviders =
    showProviderReorder &&
    !providerReorderDisabled &&
    !providerReorderPending &&
    providerIdsForReorder.length === railProviders.length &&
    providerIdsForReorder.length > 1;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const previousActiveElement = getActiveElementInTree(panelRef.current);

      previouslyFocusedRef.current =
        previousActiveElement instanceof HTMLElement
          ? previousActiveElement
          : null;

      const animationFrameId = window.requestAnimationFrame(() => {
        const focusTarget =
          closeButtonRef.current ||
          getFocusableElements(panelRef.current)[0] ||
          panelRef.current;

        focusTarget?.focus();
      });

      wasOpenRef.current = true;
      return () => {
        window.cancelAnimationFrame(animationFrameId);
      };
    }

    if (!open && wasOpenRef.current) {
      if (previouslyFocusedRef.current?.isConnected) {
        previouslyFocusedRef.current.focus();
      }
      wasOpenRef.current = false;
    }

    return undefined;
  }, [open]);

  useEffect(() => {
    setCopiedProviderId(null);
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
      copyFeedbackTimeoutRef.current = null;
    }
  }, [detailProviderId]);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      if (saveFlashTimeoutRef.current !== null) {
        window.clearTimeout(saveFlashTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (savePending) {
      setShowSaveFlash(false);
      previousSavePendingRef.current = true;
      return;
    }

    if (previousSavePendingRef.current && saveIdle) {
      setShowSaveFlash(true);
      if (saveFlashTimeoutRef.current !== null) {
        window.clearTimeout(saveFlashTimeoutRef.current);
      }
      saveFlashTimeoutRef.current = window.setTimeout(() => {
        setShowSaveFlash(false);
        saveFlashTimeoutRef.current = null;
      }, 1400);
    }

    previousSavePendingRef.current = false;
  }, [saveIdle, savePending]);

  useEffect(() => {
    if (!showSaveFlash || (!editing && saveIdle)) {
      return;
    }

    setShowSaveFlash(false);
    if (saveFlashTimeoutRef.current !== null) {
      window.clearTimeout(saveFlashTimeoutRef.current);
      saveFlashTimeoutRef.current = null;
    }
  }, [editing, saveIdle, showSaveFlash]);

  function handleTrapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (!open || event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements(panelRef.current);

    if (focusableElements.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElementInTree = getActiveElementInTree(panelRef.current);
    const activeElement =
      activeElementInTree instanceof HTMLElement ? activeElementInTree : null;
    const focusInsidePanel = Boolean(
      activeElement && panelRef.current?.contains(activeElement),
    );

    if (event.shiftKey) {
      if (!focusInsidePanel || activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (!focusInsidePanel || activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  async function handleCopyProviderId(providerId: string) {
    try {
      await copyText(providerId);
      setCopiedProviderId(providerId);

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopiedProviderId((currentProviderId) =>
          currentProviderId === providerId ? null : currentProviderId,
        );
        copyFeedbackTimeoutRef.current = null;
      }, 1600);
    } catch {
      // Ignore clipboard failures and leave the chip unchanged.
    }
  }

  function handleProviderDragEnd(event: DragEndEvent) {
    if (!canReorderProviders) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || activeId === overId) {
      return;
    }

    const oldIndex = providerIdsForReorder.indexOf(activeId);
    const newIndex = providerIdsForReorder.indexOf(overId);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    onReorderProviders?.(arrayMove(providerIdsForReorder, oldIndex, newIndex));
  }

  const providerRows = railProviders.map((provider) =>
    showProviderReorder ? (
      <SortableProviderRailItem
        key={provider.providerId || provider.name}
        appId={appId}
        provider={provider}
        selectedProviderId={selectedProviderId}
        showDragHandle={showProviderReorder}
        dragDisabled={!canReorderProviders}
        onSelectProvider={onSelectProvider}
      />
    ) : (
      <ProviderRailRow
        key={provider.providerId || provider.name}
        appId={appId}
        provider={provider}
        selectedProviderId={selectedProviderId}
        showDragHandle={false}
        dragDisabled
        onSelectProvider={onSelectProvider}
      />
    ),
  );

  return (
    <div
      className="owt-provider-panel-shell"
      data-open={open}
      data-has-scrim={showScrim ? "true" : "false"}
    >
      {showScrim ? (
        <button
          type="button"
          className="owt-provider-panel__scrim"
          aria-hidden={!open}
          tabIndex={open ? 0 : -1}
          onClick={onClose}
        />
      ) : null}

      <aside
        className="owt-provider-panel"
        data-panel-mode={panelMode}
        aria-hidden={!open}
        aria-label={`${APP_LABELS[appId]} providers`}
        aria-modal="true"
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handleTrapFocus}
      >
        <header className="owt-provider-panel__header">
          <div className="owt-provider-panel__app-badge" data-app={appId}>
            <img src={getOpenWrtAppIconUrl(appId)} alt="" />
          </div>
          <div className="owt-provider-panel__header-copy">
            <div className="owt-provider-panel__title-row">
              <h3 className="owt-provider-panel__title">{APP_LABELS[appId]}</h3>
              {showFailoverCheckboxes ? (
                <label
                  className="owt-provider-panel__failover-checkbox"
                  title={`${APP_LABELS[appId]} auto-failover`}
                >
                  <input
                    type="checkbox"
                    aria-label={`${APP_LABELS[appId]} auto-failover`}
                    checked={appAutoFailoverEnabled}
                    disabled={failoverCheckboxesDisabled || appFailoverPending}
                    onChange={(event) =>
                      onToggleAppAutoFailover?.(event.currentTarget.checked)
                    }
                  />
                </label>
              ) : null}
            </div>
            <div className="owt-provider-panel__subtitle">
              {APP_SUBTITLES[appId]}
            </div>
          </div>
          <button
            type="button"
            className="owt-provider-panel__close"
            onClick={onClose}
            aria-label="Close provider panel"
            ref={closeButtonRef}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="owt-provider-panel__body">
          <nav
            className="owt-provider-panel__rail"
            aria-label="Saved providers"
          >
            <label className="owt-provider-panel__search">
              <Search className="h-4 w-4" />
              <input
                type="text"
                placeholder="Search provider or endpoint"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>

            <div className="owt-provider-panel__rail-scroll">
              {providers.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  No providers yet. Create one from a preset or a custom draft.
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  No providers match “{search.trim()}”.
                </div>
              ) : showProviderReorder ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleProviderDragEnd}
                >
                  <SortableContext
                    items={providerIdsForReorder}
                    strategy={verticalListSortingStrategy}
                  >
                    {providerRows}
                  </SortableContext>
                </DndContext>
              ) : (
                providerRows
              )}
            </div>

            <div className="owt-provider-panel__rail-foot">
              <button
                type="button"
                className="owt-provider-panel__button"
                onClick={onAddProvider}
              >
                <Plus className="h-4 w-4" />
                Add provider
              </button>
            </div>
          </nav>

          <section
            className="owt-provider-panel__detail"
            data-panel-mode={panelMode}
          >
            <div className="owt-provider-panel__detail-shell">
              {panelMode === "detail" ? (
                <>
                  <div className="owt-provider-panel__detail-head">
                    <div className="owt-provider-panel__detail-identity">
                      <div
                        className="owt-provider-panel__provider-mark owt-provider-panel__provider-mark--detail"
                        data-app={appId}
                      >
                        <OpenWrtProviderIcon
                          appId={appId}
                          name={providerName}
                          size={22}
                          source={selectedProvider ?? draft}
                        />
                      </div>
                      <div className="owt-provider-panel__detail-copy">
                        <div className="owt-provider-panel__detail-title-row">
                          <div className="owt-provider-panel__detail-title">
                            {providerName}
                          </div>
                          {showFailoverCheckboxes ? (
                            <label
                              className="owt-provider-panel__failover-checkbox"
                              title="Failover queue"
                            >
                              <input
                                type="checkbox"
                                aria-label={`Include ${providerName} in failover queue`}
                                checked={providerInFailoverQueue}
                                disabled={
                                  failoverCheckboxesDisabled ||
                                  providerFailoverPending
                                }
                                onChange={(event) =>
                                  onToggleProviderFailoverQueue?.(
                                    event.currentTarget.checked,
                                  )
                                }
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="owt-provider-panel__detail-url">
                          {draft.baseUrl || "Not saved yet"}
                        </div>
                        {detailProviderId ? (
                          <button
                            type="button"
                            className="owt-provider-panel__id-chip"
                            data-copied={copiedProviderId === detailProviderId}
                            aria-label={`Copy provider ID ${detailProviderId}`}
                            title={
                              copiedProviderId === detailProviderId
                                ? "Copied"
                                : detailProviderId
                            }
                            onClick={() =>
                              void handleCopyProviderId(detailProviderId)
                            }
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            <span className="owt-provider-panel__id-chip-text">
                              {copiedProviderId === detailProviderId
                                ? "Copied"
                                : formatProviderIdChipLabel(detailProviderId)}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="owt-provider-panel__detail-meta">
                      {canActivate ? (
                        <button
                          type="button"
                          className="owt-provider-panel__icon-button owt-provider-panel__icon-button--accent"
                          aria-label="Set active"
                          disabled={
                            activatePending || deletePending || savePending
                          }
                          onClick={onActivate}
                        >
                          {activatePending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          className="owt-provider-panel__icon-button owt-provider-panel__icon-button--danger"
                          aria-label="Delete provider"
                          disabled={deletePending}
                          onClick={onDelete}
                        >
                          {deletePending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="owt-provider-panel__tabs" role="tablist">
                    <button
                      type="button"
                      className="owt-provider-panel__tab"
                      data-active={tab === "activities"}
                      onClick={() => onTabChange("activities")}
                    >
                      Activities
                    </button>
                    <button
                      type="button"
                      className="owt-provider-panel__tab"
                      data-active={tab === "configure"}
                      onClick={() => onTabChange("configure")}
                    >
                      Configure
                    </button>
                    <button
                      type="button"
                      className="owt-provider-panel__tab"
                      data-active="false"
                      data-placeholder-tab="failover"
                      hidden
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      Failover
                    </button>
                  </div>
                </>
              ) : null}

              {message ? (
                <div
                  className={`owt-provider-panel__note owt-provider-panel__note--${message.kind}`}
                  role={message.kind === "error" ? "alert" : "status"}
                >
                  {message.text}
                </div>
              ) : null}

              <div className="owt-provider-panel__content">
                {loading ? (
                  <div className="owt-provider-panel__state">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading provider workspace…
                  </div>
                ) : error ? (
                  <div className="owt-provider-panel__state owt-provider-panel__state--error">
                    {error}
                  </div>
                ) : panelMode === "preset-picker" ? (
                  <ProviderSidePanelPresetTab
                    groups={presetGroups}
                    selectedPresetId={selectedPresetId}
                    onPresetSelect={onPresetSelect}
                    onCancel={onPresetCancel ?? onCancel}
                  />
                ) : tab === "activities" ? (
                  <ProviderSidePanelActivitiesTab
                    appId={appId}
                    providerId={selectedProvider?.providerId ?? null}
                    providerName={
                      selectedProvider?.name ||
                      selectedProvider?.providerId ||
                      providerName
                    }
                    shell={shell}
                  />
                ) : (
                  <ProviderSidePanelConfigureTab
                    appId={appId}
                    draft={draft}
                    editing={editing}
                    footerText={footerText}
                    mode={mode}
                    provider={selectedProvider}
                    saveIdle={saveIdle}
                    savePending={savePending}
                    showSaveFlash={showSaveFlash}
                    tokenFieldOptions={tokenFieldOptions}
                    website={website}
                    canSave={canSave}
                    onCancel={onCancel}
                    onClearAuth={onClearAuth}
                    onDraftChange={onDraftChange}
                    onEdit={onEdit}
                    onPasteAuth={onPasteAuth}
                    onSave={onSave}
                  />
                )}

                {panelMode === "detail" ? (
                  <div
                    className="owt-provider-panel__failover-placeholder"
                    data-placeholder-panel="failover"
                    hidden
                    aria-hidden="true"
                  >
                    <div className="owt-provider-panel__config-group">
                      <div className="owt-provider-panel__config-group-title">
                        Failover
                      </div>
                      <div className="owt-provider-panel__config-row">
                        <div className="owt-provider-panel__config-label">
                          Auto failover
                        </div>
                        <div className="owt-provider-panel__config-value">
                          —
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
