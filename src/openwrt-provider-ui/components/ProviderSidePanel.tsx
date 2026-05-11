import {
  Copy,
  Loader2,
  Minus,
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
import { useTranslation } from "react-i18next";
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
import { ProviderSidePanelStatisticsTab } from "./ProviderSidePanelStatisticsTab";
import { getActiveElementInTree } from "./focusTree";
import {
  ProviderSidePanelPresetTab,
  type ProviderSidePanelPresetGroup,
} from "./ProviderSidePanelPresetTab";

export type ProviderSidePanelTab = "activities" | "configure" | "statistics";

export const PROVIDER_SIDE_PANEL_DETAIL_TABS = [
  "statistics",
  "configure",
  "activities",
] as const satisfies readonly ProviderSidePanelTab[];

export const DEFAULT_PROVIDER_SIDE_PANEL_DETAIL_TAB =
  PROVIDER_SIDE_PANEL_DETAIL_TABS[0];

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
  failoverQueueProviderIds?: string[];
  providerFailoverPending?: boolean;
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
  onCancel: () => void;
  onSave: () => void;
}

const APP_LABEL_KEYS: Record<SharedProviderAppId, string> = {
  claude: "apps.claude",
  codex: "apps.codex",
  gemini: "apps.gemini",
};

const APP_SUBTITLE_KEYS: Record<SharedProviderAppId, string> = {
  claude: "openwrt.providerPanel.appSubtitles.claude",
  codex: "openwrt.providerPanel.appSubtitles.codex",
  gemini: "openwrt.providerPanel.appSubtitles.gemini",
};

const DETAIL_TAB_LABEL_KEYS: Record<ProviderSidePanelTab, string> = {
  activities: "openwrt.providerPanel.activitiesTab",
  configure: "openwrt.providerPanel.configureTab",
  statistics: "openwrt.providerPanel.statisticsTab",
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
  railBadge: "active" | "queued" | "standby" | null;
  onSelectProvider: (providerId: string) => void;
}

