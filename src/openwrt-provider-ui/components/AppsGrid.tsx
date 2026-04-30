import { useEffect, useRef, useState } from "react";
import { createOpenWrtProviderAdapter } from "@/platform/openwrt/providers";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtProviderStat,
  OpenWrtRecentActivityItem,
  OpenWrtSharedPageMountOptions,
  OpenWrtUsageSummary,
} from "../pageTypes";
import type { ProviderQuotaSnapshot } from "../types/quota";
import { AppCard } from "./AppCard";

type InertHomeAppId = "opencode" | "openclaw";
export type OpenWrtHomeAppId = SharedProviderAppId | InertHomeAppId;

export const APP_OPTIONS = [
  "claude",
  "codex",
  "gemini",
  "opencode",
  "openclaw",
] as const satisfies readonly OpenWrtHomeAppId[];
const BACKEND_APP_OPTIONS = APP_OPTIONS.filter(
  (appId): appId is SharedProviderAppId => !isInertHomeAppId(appId),
);
const POLL_INTERVAL_MS = 10_000;
const POLL_INTERVAL_BACKGROUND_MS = 0;

type AppGridData = {
  appId: OpenWrtHomeAppId;
  loading: boolean;
  error: string | null;
  providerState: Awaited<
    ReturnType<
      ReturnType<typeof createOpenWrtProviderAdapter>["listProviderState"]
    >
  > | null;
  summary: OpenWrtUsageSummary | null;
  providerStats: OpenWrtProviderStat[];
  recentActivity: OpenWrtRecentActivityItem[];
};

type AppGridLoadResult = {
  card: AppGridData;
  providerStateOk: boolean;
  summaryOk: boolean;
  providerStatsOk: boolean;
  recentActivityOk: boolean;
};

function isInertHomeAppId(appId: OpenWrtHomeAppId): appId is InertHomeAppId {
  return appId === "opencode" || appId === "openclaw";
}

function createInitialCard(appId: OpenWrtHomeAppId): AppGridData {
  return {
    appId,
    loading: true,
    error: null,
    providerState: null,
    summary: null,
    providerStats: [],
    recentActivity: [],
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Router data is unavailable right now.";
}

function sortRecentActivity(
  entries: OpenWrtRecentActivityItem[],
): OpenWrtRecentActivityItem[] {
  return [...entries].sort((left, right) => right.createdAt - left.createdAt);
}

async function loadCardData(
  options: OpenWrtSharedPageMountOptions,
  appId: OpenWrtHomeAppId,
): Promise<AppGridLoadResult> {
  if (isInertHomeAppId(appId)) {
    return {
      card: {
        appId,
        loading: false,
        error: null,
        providerState: null,
        summary: null,
        providerStats: [],
        recentActivity: [],
      },
      providerStateOk: true,
      summaryOk: true,
      providerStatsOk: true,
      recentActivityOk: true,
    };
  }

  const adapter = createOpenWrtProviderAdapter(options.transport);
  const [
    providerStateResult,
    summaryResult,
    providerStatsResult,
    recentActivityResult,
  ] = await Promise.allSettled([
    adapter.listProviderState(appId),
    options.shell.getUsageSummary(appId),
    options.shell.getProviderStats(appId),
    options.shell.getRecentActivity(appId),
  ]);

  const errors = [
    providerStateResult,
    summaryResult,
    providerStatsResult,
    recentActivityResult,
  ]
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => getErrorMessage(result.reason));

  return {
    card: {
      appId,
      loading: false,
      error: errors[0] ?? null,
      providerState:
        providerStateResult.status === "fulfilled"
          ? providerStateResult.value
          : null,
      summary:
        summaryResult.status === "fulfilled" ? summaryResult.value : null,
      providerStats:
        providerStatsResult.status === "fulfilled"
          ? providerStatsResult.value
          : [],
      recentActivity:
        recentActivityResult.status === "fulfilled"
          ? sortRecentActivity(recentActivityResult.value)
          : [],
    },
    providerStateOk: providerStateResult.status === "fulfilled",
    summaryOk: summaryResult.status === "fulfilled",
    providerStatsOk: providerStatsResult.status === "fulfilled",
    recentActivityOk: recentActivityResult.status === "fulfilled",
  };
}

