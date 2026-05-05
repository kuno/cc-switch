import { Loader2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtRequestLog,
  OpenWrtSharedPageShellApi,
} from "../pageTypes";
import { formatRelativeTime } from "../i18n/formatRelativeTime";

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

function formatUpdatedLabel(value: number | null, t: TFunction): string {
  if (!value) {
    return "";
  }

  const relativeLabel = formatRelativeTime(value);

  if (relativeLabel === t("openwrt.activity.justNow")) {
    return t("openwrt.providerActivities.updatedJustNow");
  }

  return t("openwrt.providerActivities.updated", { time: relativeLabel });
}

function formatCompactCount(value: number, language: string): string {
  return new Intl.NumberFormat(language, {
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

function formatLatency(value: number | null | undefined, t: TFunction): string {
  if (!Number.isFinite(value) || value == null || value <= 0) {
    return t("openwrt.activity.notAvailable");
  }

  return t("openwrt.activity.latencyMs", { value: Math.round(value) });
}

function getRequestTokenCount(entry: OpenWrtRequestLog): number {
  return (
    entry.inputTokens +
    entry.outputTokens +
    entry.cacheCreationTokens +
    entry.cacheReadTokens
  );
}

function getStatusLabel(entry: OpenWrtRequestLog, t: TFunction): string {
  if (entry.statusCode > 0) {
    return t("openwrt.activity.httpStatus", {
      statusCode: entry.statusCode,
    });
  }

  if (entry.errorMessage) {
    return t("common.error");
  }

  return t("openwrt.activity.pending");
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
  const { t, i18n: i18nextInstance } = useTranslation();
  const language = i18nextInstance.language || "en";
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

  const providerLabel =
    providerName || t("openwrt.providerActivities.thisProvider");
  const subtitle = providerId
    ? t("openwrt.providerActivities.subtitleForProvider", {
        providerName: providerLabel,
      })
    : t("openwrt.providerActivities.subtitleGeneric");
  const meta = state.loading
    ? t("openwrt.providerActivities.loadingRecentRequestsMeta")
    : state.data.length
      ? [
          t("openwrt.providerActivities.shownCount", {
            count: state.data.length,
          }),
          state.lastLoadedAt ? formatUpdatedLabel(state.lastLoadedAt, t) : null,
        ]
          .filter(Boolean)
          .join(" · ")
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
          {t("openwrt.activity.loadingRecentRequests")}
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
                    {getStatusLabel(entry, t)}
                  </span>
                </div>
                <div className="owt-provider-panel__activity-subtitle">
                  {[
                    entry.model || t("openwrt.activity.defaultModel"),
                    formatRelativeTime(entry.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>

              <div className="owt-provider-panel__activity-right">
                <span className="owt-provider-panel__activity-metric">
                  {t("openwrt.activity.tokens", {
                    tokenCount: formatCompactCount(
                      getRequestTokenCount(entry),
                      language,
                    ),
                  })}
                </span>
                <span>{formatCost(entry.totalCostUsd)}</span>
                <span className="owt-provider-panel__activity-metric">
                  {formatLatency(entry.latencyMs, t)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="owt-provider-panel__activities-empty">
          <div className="owt-provider-panel__empty-title">
            {t("openwrt.providerActivities.emptyTitle")}
          </div>
          <div className="owt-provider-panel__empty-subtitle">
            {t("openwrt.providerActivities.emptySubtitle")}
          </div>
        </div>
      )}
    </div>
  );
}
