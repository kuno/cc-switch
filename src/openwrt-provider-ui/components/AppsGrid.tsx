import type { TFunction } from "i18next";
import type { DragEventHandler, HTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createOpenWrtProviderAdapter } from "@/platform/openwrt/providers";
import {
  emptySharedProviderView,
  normalizeSharedProviderView,
  parseSharedProviderFailoverState,
  type ProviderPlatformAdapter,
  type SharedProviderAppId,
  type SharedProviderFailoverQueueEntry,
  type SharedProviderFailoverState,
  type SharedProviderState,
  type SharedProviderView,
} from "@/shared/providers/domain";
import type {
  OpenWrtProviderStat,
  OpenWrtRecentActivityItem,
  OpenWrtSharedPageMountOptions,
  OpenWrtStatusApp,
  OpenWrtStatusFailoverProviderStatus,
  OpenWrtStatusProvider,
  OpenWrtStatusResponse,
  OpenWrtUsageSummary,
} from "../pageTypes";
import type {
  BalanceSnapshot,
  ProviderQuotaSnapshot,
  QuotaWindow,
} from "../types/quota";
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
const APP_CARD_ORDER_STORAGE_KEY = "ccswitch-openwrt-app-card-order";

type AppGridData = {
  appId: OpenWrtHomeAppId;
  loading: boolean;
  error: string | null;
  providerState: SharedProviderState | null;
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

function normalizeAppOrder(candidate: readonly unknown[]): OpenWrtHomeAppId[] {
  const validAppIds = new Set<OpenWrtHomeAppId>(APP_OPTIONS);
  const seen = new Set<OpenWrtHomeAppId>();
  const ordered: OpenWrtHomeAppId[] = [];

  for (const value of candidate) {
    if (
      typeof value === "string" &&
      validAppIds.has(value as OpenWrtHomeAppId) &&
      !seen.has(value as OpenWrtHomeAppId)
    ) {
      const appId = value as OpenWrtHomeAppId;
      seen.add(appId);
      ordered.push(appId);
    }
  }

  for (const appId of APP_OPTIONS) {
    if (!seen.has(appId)) {
      ordered.push(appId);
    }
  }

  return ordered;
}

function readStoredAppOrder(): OpenWrtHomeAppId[] {
  if (typeof window === "undefined") {
    return [...APP_OPTIONS];
  }

  try {
    const stored = window.localStorage.getItem(APP_CARD_ORDER_STORAGE_KEY);
    if (!stored) {
      return [...APP_OPTIONS];
    }

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? normalizeAppOrder(parsed) : [...APP_OPTIONS];
  } catch {
    return [...APP_OPTIONS];
  }
}

function writeStoredAppOrder(appOrder: readonly OpenWrtHomeAppId[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      APP_CARD_ORDER_STORAGE_KEY,
      JSON.stringify(appOrder),
    );
  } catch {
    // Local storage is a preference cache; failing to persist should not block UI reorder.
  }
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

function getErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return t("openwrt.appsGrid.routerDataUnavailable");
}