function SkeletonCard({
  kind = "configured",
}: {
  kind?: "configured" | "empty";
}) {
  const isEmpty = kind === "empty";

  return (
    <div
      className={`owt-app-card${
        isEmpty ? " owt-app-card--empty" : ""
      } owt-app-card--skeleton${
        isEmpty ? " owt-app-card--empty-skeleton" : ""
      }`}
      aria-hidden="true"
    >
      <div className="owt-app-card__head">
        <div className="owt-app-card__skeleton-icon" />
        <div className="owt-app-card__skeleton-copy">
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--lg"
            style={{ width: isEmpty ? "36%" : "44%" }}
          />
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
            style={{ width: isEmpty ? "48%" : "62%" }}
          />
        </div>
        <span className="owt-app-card__spacer" aria-hidden="true" />
        <div className="owt-app-card__skeleton-chip" />
      </div>

      {isEmpty ? (
        <div className="owt-app-card__skeleton-empty-cta">
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
            style={{ width: "52%", maxWidth: "220px" }}
          />
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
            style={{ width: "108px" }}
          />
        </div>
      ) : (
        <>
          <div className="owt-app-card__skeleton-active">
            <div className="owt-app-card__skeleton-mini" />
            <div className="owt-app-card__skeleton-active-body">
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "30%" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
                style={{ width: "58%" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "44%" }}
              />
            </div>
          </div>
          <div className="owt-app-card__skeleton-usage">
            <div className="owt-app-card__skeleton-usage-cell">
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "54%" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--md"
                style={{ width: "38%" }}
              />
            </div>
            <div className="owt-app-card__skeleton-usage-cell">
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "62%" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--md"
                style={{ width: "44%" }}
              />
            </div>
            <div className="owt-app-card__skeleton-usage-cell">
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "50%" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--md"
                style={{ width: "36%" }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** "Not configured" group header — matches revised/index.html groupHeader(). */
function GroupHeader({ label }: { label: string }) {
  return (
    <div className="owt-group-head">
      <span className="owt-group-label">{label}</span>
    </div>
  );
}

function isConfigured(card: AppGridData): boolean {
  return card.providerState?.activeProvider.configured ?? false;
}

function mergeCardData(
  currentCard: AppGridData,
  nextResult: AppGridLoadResult,
): AppGridData {
  const { card } = nextResult;

  return {
    ...currentCard,
    ...card,
    providerState: nextResult.providerStateOk
      ? card.providerState
      : currentCard.providerState,
    summary: nextResult.summaryOk ? card.summary : currentCard.summary,
    providerStats: nextResult.providerStatsOk
      ? card.providerStats
      : currentCard.providerStats,
    recentActivity: nextResult.recentActivityOk
      ? card.recentActivity
      : currentCard.recentActivity,
  };
}

async function loadUsageSummaries(
  shell: OpenWrtSharedPageMountOptions["shell"],
): Promise<Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>>> {
  const results = await Promise.allSettled(
    BACKEND_APP_OPTIONS.map(async (appId) => ({
      appId,
      summary: await shell.getUsageSummary(appId),
    })),
  );
  const summaries: Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>> =
    {};

  results.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }

    summaries[result.value.appId] = result.value.summary;
  });

  return summaries;
}

export interface AppsGridProps {
  options: OpenWrtSharedPageMountOptions;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (appId: SharedProviderAppId) => void;
  providerMutationVersion?: number;
}

async function loadQuotaByProviderId(
  shell: OpenWrtSharedPageMountOptions["shell"],
): Promise<Record<string, ProviderQuotaSnapshot>> {
  try {
    const response = await shell.getQuota();
    const map: Record<string, ProviderQuotaSnapshot> = {};
    for (const snapshot of response.providers) {
      map[snapshot.provider_id] = snapshot;
    }
    return map;
  } catch {
    return {};
  }
}

export function AppsGrid({
  options,
  onOpenActivity,
  onOpenProviderPanel,
  providerMutationVersion = 0,
}: AppsGridProps) {
  const [cards, setCards] = useState<AppGridData[]>(() =>
    APP_OPTIONS.map(createInitialCard),
  );
  const initialLoadCompleteRef = useRef(false);
  const [quotaByProviderId, setQuotaByProviderId] = useState<
    Record<string, ProviderQuotaSnapshot>
  >({});

  useEffect(() => {
    let cancelled = false;
    const shouldShowLoading = !initialLoadCompleteRef.current;

    if (shouldShowLoading) {
      setCards((current) =>
        current.map((card) => ({ ...card, loading: true })),
      );
    }

    void Promise.all([
      Promise.all(APP_OPTIONS.map((appId) => loadCardData(options, appId))),
      loadQuotaByProviderId(options.shell),
    ]).then(([nextResults, quotaMap]) => {
      if (cancelled) return;
      initialLoadCompleteRef.current = true;
      if (shouldShowLoading) {
        setCards(nextResults.map((result) => result.card));
      } else {
        const nextResultsByAppId = new Map(
          nextResults.map((result) => [result.card.appId, result]),
        );

        setCards((currentCards) =>
          currentCards.map((currentCard) => {
            const nextResult = nextResultsByAppId.get(currentCard.appId);
            return nextResult
              ? mergeCardData(currentCard, nextResult)
              : currentCard;
          }),
        );
      }
      setQuotaByProviderId(quotaMap);
    });

    return () => {
      cancelled = true;
    };
  }, [options, providerMutationVersion]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    const doc = typeof document === "undefined" ? null : document;

    if (!doc) {
      return;
    }

    const clearPollingInterval = () => {
      if (intervalId == null) {
        return;
      }

      window.clearInterval(intervalId);
      intervalId = null;
    };

    const getPollIntervalMs = () =>
      doc.visibilityState === "hidden"
        ? POLL_INTERVAL_BACKGROUND_MS
        : POLL_INTERVAL_MS;

    const refetchUsageSummaries = async () => {
      const newSummaryByApp = await loadUsageSummaries(options.shell);

      if (cancelled) {
        return;
      }

      setCards((prev) =>
        prev.map((card) => {
          if (isInertHomeAppId(card.appId)) {
            return card;
          }

          const nextSummary = newSummaryByApp[card.appId];

          return nextSummary !== undefined
            ? { ...card, summary: nextSummary }
            : card;
        }),
      );
    };

    const startPolling = () => {
      clearPollingInterval();

      const pollIntervalMs = getPollIntervalMs();
      if (pollIntervalMs <= 0) {
        return;
      }

      intervalId = window.setInterval(() => {
        void refetchUsageSummaries();
      }, pollIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (doc.visibilityState === "hidden") {
        clearPollingInterval();
        return;
      }

      void refetchUsageSummaries();
      startPolling();
    };

    const QUOTA_POLL_INTERVAL_MS = 60_000;
    const quotaIntervalId = window.setInterval(async () => {
      const map = await loadQuotaByProviderId(options.shell);
      if (!cancelled) {
        setQuotaByProviderId(map);
      }
    }, QUOTA_POLL_INTERVAL_MS);

    doc.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      cancelled = true;
      clearPollingInterval();
      window.clearInterval(quotaIntervalId);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [options.shell]);

  const hostState = options.shell.getHostState();
  const serviceRunning = options.shell.getServiceStatus().isRunning;
  const loadingCards = cards.filter(
    (card) => card.loading && !card.providerState,
  );
  const settledCards = cards.filter(
    (card) => !card.loading || card.providerState,
  );
  const configured = settledCards.filter(isConfigured);
  const unconfigured = settledCards.filter((card) => !isConfigured(card));

  const renderCard = (card: AppGridData) => {
    const activeProviderId = card.providerState?.activeProvider.configured
      ? card.providerState.activeProvider.providerId
      : undefined;
    const quotaSnapshot = activeProviderId
      ? quotaByProviderId[activeProviderId]
      : undefined;

    return (
      <AppCard
        key={card.appId}
        appId={card.appId}
        hostState={hostState}
        serviceRunning={serviceRunning}
        providerState={card.providerState}
        summary={card.summary}
        providerStats={card.providerStats}
        recentActivity={card.recentActivity}
        loading={card.loading}
        error={card.error}
        quotaSnapshot={quotaSnapshot}
        onOpenActivity={onOpenActivity}
        onOpenProviderPanel={onOpenProviderPanel}
      />
    );
  };
  const settledGridItems = [
    ...configured.map(renderCard),
    ...(unconfigured.length > 0
      ? [
          <GroupHeader
            key="group-header-unconfigured"
            label="Not configured"
          />,
        ]
      : []),
    ...unconfigured.map(renderCard),
    ...(settledCards.length % 2 === 1
      ? [
          <SkeletonCard
            key="settled-pad"
            kind={unconfigured.length > 0 ? "empty" : "configured"}
          />,
        ]
      : []),
  ];

  return (
    <div className="owt-apps-grid">
      {loadingCards.length > 0 && (
        <div className="owt-group-grid">
          {loadingCards.map((card) => (
            <SkeletonCard key={`${card.appId}-loading`} />
          ))}
          {loadingCards.length % 2 === 1 && <SkeletonCard key="loading-pad" />}
        </div>
      )}

      {settledCards.length > 0 && (
        <div className="owt-group-grid">{settledGridItems}</div>
      )}
    </div>
  );
}
