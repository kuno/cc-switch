import { useEffect, useState } from "react";
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


const APP_OPTIONS: SharedProviderAppId[] = ["claude", "codex", "gemini"];
const POLL_INTERVAL_MS = 10_000;
const POLL_INTERVAL_BACKGROUND_MS = 0;

type AppGridData = {
  appId: SharedProviderAppId;
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

function createInitialCard(appId: SharedProviderAppId): AppGridData {
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
  appId: SharedProviderAppId,
): Promise<AppGridData> {
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
    appId,
    loading: false,
    error: errors[0] ?? null,
    providerState:
      providerStateResult.status === "fulfilled"
        ? providerStateResult.value
        : null,
    summary: summaryResult.status === "fulfilled" ? summaryResult.value : null,
    providerStats:
      providerStatsResult.status === "fulfilled"
        ? providerStatsResult.value
        : [],
    recentActivity:
      recentActivityResult.status === "fulfilled"
        ? sortRecentActivity(recentActivityResult.value)
        : [],
  };
}

/** Placeholder that fills the odd slot when a group has an uneven card count. */
function SkeletonCard({ showStats = true }: { showStats?: boolean }) {
  return (
    <div
      className={`owt-app-card owt-app-card--skeleton${
        showStats
          ? ""
          : " owt-app-card--skeleton-compact owt-app-card--empty-skeleton"
      }`}
      aria-hidden="true"
    >
      <div className="owt-app-card__head">
        <div className="owt-app-card__skeleton-icon" />
        <div className="owt-app-card__titles">
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--lg"
            style={{ width: "8rem" }}
          />
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
            style={{ width: "5.5rem", marginTop: "8px" }}
          />
        </div>
        <span className="owt-app-card__spacer" aria-hidden="true" />
        <div className="owt-app-card__skeleton-chip" />
      </div>

      {showStats ? (
        <div className="owt-app-card__skeleton-active">
          <div className="owt-app-card__skeleton-mini" />
          <div className="owt-app-card__active-labels">
            <div
              className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
              style={{ width: "5rem" }}
            />
            <div
              className="owt-app-card__skeleton-line owt-app-card__skeleton-line--md"
              style={{ width: "8.5rem", marginTop: "8px" }}
            />
            <div
              className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
              style={{ width: "6.5rem", marginTop: "6px" }}
            />
          </div>
        </div>
      ) : (
        <div className="owt-app-card__skeleton-empty-cta">
          <div className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm" />
          <div
            className="owt-app-card__skeleton-line owt-app-card__skeleton-line--sm"
            style={{ width: "7rem" }}
          />
        </div>
      )}

      {showStats ? (
        <div className="owt-app-card__skeleton-usage">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="owt-app-card__skeleton-usage-cell" key={index}>
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--xs"
                style={{ width: "3rem" }}
              />
              <div
                className="owt-app-card__skeleton-line owt-app-card__skeleton-line--md"
                style={{ width: "4rem", marginTop: "8px" }}
              />
            </div>
          ))}
        </div>
      ) : null}
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

async function loadUsageSummaries(
  shell: OpenWrtSharedPageMountOptions["shell"],
): Promise<Partial<Record<SharedProviderAppId, OpenWrtUsageSummary>>> {
  const results = await Promise.allSettled(
    APP_OPTIONS.map(async (appId) => ({
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
  const [quotaByProviderId, setQuotaByProviderId] = useState<
    Record<string, ProviderQuotaSnapshot>
  >({});

  useEffect(() => {
    let cancelled = false;

    setCards((current) => current.map((card) => ({ ...card, loading: true })));

    void Promise.all([
      Promise.all(APP_OPTIONS.map((appId) => loadCardData(options, appId))),
      loadQuotaByProviderId(options.shell),
    ]).then(([nextCards, quotaMap]) => {
      if (cancelled) return;
      setCards(nextCards);
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

    doc.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      cancelled = true;
      clearPollingInterval();
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [options.shell]);

  const hostState = options.shell.getHostState();
  const serviceRunning = options.shell.getServiceStatus().isRunning;

  // Split into configured vs unconfigured groups, preserving APP_OPTIONS order.
  const configured = cards.filter(isConfigured);
  const unconfigured = cards.filter((card) => !isConfigured(card));

  const renderCard = (card: AppGridData) => {
    const activeProviderId =
      card.providerState?.activeProvider.configured
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

  return (
    <div className="owt-apps-grid">
      {configured.length > 0 && (
        <div className="owt-group-grid">
          {configured.map(renderCard)}
          {configured.length % 2 === 1 && <SkeletonCard />}
        </div>
      )}

      {unconfigured.length > 0 && (
        <>
          <GroupHeader label="Not configured" />
          <div className="owt-group-grid owt-group-grid--unconfigured">
            {unconfigured.map(renderCard)}
            {unconfigured.length % 2 === 1 && <SkeletonCard showStats={false} />}
          </div>
        </>
      )}
    </div>
  );
}