function sortRecentActivity(
  entries: OpenWrtRecentActivityItem[],
): OpenWrtRecentActivityItem[] {
  return [...entries].sort((left, right) => right.createdAt - left.createdAt);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function getOptionalString(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  const result = getString(value, keys);
  return result || null;
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

function getBoolean(
  value: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return null;
}

function createInertLoadResult(appId: InertHomeAppId): AppGridLoadResult {
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

function createFailedLoadResult(
  appId: OpenWrtHomeAppId,
  error: string,
): AppGridLoadResult {
  if (isInertHomeAppId(appId)) {
    return createInertLoadResult(appId);
  }

  return {
    card: {
      appId,
      loading: false,
      error,
      providerState: null,
      summary: null,
      providerStats: [],
      recentActivity: [],
      failoverState: null,
    },
    providerStateOk: false,
    summaryOk: false,
    providerStatsOk: false,
    recentActivityOk: false,
    failoverStateOk: false,
  };
}

function normalizeUsageSummary(
  value: OpenWrtStatusApp["usage"],
): OpenWrtUsageSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    totalRequests: getNumber(value, ["totalRequests"]) ?? 0,
    totalCost: String(value.totalCost ?? "0"),
    totalInputTokens: getNumber(value, ["totalInputTokens"]) ?? 0,
    totalOutputTokens: getNumber(value, ["totalOutputTokens"]) ?? 0,
    totalCacheCreationTokens:
      getNumber(value, ["totalCacheCreationTokens"]) ?? 0,
    totalCacheReadTokens: getNumber(value, ["totalCacheReadTokens"]) ?? 0,
    successRate: getNumber(value, ["successRate"]) ?? 0,
  };
}

function normalizeProviderStats(app: OpenWrtStatusApp): OpenWrtProviderStat[] {
  if (!isRecord(app.providers)) {
    return [];
  }

  return Object.entries(app.providers)
    .map(([providerId, provider]) => {
      if (!isRecord(provider.stats)) {
        return null;
      }

      return {
        providerId,
        providerName: provider.name?.trim() || providerId,
        requestCount: getNumber(provider.stats, ["requestCount"]) ?? 0,
        totalTokens: getNumber(provider.stats, ["totalTokens"]) ?? 0,
        totalCost: String(provider.stats.totalCost ?? "0"),
        successRate: getNumber(provider.stats, ["successRate"]) ?? 0,
        avgLatencyMs: getNumber(provider.stats, ["avgLatencyMs"]) ?? 0,
      } satisfies OpenWrtProviderStat;
    })
    .filter((stat): stat is OpenWrtProviderStat => stat != null);
}

function normalizeRecentActivityEntry(
  value: unknown,
): OpenWrtRecentActivityItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const requestId = getString(value, ["requestId", "request_id"]);
  if (!requestId) {
    return null;
  }

  return {
    requestId,
    providerId: getString(value, ["providerId", "provider_id"]),
    providerName: getString(value, ["providerName", "provider_name"]),
    model: getString(value, ["model"]),
    totalTokens: getNumber(value, ["totalTokens", "total_tokens"]) ?? 0,
    totalCost: String(value.totalCost ?? value.total_cost ?? "0"),
    statusCode: getNumber(value, ["statusCode", "status_code"]) ?? 0,
    latencyMs: getNumber(value, ["latencyMs", "latency_ms"]) ?? 0,
    createdAt: getNumber(value, ["createdAt", "created_at"]) ?? 0,
  };
}

function normalizeRecentActivity(
  app: OpenWrtStatusApp,
): OpenWrtRecentActivityItem[] {
  const value = app.recentActivity ?? app.recent_activity;
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.entries)
      ? value.entries
      : [];

  return sortRecentActivity(
    entries
      .map((entry) => normalizeRecentActivityEntry(entry))
      .filter((entry): entry is OpenWrtRecentActivityItem => entry != null),
  );
}

function normalizeQuotaWindow(value: unknown): QuotaWindow | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = getString(value, ["name"]);
  if (!name) {
    return null;
  }

  return {
    name,
    status: getOptionalString(value, ["status"]),
    utilization: getNumber(value, ["utilization"]),
    reset: getNumber(value, ["reset"]),
  };
}

function normalizeBalance(value: unknown): BalanceSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    plan_name: getOptionalString(value, ["planName", "plan_name"]),
    currency: getOptionalString(value, ["currency"]),
    total: getNumber(value, ["total"]),
    used: getNumber(value, ["used"]),
    remaining: getNumber(value, ["remaining"]),
    is_valid: getBoolean(value, ["isValid", "is_valid"]),
    invalid_message: getOptionalString(value, [
      "invalidMessage",
      "invalid_message",
    ]),
  };
}

function normalizeQuotaSnapshot(
  value: unknown,
  appId: SharedProviderAppId,
  providerId: string,
  providerName: string,
): ProviderQuotaSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const windows = Array.isArray(value.windows)
    ? value.windows
        .map((entry) => normalizeQuotaWindow(entry))
        .filter((entry): entry is QuotaWindow => entry != null)
    : [];
  const balances = Array.isArray(value.balances)
    ? value.balances
        .map((entry) => normalizeBalance(entry))
        .filter((entry): entry is BalanceSnapshot => entry != null)
    : null;

  return {
    app_type: getString(value, ["appType", "app_type"]) || appId,
    provider_id: getString(value, ["providerId", "provider_id"]) || providerId,
    provider_name:
      getString(value, ["providerName", "provider_name"]) ||
      providerName ||
      providerId,
    source: getOptionalString(value, ["source"]),
    status: getOptionalString(value, ["status"]),
    windows,
    balances,
    representative_claim: getOptionalString(value, [
      "representativeClaim",
      "representative_claim",
    ]),
    overage_status: getOptionalString(value, [
      "overageStatus",
      "overage_status",
    ]),
    fallback_percentage: getNumber(value, [
      "fallbackPercentage",
      "fallback_percentage",
    ]),
    requests_remaining: getNumber(value, [
      "requestsRemaining",
      "requests_remaining",
    ]),
    requests_limit: getNumber(value, ["requestsLimit", "requests_limit"]),
    tokens_remaining: getNumber(value, ["tokensRemaining", "tokens_remaining"]),
    tokens_limit: getNumber(value, ["tokensLimit", "tokens_limit"]),
    captured_at: getNumber(value, ["capturedAt", "captured_at"]) ?? Date.now(),
  };
}

