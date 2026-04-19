import { ArrowUpRight, Loader2 } from "lucide-react";
import type {
  SharedProviderAppId,
  SharedProviderState,
} from "@/shared/providers/domain";
import type {
  OpenWrtHostState,
  OpenWrtProviderStat,
  OpenWrtRecentActivityItem,
  OpenWrtUsageSummary,
} from "../pageTypes";

const APP_COPY: Record<
  SharedProviderAppId,
  {
    label: string;
    initials: string;
    subtitle: string;
  }
> = {
  claude: {
    label: "Claude",
    initials: "CL",
    subtitle: "Anthropic-compatible routing",
  },
  codex: {
    label: "Codex",
    initials: "CX",
    subtitle: "Responses-compatible routing",
  },
  gemini: {
    label: "Gemini",
    initials: "GM",
    subtitle: "Google-compatible routing",
  },
};

type StatusTone = "success" | "accent" | "neutral";

function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}

function formatUsd(value: string | null | undefined): string {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return value?.trim() || "$0.00";
  }

  const fractionDigits = numeric !== 0 && Math.abs(numeric) < 1 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(numeric);
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
    return "Unknown";
  }

  const diffMinutes = Math.round((Date.now() - epochMs) / 60000);

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
  }).format(new Date(epochMs));
}

function getActivityTone(statusCode: number): StatusTone {
  if (statusCode >= 200 && statusCode < 300) {
    return "success";
  }

  if (statusCode >= 400) {
    return "accent";
  }

  return "neutral";
}

function getLatestStatusValue(entries: OpenWrtRecentActivityItem[]): string {
  const statusCode = entries[0]?.statusCode ?? 0;

  if (statusCode > 0) {
    return String(statusCode);
  }

  return "—";
}

function getActiveProviderStat(
  providerState: SharedProviderState | null,
  providerStats: OpenWrtProviderStat[],
): OpenWrtProviderStat | null {
  const activeProvider = providerState?.activeProvider;

  if (!activeProvider?.configured) {
    return null;
  }

  return (
    providerStats.find(
      (stat) => stat.providerId === activeProvider.providerId,
    ) ??
    providerStats.find(
      (stat) =>
        stat.providerName.trim() &&
        stat.providerName.trim() === activeProvider.name.trim(),
    ) ??
    null
  );
}

function getStatus({
  appId,
  hostState,
  loading,
  error,
  providerState,
  serviceRunning,
  recentActivity,
}: {
  appId: SharedProviderAppId;
  hostState: OpenWrtHostState;
  loading: boolean;
  error: string | null;
  providerState: SharedProviderState | null;
  serviceRunning: boolean;
  recentActivity: OpenWrtRecentActivityItem[];
}): {
  label: string;
  tone: StatusTone;
} {
  const activeProviderConfigured = providerState?.activeProvider.configured ?? false;

  if (loading && !providerState) {
    return {
      label: "Loading",
      tone: "neutral",
    };
  }

  if (!activeProviderConfigured) {
    return {
      label: "Not configured",
      tone: "neutral",
    };
  }

  if (!serviceRunning || hostState.status === "stopped") {
    return {
      label: "Stopped",
      tone: "neutral",
    };
  }

  if (appId === hostState.app) {
    if (hostState.health === "healthy") {
      return {
        label: "Healthy",
        tone: "success",
      };
    }

    if (hostState.health === "degraded") {
      return {
        label: "Degraded",
        tone: "accent",
      };
    }
  }

  if (recentActivity[0]?.statusCode >= 400) {
    return {
      label: "Attention",
      tone: "accent",
    };
  }

  if (error) {
    return {
      label: "Unavailable",
      tone: "accent",
    };
  }

  return {
    label: "Ready",
    tone: "success",
  };
}

export interface AppCardProps {
  appId: SharedProviderAppId;
  hostState: OpenWrtHostState;
  serviceRunning: boolean;
  providerState: SharedProviderState | null;
  summary: OpenWrtUsageSummary | null;
  providerStats: OpenWrtProviderStat[];
  recentActivity: OpenWrtRecentActivityItem[];
  loading: boolean;
  error: string | null;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (appId: SharedProviderAppId) => void;
}

