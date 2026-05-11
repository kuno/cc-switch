import { Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  SharedProviderAppId,
  SharedProviderView,
} from "@/shared/providers/domain";
import type {
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
  OpenWrtStatusApp,
  OpenWrtStatusProvider,
} from "../pageTypes";
import { formatRelativeTime } from "../i18n/formatRelativeTime";

const STATUS_REQUEST_LOG_LIMIT = 6;

type ProviderStatusTone = "success" | "warn" | "fail" | "idle";

type ProviderStatusState = {
  appStatus: OpenWrtStatusApp | null;
  error: string | null;
  loading: boolean;
  logs: OpenWrtRequestLog[];
  providerStatus: OpenWrtStatusProvider | null;
};

type ProviderQuotaSummary = {
  balances: Array<{
    label: string;
    remaining: string;
  }>;
  tokens: string | null;
  windows: Array<{
    label: string;
    remainingPercent: number;
  }>;
};

interface ProviderSidePanelStatusTabProps {
  appId: SharedProviderAppId;
  provider: SharedProviderView | null;
  providerId: string | null;
  providerInFailoverQueue?: boolean;
  failoverQueueProviderIds: string[];
  shell: OpenWrtSharedPageShellApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: Record<string, unknown> | null | undefined): string {
  if (!value) return "";
  const candidates = ["state", "status", "phase", "currentRole", "current_role"];
  for (const key of candidates) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function getBool(
  value: Record<string, unknown> | null | undefined,
  keys: string[],
): boolean | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return null;
}

