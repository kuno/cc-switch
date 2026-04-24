import {
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
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
import {
  getOpenWrtAppIconUrl,
  OpenWrtProviderIcon,
} from "../providerIcons";
import { ProviderSidePanelCredentialsTab } from "./ProviderSidePanelCredentialsTab";
import { ProviderSidePanelGeneralTab } from "./ProviderSidePanelGeneralTab";
import {
  ProviderSidePanelPresetTab,
  type ProviderSidePanelPresetGroup,
} from "./ProviderSidePanelPresetTab";
import { getActiveElementInTree } from "./focusTree";

export type ProviderSidePanelTab = "preset" | "general" | "credentials";

interface ProviderSidePanelProps {
  appId: SharedProviderAppId;
  open: boolean;
  showScrim?: boolean;
  loading: boolean;
  error: string | null;
  mode: "new" | "edit";
  panelMode?: "detail" | "preset-picker";
  providers: SharedProviderView[];
  filteredProviders: SharedProviderView[];
  selectedProviderId: string | null;
  selectedProvider: SharedProviderView | null;
  draft: SharedProviderEditorPayload;
  website: string;
  tab: ProviderSidePanelTab;
  search: string;
  selectedPresetId: string | null;
  presetGroups: ProviderSidePanelPresetGroup[];
  tokenFieldOptions: Array<{
    value: SharedProviderTokenField;
    label: string;
  }>;
  selectedFileName: string;
  authPending: boolean;
  savePending: boolean;
  deletePending: boolean;
  activatePending: boolean;
  canActivate: boolean;
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
  onWebsiteChange: (website: string) => void;
  onFileSelect: (file: File | null) => void;
  onUploadCodexAuth: () => void;
  onRemoveCodexAuth: () => void;
  onUploadClaudeAuth: () => void;
  onRemoveClaudeAuth: () => void;
  onActivate: () => void;
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

function getPanelSubtitle(
  appId: SharedProviderAppId,
): string {
  return APP_SUBTITLES[appId];
}

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
  loading,
  error,
  mode,
  panelMode,
  providers,
  filteredProviders,
  selectedProviderId,
  selectedProvider,
  draft,
  website,
  tab,
  search,
  selectedPresetId,
  presetGroups,
  tokenFieldOptions,
  selectedFileName,
  authPending,
  savePending,
  deletePending,
  activatePending,
  canActivate,
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
  onWebsiteChange,
  onFileSelect,
  onUploadCodexAuth,
  onRemoveCodexAuth,
  onUploadClaudeAuth,
  onRemoveClaudeAuth,
  onActivate,
  onDelete,
  onCancel,
  onSave,
}: ProviderSidePanelProps) {
  const resolvedPanelMode =
    panelMode ?? (tab === "preset" ? "preset-picker" : "detail");
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
      // Copy failures should leave the current chip label untouched.
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
        data-panel-mode={resolvedPanelMode}
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
              {getPanelSubtitle(appId)}
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
            data-panel-mode={resolvedPanelMode}
          >
            <div className="owt-provider-panel__detail-shell">
              {resolvedPanelMode === "detail" ? (
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
                    </div>
                  </div>

                  <div className="owt-provider-panel__tabs" role="tablist">
                    {(["general", "credentials"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="owt-provider-panel__tab"
                        data-active={tab === value}
                        onClick={() => onTabChange(value)}
                      >
                        {value === "general" ? "General" : "Credentials"}
                      </button>
                    ))}
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
                ) : resolvedPanelMode === "preset-picker" ? (
                  <ProviderSidePanelPresetTab
                    groups={presetGroups}
                    selectedPresetId={selectedPresetId}
                    onPresetSelect={onPresetSelect}
                  />
                ) : tab === "general" ? (
                  <ProviderSidePanelGeneralTab
                    draft={draft}
                    website={website}
                    onDraftChange={onDraftChange}
                    onWebsiteChange={onWebsiteChange}
                  />
                ) : (
                  <ProviderSidePanelCredentialsTab
                    appId={appId}
                    draft={draft}
                    provider={selectedProvider}
                    selectedFileName={selectedFileName}
                    authPending={authPending}
                    tokenFieldOptions={tokenFieldOptions}
                    onDraftChange={onDraftChange}
                    onFileSelect={onFileSelect}
                    onUploadCodexAuth={onUploadCodexAuth}
                    onRemoveCodexAuth={onRemoveCodexAuth}
                    onUploadClaudeAuth={onUploadClaudeAuth}
                    onRemoveClaudeAuth={onRemoveClaudeAuth}
                  />
                )}
              </div>
            </div>
          </section>
        </div>

        {resolvedPanelMode === "detail" ? (
          <footer className="owt-provider-panel__footer">
            <div className="owt-provider-panel__footer-copy">
              <CheckCircle2 className="h-4 w-4" />
              <span>{footerText}</span>
            </div>

            <div className="owt-provider-panel__footer-actions">
              {canDelete ? (
                <button
                  type="button"
                  className="owt-provider-panel__button owt-provider-panel__button--danger"
                  disabled={deletePending}
                  onClick={onDelete}
                >
                  {deletePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </button>
              ) : null}
              {canActivate ? (
                <button
                  type="button"
                  className="owt-provider-panel__button owt-provider-panel__button--ghost"
                  disabled={activatePending}
                  onClick={onActivate}
                >
                  {activatePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Set active
                </button>
              ) : null}
              <button
                type="button"
                className="owt-provider-panel__button"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="owt-provider-panel__button owt-provider-panel__button--primary"
                data-idle={saveIdle && !showSaveFlash ? "true" : "false"}
                data-saved={showSaveFlash ? "true" : "false"}
                disabled={!canSave || savePending || loading}
                onClick={onSave}
              >
                {savePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : showSaveFlash ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : null}
                {savePending ? "Saving…" : showSaveFlash ? "Saved" : "Save"}
              </button>
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
