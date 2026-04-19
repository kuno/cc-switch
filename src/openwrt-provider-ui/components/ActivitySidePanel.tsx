import {
  ArrowLeft,
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

type ActivityRequestDetailState = {
  detail: OpenWrtRequestLog | null;
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

function formatAbsoluteTime(value: number): string {
  const epochMs = normalizeEpochMs(value);

  if (!epochMs) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(epochMs));
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatLatency(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return "n/a";
  }

  return `${Math.round(value)} ms`;
}

function formatUsd(value: string): string {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return value || "$0.00";
  }

  const fractionDigits = numeric !== 0 && Math.abs(numeric) < 1 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
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
): "success" | "warning" | "error" | "neutral" {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }

  if (statusCode >= 500 || hasError) {
    return "error";
  }

  if (statusCode >= 300) {
    return "warning";
  }

  return "neutral";
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
    SUPPORTED_APP_IDS.map(async (appId) => {
      const response = await shell.getRequestLogs(appId, 0, mergedPageSize);

      return {
        appId,
        response,
      };
    }),
  );

  const total = results.reduce((sum, result) => sum + result.response.total, 0);
  const mergedEntries = results
    .flatMap(({ appId, response }) =>
      response.data.map((entry) => ({
        ...entry,
        resolvedAppId: resolveAppId(entry.appType, appId),
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

export function ActivitySidePanel({
  open,
  appId,
  onClose,
  shell,
}: ActivitySidePanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeAppId = resolveAppId(appId, shell.getSelectedApp());
  const [filterMode, setFilterMode] = useState<ActivityDrawerFilterMode>("app");
  const [page, setPage] = useState(0);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [selectedRequestAppId, setSelectedRequestAppId] =
    useState<SharedProviderAppId | null>(null);
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
  const [detailState, setDetailState] = useState<ActivityRequestDetailState>({
    detail: null,
    loading: false,
    error: null,
  });
  const detailViewOpen = Boolean(selectedRequestId);
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
  const subtitle = detailViewOpen
    ? `${activeFilterLabel} · ${selectedRequestId ?? "Request detail"}`
    : requestLogsState.loading
      ? `${activeFilterLabel} · loading recent requests`
      : requestLogsState.total
        ? `${activeFilterLabel} · ${windowStart}-${windowEnd} of ${formatCount(requestLogsState.total)}`
        : `${activeFilterLabel} · no requests yet`;
  const updatedLabel = lastLoadedAt
    ? `Updated ${formatRelativeTime(lastLoadedAt)}`
    : "Waiting for data";

  useEffect(() => {
    if (!open) {
      return;
    }

    setFilterMode("app");
    setPage(0);
    setSelectedRequestId(null);
    setSelectedRequestAppId(null);
    setDetailState({
      detail: null,
      loading: false,
      error: null,
    });
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
    if (!open || !selectedRequestId || !selectedRequestAppId) {
      setDetailState({
        detail: null,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;

    setDetailState((current) => ({
      detail:
        current.detail?.requestId === selectedRequestId ? current.detail : null,
      loading: true,
      error: null,
    }));

    void shell
      .getRequestDetail(selectedRequestAppId, selectedRequestId)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        setDetailState({
          detail,
          loading: false,
          error: detail ? null : "Request detail unavailable.",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setDetailState({
          detail: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, refreshCounter, selectedRequestAppId, selectedRequestId, shell]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    const focusTimer = window.requestAnimationFrame(() => {
      const focusTarget =
        getFocusableElements(panelRef.current ?? document.body)[0] ??
        panelRef.current;

      focusTarget?.focus();
    });

    document.body.style.overflow = "hidden";

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
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
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
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [onClose, open]);

  function handleFilterChange(nextFilterMode: ActivityDrawerFilterMode) {
    setFilterMode(nextFilterMode);
    setPage(0);
    setSelectedRequestId(null);
    setSelectedRequestAppId(null);
    setDetailState({
      detail: null,
      loading: false,
      error: null,
    });
  }

  function handleOpenDetail(entry: ActivityRequestLog) {
    setSelectedRequestId(entry.requestId);
    setSelectedRequestAppId(entry.resolvedAppId);
  }

  function handleBackToList() {
    setSelectedRequestId(null);
    setSelectedRequestAppId(null);
    setDetailState({
      detail: null,
      loading: false,
      error: null,
    });
    closeButtonRef.current?.focus();
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
              {detailViewOpen ? "Request detail" : "Recent activity"}
            </h2>
            <p id={descriptionId} className="owt-activity-drawer__subtitle">
              {subtitle}
            </p>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="owt-activity-drawer__icon-button"
            onClick={onClose}
            aria-label="Close recent activity"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="owt-activity-drawer__toolbar">
          {detailViewOpen ? (
            <button
              type="button"
              className="owt-activity-drawer__secondary-button"
              onClick={handleBackToList}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </button>
          ) : (
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
          )}

          <button
            type="button"
            className="owt-activity-drawer__secondary-button"
            onClick={handleRefresh}
            disabled={requestLogsState.loading || detailState.loading}
          >
            {requestLogsState.loading || detailState.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </div>

        {detailViewOpen ? (
          <div className="owt-activity-drawer__detail">
            {detailState.error ? (
              <div className="owt-activity-drawer__state">
                <p>{detailState.error}</p>
              </div>
            ) : detailState.loading ? (
              <div className="owt-activity-drawer__state">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p>Loading request detail…</p>
              </div>
            ) : detailState.detail ? (
              <>
                <div className="owt-activity-drawer__detail-summary">
                  <div className="owt-activity-drawer__detail-card">
                    <span className="owt-activity-drawer__detail-label">
                      Request ID
                    </span>
                    <strong className="owt-activity-drawer__detail-value owt-activity-drawer__detail-value--mono">
                      {detailState.detail.requestId}
                    </strong>
                  </div>
                  <div className="owt-activity-drawer__detail-card">
                    <span className="owt-activity-drawer__detail-label">
                      App
                    </span>
                    <strong className="owt-activity-drawer__detail-value">
                      {
                        APP_LABELS[
                          resolveAppId(
                            detailState.detail.appType,
                            selectedRequestAppId ?? activeAppId,
                          )
                        ]
                      }
                    </strong>
                  </div>
                  <div className="owt-activity-drawer__detail-card">
                    <span className="owt-activity-drawer__detail-label">
                      Status
                    </span>
                    <span
                      className="owt-activity-drawer__status-pill"
                      data-tone={getStatusTone(
                        detailState.detail.statusCode,
                        Boolean(detailState.detail.errorMessage),
                      )}
                    >
                      {getStatusLabel(detailState.detail)}
                    </span>
                  </div>
                  <div className="owt-activity-drawer__detail-card">
                    <span className="owt-activity-drawer__detail-label">
                      Created
                    </span>
                    <strong className="owt-activity-drawer__detail-value">
                      {formatAbsoluteTime(detailState.detail.createdAt)}
                    </strong>
                  </div>
                </div>

                <section className="owt-activity-drawer__detail-section">
                  <h3>Request</h3>
                  <dl className="owt-activity-drawer__detail-grid">
                    <div>
                      <dt>Provider</dt>
                      <dd>
                        {detailState.detail.providerName ||
                          detailState.detail.providerId}
                      </dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{detailState.detail.model || "Default model"}</dd>
                    </div>
                    <div>
                      <dt>Request model</dt>
                      <dd>
                        {detailState.detail.requestModel || "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt>Data source</dt>
                      <dd>{detailState.detail.dataSource || "Unavailable"}</dd>
                    </div>
                    <div>
                      <dt>Streaming</dt>
                      <dd>{detailState.detail.isStreaming ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Cost multiplier</dt>
                      <dd>{detailState.detail.costMultiplier || "1"}</dd>
                    </div>
                  </dl>
                </section>

                <section className="owt-activity-drawer__detail-section">
                  <h3>Performance</h3>
                  <dl className="owt-activity-drawer__detail-grid">
                    <div>
                      <dt>Latency</dt>
                      <dd>{formatLatency(detailState.detail.latencyMs)}</dd>
                    </div>
                    <div>
                      <dt>First token</dt>
                      <dd>{formatLatency(detailState.detail.firstTokenMs)}</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatLatency(detailState.detail.durationMs)}</dd>
                    </div>
                    <div>
                      <dt>Total tokens</dt>
                      <dd>
                        {formatCount(getRequestTokenCount(detailState.detail))}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="owt-activity-drawer__detail-section">
                  <h3>Token breakdown</h3>
                  <dl className="owt-activity-drawer__detail-grid">
                    <div>
                      <dt>Input</dt>
                      <dd>{formatCount(detailState.detail.inputTokens)}</dd>
                    </div>
                    <div>
                      <dt>Output</dt>
                      <dd>{formatCount(detailState.detail.outputTokens)}</dd>
                    </div>
                    <div>
                      <dt>Cache read</dt>
                      <dd>{formatCount(detailState.detail.cacheReadTokens)}</dd>
                    </div>
                    <div>
                      <dt>Cache create</dt>
                      <dd>
                        {formatCount(detailState.detail.cacheCreationTokens)}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="owt-activity-drawer__detail-section">
                  <h3>Cost breakdown</h3>
                  <dl className="owt-activity-drawer__detail-grid">
                    <div>
                      <dt>Input</dt>
                      <dd>{formatUsd(detailState.detail.inputCostUsd)}</dd>
                    </div>
                    <div>
                      <dt>Output</dt>
                      <dd>{formatUsd(detailState.detail.outputCostUsd)}</dd>
                    </div>
                    <div>
                      <dt>Cache read</dt>
                      <dd>{formatUsd(detailState.detail.cacheReadCostUsd)}</dd>
                    </div>
                    <div>
                      <dt>Cache create</dt>
                      <dd>
                        {formatUsd(detailState.detail.cacheCreationCostUsd)}
                      </dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>{formatUsd(detailState.detail.totalCostUsd)}</dd>
                    </div>
                  </dl>
                </section>

                {detailState.detail.errorMessage ? (
                  <section className="owt-activity-drawer__detail-section">
                    <h3>Response</h3>
                    <pre className="owt-activity-drawer__detail-block">
                      {detailState.detail.errorMessage}
                    </pre>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="owt-activity-drawer__state">
                <p>Request detail unavailable.</p>
              </div>
            )}
          </div>
        ) : (
          <>
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
                  <button
                    key={`${entry.resolvedAppId}-${entry.requestId}`}
                    type="button"
                    className="owt-activity-drawer__row"
                    onClick={() => {
                      handleOpenDetail(entry);
                    }}
                    aria-label={`Open ${entry.providerName || entry.providerId} request ${entry.requestId}`}
                  >
                    <div className="owt-activity-drawer__row-main">
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
                        <span>{entry.model || "Default model"}</span>
                        <span>{APP_LABELS[entry.resolvedAppId]}</span>
                        <span>{formatRelativeTime(entry.createdAt)}</span>
                      </div>
                    </div>

                    <div className="owt-activity-drawer__row-metrics">
                      <span className="owt-activity-drawer__row-metric owt-activity-drawer__row-metric--strong">
                        {formatCount(getRequestTokenCount(entry))} tokens
                      </span>
                      <span className="owt-activity-drawer__row-metric">
                        {formatUsd(entry.totalCostUsd)}
                      </span>
                      <span className="owt-activity-drawer__row-metric">
                        {formatLatency(entry.latencyMs)}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="owt-activity-drawer__state">
                  <p>No recent requests for this filter.</p>
                </div>
              )}
            </div>

            <div className="owt-activity-drawer__foot">
              <div className="owt-activity-drawer__foot-copy">
                <span>
                  {windowStart && windowEnd
                    ? `${windowStart}-${windowEnd} of ${formatCount(requestLogsState.total)}`
                    : "0 requests"}
                </span>
                <span>{updatedLabel}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