function getNumber(
  value: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getRecordString(
  value: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return "";
}

function getLastError(
  value: Record<string, unknown> | null | undefined,
): string {
  if (!value) return "";
  for (const key of ["lastError", "last_error", "error", "reason"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function getActiveProviderId(appStatus: OpenWrtStatusApp | null): string {
  const active = appStatus?.activeProvider ?? appStatus?.active_provider;
  if (!active) return "";
  return (
    active.providerId ??
    active.provider_id ??
    active.id ??
    ""
  ).trim();
}

function getProviderStatus(
  appStatus: OpenWrtStatusApp | null,
  providerId: string | null,
): OpenWrtStatusProvider | null {
  if (!providerId) return null;
  return appStatus?.providers?.[providerId] ?? null;
}

function formatCount(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(
    Number.isFinite(value) ? Math.max(0, value) : 0,
  );
}

function formatCompactCount(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function formatCost(value: string | number | null | undefined): string {
  const numericValue = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "$0.00";
  return numericValue < 0.01
    ? `$${numericValue.toFixed(4)}`
    : `$${numericValue.toFixed(2)}`;
}

function formatLatency(value: number | null, t: TFunction): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return t("openwrt.activity.notAvailable");
  }
  return t("openwrt.activity.latencyMs", { value: Math.round(value) });
}

function formatPercent(value: number | null, t: TFunction): string {
  if (!Number.isFinite(value) || value == null) {
    return t("openwrt.activity.notAvailable");
  }
  return t("openwrt.providerStatistics.percent", {
    value: Math.round(value * 10) / 10,
  });
}

function formatQuotaAmount(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: value >= 1000 ? 0 : 1,
  }).format(Math.max(0, value));
}

function formatBalanceAmount(
  amount: number,
  currency: string,
  language: string,
): string {
  try {
    return new Intl.NumberFormat(language, {
      currency,
      style: "currency",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function normalizeQuotaSummary(
  value: unknown,
  t: TFunction,
  language: string,
): ProviderQuotaSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const tokensRemaining = getNumber(value, [
    "tokensRemaining",
    "tokens_remaining",
  ]);
  const tokensLimit = getNumber(value, ["tokensLimit", "tokens_limit"]);
  const tokens =
    tokensRemaining != null
      ? tokensLimit && tokensLimit > 0
        ? t("openwrt.providerStatistics.quotaValueWithLimit", {
            limit: formatQuotaAmount(tokensLimit, language),
            remaining: formatQuotaAmount(tokensRemaining, language),
          })
        : t("openwrt.providerStatistics.quotaValue", {
            remaining: formatQuotaAmount(tokensRemaining, language),
          })
      : null;

  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((entry): ProviderQuotaSummary["windows"][number] | null => {
          if (!isRecord(entry)) {
            return null;
          }

          const label = getRecordString(entry, ["name"]);
          const utilization = getNumber(entry, ["utilization"]);

          if (!label || utilization == null) {
            return null;
          }

          return {
            label,
            remainingPercent: Math.max(
              0,
              Math.min(100, Math.trunc((1 - utilization) * 100)),
            ),
          };
        })
        .filter(
          (entry): entry is ProviderQuotaSummary["windows"][number] =>
            entry != null,
        )
    : [];

  const balances = Array.isArray(value.balances)
    ? value.balances
        .map((entry): ProviderQuotaSummary["balances"][number] | null => {
          if (!isRecord(entry)) {
            return null;
          }

          const remaining = getNumber(entry, ["remaining"]);
          if (remaining == null) {
            return null;
          }

          const label =
            getRecordString(entry, ["planName", "plan_name"]) ||
            t("openwrt.providerStatistics.balance");
          const currency = getRecordString(entry, ["currency"]) || "USD";

          return {
            label,
            remaining: formatBalanceAmount(remaining, currency, language),
          };
        })
        .filter(
          (entry): entry is ProviderQuotaSummary["balances"][number] =>
            entry != null,
        )
    : [];

  if (!tokens && windows.length === 0 && balances.length === 0) {
    return null;
  }

  return {
    balances,
    tokens,
    windows,
  };
}

function getTokenCount(entry: OpenWrtRequestLog): number {
  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.cacheCreationTokens +
    entry.cacheReadTokens
  );
}

function getLogTone(entry: OpenWrtRequestLog): Exclude<ProviderStatusTone, "idle"> {
  if (entry.statusCode >= 200 && entry.statusCode < 300) return "success";
  if (entry.statusCode >= 500 || entry.errorMessage) return "fail";
  return "warn";
}

function percentile(values: number[], ratio: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function deriveSummary(
  providerStatus: OpenWrtStatusProvider | null,
  logs: OpenWrtRequestLog[],
) {
  const stats = providerStatus?.stats;
  const requestCount =
    typeof stats?.requestCount === "number" ? stats.requestCount : logs.length;
  const totalTokens =
    typeof stats?.totalTokens === "number"
      ? stats.totalTokens
      : logs.reduce((total, entry) => total + getTokenCount(entry), 0);
  const totalCost =
    stats?.totalCost ??
    logs
      .reduce(
        (total, entry) => total + Number.parseFloat(entry.totalCostUsd || "0"),
        0,
      )
      .toString();
  const successRate =
    typeof stats?.successRate === "number"
      ? stats.successRate
      : logs.length
        ? (logs.filter((entry) => getLogTone(entry) === "success").length /
            logs.length) *
          100
        : null;
  const latencies = logs.map((entry) => entry.latencyMs);
  const p50 =
    typeof stats?.avgLatencyMs === "number"
      ? stats.avgLatencyMs
      : percentile(latencies, 0.5);

  return {
    p50,
    p95: percentile(latencies, 0.95),
    requestCount,
    successRate,
    totalCost,
    totalTokens,
  };
}

function deriveProviderState({
  activeProviderId,
  appStatus,
  failoverQueueProviderIds,
  provider,
  providerId,
  providerInFailoverQueue,
  providerStatus,
  t,
}: {
  activeProviderId: string;
  appStatus: OpenWrtStatusApp | null;
  failoverQueueProviderIds: string[];
  provider: SharedProviderView | null;
  providerId: string | null;
  providerInFailoverQueue?: boolean;
  providerStatus: OpenWrtStatusProvider | null;
  t: TFunction;
}) {
  const failoverStatus =
    providerId && appStatus?.failoverStatus
      ? appStatus.failoverStatus[providerId]
      : null;
  const role = isRecord(failoverStatus) ? getString(failoverStatus) : "";
  const active = Boolean(
    providerId && (provider?.active || providerId === activeProviderId),
  );
  const queued =
    Boolean(providerInFailoverQueue) ||
    Boolean(providerId && failoverQueueProviderIds.includes(providerId)) ||
    Boolean(
      isRecord(failoverStatus) &&
        getBool(failoverStatus, ["inFailoverQueue", "in_failover_queue"]),
    );
  const providerHealthy = getBool(providerStatus?.health, ["healthy", "ok"]);
  const appHealthy = appStatus?.health;

  if (active && (providerHealthy === false || appHealthy === false)) {
    return {
      label: t("openwrt.providerStatus.degraded"),
      sub: t("openwrt.providerStatus.activeDegraded"),
      tone: "warn" as const,
    };
  }

  if (active) {
    return {
      label: t("openwrt.providerStatus.active"),
      sub: t("openwrt.providerStatus.activeSub"),
      tone: "success" as const,
    };
  }

  if (queued || role) {
    return {
      label: role || t("openwrt.providerStatus.queued"),
      sub: t("openwrt.providerStatus.queuedSub"),
      tone: "idle" as const,
    };
  }

  if (provider?.configured === false) {
    return {
      label: t("openwrt.providerStatus.draft"),
      sub: t("openwrt.providerStatus.draftSub"),
      tone: "warn" as const,
    };
  }

  return {
    label: t("openwrt.providerStatus.saved"),
    sub: t("openwrt.providerStatus.savedSub"),
    tone: "idle" as const,
  };
}

export function ProviderSidePanelStatusTab({
  appId,
  provider,
  providerId,
  providerInFailoverQueue,
  failoverQueueProviderIds,
  shell,
}: ProviderSidePanelStatusTabProps) {
  const { t, i18n: i18nextInstance } = useTranslation();
  const language = i18nextInstance.language || "en";
  const [state, setState] = useState<ProviderStatusState>({
    appStatus: null,
    error: null,
    loading: false,
    logs: [],
    providerStatus: null,
  });

  useEffect(() => {
    if (!providerId) {
      setState({
        appStatus: null,
        error: null,
        loading: false,
        logs: [],
        providerStatus: null,
      });
      return;
    }

    let cancelled = false;
    setState((current) => ({ ...current, error: null, loading: true }));

    void Promise.all([
      shell.getStatus(),
      shell.getRequestLogs(appId, 0, STATUS_REQUEST_LOG_LIMIT, providerId),
    ])
      .then(([status, logs]) => {
        if (cancelled) return;
        const appStatus = status.apps[appId] ?? null;
        setState({
          appStatus,
          error: null,
          loading: false,
          logs: logs.data,
          providerStatus: getProviderStatus(appStatus, providerId),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          appStatus: null,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
          logs: [],
          providerStatus: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [appId, providerId, shell]);

  const activeProviderId = getActiveProviderId(state.appStatus);
  const providerState = deriveProviderState({
    activeProviderId,
    appStatus: state.appStatus,
    failoverQueueProviderIds,
    provider,
    providerId,
    providerInFailoverQueue,
    providerStatus: state.providerStatus,
    t,
  });
  const summary = useMemo(
    () => deriveSummary(state.providerStatus, state.logs),
    [state.logs, state.providerStatus],
  );
  const quota = normalizeQuotaSummary(state.providerStatus?.quota, t, language);
  const hasQuota =
    quota &&
    (quota.tokens || quota.windows.length > 0 || quota.balances.length > 0);
  const lastRequest = state.logs[0] ?? null;
  const health = state.providerStatus?.health;
  const circuit = state.providerStatus?.circuit;
  const reachabilityHealthy = getBool(health, ["healthy", "reachable", "ok"]);
  const circuitState = getString(circuit) || t("openwrt.providerStatus.closed");
  const lastError =
    getLastError(health) ||
    getLastError(circuit) ||
    state.logs.find((entry) => entry.errorMessage)?.errorMessage ||
    "";

  return (
    <div className="owt-provider-panel__status">
      {state.error ? (
        <div className="owt-provider-panel__state owt-provider-panel__state--error">
          {state.error}
        </div>
      ) : state.loading ? (
        <div className="owt-provider-panel__state">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("openwrt.providerStatus.loading")}
        </div>
      ) : (
        <>
          <div className="owt-provider-panel__status-hero">
            <div>
              <div className="owt-provider-panel__status-eyebrow">
                {t("openwrt.providerStatus.providerState")}
              </div>
              <div className="owt-provider-panel__status-line">
                <span
                  className="owt-provider-panel__status-dot"
                  data-tone={providerState.tone}
                  aria-hidden="true"
                />
                <span>{providerState.label}</span>
              </div>
              <div className="owt-provider-panel__status-sub">
                {providerState.sub}
              </div>
            </div>
            <div className="owt-provider-panel__status-last">
              <div className="owt-provider-panel__status-eyebrow">
                {t("openwrt.providerStatus.lastRequest")}
              </div>
              <div className="owt-provider-panel__status-time">
                {lastRequest
                  ? formatRelativeTime(lastRequest.createdAt)
                  : t("openwrt.providerStatus.noLastRequest")}
              </div>
              <div className="owt-provider-panel__status-sub">
                {lastRequest
                  ? [
                      lastRequest.statusCode
                        ? t("openwrt.activity.httpStatus", {
                            statusCode: lastRequest.statusCode,
                          })
                        : null,
                      formatCompactCount(getTokenCount(lastRequest), language),
                      formatLatency(lastRequest.latencyMs, t),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : t("openwrt.providerStatus.noRequestRouted")}
              </div>
            </div>
          </div>

          {hasQuota ? (
            <div className="owt-provider-panel__quota-card">
              <div className="owt-provider-panel__config-group-title">
                {t("openwrt.providerStatistics.leftQuota")}
              </div>
              {quota?.tokens ? (
                <div className="owt-provider-panel__quota-line">
                  <span>{t("openwrt.providerStatistics.tokenQuota")}</span>
                  <strong>{quota.tokens}</strong>
                </div>
              ) : null}
              {quota?.windows.map((window) => (
                <div
                  className="owt-provider-panel__quota-line"
                  key={window.label}
                >
                  <span>{window.label}</span>
                  <strong>
                    {t("openwrt.appCard.percentRemaining", {
                      percent: window.remainingPercent,
                    })}
                  </strong>
                </div>
              ))}
              {quota?.balances.map((balance) => (
                <div
                  className="owt-provider-panel__quota-line"
                  key={balance.label}
                >
                  <span>{balance.label}</span>
                  <strong>{balance.remaining}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="owt-provider-panel__status-metrics">
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.successRate")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatPercent(summary.successRate, t)}
              </div>
            </div>
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.p50Latency")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatLatency(summary.p50, t)}
              </div>
            </div>
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.p95Latency")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatLatency(summary.p95, t)}
              </div>
            </div>
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.requests")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatCount(summary.requestCount, language)}
              </div>
            </div>
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.tokens")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatCompactCount(summary.totalTokens, language)}
              </div>
            </div>
            <div className="owt-provider-panel__status-metric">
              <div className="owt-provider-panel__status-metric-label">
                {t("openwrt.providerStatus.cost")}
              </div>
              <div className="owt-provider-panel__status-metric-value">
                {formatCost(summary.totalCost)}
              </div>
            </div>
          </div>

          <div className="owt-provider-panel__status-block">
            <div className="owt-provider-panel__status-eyebrow">
              {t("openwrt.providerStatus.recentRequests")}
            </div>
            <div className="owt-provider-panel__status-recent">
              {state.logs.length ? (
                state.logs.slice(0, 5).map((entry) => (
                  <div
                    key={`${entry.providerId}-${entry.requestId}`}
                    className="owt-provider-panel__status-recent-row"
                  >
                    <span
                      className="owt-provider-panel__activity-status"
                      data-tone={getLogTone(entry)}
                    >
                      {entry.statusCode || t("openwrt.activity.pending")}
                    </span>
                    <span className="owt-provider-panel__status-recent-model">
                      {entry.model || t("openwrt.activity.defaultModel")}
                    </span>
                    <span>{formatCompactCount(getTokenCount(entry), language)}</span>
                    <span>{formatRelativeTime(entry.createdAt)}</span>
                  </div>
                ))
              ) : (
                <div className="owt-provider-panel__status-empty-row">
                  {t("openwrt.providerStatus.noRecentTraffic")}
                </div>
              )}
            </div>
          </div>

          <div className="owt-provider-panel__status-block">
            <div className="owt-provider-panel__status-eyebrow">
              {t("openwrt.providerStatus.healthChecks")}
            </div>
            <div className="owt-provider-panel__health-row">
              <span>{t("openwrt.providerStatus.reachability")}</span>
              <span
                className="owt-provider-panel__health-chip"
                data-tone={reachabilityHealthy === false ? "fail" : "success"}
              >
                {reachabilityHealthy === false
                  ? t("openwrt.providerStatus.unreachable")
                  : t("openwrt.providerStatus.ok")}
              </span>
            </div>
            <div className="owt-provider-panel__health-row">
              <span>{t("openwrt.providerStatus.auth")}</span>
              <span
                className="owt-provider-panel__health-chip"
                data-tone={provider?.tokenConfigured ? "success" : "warn"}
              >
                {provider?.tokenConfigured
                  ? t("openwrt.providerStatus.valid")
                  : t("openwrt.providerStatus.notConfigured")}
              </span>
            </div>
            <div className="owt-provider-panel__health-row">
              <span>{t("openwrt.providerStatus.circuitBreaker")}</span>
              <span className="owt-provider-panel__health-chip">
                {circuitState}
              </span>
            </div>
            <div className="owt-provider-panel__health-row">
              <span>{t("openwrt.providerStatus.lastError")}</span>
              <span className="owt-provider-panel__health-value">
                {lastError || t("openwrt.providerStatus.none")}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
