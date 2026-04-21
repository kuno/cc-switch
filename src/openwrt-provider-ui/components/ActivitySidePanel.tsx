import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCcw,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtPaginatedRequestLogs,
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
} from "../pageTypes";
import { lockBodyScroll } from "../utils/bodyScrollLock";
import { getActiveElementInTree } from "./focusTree";

const ACTIVITY_DRAWER_PAGE_SIZE = 6;
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
}

const APP_LABELS: Record<SharedProviderAppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
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

function formatRelativeTime(value: number): string {
  const epochMs = normalizeEpochMs(value);

  if (!epochMs) {
    return "Unknown time";
  }

  const diffMs = Date.now() - epochMs;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes <= 1) {
    return "Just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  if (diffMinutes < 1440) {
    return `${Math.round(diffMinutes / 60)}h ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatLatency(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return "n/a";
  }

  return `${Math.round(value)} ms`;
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

function getStatusLabel(entry: OpenWrtRequestLog): string {
  if (entry.statusCode > 0) {
    return `HTTP ${entry.statusCode}`;
  }

  if (entry.errorMessage) {
    return "Error";
  }

  return "Pending";
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
): string {
  const parts = [
    entry.model || "Default model",
    filterMode === "all" ? APP_LABELS[entry.resolvedAppId] : null,
    formatRelativeTime(entry.createdAt),
  ].filter(Boolean);

  return parts.join(" · ");
}

export function ActivitySidePanel({
  open,
  appId,
  onClose,
  shell,
}: ActivitySidePanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const unlockBodyScrollRef = useRef<(() => void) | null>(null);
  const activeAppId = resolveAppId(appId, shell.getSelectedApp());
  const [filterMode, setFilterMode] = useState<ActivityDrawerFilterMode>("app");
  const [page, setPage] = useState(0);
  const [refreshCounter, setRefreshCounter] = useState(0);
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
    Math.ceil(
      requestLogsState.total /
        Math.max(1, requestLogsState.pageSize || ACTIVITY_DRAWER_PAGE_SIZE),
    ),
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
    filterMode === "all" ? "All apps" : APP_LABELS[activeAppId];
  const subtitle = requestLogsState.loading
    ? `${activeFilterLabel} · loading recent requests`
    : requestLogsState.total
      ? `${activeFilterLabel} · ${windowStart}-${windowEnd} of ${formatCount(requestLogsState.total)}`
      : `${activeFilterLabel} · no requests yet`;
  const updatedLabel = lastLoadedAt
    ? `Updated ${formatRelativeTime(lastLoadedAt)}`
    : "Waiting for data";
  const filterSummary =
    filterMode === "all"
      ? "Showing all apps"
      : `Showing ${APP_LABELS[activeAppId]}`;
  const requestSummary =
    windowStart && windowEnd
      ? `${windowStart}-${windowEnd} of ${formatCount(requestLogsState.total)} requests`
      : "0 requests";

  useEffect(() => {
    if (!open) {
      return;
    }

    setFilterMode("app");
    setPage(0);
  }, [activeAppId, open]);

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
        ? loadAllAppRequestLogs(shell, page, ACTIVITY_DRAWER_PAGE_SIZE)
        : loadScopedRequestLogs(
            shell,
            activeAppId,
            page,
            ACTIVITY_DRAWER_PAGE_SIZE,
          );

    void requestPromise
      .then((result) => {
        if (cancelled) {
          return;
        }

        setRequestLogsState({
          data: result.data,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize || ACTIVITY_DRAWER_PAGE_SIZE,
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
          pageSize: ACTIVITY_DRAWER_PAGE_SIZE,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeAppId, filterMode, open, page, refreshCounter, shell]);

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
        onClose();
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
  }, [onClose, open]);

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
      aria-hidden={open ? "false" : "true"}
    >
      <button
        type="button"
        className="owt-activity-drawer__scrim"
        tabIndex={open ? 0 : -1}
        aria-label="Close recent activity drawer"
        onClick={onClose}
      />

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
              Recent activity
            </h2>
            <p id={descriptionId} className="owt-activity-drawer__subtitle">
              {subtitle}
            </p>
          </div>

          <button
            type="button"
            className="owt-activity-drawer__icon-button"
            onClick={onClose}
            aria-label="Close recent activity"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="owt-activity-drawer__list">
          {requestLogsState.error ? (
            <div className="owt-activity-drawer__state">
              <p>{requestLogsState.error}</p>
            </div>
          ) : requestLogsState.loading ? (
            <div className="owt-activity-drawer__state">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p>Loading recent requests…</p>
            </div>
          ) : requestLogsState.data.length ? (
            requestLogsState.data.map((entry) => (
              <div
                key={`${entry.resolvedAppId}-${entry.requestId}`}
                className="owt-activity-drawer__row"
              >
                <div className="owt-activity-drawer__row-left">
                  <div className="owt-activity-drawer__row-title">
                    <span className="owt-activity-drawer__row-provider">
                      {entry.providerName || entry.providerId || "Provider"}
                    </span>
                    <span
                      className="owt-activity-drawer__status-pill"
                      data-tone={getStatusTone(
                        entry.statusCode,
                        Boolean(entry.errorMessage),
                      )}
                    >
                      {getStatusLabel(entry)}
                    </span>
                  </div>
                  <div className="owt-activity-drawer__row-subtitle">
                    {getRowSubtitle(entry, filterMode)}
                  </div>
                </div>

                <div className="owt-activity-drawer__row-right">
                  <span className="owt-activity-drawer__tokens">
                    {formatCompactCount(getRequestTokenCount(entry))} tok
                  </span>
                  <span className="owt-activity-drawer__ms">
                    {formatLatency(entry.latencyMs)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="owt-activity-drawer__state">
              <p>No recent requests for this filter.</p>
            </div>
          )}
        </div>

        <div className="owt-activity-drawer__foot">
          <div className="owt-activity-drawer__foot-meta">
            <div className="owt-activity-drawer__foot-copy">
              <span>{filterSummary}</span>
              <span>
                {requestSummary} · {updatedLabel}
              </span>
            </div>

            <button
              type="button"
              className="owt-activity-drawer__icon-button"
              onClick={handleRefresh}
              disabled={requestLogsState.loading}
              aria-label="Refresh recent activity"
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
              aria-label="Activity filters"
            >
              <button
                type="button"
                className="owt-activity-drawer__filter-button"
                data-active={filterMode === "all"}
                onClick={() => {
                  handleFilterChange("all");
                }}
              >
                All apps
              </button>
              <button
                type="button"
                className="owt-activity-drawer__filter-button"
                data-active={filterMode === "app"}
                onClick={() => {
                  handleFilterChange("app");
                }}
              >
                {APP_LABELS[activeAppId]}
              </button>
            </div>

            <div
              className="owt-activity-drawer__pagination"
              role="group"
              aria-label="Request log pages"
            >
              <button
                type="button"
                className="owt-activity-drawer__icon-button"
                onClick={() => {
                  setPage((current) => Math.max(0, current - 1));
                }}
                disabled={requestLogsState.loading || page <= 0}
                aria-label="Previous request log page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="owt-activity-drawer__page-label">
                Page {page + 1} of {totalPages}
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
                aria-label="Next request log page"
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