function getActiveProviderHint(
  app: OpenWrtStatusApp,
): OpenWrtStatusApp["activeProvider"] {
  return app.activeProvider ?? app.active_provider ?? null;
}

function getActiveProviderId(app: OpenWrtStatusApp): string | null {
  const activeProvider = getActiveProviderHint(app);
  return isRecord(activeProvider)
    ? getString(activeProvider, ["providerId", "provider_id", "id"]) || null
    : null;
}

function normalizeStatusProviderView(
  appId: SharedProviderAppId,
  providerId: string,
  provider: OpenWrtStatusProvider,
  activeProviderId: string | null,
  activeProviderHint: OpenWrtStatusApp["activeProvider"],
): SharedProviderView {
  const activeHintName =
    activeProviderId === providerId && isRecord(activeProviderHint)
      ? getString(activeProviderHint, ["name"])
      : "";
  const providerPayload = {
    ...provider,
    providerId:
      getString(provider, ["providerId", "provider_id", "id"]) || providerId,
    name: provider.name?.trim() || activeHintName || providerId,
    active: activeProviderId === providerId,
  };

  return normalizeSharedProviderView(
    providerPayload,
    providerId,
    activeProviderId,
    appId,
  );
}

function normalizeProviderState(
  appId: SharedProviderAppId,
  app: OpenWrtStatusApp,
): SharedProviderState {
  const activeProviderId = getActiveProviderId(app);
  const activeProviderHint = getActiveProviderHint(app);
  const providers = isRecord(app.providers)
    ? Object.entries(app.providers)
        .map(([providerId, provider]) =>
          normalizeStatusProviderView(
            appId,
            providerId,
            provider,
            activeProviderId,
            activeProviderHint,
          ),
        )
        .filter((provider) => provider.configured)
    : [];
  let activeProvider =
    providers.find(
      (provider) =>
        activeProviderId != null && provider.providerId === activeProviderId,
    ) ?? emptySharedProviderView(appId);

  if (
    !activeProvider.configured &&
    activeProviderId &&
    isRecord(activeProviderHint)
  ) {
    activeProvider = normalizeSharedProviderView(
      {
        ...activeProviderHint,
        configured: true,
        providerId: activeProviderId,
        active: true,
      },
      activeProviderId,
      activeProviderId,
      appId,
    );
  }

  const normalizedProviders =
    activeProvider.configured &&
    !providers.some(
      (provider) => provider.providerId === activeProvider.providerId,
    )
      ? [...providers, activeProvider]
      : providers;

  return {
    phase2Available: true,
    providers: normalizedProviders,
    activeProviderId: activeProvider.configured
      ? activeProvider.providerId
      : activeProviderId,
    activeProvider,
  };
}

function getFailoverStatusMap(
  app: OpenWrtStatusApp,
): Record<string, OpenWrtStatusFailoverProviderStatus> {
  return app.failoverStatus ?? app.failover_status ?? {};
}

function statusProviderIsQueued(
  value: OpenWrtStatusFailoverProviderStatus | undefined,
): boolean {
  return Boolean(value?.inFailoverQueue ?? value?.in_failover_queue);
}

function getStatusQueuePosition(
  value: OpenWrtStatusFailoverProviderStatus | undefined,
): number | null {
  return value
    ? getNumber(value, ["queuePosition", "queue_position", "position"])
    : null;
}

