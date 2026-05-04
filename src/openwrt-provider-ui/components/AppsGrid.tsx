import { useEffect, useRef, useState } from "react";
import { createOpenWrtProviderAdapter } from "@/platform/openwrt/providers";
import type {
  ProviderPlatformAdapter,
  SharedProviderAppId,
  SharedProviderFailoverState,
} from "@/shared/providers/domain";
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

type OpenWrtProviderReorderAdapter = ProviderPlatformAdapter & {
  reorderProviders(
    appId: SharedProviderAppId,
    providerIds: string[],
  ): Promise<void>;
};

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
  failoverState: SharedProviderFailoverState | null;
};

type AppGridLoadResult = {
  card: AppGridData;
  providerStateOk: boolean;
  summaryOk: boolean;
  providerStatsOk: boolean;
  recentActivityOk: boolean;
  failoverStateOk: boolean;
};

function isInertHomeAppId(appId: OpenWrtHomeAppId): appId is InertHomeAppId {
  return appId === "opencode" || appId === "openclaw";
}

function supportsOpenWrtProviderReorder(
  adapter: ProviderPlatformAdapter,
): adapter is OpenWrtProviderReorderAdapter {
  return (
    typeof (adapter as Partial<OpenWrtProviderReorderAdapter>)
      .reorderProviders === "function"
  );
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
    failoverState: null,
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
        failoverState: null,
      },
      providerStateOk: true,
      summaryOk: true,
      providerStatsOk: true,
      recentActivityOk: true,
      failoverStateOk: true,
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

  const providerState =
    providerStateResult.status === "fulfilled"
      ? providerStateResult.value
      : null;
  const activeProviderId = providerState?.activeProvider.configured
    ? providerState.activeProvider.providerId
    : null;
  let failoverState: SharedProviderFailoverState | null = null;
  let failoverStateOk = true;

  if (
    activeProviderId &&
    typeof adapter.getProviderFailoverState === "function"
  ) {
    try {
      failoverState = await adapter.getProviderFailoverState(
        appId,
        activeProviderId,
      );
    } catch {
      failoverStateOk = false;
    }
  }

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
      providerState,
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
      failoverState,
    },
    providerStateOk: providerStateResult.status === "fulfilled",
    summaryOk: summaryResult.status === "fulfilled",
    providerStatsOk: providerStatsResult.status === "fulfilled",
    recentActivityOk: recentActivityResult.status === "fulfilled",
    failoverStateOk,
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
    failoverState: nextResult.failoverStateOk
      ? card.failoverState
      : currentCard.failoverState,
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

async function loadRecentActivityByApp(
  shell: OpenWrtSharedPageMountOptions["shell"],
): Promise<Partial<Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>>> {
  const results = await Promise.allSettled(
    BACKEND_APP_OPTIONS.map(async (appId) => ({
      appId,
      recentActivity: await shell.getRecentActivity(appId),
    })),
  );
  const recentActivityByApp: Partial<
    Record<SharedProviderAppId, OpenWrtRecentActivityItem[]>
  > = {};

  results.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }

    recentActivityByApp[result.value.appId] = sortRecentActivity(
      result.value.recentActivity,
    );
  });

  return recentActivityByApp;
}

