import type { KeyboardEventHandler, MouseEventHandler } from "react";
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
import type {
  BalanceSnapshot,
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "../types/quota";
import {
  getOpenWrtAppIconUrl,
  OpenWrtProviderIcon,
} from "../providerIcons";

const APP_COPY: Record<
  SharedProviderAppId,
  {
    label: string;
    subtitle: string;
  }
> = {
  claude: {
    label: "Claude",
    subtitle: "Anthropic · Claude Code",
  },
  codex: {
    label: "Codex",
    subtitle: "OpenAI · Codex CLI",
  },
  gemini: {
    label: "Gemini",
    subtitle: "Google · Gemini CLI",
  },
};

type StatusTone = "success" | "accent" | "neutral" | "fail";

/** Compact formatter: 12307 → "12.3k", 8_420_000 → "8.42M". Mirrors the prototype. */
function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 100) / 10}k`;
  }

  if (value >= 1000) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  return new Intl.NumberFormat("en-US").format(value);
}

/** Parses the string-money field and returns a bare numeric string — the unit is rendered separately. */
function formatCostValue(value: string | null | undefined): string {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric) || numeric === 0) {
    return "0.00";
  }

  const fractionDigits = Math.abs(numeric) < 1 ? 4 : 2;

  return numeric.toFixed(fractionDigits);
}

function sumTokenCounts(summary: OpenWrtUsageSummary | null): number {
  if (!summary) {
    return 0;
  }

  return (
    (summary.totalInputTokens ?? 0) +
    (summary.totalOutputTokens ?? 0) +
    (summary.totalCacheCreationTokens ?? 0) +
    (summary.totalCacheReadTokens ?? 0)
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
  const activeProviderConfigured =
    providerState?.activeProvider.configured ?? false;

  if (loading && !providerState) {
    return { label: "Loading", tone: "neutral" };
  }

  if (!activeProviderConfigured) {
    return { label: "Not configured", tone: "neutral" };
  }

  if (!serviceRunning || hostState.status === "stopped") {
    return { label: "Stopped", tone: "neutral" };
  }

  if (appId === hostState.app) {
    if (hostState.health === "healthy") {
      return { label: "Running", tone: "success" };
    }

    if (hostState.health === "degraded") {
      return { label: "Degraded", tone: "accent" };
    }
  }

  if ((recentActivity[0]?.statusCode ?? 0) >= 400) {
    return { label: "Degraded", tone: "accent" };
  }

  if (error) {
    return { label: "Unavailable", tone: "fail" };
  }

  return { label: "Running", tone: "success" };
}

function formatReset(reset: number | null | undefined): string {
  if (!reset) return "—";
  const parts = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(reset * 1000));
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!month || !day || !hour || !minute) return "—";
  return `${month} ${day} ${hour}:${minute}`;
}

function utilBarClass(util: number | null | undefined): string {
  if (util == null) return "owt-quota-bar--success";
  if (util >= 0.8) return "owt-quota-bar--danger";
  if (util >= 0.6) return "owt-quota-bar--warning";
  return "owt-quota-bar--success";
}

function remainingBarClass(util: number | null | undefined): string {
  if (util == null) return "owt-quota-bar--success";
  const remaining = 1 - util;
  if (remaining <= 0.2) return "owt-quota-bar--danger";
  if (remaining <= 0.4) return "owt-quota-bar--warning";
  return "owt-quota-bar--success";
}

function formatBalanceAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function WindowRow({ window: w }: { window: QuotaWindow }) {
  const pct =
    w.utilization != null
      ? Math.max(0, Math.min(100, Math.round((1 - w.utilization) * 100)))
      : null;
  const fillPct =
    w.utilization != null
      ? Math.max(0, Math.min(100, Number(((1 - w.utilization) * 100).toFixed(2))))
      : null;
  const barClass = remainingBarClass(w.utilization);

  return (
    <div className="owt-quota-row">
      <div className="owt-quota-row__label">
        <span className="owt-quota-row__name">{w.name}</span>
        {pct != null && (
          <span className="owt-quota-row__pct">{pct}% remaining</span>
        )}
        {w.reset != null && (
          <span className="owt-quota-row__reset">
            resets {formatReset(w.reset)}
          </span>
        )}
      </div>
      {fillPct != null && (
        <div className="owt-quota-bar" aria-hidden="true">
          <div
            className={`owt-quota-bar__fill ${barClass}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BalanceRow({ balance }: { balance: BalanceSnapshot }) {
  const currency = balance.currency ?? "USD";
  const remaining = balance.remaining ?? 0;
  const isInvalid = balance.is_valid === false || remaining <= 0;
  const formattedRemaining = formatBalanceAmount(remaining, currency);
  const hasTotal =
    balance.total != null && balance.total > 0;
  const usedAmount = balance.used ?? (hasTotal ? (balance.total ?? 0) - remaining : null);
  const fillPct =
    hasTotal && balance.total != null && balance.total > 0
      ? Math.min(100, Math.round(((usedAmount ?? 0) / balance.total) * 100))
      : null;
  const barClass = isInvalid
    ? "owt-quota-bar--danger"
    : utilBarClass(fillPct != null ? fillPct / 100 : null);

  return (
    <div className="owt-quota-row">
      <div className="owt-quota-row__label">
        <span
          className={`owt-quota-row__name${isInvalid ? " owt-quota-row__name--invalid" : ""}`}
        >
          {formattedRemaining} remaining
          {hasTotal && balance.total != null
            ? ` / ${formatBalanceAmount(balance.total, currency)}`
            : null}
        </span>
        {isInvalid && balance.invalid_message ? (
          <span className="owt-quota-row__invalid-msg">
            {balance.invalid_message}
          </span>
        ) : null}
      </div>
      {fillPct != null && (
        <div className="owt-quota-bar" aria-hidden="true">
          <div
            className={`owt-quota-bar__fill ${barClass}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function QuotaBand({ snapshot, hideLabel }: { snapshot: ProviderQuotaSnapshot; hideLabel?: boolean }) {
  const hasWindows = snapshot.windows.length > 0;
  const activeBalances = snapshot.balances?.filter(
    (b) => b.remaining != null || b.total != null,
  );
  const hasBalances = (activeBalances?.length ?? 0) > 0;

  if (!hasWindows && !hasBalances) return null;

  return (
    <div className="owt-quota-band">
      {!hideLabel && <div className="owt-quota-band__label">Quota</div>}
      {hasWindows
        ? snapshot.windows.map((w, i) => (
            <WindowRow key={`${w.name}-${i}`} window={w} />
          ))
        : activeBalances!.map((b, i) => (
            <BalanceRow key={i} balance={b} />
          ))}
    </div>
  );
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
  quotaSnapshot?: ProviderQuotaSnapshot;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (appId: SharedProviderAppId) => void;
}

export function AppCard({
  appId,
  hostState,
  serviceRunning,
  providerState,
  summary,
  recentActivity,
  loading,
  error,
  quotaSnapshot,
  onOpenActivity,
  onOpenProviderPanel,
}: AppCardProps) {
  const appCopy = APP_COPY[appId];
  const providerCount = providerState?.providers.length ?? 0;
  const activeProvider = providerState?.activeProvider.configured
    ? providerState.activeProvider
    : null;
  const status = getStatus({
    appId,
    hostState,
    loading,
    error,
    providerState,
    serviceRunning,
    recentActivity,
  });

  const appIconUrl = getOpenWrtAppIconUrl(appId);

  if (!activeProvider) {
    return (
      <button
        type="button"
        className="owt-app-card owt-app-card--empty"
        data-app={appId}
        onClick={() => onOpenProviderPanel(appId)}
        aria-label={`Add a ${appCopy.label} provider`}
      >
        <div className="owt-app-card__head">
        <div
          className="owt-app-card__icon owt-app-card__icon--muted"
          aria-hidden="true"
        >
          <img src={appIconUrl} alt="" />
        </div>
          <div className="owt-app-card__titles">
            <h3 className="owt-app-card__title owt-app-card__title--muted">
              {appCopy.label}
            </h3>
            <p className="owt-app-card__subtitle">{appCopy.subtitle}</p>
          </div>
          <span className="owt-app-card__spacer" aria-hidden="true" />
          <span className="owt-status-pill" data-tone="neutral">
            <span className="owt-status-pill__dot" aria-hidden="true" />
            Not configured
          </span>
        </div>
        <div className="owt-app-card__empty-cta">
          <span>No provider configured yet</span>
          <span className="owt-app-card__empty-cta-btn">Add a provider →</span>
        </div>
      </button>
    );
  }

  const tokensValue = formatCompactCount(sumTokenCounts(summary));
  const requestsValue = formatCompactCount(summary?.totalRequests ?? 0);
  const costValue = formatCostValue(summary?.totalCost);

  const handleCardClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if ((event.target as HTMLElement).closest("[data-owt-chip]")) {
      return;
    }
    onOpenProviderPanel(appId);
  };

  const handleCardKey: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      if ((event.target as HTMLElement).closest("[data-owt-chip]")) {
        return;
      }
      event.preventDefault();
      onOpenProviderPanel(appId);
    }
  };

  return (
    <div
      className="owt-app-card"
      data-app={appId}
      data-loading={loading ? "true" : "false"}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      aria-label={`Open ${appCopy.label} providers`}
    >
      <div className="owt-app-card__head">
        <div className="owt-app-card__icon" aria-hidden="true">
          <img src={appIconUrl} alt="" />
        </div>
        <div className="owt-app-card__titles">
          <h3 className="owt-app-card__title">
            {appCopy.label}
            <span className="owt-app-card__prov-count">
              {" · "}
              {providerCount} provider{providerCount === 1 ? "" : "s"}
              <span className="owt-app-card__prov-hover"> →</span>
            </span>
          </h3>
          <p className="owt-app-card__subtitle">{appCopy.subtitle}</p>
        </div>
        <span className="owt-app-card__spacer" aria-hidden="true" />
        <button
          type="button"
          className="owt-status-pill owt-status-pill--button"
          data-owt-chip="true"
          data-tone={status.tone}
          onClick={(event) => {
            event.stopPropagation();
            onOpenActivity(appId);
          }}
          title="Show recent requests"
        >
          <span className="owt-status-pill__dot" aria-hidden="true" />
          {status.label}
          <svg
            className="owt-status-pill__caret"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M3 5l3 3 3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="owt-app-card__active">
        <div className="owt-app-card__active-row">
          <div className="owt-app-card__mini-icon" aria-hidden="true">
            <OpenWrtProviderIcon
              appId={appId}
              name={activeProvider.name.trim() || appCopy.label}
              size={18}
              source={activeProvider}
            />
          </div>
          <div className="owt-app-card__active-labels">
            <div className="owt-app-card__active-top">Active provider</div>
            <div className="owt-app-card__active-main">
              {activeProvider.name.trim() || "Unnamed provider"}
            </div>
            <div className="owt-app-card__active-endpoint">
              {activeProvider.baseUrl.trim() || "Endpoint unavailable"}
            </div>
          </div>
        </div>
        {quotaSnapshot ? <QuotaBand snapshot={quotaSnapshot} hideLabel /> : null}
      </div>

      <div className="owt-app-card__usage">
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">Tokens</div>
          <div className="owt-app-card__usage-value">{tokensValue}</div>
        </div>
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">Requests</div>
          <div className="owt-app-card__usage-value">{requestsValue}</div>
        </div>
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">Cost</div>
          <div className="owt-app-card__usage-value">
            {costValue}
            <span className="owt-app-card__usage-unit">USD</span>
          </div>
        </div>
      </div>


      {error ? <p className="owt-app-card__telemetry-note">{error}</p> : null}
    </div>
  );
}