function normalizeFailoverQueueFromStatus(
  app: OpenWrtStatusApp,
  providerState: SharedProviderState,
): SharedProviderFailoverQueueEntry[] {
  const statusMap = getFailoverStatusMap(app);
  const providersById = new Map(
    providerState.providers
      .filter((provider) => provider.providerId)
      .map((provider) => [provider.providerId, provider]),
  );
  const rawQueue = app.failoverQueue ?? app.failover_queue;
  const queueEntries: Array<{
    providerId: string;
    providerName: string;
    sortIndex: number | null;
    active: boolean;
    health: unknown;
  }> = Array.isArray(rawQueue)
    ? rawQueue
        .map((entry, index) => {
          const providerId = getString(entry, ["providerId", "provider_id"]);
          if (!providerId) {
            return null;
          }

          const providerStatus = statusMap[providerId];
          const provider = providersById.get(providerId);
          const currentRole = providerStatus
            ? getString(providerStatus, ["currentRole", "current_role"])
            : "";
          const active =
            providerState.activeProviderId != null
              ? providerState.activeProviderId === providerId
              : entry.active === true || currentRole === "active";

          return {
            providerId,
            providerName:
              getString(entry, ["providerName", "provider_name", "name"]) ||
              provider?.name ||
              providerId,
            sortIndex:
              getNumber(entry, ["sortIndex", "sort_index", "position"]) ??
              index,
            active,
            health: providerStatus?.health ?? entry.health,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    : Object.entries(statusMap)
        .filter(([, status]) => statusProviderIsQueued(status))
        .sort(([, left], [, right]) => {
          const leftPosition =
            getStatusQueuePosition(left) ?? Number.MAX_SAFE_INTEGER;
          const rightPosition =
            getStatusQueuePosition(right) ?? Number.MAX_SAFE_INTEGER;

          return leftPosition - rightPosition;
        })
        .map(([providerId, status], index) => {
          const provider = providersById.get(providerId);
          const currentRole = getString(status, [
            "currentRole",
            "current_role",
          ]);
          const active =
            providerState.activeProviderId != null
              ? providerState.activeProviderId === providerId
              : currentRole === "active";

          return {
            providerId,
            providerName: provider?.name || providerId,
            sortIndex: getStatusQueuePosition(status) ?? index,
            active,
            health: status.health,
          };
        });

  return queueEntries.map((entry) => ({
    providerId: entry.providerId,
    providerName: entry.providerName,
    sortIndex: entry.sortIndex,
    active: entry.active,
    health: parseSharedProviderFailoverState(
      {
        providerId: entry.providerId,
        providerHealth: entry.health,
      },
      entry.providerId,
    ).providerHealth,
  }));
}

function normalizeFailoverState(
  app: OpenWrtStatusApp,
  providerState: SharedProviderState,
): SharedProviderFailoverState | null {
  const activeProviderId = providerState.activeProvider.configured
    ? providerState.activeProvider.providerId
    : null;

  if (!activeProviderId) {
    return null;
  }

  const statusMap = getFailoverStatusMap(app);
  const activeProviderStatus = statusMap[activeProviderId];
  const activeProvider = isRecord(app.providers)
    ? app.providers[activeProviderId]
    : null;
  const queue = normalizeFailoverQueueFromStatus(app, providerState);
  const queueIndex = queue.findIndex(
    (entry) => entry.providerId === activeProviderId,
  );
  const mode = app.mode ?? "";

  return parseSharedProviderFailoverState(
    {
      providerId: activeProviderId,
      proxyEnabled: getBoolean(app, ["proxyEnabled", "proxy_enabled"]) ?? false,
      autoFailoverEnabled: mode === "failover",
      maxRetries:
        typeof app.maxRetries === "number"
          ? app.maxRetries
          : (getNumber(app, ["max_retries"]) ?? 0),
      activeProviderId,
      inFailoverQueue:
        statusProviderIsQueued(activeProviderStatus) || queueIndex >= 0,
      queuePosition:
        getStatusQueuePosition(activeProviderStatus) ??
        (queueIndex >= 0 ? queueIndex : null),
      sortIndex:
        getNumber(activeProviderStatus ?? {}, ["sortIndex", "sort_index"]) ??
        (queueIndex >= 0 ? queueIndex : null),
      providerHealth: activeProviderStatus?.health ?? activeProvider?.health,
      failoverQueueDepth: queue.length,
      failoverQueue: queue,
    },
    activeProviderId,
  );
}

function normalizeCardFromStatus(
  appId: SharedProviderAppId,
  app: OpenWrtStatusApp,
): AppGridLoadResult {
  const providerState = normalizeProviderState(appId, app);

  return {
    card: {
      appId,
      loading: false,
      error: null,
      providerState,
      summary: normalizeUsageSummary(app.usage),
      providerStats: normalizeProviderStats(app),
      recentActivity:
        app.recentActivity || app.recent_activity
          ? normalizeRecentActivity(app)
          : [],
      failoverState: normalizeFailoverState(app, providerState),
    },
    providerStateOk: true,
    summaryOk: Boolean(app.usage),
    providerStatsOk: true,
    recentActivityOk: Boolean(app.recentActivity || app.recent_activity),
    failoverStateOk: true,
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

export interface AppsGridProps {
  options: OpenWrtSharedPageMountOptions;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
  providerMutationVersion?: number;
}

type StatusGridLoadResult = {
  cards: AppGridLoadResult[];
  quotaByProviderId: Record<string, ProviderQuotaSnapshot>;
  quotaOk: boolean;
};

function assertStatusShape(
  status: OpenWrtStatusResponse,
): OpenWrtStatusResponse {
  if (!status || !isRecord(status) || !isRecord(status.apps)) {
    throw new Error("OpenWrt status payload was empty or invalid.");
  }

  return status;
}

function normalizeQuotaByProviderId(
  status: OpenWrtStatusResponse,
): Record<string, ProviderQuotaSnapshot> {
  const quotaByProviderId: Record<string, ProviderQuotaSnapshot> = {};

  for (const appId of BACKEND_APP_OPTIONS) {
    const app = status.apps[appId];
    if (!app || !isRecord(app.providers)) {
      continue;
    }

    for (const [providerId, provider] of Object.entries(app.providers)) {
      const providerName = provider.name?.trim() || providerId;
      const quota = normalizeQuotaSnapshot(
        provider.quota,
        appId,
        providerId,
        providerName,
      );

      if (quota) {
        quotaByProviderId[quota.provider_id] = quota;
      }
    }
  }

  return quotaByProviderId;
}

async function loadStatusGridData(
  options: OpenWrtSharedPageMountOptions,
  t: TFunction,
): Promise<StatusGridLoadResult> {
  try {
    const status = assertStatusShape(await options.shell.getStatus());
    const cards = APP_OPTIONS.map((appId): AppGridLoadResult => {
      if (isInertHomeAppId(appId)) {
        return createInertLoadResult(appId);
      }

      const app = status.apps[appId];
      return app
        ? normalizeCardFromStatus(appId, app)
        : createFailedLoadResult(
            appId,
            t("openwrt.appsGrid.routerDataUnavailable"),
          );
    });

    return {
      cards,
      quotaByProviderId: normalizeQuotaByProviderId(status),
      quotaOk: true,
    };
  } catch (error) {
    const message = getErrorMessage(error, t);

    return {
      cards: APP_OPTIONS.map((appId) => createFailedLoadResult(appId, message)),
      quotaByProviderId: {},
      quotaOk: false,
    };
  }
}

function mergeStatusCards(
  currentCards: AppGridData[],
  nextResults: AppGridLoadResult[],
): AppGridData[] {
  const nextResultsByAppId = new Map(
    nextResults.map((result) => [result.card.appId, result]),
  );

  return currentCards.map((currentCard) => {
    const nextResult = nextResultsByAppId.get(currentCard.appId);
    return nextResult ? mergeCardData(currentCard, nextResult) : currentCard;
  });
}

function sortCardsByOrder(
  cardsToSort: AppGridData[],
  orderedAppIds: readonly OpenWrtHomeAppId[],
): AppGridData[] {
  const orderIndex = new Map(
    orderedAppIds.map((appId, index) => [appId, index]),
  );

  return [...cardsToSort].sort(
    (left, right) =>
      (orderIndex.get(left.appId) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(right.appId) ?? Number.MAX_SAFE_INTEGER),
  );
}

type AppReorderHandle = {
  isDragging: boolean;
  dropPosition: "before" | "after" | null;
  rootProps: HTMLAttributes<HTMLElement>;
  handleProps: HTMLAttributes<HTMLButtonElement> & {
    draggable: true;
  };
};

export function AppsGrid({
  options,
  onOpenActivity,
  onOpenProviderPanel,
  providerMutationVersion = 0,
}: AppsGridProps) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<AppGridData[]>(() =>
    APP_OPTIONS.map(createInitialCard),
  );
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
  const [optimisticProxyEnabledByApp, setOptimisticProxyEnabledByApp] =
    useState<Partial<Record<SharedProviderAppId, boolean>>>({});
  const [failoverReorderPendingByApp, setFailoverReorderPendingByApp] =
    useState<Partial<Record<SharedProviderAppId, boolean>>>({});
  const [appOrder, setAppOrder] =
    useState<OpenWrtHomeAppId[]>(readStoredAppOrder);
  const [appDropTarget, setAppDropTarget] = useState<{
    appId: OpenWrtHomeAppId;
    position: "before" | "after";
  } | null>(null);
  const [draggingAppId, setDraggingAppId] = useState<OpenWrtHomeAppId | null>(
    null,
  );

  async function refreshStatusSnapshot() {
    const nextStatus = await loadStatusGridData(options, t);

    setCards((currentCards) =>
      mergeStatusCards(currentCards, nextStatus.cards),
    );
    if (nextStatus.quotaOk) {
      setQuotaByProviderId(nextStatus.quotaByProviderId);
    }
  }

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
      await refreshStatusSnapshot();
    } finally {
      setFailoverPendingByApp((current) => ({ ...current, [appId]: false }));
      setOptimisticAutoFailoverEnabledByApp((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    }
  }

  async function handleSetProxyEnabled(
    appId: SharedProviderAppId,
    enabled: boolean,
  ) {
    const adapter = createOpenWrtProviderAdapter(options.transport);

    if (typeof adapter.setProxyEnabled !== "function") {
      return;
    }

    setFailoverPendingByApp((current) => ({ ...current, [appId]: true }));
    setOptimisticProxyEnabledByApp((current) => ({
      ...current,
      [appId]: enabled,
    }));
    try {
      await adapter.setProxyEnabled(appId, enabled);
      await refreshStatusSnapshot();
    } finally {
      setFailoverPendingByApp((current) => ({ ...current, [appId]: false }));
      setOptimisticProxyEnabledByApp((current) => {
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
      await refreshStatusSnapshot();
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

    void loadStatusGridData(options, t).then((nextStatus) => {
      if (cancelled) return;
      initialLoadCompleteRef.current = true;
      if (shouldShowLoading) {
        setCards(nextStatus.cards.map((result) => result.card));
      } else {
        setCards((currentCards) =>
          mergeStatusCards(currentCards, nextStatus.cards),
        );
      }
      if (nextStatus.quotaOk) {
        setQuotaByProviderId(nextStatus.quotaByProviderId);
      }
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

    const refetchStatus = async () => {
      const nextStatus = await loadStatusGridData(options, t);

      if (cancelled) {
        return;
      }

      setCards((prev) => mergeStatusCards(prev, nextStatus.cards));
      if (nextStatus.quotaOk) {
        setQuotaByProviderId(nextStatus.quotaByProviderId);
      }
    };

    const startPolling = () => {
      clearPollingInterval();

      const pollIntervalMs = getPollIntervalMs();
      if (pollIntervalMs <= 0) {
        return;
      }

      intervalId = window.setInterval(() => {
        void refetchStatus();
      }, pollIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (doc.visibilityState === "hidden") {
        clearPollingInterval();
        return;
      }

      void refetchStatus();
      startPolling();
    };

    doc.addEventListener("visibilitychange", handleVisibilityChange);
    startPolling();

    return () => {
      cancelled = true;
      clearPollingInterval();
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [options]);

  const hostState = options.shell.getHostState();
  const serviceRunning = options.shell.getServiceStatus().isRunning;
  const loadingCards = cards.filter(
    (card) => card.loading && !card.providerState,
  );
  const settledCards = cards.filter(
    (card) => !card.loading || card.providerState,
  );
  const orderedLoadingCards = sortCardsByOrder(loadingCards, appOrder);
  const orderedSettledCards = sortCardsByOrder(settledCards, appOrder);
  const configured = orderedSettledCards.filter(isConfigured);
  const unconfigured = orderedSettledCards.filter(
    (card) => !isConfigured(card),
  );
  const configuredAppIds = configured.map((card) => card.appId);

  function clearAppDragState() {
    setDraggingAppId(null);
    setAppDropTarget(null);
  }

  function reorderConfiguredApps(
    activeId: OpenWrtHomeAppId,
    overId: OpenWrtHomeAppId,
    position: "before" | "after",
  ) {
    if (
      activeId === overId ||
      !configuredAppIds.includes(activeId) ||
      !configuredAppIds.includes(overId)
    ) {
      return;
    }

    setAppOrder((currentOrder) => {
      const oldIndex = currentOrder.indexOf(activeId);
      const newIndex = currentOrder.indexOf(overId);

      if (oldIndex < 0 || newIndex < 0) {
        return currentOrder;
      }

      const nextOrder = [...currentOrder];
      const [movedAppId] = nextOrder.splice(oldIndex, 1);
      const overIndexAfterRemoval = nextOrder.indexOf(overId);

      if (overIndexAfterRemoval < 0) {
        return currentOrder;
      }

      nextOrder.splice(
        overIndexAfterRemoval + (position === "after" ? 1 : 0),
        0,
        movedAppId,
      );
      writeStoredAppOrder(nextOrder);
      return nextOrder;
    });
  }

  function updateAppDropTarget(
    activeId: OpenWrtHomeAppId,
    overId: OpenWrtHomeAppId,
    position: "before" | "after",
  ) {
    if (
      activeId === overId ||
      !configuredAppIds.includes(activeId) ||
      !configuredAppIds.includes(overId)
    ) {
      setAppDropTarget(null);
      return;
    }

    setAppDropTarget({
      appId: overId,
      position,
    });
  }

  function buildAppReorderHandle(card: AppGridData): AppReorderHandle {
    const handleDragStart: DragEventHandler<HTMLButtonElement> = (event) => {
      setDraggingAppId(card.appId);
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", card.appId);
      } catch {
        // Some browser implementations do not allow setting drag data.
      }
    };

    const rootProps: HTMLAttributes<HTMLElement> = {
      onDragOver(event) {
        if (!draggingAppId) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const position =
          event.clientX - rect.left > rect.width / 2 ? "after" : "before";
        updateAppDropTarget(draggingAppId, card.appId, position);
      },
      onDrop(event) {
        if (!draggingAppId) {
          return;
        }

        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const position =
          event.clientX - rect.left > rect.width / 2 ? "after" : "before";
        reorderConfiguredApps(draggingAppId, card.appId, position);
        clearAppDragState();
      },
    };

    return {
      isDragging: draggingAppId === card.appId,
      dropPosition:
        appDropTarget?.appId === card.appId ? appDropTarget.position : null,
      rootProps,
      handleProps: {
        draggable: true,
        onDragStart: handleDragStart,
        onDragEnd: clearAppDragState,
      },
    };
  }

  const renderCard = (
    card: AppGridData,
    appReorderHandle?: AppReorderHandle,
  ) => {
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
        optimisticProxyEnabled={
          isInertHomeAppId(card.appId)
            ? null
            : (optimisticProxyEnabledByApp[card.appId] ?? null)
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
        onSetProxyEnabled={(nextAppId, enabled) => {
          void handleSetProxyEnabled(nextAppId, enabled);
        }}
        onReorderFailoverQueue={(nextAppId, providerIds) => {
          void handleReorderFailoverQueue(nextAppId, providerIds);
        }}
        appReorderHandle={appReorderHandle}
      />
    );
  };

  return (
    <div className="owt-apps-grid">
      {loadingCards.length > 0 && (
        <div className="owt-group-grid">
          {orderedLoadingCards.map((card) => (
            <SkeletonCard key={`${card.appId}-loading`} />
          ))}
          {loadingCards.length % 2 === 1 && <SkeletonCard key="loading-pad" />}
        </div>
      )}

      {configured.length > 0 && (
        <div className="owt-group-grid" data-app-reorder-grid="true">
          {configured.map((card) =>
            renderCard(card, buildAppReorderHandle(card)),
          )}
          {configured.length % 2 === 1 && <SkeletonCard key="configured-pad" />}
        </div>
      )}

      {unconfigured.length > 0 && (
        <>
          <GroupHeader label={t("openwrt.appsGrid.notConfigured")} />
          <div className="owt-group-grid">
            {unconfigured.map((card) => renderCard(card))}
            {unconfigured.length % 2 === 1 && (
              <SkeletonCard key="unconfigured-pad" kind="empty" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
