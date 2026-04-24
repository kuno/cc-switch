import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import {
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
import type { OpenWrtSharedPageShellApi } from "../pageTypes";
import {
  getOpenWrtAppIconUrl,
  OpenWrtProviderIcon,
} from "../providerIcons";
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
  selectedPresetId: string | null;
  presetGroups: ProviderSidePanelPresetGroup[];
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  savePending: boolean;
  deletePending: boolean;
  canDelete: boolean;
  canSave: boolean;
  saveIdle: boolean;
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
  onDelete: () => void;
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

function getStatusLabel(
  mode: "new" | "edit",
  provider: SharedProviderView | null,
): string {
  if (mode === "new") {
    return "Draft";
  }

  return provider?.active ? "Active" : "Saved";
}

function getStatusTone(
  mode: "new" | "edit",
  provider: SharedProviderView | null,
): "accent" | "neutral" | "success" {
  if (mode === "new") {
    return "accent";
  }

  return provider?.active ? "success" : "neutral";
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
  selectedPresetId,
  presetGroups,
  tokenFieldOptions,
  savePending,
  deletePending,
  canDelete,
  canSave,
  saveIdle,
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
  onDelete,
  onCancel,
  onSave,
}: ProviderSidePanelProps) {
  const providerName =
    (mode === "new"
      ? draft.name.trim() || "New provider"
      : selectedProvider?.name.trim()) || "Provider";
  const detailProviderId = selectedProvider?.providerId ?? null;
  const panelRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const saveFlashTimeoutRef = useRef<number | null>(null);
  const previousSavePendingRef = useRef(savePending);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const [copiedProviderId, setCopiedProviderId] = useState<string | null>(null);
  const [showSaveFlash, setShowSaveFlash] = useState(false);

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
            <h3 className="owt-provider-panel__title">{APP_LABELS[appId]}</h3>
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
          <nav className="owt-provider-panel__rail" aria-label="Saved providers">
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
              ) : (
                filteredProviders.map((provider) => (
                  <button
                    type="button"
                    key={provider.providerId || provider.name}
                    className="owt-provider-panel__provider-row"
                    data-active={provider.providerId === selectedProviderId}
                    onClick={() =>
                      provider.providerId
                        ? onSelectProvider(provider.providerId)
                        : undefined
                    }
                  >
                    <div
                      className="owt-provider-panel__provider-mark"
                      data-app={appId}
                    >
                      <OpenWrtProviderIcon
                        appId={appId}
                        name={
                          provider.name ||
                          provider.providerId ||
                          APP_LABELS[appId]
                        }
                        size={18}
                        source={provider}
                      />
                    </div>
                    <div className="owt-provider-panel__provider-copy">
                      <div className="owt-provider-panel__provider-name">
                        {provider.name || provider.providerId || "Provider"}
                      </div>
                      <div className="owt-provider-panel__rail-url">
                        {provider.baseUrl || "No base URL saved"}
                      </div>
                      {provider.providerId ? (
                        <div className="owt-provider-panel__rail-id">
                          {provider.providerId}
                        </div>
                      ) : null}
                    </div>
                    {provider.active ? (
                      <span className="owt-status-pill" data-tone="success">
                        <span
                          className="owt-status-pill__dot"
                          aria-hidden="true"
                        />
                        Active
                      </span>
                    ) : null}
                  </button>
                ))
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
                        <div className="owt-provider-panel__detail-title">
                          {providerName}
                        </div>
                        <div className="owt-provider-panel__detail-url">
                          {draft.baseUrl || "Not saved yet"}
                        </div>
                      </div>
                    </div>

                    <div className="owt-provider-panel__detail-meta">
                      {detailProviderId ? (
                        <button
                          type="button"
                          className="owt-provider-panel__id-chip"
                          data-copied={copiedProviderId === detailProviderId}
                          aria-label={`Copy provider ID ${detailProviderId}`}
                          title={
                            copiedProviderId === detailProviderId
                              ? "Copied"
                              : `Copy provider ID ${detailProviderId}`
                          }
                          onClick={() =>
                            void handleCopyProviderId(detailProviderId)
                          }
                        >
                          {copiedProviderId === detailProviderId
                            ? "Copied"
                            : detailProviderId}
                        </button>
                      ) : null}
                      <span
                        className="owt-status-pill"
                        data-tone={getStatusTone(mode, selectedProvider)}
                      >
                        <span
                          className="owt-status-pill__dot"
                          aria-hidden="true"
                        />
                        {getStatusLabel(mode, selectedProvider)}
                      </span>
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
              ) : (
                <div className="owt-provider-panel__picker-actions">
                  <button
                    type="button"
                    className="owt-provider-panel__button owt-provider-panel__button--ghost"
                    onClick={onPresetCancel ?? onCancel}
                  >
                    Cancel
                  </button>
                </div>
              )}

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