async function loadFailoverStateByApp(
  transport: OpenWrtSharedPageMountOptions["transport"],
  currentCards: AppGridData[],
): Promise<Partial<Record<SharedProviderAppId, SharedProviderFailoverState>>> {
  const adapter = createOpenWrtProviderAdapter(transport);
  const { getProviderFailoverState } = adapter;

  if (typeof getProviderFailoverState !== "function") {
    return {};
  }

  const results = await Promise.allSettled(
    BACKEND_APP_OPTIONS.map(async (appId) => {
      const card = currentCards.find((c) => c.appId === appId);
      const activeProviderId = card?.providerState?.activeProvider.configured
        ? card.providerState.activeProvider.providerId
        : null;

      if (!activeProviderId) {
        return null;
      }

      return {
        appId,
        failoverState: await getProviderFailoverState(appId, activeProviderId),
      };
    }),
  );

  const failoverStateByApp: Partial<
    Record<SharedProviderAppId, SharedProviderFailoverState>
  > = {};

  results.forEach((result) => {
    if (result.status !== "fulfilled" || result.value === null) {
      return;
    }

    failoverStateByApp[result.value.appId] = result.value.failoverState;
  });

  return failoverStateByApp;
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
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const initialLoadCompleteRef = useRef(false);
  const [quotaByProviderId, setQuotaByProviderId] = useState<
    Record<string, ProviderQuotaSnapshot>
  >({});
  const [failoverPendingByApp, setFailoverPendingByApp] = useState<
    Partial<Record<SharedProviderAppId, boolean>>
  >({});
  const [
    optimisticAutoFailoverEnabledByApp,
    setOptimisticAutoFailoverEnabledByApp,
  ] = useState<Partial<Record<SharedProviderAppId, boolean>>>({});
  const [failoverReorderPendingByApp, setFailoverReorderPendingByApp] =
    useState<Partial<Record<SharedProviderAppId, boolean>>>({});

  async function handleSetAutoFailover(
    appId: SharedProviderAppId,
    enabled: boolean,
  ) {
    const adapter = createOpenWrtProviderAdapter(options.transport);

    if (typeof adapter.setAutoFailoverEnabled !== "function") {
      return;
    }

    setFailoverPendingByApp((current) => ({ ...current, [appId]: true }));
    setOptimisticAutoFailoverEnabledByApp((current) => ({
      ...current,
      [appId]: enabled,
    }));
    try {
      await adapter.setAutoFailoverEnabled(appId, enabled);
      const nextResult = await loadCardData(options, appId);

      setCards((currentCards) =>
        currentCards.map((card) =>
          card.appId === appId ? mergeCardData(card, nextResult) : card,
        ),
      );
    } finally {
      setFailoverPendingByApp((current) => ({ ...current, [appId]: false }));
      setOptimisticAutoFailoverEnabledByApp((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    }
  }

  async function handleReorderFailoverQueue(
    appId: SharedProviderAppId,
    queuedProviderIds: string[],
  ) {
    const adapter = createOpenWrtProviderAdapter(options.transport);

    if (!supportsOpenWrtProviderReorder(adapter)) {
      return;
    }

    const currentCard = cards.find((card) => card.appId === appId);
    const currentProviders = currentCard?.providerState?.providers ?? [];
    const currentProviderIds = currentProviders
      .map((provider) => provider.providerId)
      .filter((providerId): providerId is string => Boolean(providerId));
    const currentQueuedProviderIds =
      currentCard?.failoverState?.failoverQueue.map(
        (entry) => entry.providerId,
      ) ?? [];

    if (
      currentProviderIds.length === 0 ||
      queuedProviderIds.length !== currentQueuedProviderIds.length
    ) {
      return;
    }

    const expectedQueuedSet = new Set(currentQueuedProviderIds);
    if (
      queuedProviderIds.some((providerId) => !expectedQueuedSet.has(providerId))
    ) {
      return;
    }

    const nextQueuedProviderIds = [...queuedProviderIds];
    const nextProviderIds = currentProviderIds.map((providerId) =>
      expectedQueuedSet.has(providerId)
        ? (nextQueuedProviderIds.shift() ?? providerId)
        : providerId,
    );

    setFailoverReorderPendingByApp((current) => ({
      ...current,
      [appId]: true,
    }));
    try {
      await adapter.reorderProviders(appId, nextProviderIds);
      const nextResult = await loadCardData(options, appId);

      setCards((currentCards) =>
        currentCards.map((card) =>
          card.appId === appId ? mergeCardData(card, nextResult) : card,
        ),
      );
    } finally {
      setFailoverReorderPendingByApp((current) => ({
        ...current,
        [appId]: false,
      }));
    }
  }

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
      const [newSummaryByApp, newRecentActivityByApp, newFailoverStateByApp] =
        await Promise.all([
          loadUsageSummaries(options.shell),
          loadRecentActivityByApp(options.shell),
          loadFailoverStateByApp(options.transport, cardsRef.current),
        ]);

      if (cancelled) {
        return;
      }

      setCards((prev) =>
        prev.map((card) => {
          if (isInertHomeAppId(card.appId)) {
            return card;
          }

          const nextSummary = newSummaryByApp[card.appId];
          const nextRecentActivity = newRecentActivityByApp[card.appId];
          const nextFailoverState = newFailoverStateByApp[card.appId];
          let updatedCard = card;

          if (nextSummary !== undefined) {
            updatedCard = { ...updatedCard, summary: nextSummary };
          }

          if (nextRecentActivity !== undefined) {
            updatedCard = {
              ...updatedCard,
              recentActivity: nextRecentActivity,
            };
          }

          if (nextFailoverState !== undefined) {
            updatedCard = { ...updatedCard, failoverState: nextFailoverState };
          }

          return updatedCard;
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
        failoverState={card.failoverState}
        failoverPending={
          isInertHomeAppId(card.appId)
            ? false
            : Boolean(failoverPendingByApp[card.appId])
        }
        optimisticAutoFailoverEnabled={
          isInertHomeAppId(card.appId)
            ? null
            : (optimisticAutoFailoverEnabledByApp[card.appId] ?? null)
        }
        failoverReorderPending={
          isInertHomeAppId(card.appId)
            ? false
            : Boolean(failoverReorderPendingByApp[card.appId])
        }
        onOpenActivity={onOpenActivity}
        onOpenProviderPanel={onOpenProviderPanel}
        onSetAutoFailover={(nextAppId, enabled) => {
          void handleSetAutoFailover(nextAppId, enabled);
        }}
        onReorderFailoverQueue={(nextAppId, providerIds) => {
          void handleReorderFailoverQueue(nextAppId, providerIds);
        }}
      />
    );
  };
  const settledGridItems = [
    ...configured.map(renderCard),
    ...(unconfigured.length > 0
      ? [<GroupHeader key="group-header-unconfigured" label="Not configured" />]
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
