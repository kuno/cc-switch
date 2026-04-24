import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
} from "../pageTypes";

const REQUEST_LOG_LIMIT = 20;

type ProviderActivitiesState = {
  data: OpenWrtRequestLog[];
  error: string | null;
  lastLoadedAt: number | null;
  loading: boolean;
};

interface ProviderSidePanelActivitiesTabProps {
  appId: SharedProviderAppId;
  providerId: string | null;
  providerName: string;
  shell: OpenWrtSharedPageShellApi;
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
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(epochMs));
}

function formatUpdatedLabel(value: number | null): string {
  if (!value) {
    return "";
  }

  const relativeLabel = formatRelativeTime(value);

  return `Updated ${relativeLabel === "Just now" ? "just now" : relativeLabel}`;
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatCost(value: string | null | undefined): string {
  const numericValue = Number.parseFloat(value ?? "");

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "$0.00";
  }

  return numericValue < 0.01
    ? `$${numericValue.toFixed(4)}`
    : `$${numericValue.toFixed(2)}`;
}

function formatLatency(value: number | null | undefined): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return "n/a";
  }

  return `${Math.round(value)} ms`;
}

function getRequestTokenCount(entry: OpenWrtRequestLog): number {
  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.cacheCreationTokens +
    entry.cacheReadTokens
  );
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

export function ProviderSidePanelActivitiesTab({
  appId,
  providerId,
  providerName,
  shell,
}: ProviderSidePanelActivitiesTabProps) {
  const [state, setState] = useState<ProviderActivitiesState>({
    data: [],
    error: null,
    lastLoadedAt: null,
    loading: false,
  });

  useEffect(() => {
    if (!providerId) {
      setState({
        data: [],
        error: null,
        lastLoadedAt: null,
        loading: false,
      });
      return;
    }

    let cancelled = false;
    setState((current) => ({
      ...current,
      error: null,
      loading: true,
    }));

    void shell
      .getRequestLogs(appId, 0, REQUEST_LOG_LIMIT, providerId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setState({
          data: response.data,
          error: null,
          lastLoadedAt: Date.now(),
          loading: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          data: [],
          error: error instanceof Error ? error.message : String(error),
          lastLoadedAt: null,
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appId, providerId, shell]);

  const subtitle = providerId
    ? `Recent requests for ${providerName || "this provider"}`
    : "Recent requests for this provider";
  const meta = state.loading
    ? "Loading recent requests"
    : state.data.length
      ? `${state.data.length} shown${state.lastLoadedAt ? ` · ${formatUpdatedLabel(state.lastLoadedAt).toLowerCase()}` : ""}`
      : "";

  return (
    <div className="owt-provider-panel__activities">
      <div className="owt-provider-panel__activities-head">
        <div className="owt-provider-panel__activities-sub">{subtitle}</div>
        {meta ? (
          <div className="owt-provider-panel__activities-meta">{meta}</div>
        ) : null}
      </div>

      {state.error ? (
        <div className="owt-provider-panel__state owt-provider-panel__state--error">
          {state.error}
        </div>
      ) : state.loading ? (
        <div className="owt-provider-panel__state">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading recent requests…
        </div>
      ) : state.data.length ? (
        <div className="owt-provider-panel__activities-list">
          {state.data.map((entry) => (
            <div
              key={`${entry.providerId}-${entry.requestId}`}
              className="owt-provider-panel__activity-row"
            >
              <div className="owt-provider-panel__activity-left">
                <div className="owt-provider-panel__activity-title">
                  <span className="owt-provider-panel__activity-provider">
                    {entry.providerName || entry.providerId || providerName}
                  </span>
                  <span
                    className="owt-provider-panel__activity-status"
                    data-tone={getStatusTone(
                      entry.statusCode,
                      Boolean(entry.errorMessage),
                    )}
                  >
                    {getStatusLabel(entry)}
                  </span>
                </div>
                <div className="owt-provider-panel__activity-subtitle">
                  {[entry.model || "Default model", formatRelativeTime(entry.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>

              <div className="owt-provider-panel__activity-right">
                <span className="owt-provider-panel__activity-metric">
                  {formatCompactCount(getRequestTokenCount(entry))} tok
                </span>
                <span>{formatCost(entry.totalCostUsd)}</span>
                <span className="owt-provider-panel__activity-metric">
                  {formatLatency(entry.latencyMs)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="owt-provider-panel__activities-empty">
          <div className="owt-provider-panel__empty-title">No recent activity</div>
          <div className="owt-provider-panel__empty-subtitle">
            This provider hasn&apos;t served any requests yet. Once traffic flows
            through the daemon, requests will appear here.
          </div>
        </div>
      )}
    </div>
  );
}
