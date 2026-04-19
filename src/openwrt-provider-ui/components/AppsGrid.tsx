import { useEffect, useState } from "react";
import { createOpenWrtProviderAdapter } from "@/platform/openwrt/providers";
import type { SharedProviderAppId } from "@/shared/providers/domain";
import type {
  OpenWrtProviderStat,
  OpenWrtRecentActivityItem,
  OpenWrtSharedPageMountOptions,
  OpenWrtUsageSummary,
} from "../pageTypes";
import { AppCard } from "./AppCard";

const APP_OPTIONS: SharedProviderAppId[] = ["claude", "codex", "gemini"];

type AppGridData = {
  appId: SharedProviderAppId;
  loading: boolean;
  error: string | null;
  providerState: Awaited<
    ReturnType<ReturnType<typeof createOpenWrtProviderAdapter>["listProviderState"]>
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
  const [providerStateResult, summaryResult, providerStatsResult, recentActivityResult] =
    await Promise.allSettled([
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
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => getErrorMessage(result.reason));

  return {
    appId,
    loading: false,
    error: errors[0] ?? null,
    providerState:
      providerStateResult.status === "fulfilled" ? providerStateResult.value : null,
    summary: summaryResult.status === "fulfilled" ? summaryResult.value : null,
    providerStats:
      providerStatsResult.status === "fulfilled" ? providerStatsResult.value : [],
    recentActivity:
      recentActivityResult.status === "fulfilled"
        ? sortRecentActivity(recentActivityResult.value)
        : [],
  };
}

/** Placeholder that fills the odd slot when a group has an uneven card count. */
function SkeletonCard({ dashed = false }: { dashed?: boolean }) {
  return (
    <div
      className={
        dashed
          ? "owt-app-card owt-app-card--skeleton owt-app-card--skeleton-dashed"
          : "owt-app-card owt-app-card--skeleton"
      }
      aria-hidden="true"
    />
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

export interface AppsGridProps {
  options: OpenWrtSharedPageMountOptions;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (appId: SharedProviderAppId) => void;
}

export function AppsGrid({
  options,
  onOpenActivity,
  onOpenProviderPanel,
}: AppsGridProps) {
  const [cards, setCards] = useState<AppGridData[]>(() =>
    APP_OPTIONS.map(createInitialCard),
  );
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    return options.shell.subscribe?.(() => {
      setRefreshToken((current) => current + 1);
    });
  }, [options.shell]);

  useEffect(() => {
    let cancelled = false;

    setCards((current) =>
      current.map((card) => ({ ...card, loading: true })),
    );

    void Promise.all(APP_OPTIONS.map((appId) => loadCardData(options, appId))).then(
      (nextCards) => {
        if (cancelled) return;
        setCards(nextCards);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [options, refreshToken]);

  const hostState = options.shell.getHostState();
  const serviceRunning = options.shell.getServiceStatus().isRunning;

  // Split into configured vs unconfigured groups, preserving APP_OPTIONS order.
  const configured = cards.filter(isConfigured);
  const unconfigured = cards.filter((card) => !isConfigured(card));

  const renderCard = (card: AppGridData) => (
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
      onOpenActivity={onOpenActivity}
      onOpenProviderPanel={onOpenProviderPanel}
    />
  );

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
          <div className="owt-group-grid">
            {unconfigured.map(renderCard)}
            {unconfigured.length % 2 === 1 && <SkeletonCard dashed />}
          </div>
        </>
      )}
    </div>
  );
}
