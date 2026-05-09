import { Info, Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtProviderStat,
  OpenWrtSharedPageShellApi,
  OpenWrtStatusProvider,
} from "../pageTypes";

type ProviderStatisticsState = {
  error: string | null;
  loading: boolean;
  quota: ProviderQuotaSummary | null;
  stat: OpenWrtProviderStat | null;
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

interface ProviderSidePanelStatisticsTabProps {
  appId: SharedProviderAppId;
  providerId: string | null;
  providerName: string;
  shell: OpenWrtSharedPageShellApi;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function getString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return "";
}

function normalizeStat(
  providerId: string,
  providerName: string,
  provider: OpenWrtStatusProvider | null,
): OpenWrtProviderStat | null {
  if (!provider || !isRecord(provider.stats)) {
    return null;
  }

  return {
    providerId,
    providerName: provider.name?.trim() || providerName || providerId,
    requestCount: getNumber(provider.stats, ["requestCount"]) ?? 0,
    totalTokens: getNumber(provider.stats, ["totalTokens"]) ?? 0,
    totalCost: String(provider.stats.totalCost ?? "0"),
    successRate: getNumber(provider.stats, ["successRate"]) ?? 0,
    avgLatencyMs: getNumber(provider.stats, ["avgLatencyMs"]) ?? 0,
  };
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

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "$0.00";
  }

  return numericValue < 0.01
    ? `$${numericValue.toFixed(4)}`
    : `$${numericValue.toFixed(2)}`;
}

function formatLatency(value: number, t: TFunction): string {
  if (!Number.isFinite(value) || value <= 0) {
    return t("openwrt.activity.notAvailable");
  }

  return t("openwrt.activity.latencyMs", { value: Math.round(value) });
}

function formatPercent(value: number, t: TFunction): string {
  if (!Number.isFinite(value)) {
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

          const label = getString(entry, ["name"]);
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
            getString(entry, ["planName", "plan_name"]) ||
            t("openwrt.providerStatistics.balance");
          const currency = getString(entry, ["currency"]) || "USD";

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

export function ProviderSidePanelStatisticsTab({
  appId,
  providerId,
  providerName,
  shell,
}: ProviderSidePanelStatisticsTabProps) {
  const { t, i18n: i18nextInstance } = useTranslation();
  const language = i18nextInstance.language || "en";
  const [state, setState] = useState<ProviderStatisticsState>({
    error: null,
    loading: false,
    quota: null,
    stat: null,
  });

  useEffect(() => {
    if (!providerId) {
      setState({
        error: null,
        loading: false,
        quota: null,
        stat: null,
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
      .getStatus()
      .then(async (status) => {
        const provider = status.apps[appId]?.providers?.[providerId] ?? null;
        const stat =
          normalizeStat(providerId, providerName, provider) ??
          (await shell.getProviderStats(appId)).find(
            (entry) => entry.providerId === providerId,
          ) ??
          null;
        const quota = normalizeQuotaSummary(provider?.quota, t, language);

        if (!cancelled) {
          setState({
            error: null,
            loading: false,
            quota,
            stat,
          });
        }
      })
      .catch(async () => {
        try {
          const stat =
            (await shell.getProviderStats(appId)).find(
              (entry) => entry.providerId === providerId,
            ) ?? null;

          if (!cancelled) {
            setState({
              error: null,
              loading: false,
              quota: null,
              stat,
            });
          }
        } catch (error: unknown) {
          if (!cancelled) {
            setState({
              error: error instanceof Error ? error.message : String(error),
              loading: false,
              quota: null,
              stat: null,
            });
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appId, language, providerId, providerName, shell, t]);

  const hasQuota =
    state.quota &&
    (state.quota.tokens ||
      state.quota.windows.length > 0 ||
      state.quota.balances.length > 0);

  return (
    <div className="owt-provider-panel__statistics">
      <div className="owt-provider-panel__activities-head">
        <div className="owt-provider-panel__activities-sub">
          {providerId
            ? t("openwrt.providerStatistics.subtitleForProvider", {
                providerName,
              })
            : t("openwrt.providerStatistics.subtitleGeneric")}
        </div>
      </div>

      {state.error ? (
        <div className="owt-provider-panel__state owt-provider-panel__state--error">
          {state.error}
        </div>
      ) : state.loading ? (
        <div className="owt-provider-panel__state">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("openwrt.providerStatistics.loading")}
        </div>
      ) : state.stat ? (
        <>
          <div className="owt-provider-panel__statistics-grid">
            <div className="owt-provider-panel__stat-card">
              <div className="owt-provider-panel__stat-label">
                {t("openwrt.providerStatistics.requests")}
              </div>
              <div className="owt-provider-panel__stat-value">
                {formatCount(state.stat.requestCount, language)}
              </div>
            </div>
            <div className="owt-provider-panel__stat-card">
              <div className="owt-provider-panel__stat-label">
                {t("openwrt.providerStatistics.tokens")}
              </div>
              <div className="owt-provider-panel__stat-value">
                {formatCompactCount(state.stat.totalTokens, language)}
              </div>
            </div>
            <div className="owt-provider-panel__stat-card">
              <div className="owt-provider-panel__stat-label">
                {t("openwrt.providerStatistics.successRate")}
              </div>
              <div className="owt-provider-panel__stat-value">
                {formatPercent(state.stat.successRate, t)}
              </div>
            </div>
            <div className="owt-provider-panel__stat-card">
              <div className="owt-provider-panel__stat-label">
                {t("openwrt.providerStatistics.totalCost")}
                <button
                  type="button"
                  className="owt-app-card__usage-info"
                  aria-label={t("openwrt.appCard.aboutCostNumber")}
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                  <span className="owt-app-card__usage-tip" role="tooltip">
                    <strong>{t("openwrt.appCard.costTooltipTitle")}</strong>{" "}
                    {t("openwrt.appCard.costTooltipBody")}
                  </span>
                </button>
              </div>
              <div className="owt-provider-panel__stat-value">
                {formatCost(state.stat.totalCost)}
              </div>
            </div>
            <div className="owt-provider-panel__stat-card">
              <div className="owt-provider-panel__stat-label">
                {t("openwrt.providerStatistics.averageLatency")}
              </div>
              <div className="owt-provider-panel__stat-value">
                {formatLatency(state.stat.avgLatencyMs, t)}
              </div>
            </div>
          </div>

          {hasQuota ? (
            <div className="owt-provider-panel__quota-card">
              <div className="owt-provider-panel__config-group-title">
                {t("openwrt.providerStatistics.leftQuota")}
              </div>
              {state.quota?.tokens ? (
                <div className="owt-provider-panel__quota-line">
                  <span>{t("openwrt.providerStatistics.tokenQuota")}</span>
                  <strong>{state.quota.tokens}</strong>
                </div>
              ) : null}
              {state.quota?.windows.map((window) => (
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
              {state.quota?.balances.map((balance) => (
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
        </>
      ) : (
        <div className="owt-provider-panel__activities-empty">
          <div className="owt-provider-panel__empty-title">
            {t("openwrt.providerStatistics.emptyTitle")}
          </div>
          <div className="owt-provider-panel__empty-subtitle">
            {t("openwrt.providerStatistics.emptySubtitle")}
          </div>
        </div>
      )}
    </div>
  );
}
