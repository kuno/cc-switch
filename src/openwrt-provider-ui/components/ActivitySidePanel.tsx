import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCcw,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtPaginatedRequestLogs,
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
} from "../pageTypes";
import { formatRelativeTime } from "../i18n/formatRelativeTime";
import { lockBodyScroll } from "../utils/bodyScrollLock";
import { getActiveElementInTree } from "./focusTree";

const ACTIVITY_DRAWER_PAGE_SIZE = 6;
const ROW_HEIGHT_PX = 65; // row padding (12+12) + border (1+1) + ~2 text lines
const ROW_GAP_PX = 8; // gap between rows
const LIST_PADDING_PX = 24; // list container padding (12 top + 12 bottom)
const SUPPORTED_APP_IDS = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedProviderAppId[];

type ActivityDrawerFilterMode = "all" | "app";

type ActivityRequestLog = OpenWrtRequestLog & {
  resolvedAppId: SharedProviderAppId;
};

type ActivityRequestLogsState = Omit<OpenWrtPaginatedRequestLogs, "data"> & {
  data: ActivityRequestLog[];
  loading: boolean;
  error: string | null;
};

export interface ActivitySidePanelProps {
  open: boolean;
  appId: string | null;
  onClose: () => void;
  shell: OpenWrtSharedPageShellApi;
  showScrim?: boolean;
}

const APP_LABEL_KEYS: Record<SharedProviderAppId, string> = {
  claude: "apps.claude",
  codex: "apps.codex",
  gemini: "apps.gemini",
};

function isSupportedAppId(
  value: string | null | undefined,
): value is SharedProviderAppId {
  return value === "claude" || value === "codex" || value === "gemini";
}

function resolveAppId(
  value: string | null | undefined,
  fallback: SharedProviderAppId,
): SharedProviderAppId {
  return isSupportedAppId(value) ? value : fallback;
}

function normalizeEpochMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

function getAppLabel(t: TFunction, appId: SharedProviderAppId): string {
  return t(APP_LABEL_KEYS[appId]);
}

function formatUpdatedLabel(value: number | null, t: TFunction): string {
  if (!value) {
    return t("openwrt.activity.waitingForData");
  }

  const relativeLabel = formatRelativeTime(value);

  if (relativeLabel === t("openwrt.activity.justNow")) {
    return t("openwrt.activity.updatedJustNow");
  }

  return t("openwrt.activity.updated", { time: relativeLabel });
}

function formatCount(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatCompactCount(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatLatency(value: number | null | undefined, t: TFunction): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return t("openwrt.activity.notAvailable");
  }

  return t("openwrt.activity.latencyMs", { value: Math.round(value) });
}

function getRequestTokenCount(entry: OpenWrtRequestLog | null): number {
  if (!entry) {
    return 0;
  }

  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.cacheCreationTokens +
    entry.cacheReadTokens
  );
}

function getStatusTone(
  statusCode: number,
  hasError: boolean,
): "success" | "warn" | "fail" {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }

  if (statusCode >= 500 || hasError) {
    return "fail";
  }

  return "warn";
}

function getStatusLabel(entry: OpenWrtRequestLog, t: TFunction): string {
  if (entry.statusCode > 0) {
    return t("openwrt.activity.httpStatus", { statusCode: entry.statusCode });
  }

  if (entry.errorMessage) {
    return t("common.error");
  }

  return t("openwrt.activity.pending");
}

function sortByRecent(
  left: OpenWrtRequestLog,
  right: OpenWrtRequestLog,
): number {
  const timestampDelta =
    normalizeEpochMs(right.createdAt) - normalizeEpochMs(left.createdAt);

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return right.requestId.localeCompare(left.requestId);
}

async function loadAllAppRequestLogs(
  shell: OpenWrtSharedPageShellApi,
  page: number,
  pageSize: number,
): Promise<
  Omit<OpenWrtPaginatedRequestLogs, "data"> & { data: ActivityRequestLog[] }