function ProviderRailRow({
  appId,
  provider,
  selectedProviderId,
  railBadge,
  onSelectProvider,
}: SortableProviderRailItemProps) {
  const { t } = useTranslation();
  const providerLabel =
    provider.name || provider.providerId || t("provider.tabProvider");
  const railBadgeCopy =
    railBadge === "active"
      ? t("openwrt.providerPanel.active")
      : railBadge === "queued"
        ? t("openwrt.providerPanel.inQueue")
        : railBadge === "standby"
          ? t("openwrt.providerPanel.standby")
          : null;
  const railBadgeTone = railBadge === "standby" ? "neutral" : "success";

  return (
    <div className="owt-provider-panel__provider-item" data-reorderable="false">
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
        {railBadgeCopy ? (
          <span className="owt-status-pill" data-tone={railBadgeTone}>
            <span className="owt-status-pill__dot" aria-hidden="true" />
            {railBadgeCopy}
          </span>
        ) : null}
      </button>
    </div>
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
  failoverQueueProviderIds = [],
  providerFailoverPending = false,
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
  onCancel,
  onSave,
}: ProviderSidePanelProps) {
  const { t } = useTranslation();
  const appLabel = t(APP_LABEL_KEYS[appId]);
  const appSubtitle = t(APP_SUBTITLE_KEYS[appId]);
  const fallbackProviderName = t("provider.tabProvider");
  const providerName =
    (mode === "new"
      ? draft.name.trim() || t("openwrt.providerPanel.newProvider")
      : selectedProvider?.name.trim()) || fallbackProviderName;
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
  const showFailoverCheckboxes =
    failoverControlsAvailable && mode === "edit" && Boolean(detailProviderId);
  const failoverCheckboxesDisabled =
    !failoverControlsReady ||
    failoverControlsLoading ||
    savePending ||
    activatePending ||
    deletePending;

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

  const failoverQueueProviderIdSet = new Set(failoverQueueProviderIds);
  const providerRows = railProviders.map((provider) => (
    <ProviderRailRow
      key={provider.providerId || provider.name}
      appId={appId}
      provider={provider}
      selectedProviderId={selectedProviderId}
      railBadge={
        appAutoFailoverEnabled
          ? provider.providerId &&
            failoverQueueProviderIdSet.has(provider.providerId)
            ? "queued"
            : "standby"
          : provider.active
            ? "active"
            : null
      }
      onSelectProvider={onSelectProvider}
    />
  ));

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
        aria-label={t("openwrt.providerPanel.providersDialogLabel", {
          app: appLabel,
        })}
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
              <h3 className="owt-provider-panel__title">{appLabel}</h3>
              {showFailoverCheckboxes ? (
                <div
                  className="owt-mode-toggle owt-mode-toggle--panel"
                  role="tablist"
                  aria-label={t("openwrt.providerPanel.routingModeAria", {
                    app: appLabel,
                  })}
                  data-pending={appFailoverPending ? "true" : "false"}
                  aria-busy={appFailoverPending ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="owt-mode-toggle__button"
                    role="tab"
                    aria-selected={!appAutoFailoverEnabled}
                    data-active={!appAutoFailoverEnabled}
                    disabled={failoverCheckboxesDisabled || appFailoverPending}
                    onClick={() => {
                      if (appAutoFailoverEnabled) {
                        onToggleAppAutoFailover?.(false);
                      }
                    }}
                    title={t("openwrt.providerPanel.normalModeTitle")}
                  >
                    <span className="owt-mode-toggle__dot" aria-hidden="true" />
                    {t("openwrt.providerPanel.normal")}
                  </button>
                  <button
                    type="button"
                    className="owt-mode-toggle__button"
                    role="tab"
                    aria-selected={appAutoFailoverEnabled}
                    data-active={appAutoFailoverEnabled}
                    disabled={failoverCheckboxesDisabled || appFailoverPending}
                    onClick={() => {
                      if (!appAutoFailoverEnabled) {
                        onToggleAppAutoFailover?.(true);
                      }
                    }}
                    title={t("openwrt.providerPanel.failoverModeTitle")}
                  >
                    <span className="owt-mode-toggle__dot" aria-hidden="true" />
                    {t("openwrt.providerPanel.failover")}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="owt-provider-panel__subtitle">{appSubtitle}</div>
          </div>
          <button
            type="button"
            className="owt-provider-panel__close"
            onClick={onClose}
            aria-label={t("openwrt.providerPanel.closeProviderPanel")}
            ref={closeButtonRef}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="owt-provider-panel__body">
          <nav
            className="owt-provider-panel__rail"
            aria-label={t("openwrt.providerPanel.savedProviders")}
          >
            <label className="owt-provider-panel__search">
              <Search className="h-4 w-4" />
              <input
                type="text"
                placeholder={t(
                  "openwrt.providerPanel.searchProviderPlaceholder",
                )}
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>

            <div className="owt-provider-panel__rail-scroll">
              {providers.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  {t("openwrt.providerPanel.noProviders")}
                </div>
              ) : filteredProviders.length === 0 ? (
                <div className="owt-provider-panel__empty">
                  {t("openwrt.providerPanel.noProviderSearchMatch", {
                    search: search.trim(),
                  })}
                </div>
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
                {t("openwrt.providerPanel.addProvider")}
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
                        </div>
                        <div className="owt-provider-panel__detail-url">
                          {draft.baseUrl ||
                            t("openwrt.providerPanel.notSavedYet")}
                        </div>
                        {detailProviderId ? (
                          <button
                            type="button"
                            className="owt-provider-panel__id-chip"
                            data-copied={copiedProviderId === detailProviderId}
                            aria-label={t(
                              "openwrt.providerPanel.copyProviderId",
                              {
                                providerId: detailProviderId,
                              },
                            )}
                            title={
                              copiedProviderId === detailProviderId
                                ? t("openwrt.providerPanel.copied")
                                : detailProviderId
                            }
                            onClick={() =>
                              void handleCopyProviderId(detailProviderId)
                            }
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            <span className="owt-provider-panel__id-chip-text">
                              {copiedProviderId === detailProviderId
                                ? t("openwrt.providerPanel.copied")
                                : formatProviderIdChipLabel(detailProviderId)}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="owt-provider-panel__detail-meta">
                      {appAutoFailoverEnabled && showFailoverCheckboxes ? (
                        <button
                          type="button"
                          className="owt-provider-panel__icon-button owt-provider-panel__icon-button--accent"
                          aria-label={
                            providerInFailoverQueue
                              ? t(
                                  "openwrt.providerPanel.removeFromFailoverQueue",
                                  {
                                    provider: providerName,
                                  },
                                )
                              : t("openwrt.providerPanel.addToFailoverQueue", {
                                  provider: providerName,
                                })
                          }
                          disabled={
                            failoverCheckboxesDisabled ||
                            providerFailoverPending
                          }
                          onClick={() =>
                            onToggleProviderFailoverQueue?.(
                              !providerInFailoverQueue,
                            )
                          }
                          title={
                            providerInFailoverQueue
                              ? t(
                                  "openwrt.providerPanel.removeFromFailoverQueueTitle",
                                )
                              : t(
                                  "openwrt.providerPanel.addToFailoverQueueTitle",
                                )
                          }
                        >
                          {providerFailoverPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : providerInFailoverQueue ? (
                            <Minus className="h-4 w-4" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                      {!appAutoFailoverEnabled && canActivate ? (
                        <button
                          type="button"
                          className="owt-provider-panel__icon-button owt-provider-panel__icon-button--accent"
                          aria-label={t("openwrt.providerPanel.setActive")}
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
                          aria-label={t("openwrt.providerPanel.deleteProvider")}
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
                    {PROVIDER_SIDE_PANEL_DETAIL_TABS.map((detailTab) => (
                      <button
                        key={detailTab}
                        type="button"
                        className="owt-provider-panel__tab"
                        data-active={tab === detailTab}
                        onClick={() => onTabChange(detailTab)}
                      >
                        {t(DETAIL_TAB_LABEL_KEYS[detailTab])}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="owt-provider-panel__tab"
                      data-active="false"
                      data-placeholder-tab="failover"
                      hidden
                      aria-hidden="true"
                      tabIndex={-1}
                    >
                      {t("openwrt.providerPanel.failover")}
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
                    {t("openwrt.providerPanel.loadingWorkspace")}
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
                ) : tab === "statistics" ? (
                  <ProviderSidePanelStatisticsTab
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
                        {t("openwrt.providerPanel.failover")}
                      </div>
                      <div className="owt-provider-panel__config-row">
                        <div className="owt-provider-panel__config-label">
                          {t("openwrt.providerPanel.autoFailover")}
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