export function AppCard({
  appId,
  hostState,
  serviceRunning,
  providerState,
  summary,
  providerStats,
  recentActivity,
  loading,
  error,
  onOpenActivity,
  onOpenProviderPanel,
}: AppCardProps) {
  const appCopy = APP_COPY[appId];
  const configuredProviderCount =
    providerState?.providers.filter((provider) => provider.configured).length ?? 0;
  const activeProvider = providerState?.activeProvider.configured
    ? providerState.activeProvider
    : null;
  const activeProviderStat = getActiveProviderStat(providerState, providerStats);
  const status = getStatus({
    appId,
    hostState,
    loading,
    error,
    providerState,
    serviceRunning,
    recentActivity,
  });
  const activityPreview = recentActivity.slice(0, 3);
  const summaryLine = activeProviderStat
    ? `${formatPercent(activeProviderStat.successRate)} success rate`
    : `${configuredProviderCount} provider${configuredProviderCount === 1 ? "" : "s"} saved`;

  return (
    <article
      className={`owt-app-card${activeProvider ? "" : " owt-app-card--empty"}`}
      data-app={appId}
      data-loading={loading ? "true" : "false"}
    >
      <button
        type="button"
        className="owt-app-card__main"
        onClick={() => onOpenProviderPanel(appId)}
        aria-label={`Open ${appCopy.label} providers`}
      >
        <div className="owt-app-card__head">
          <div className="owt-app-card__identity">
            <div className="owt-app-card__icon" data-app={appId} aria-hidden="true">
              <span>{appCopy.initials}</span>
            </div>

            <div className="owt-app-card__titles">
              <h3 className="owt-app-card__title">{appCopy.label}</h3>
              <p className="owt-app-card__subtitle">{appCopy.subtitle}</p>
              <p className="owt-app-card__meta">{summaryLine}</p>
            </div>
          </div>

          <div className="owt-app-card__head-side">
            <span className="owt-status-pill" data-tone={status.tone}>
              {status.label}
            </span>
            <span className="owt-app-card__affordance">
              Open providers
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        {activeProvider ? (
          <>
            <div className="owt-app-card__provider">
              <div className="owt-app-card__provider-label">Active provider</div>
              <div className="owt-app-card__provider-name">
                {activeProvider.name.trim() || "Unnamed provider"}
              </div>
              <div className="owt-app-card__provider-endpoint">
                {activeProvider.baseUrl.trim() || "Endpoint unavailable"}
              </div>
            </div>

            <dl className="owt-app-card__stats">
              <div className="owt-app-card__stat">
                <dt>Requests today</dt>
                <dd>{formatCount(summary?.totalRequests ?? 0)}</dd>
              </div>
              <div className="owt-app-card__stat">
                <dt>Cost today</dt>
                <dd>{formatUsd(summary?.totalCost)}</dd>
              </div>
              <div className="owt-app-card__stat">
                <dt>Latest HTTP</dt>
                <dd>{getLatestStatusValue(recentActivity)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="owt-app-card__empty-state">
            <span>No provider configured yet</span>
            <strong>Add a provider</strong>
          </div>
        )}
      </button>

      <div className="owt-app-card__activity">
        <div className="owt-app-card__activity-head">
          <span>Recent activity</span>
          <button
            type="button"
            className="owt-app-card__activity-open"
            onClick={() => onOpenActivity(appId)}
          >
            Open
          </button>
        </div>

        {loading && !activityPreview.length ? (
          <div className="owt-app-card__activity-note">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading activity…</span>
          </div>
        ) : activityPreview.length ? (
          <div className="owt-app-card__activity-row">
            {activityPreview.map((entry) => (
              <button
                key={entry.requestId}
                type="button"
                className="owt-activity-pill"
                data-tone={getActivityTone(entry.statusCode)}
                onClick={() => onOpenActivity(appId)}
                aria-label={`Open ${appCopy.label} activity preview`}
                title={`Open ${appCopy.label} activity`}
              >
                <span className="owt-activity-pill__status">
                  {entry.statusCode > 0 ? entry.statusCode : "—"}
                </span>
                <span className="owt-activity-pill__time">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="owt-app-card__activity-note">
            <span>
              {activeProvider ? "No recent requests yet." : "Configure a provider to start routing requests."}
            </span>
          </div>
        )}

        {error ? (
          <p className="owt-app-card__telemetry-note">{error}</p>
        ) : null}
      </div>
    </article>
  );
}