> {
  const mergedPageSize = Math.max(pageSize, (page + 1) * pageSize);
  const results = await Promise.all(
    SUPPORTED_APP_IDS.map(async (nextAppId) => {
      const response = await shell.getRequestLogs(nextAppId, 0, mergedPageSize);

      return {
        appId: nextAppId,
        response,
      };
    }),
  );

  const total = results.reduce((sum, result) => sum + result.response.total, 0);
  const mergedEntries = results
    .flatMap(({ appId: nextAppId, response }) =>
      response.data.map((entry) => ({
        ...entry,
        resolvedAppId: resolveAppId(entry.appType, nextAppId),
      })),
    )
    .sort(sortByRecent);
  const start = page * pageSize;
  const end = start + pageSize;

  return {
    data: mergedEntries.slice(start, end),
    total,
    page,
    pageSize,
  };
}

async function loadScopedRequestLogs(
  shell: OpenWrtSharedPageShellApi,
  appId: SharedProviderAppId,
  page: number,
  pageSize: number,
): Promise<
  Omit<OpenWrtPaginatedRequestLogs, "data"> & { data: ActivityRequestLog[] }
> {
  const response = await shell.getRequestLogs(appId, page, pageSize);

  return {
    data: response.data.map((entry) => ({
      ...entry,
      resolvedAppId: resolveAppId(entry.appType, appId),
    })),
    total: response.total,
    page: response.page,
    pageSize: response.pageSize || pageSize,
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "button:not([disabled])",
        "[href]",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element);

    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function getRowSubtitle(
  entry: ActivityRequestLog,
  filterMode: ActivityDrawerFilterMode,
  t: TFunction,
): string {
  const parts = [
    entry.model || t("openwrt.activity.defaultModel"),
    filterMode === "all" ? getAppLabel(t, entry.resolvedAppId) : null,
    formatRelativeTime(entry.createdAt, Date.now(), { compact: true }),
  ].filter(Boolean);

  return parts.join(" · ");
}

export function ActivitySidePanel({
  open,
  appId,
  onClose,
  shell,
  showScrim = true,
}: ActivitySidePanelProps) {
  const { t, i18n: i18nextInstance } = useTranslation();
  const language = i18nextInstance.language || "en";
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const unlockBodyScrollRef = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const activeAppId = resolveAppId(appId, shell.getSelectedApp());
  const [filterMode, setFilterMode] = useState<ActivityDrawerFilterMode>("app");
  const [page, setPage] = useState(0);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [pageSize, setPageSize] = useState(ACTIVITY_DRAWER_PAGE_SIZE);
  const listRef = useRef<HTMLDivElement | null>(null);
  const measuredRowHeightRef = useRef<number | null>(null);
  const firstRowCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || measuredRowHeightRef.current !== null || el.offsetHeight <= 0)
      return;
    measuredRowHeightRef.current = el.offsetHeight;
    const listEl = listRef.current;
    if (!listEl) return;
    const height = listEl.getBoundingClientRect().height;
    if (height <= 0) return;
    const rowHeight = measuredRowHeightRef.current;
    setPageSize(
      Math.max(
        1,
        Math.floor(
          (height - LIST_PADDING_PX + ROW_GAP_PX) / (rowHeight + ROW_GAP_PX),
        ),
      ),
    );
  }, []);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [requestLogsState, setRequestLogsState] =
    useState<ActivityRequestLogsState>({
      data: [],
      total: 0,
      page: 0,
      pageSize: ACTIVITY_DRAWER_PAGE_SIZE,
      loading: false,
      error: null,
    });
  const totalPages = Math.max(
    1,
    Math.ceil(requestLogsState.total / Math.max(1, pageSize)),
  );
  const windowStart = requestLogsState.total
    ? requestLogsState.page * requestLogsState.pageSize + 1
    : 0;
  const windowEnd = requestLogsState.total
    ? Math.min(
        requestLogsState.total,
        windowStart + requestLogsState.data.length - 1,
      )
    : 0;
  const activeFilterLabel =
    filterMode === "all"
      ? t("openwrt.activity.allApps")
      : getAppLabel(t, activeAppId);
  const subtitle = requestLogsState.loading
    ? t("openwrt.activity.subtitleLoading", { filter: activeFilterLabel })
    : requestLogsState.total
      ? t("openwrt.activity.subtitleLastRequests", {
          filter: activeFilterLabel,
          requestCount: formatCount(requestLogsState.data.length, language),
        })
      : t("openwrt.activity.subtitleNoRequests", {
          filter: activeFilterLabel,
        });
  const updatedLabel = formatUpdatedLabel(lastLoadedAt, t);
  const requestSummary =
    windowStart && windowEnd
      ? t("openwrt.activity.showing", {
          start: windowStart,
          end: windowEnd,
          total: formatCount(requestLogsState.total, language),
        })
      : t("openwrt.activity.showingEmpty");

  useEffect(() => {
    if (!open) {
      return;
    }

    setFilterMode("app");
    setPage(0);
  }, [activeAppId, open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    function measure() {
      const height = el!.getBoundingClientRect().height;
      if (height <= 0) return;
      const rowHeight = measuredRowHeightRef.current ?? ROW_HEIGHT_PX;
      setPageSize(
        Math.max(
          1,
          Math.floor(
            (height - LIST_PADDING_PX + ROW_GAP_PX) / (rowHeight + ROW_GAP_PX),
          ),
        ),
      );
    }
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 100);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!requestLogsState.total) return;
    const maxPage = Math.max(
      0,
      Math.ceil(requestLogsState.total / pageSize) - 1,
    );
    setPage((current) => Math.min(current, maxPage));
  }, [pageSize, requestLogsState.total]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    setRequestLogsState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    const requestPromise =
      filterMode === "all"
        ? loadAllAppRequestLogs(shell, page, pageSize)
        : loadScopedRequestLogs(shell, activeAppId, page, pageSize);

    void requestPromise
      .then((result) => {
        if (cancelled) {
          return;
        }

        setRequestLogsState({
          data: result.data,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize || pageSize,
          loading: false,
          error: null,
        });
        setLastLoadedAt(Date.now());
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRequestLogsState({
          data: [],
          total: 0,
          page,
          pageSize,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeAppId, filterMode, open, page, pageSize, refreshCounter, shell]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElementInTree = getActiveElementInTree(
      panelRef.current,
    );
    const previousActiveElement =
      previousActiveElementInTree instanceof HTMLElement
        ? previousActiveElementInTree
        : null;
    const unlockBodyScroll = lockBodyScroll();
    unlockBodyScrollRef.current = unlockBodyScroll;
    const focusTimer = window.requestAnimationFrame(() => {
      const focusTarget =
        getFocusableElements(panelRef.current ?? document.body)[0] ??
        panelRef.current;

      focusTarget?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(panelRef.current);

      if (!focusableElements.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElementInTree = getActiveElementInTree(panelRef.current);
      const activeElement =
        activeElementInTree instanceof HTMLElement ? activeElementInTree : null;
      const isInsidePanel = activeElement
        ? panelRef.current.contains(activeElement)
        : false;

      if (event.shiftKey) {
        if (!isInsidePanel || activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (!isInsidePanel || activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);

      if (unlockBodyScrollRef.current === unlockBodyScroll) {
        unlockBodyScrollRef.current = null;
      }

      unlockBodyScroll();
      previousActiveElement?.focus();
    };
  }, [open]);

  function handleFilterChange(nextFilterMode: ActivityDrawerFilterMode) {
    setFilterMode(nextFilterMode);
    setPage(0);
  }

  function handleRefresh() {
    setRefreshCounter((current) => current + 1);
  }

  return (
    <div
      className="owt-activity-drawer"
      data-open={open ? "true" : "false"}
      data-has-scrim={showScrim ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
    >
      {showScrim ? (
        <button
          type="button"
          className="owt-activity-drawer__scrim"
          tabIndex={open ? 0 : -1}
          aria-label={t("openwrt.activity.closeDrawer")}
          onClick={onClose}
        />
      ) : null}

      <div
        ref={panelRef}
        className="owt-activity-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="owt-activity-drawer__head">
          <div className="owt-activity-drawer__title-wrap">
            <h2 id={titleId} className="owt-activity-drawer__title">
              {t("openwrt.activity.title")}
            </h2>
            <p id={descriptionId} className="owt-activity-drawer__subtitle">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            className="owt-activity-drawer__icon-button"
            onClick={onClose}
            aria-label={t("openwrt.activity.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="owt-activity-drawer__list">
          {requestLogsState.error ? (
            <div className="owt-activity-drawer__state">
              <p>{requestLogsState.error}</p>
            </div>
          ) : requestLogsState.loading ? (
            <div className="owt-activity-drawer__state">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p>{t("openwrt.activity.loadingRecentRequests")}</p>
            </div>
          ) : requestLogsState.data.length ? (
            requestLogsState.data.map((entry, index) => (
              <div
                key={`${entry.resolvedAppId}-${entry.requestId}`}
                ref={index === 0 ? firstRowCallbackRef : undefined}
                className="owt-activity-drawer__row"
              >
                <div className="owt-activity-drawer__row-left">
                  <div className="owt-activity-drawer__row-title">
                    <span className="owt-activity-drawer__row-provider">
                      {entry.providerName ||
                        entry.providerId ||
                        t("provider.tabProvider")}
                    </span>
                    <span
                      className="owt-activity-drawer__status-pill"
                      data-tone={getStatusTone(
                        entry.statusCode,
                        Boolean(entry.errorMessage),
                      )}
                    >
                      {getStatusLabel(entry, t)}
                    </span>
                  </div>
                  <div className="owt-activity-drawer__row-subtitle">
                    {getRowSubtitle(entry, filterMode, t)}
                  </div>
                </div>

                <div className="owt-activity-drawer__row-right">
                  <span className="owt-activity-drawer__tokens">
                    {t("openwrt.activity.tokens", {
                      tokenCount: formatCompactCount(
                        getRequestTokenCount(entry),
                        language,
                      ),
                    })}
                  </span>
                  <span className="owt-activity-drawer__ms">
                    {formatLatency(entry.latencyMs, t)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="owt-activity-drawer__state">
              <p>{t("openwrt.activity.noRecentRequestsForFilter")}</p>
            </div>
          )}
        </div>

        <div className="owt-activity-drawer__foot">
          <div className="owt-activity-drawer__foot-meta">
            <div className="owt-activity-drawer__foot-copy">
              <span>{requestSummary}</span>
              <span>{updatedLabel}</span>
            </div>

            <button
              type="button"
              className="owt-activity-drawer__icon-button"
              onClick={handleRefresh}
              disabled={requestLogsState.loading}
              aria-label={t("openwrt.activity.refresh")}
            >
              {requestLogsState.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="owt-activity-drawer__foot-actions">
            <div
              className="owt-activity-drawer__filter"
              role="group"
              aria-label={t("openwrt.activity.filters")}
            >
              <button
                type="button"
                className="owt-activity-drawer__filter-button"
                data-active={filterMode === "all"}
                onClick={() => {
                  handleFilterChange("all");
                }}
              >
                {t("openwrt.activity.allApps")}
              </button>
              <button
                type="button"
                className="owt-activity-drawer__filter-button"
                data-active={filterMode === "app"}
                onClick={() => {
                  handleFilterChange("app");
                }}
              >
                {getAppLabel(t, activeAppId)}
              </button>
            </div>

            <div
              className="owt-activity-drawer__pagination"
              role="group"
              aria-label={t("openwrt.activity.requestLogPages")}
            >
              <button
                type="button"
                className="owt-activity-drawer__icon-button"
                onClick={() => {
                  setPage((current) => Math.max(0, current - 1));
                }}
                disabled={requestLogsState.loading || page <= 0}
                aria-label={t("openwrt.activity.previousPage")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="owt-activity-drawer__page-label">
                {t("openwrt.activity.pageLabel", {
                  page: page + 1,
                  totalPages,
                })}
              </span>
              <button
                type="button"
                className="owt-activity-drawer__icon-button"
                onClick={() => {
                  setPage((current) => Math.min(totalPages - 1, current + 1));
                }}
                disabled={
                  requestLogsState.loading ||
                  page >= Math.max(0, totalPages - 1)
                }
                aria-label={t("openwrt.activity.nextPage")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
