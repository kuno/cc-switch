import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TFunction } from "i18next";
import { GripVertical, Info } from "lucide-react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEventHandler,
  MouseEventHandler,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  SharedProviderAppId,
  SharedProviderFailoverQueueEntry,
  SharedProviderFailoverState,
  SharedProviderState,
  SharedProviderView,
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
import { getOpenWrtAppIconUrl, OpenWrtProviderIcon } from "../providerIcons";
import { formatResetDelta } from "../utils/formatResetDelta";

type InertHomeAppId = "opencode" | "openclaw";
type AppCardAppId = SharedProviderAppId | InertHomeAppId;

const APP_COPY: Record<
  AppCardAppId,
  {
    labelKey: string;
    subtitleKey?: string;
  }
> = {
  claude: {
    labelKey: "apps.claude",
    subtitleKey: "openwrt.appCard.subtitle.claude",
  },
  codex: {
    labelKey: "apps.codex",
    subtitleKey: "openwrt.appCard.subtitle.codex",
  },
  gemini: {
    labelKey: "apps.gemini",
    subtitleKey: "openwrt.appCard.subtitle.gemini",
  },
  opencode: {
    labelKey: "apps.opencode",
  },
  openclaw: {
    labelKey: "apps.openclaw",
  },
};

function isInertHomeAppId(appId: AppCardAppId): appId is InertHomeAppId {
  return appId === "opencode" || appId === "openclaw";
}

type StatusTone = "success" | "accent" | "warn" | "neutral" | "fail";
type RunMode = "normal" | "failover";

/** Adaptive formatter: 3 significant figures with k/M/B/T suffix. */
function formatAdaptive(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return Math.round(n).toString();
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [base, suffix] of units) {
    if (abs >= base) {
      const v = n / base;
      const intDigits = Math.floor(Math.log10(Math.abs(v))) + 1;
      const decimals = Math.max(0, 3 - intDigits);
      return v.toFixed(decimals) + suffix;
    }
  }
  return n.toString();
}

/** Parses the string-money field and returns a scaled numeric string — the unit is rendered separately. */
function formatCostValue(value: string | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric === 0) return "0";
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
  });
}

function formatRequestCount(value: number | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "0";
  return Math.round(numeric).toLocaleString();
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
  hostState,
  loading,
  error,
  providerState,
  serviceRunning,
  recentActivity,
  failoverState,
}: {
  hostState: OpenWrtHostState;
  loading: boolean;
  error: string | null;
  providerState: SharedProviderState | null;
  serviceRunning: boolean;
  recentActivity: OpenWrtRecentActivityItem[];
  failoverState: SharedProviderFailoverState | null;
}): {
  labelKey: string;
  tone: StatusTone;
} {
  const activeProviderConfigured =
    providerState?.activeProvider.configured ?? false;

  if (loading && !providerState) {
    return { labelKey: "openwrt.appCard.status.loading", tone: "neutral" };
  }

  if (!activeProviderConfigured) {
    return { labelKey: "openwrt.appCard.notConfigured", tone: "neutral" };
  }

  if (!serviceRunning || hostState.status === "stopped") {
    return { labelKey: "settings.advanced.proxy.stopped", tone: "neutral" };
  }

  if (error) {
    return { labelKey: "openwrt.appCard.status.unavailable", tone: "fail" };
  }

  // recent live failures override the daemon's probe-based health, which can lag by hours
  if ((recentActivity[0]?.statusCode ?? 0) >= 400) {
    return { labelKey: "health.degraded", tone: "warn" };
  }

  const providerHealth = failoverState?.providerHealth;
  if (providerHealth?.observed) {
    if (providerHealth.healthy) {
      return { labelKey: "settings.advanced.proxy.running", tone: "success" };
    }
    if (
      providerHealth.lastSuccessAt === null &&
      providerHealth.lastFailureAt === null
    ) {
      return {
        labelKey: "openwrt.appCard.status.unavailable",
        tone: "neutral",
      };
    }
    return { labelKey: "openwrt.appCard.status.unavailable", tone: "fail" };
  }

  return { labelKey: "openwrt.appCard.status.standby", tone: "neutral" };
}

function utilBarClass(util: number | null | undefined): string {
  if (util == null) return "owt-quota-bar--success";
  if (util >= 0.8) return "owt-quota-bar--danger";
  if (util >= 0.6) return "owt-quota-bar--warning";
  return "owt-quota-bar--success";
}

function remainingBarClass(remainingPct: number | null): string {
  if (remainingPct == null) return "owt-quota-bar--success";
  if (remainingPct <= 20) return "owt-quota-bar--danger";
  if (remainingPct <= 40) return "owt-quota-bar--warning";
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
  const { t } = useTranslation();
  const remainingRatio =
    w.utilization != null ? Math.max(0, Math.min(1, 1 - w.utilization)) : null;
  const remainingPct =
    remainingRatio != null
      ? Math.max(0, Math.min(100, Math.trunc(remainingRatio * 100)))
      : null;
  const remainingWidth =
    remainingRatio != null
      ? Math.max(0, Math.min(100, Math.round(remainingRatio * 1000) / 10))
      : null;
  const barClass = remainingBarClass(remainingPct);
  const resetLabel = formatResetDelta(w.reset);

  return (
    <div className="owt-quota-row">
      <div className="owt-quota-row__label">
        <span className="owt-quota-row__name">{w.name}</span>
        {remainingPct != null && (
          <span className="owt-quota-row__pct">
            {t("openwrt.appCard.percentRemaining", { percent: remainingPct })}
          </span>
        )}
        {resetLabel && (
          <span className="owt-quota-row__reset">
            {t("openwrt.appCard.resets", { time: resetLabel })}
          </span>
        )}
      </div>
      {remainingWidth != null && (
        <div className="owt-quota-bar" aria-hidden="true">
          <div
            className={`owt-quota-bar__fill ${barClass}`}
            style={{ width: `${remainingWidth}%` }}
          />
        </div>
      )}
    </div>
  );
}

function BalanceRow({ balance }: { balance: BalanceSnapshot }) {
  const { t } = useTranslation();
  const currency = balance.currency ?? "USD";
  const remaining = balance.remaining ?? 0;
  const isInvalid = balance.is_valid === false || remaining <= 0;
  const formattedRemaining = formatBalanceAmount(remaining, currency);
  const hasTotal = balance.total != null && balance.total > 0;
  const usedAmount =
    balance.used ?? (hasTotal ? (balance.total ?? 0) - remaining : null);
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
          {t("openwrt.appCard.amountRemaining", {
            amount: formattedRemaining,
          })}
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

function QuotaBand({
  snapshot,
  hideLabel,
}: {
  snapshot: ProviderQuotaSnapshot;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation();
  const hasWindows = snapshot.windows.length > 0;
  const activeBalances = snapshot.balances?.filter(
    (b) => b.remaining != null || b.total != null,
  );
  const hasBalances = (activeBalances?.length ?? 0) > 0;

  if (!hasWindows && !hasBalances) return null;

  return (
    <div className="owt-quota-band">
      {!hideLabel && (
        <div className="owt-quota-band__label">
          {t("openwrt.appCard.quota")}
        </div>
      )}
      {hasWindows
        ? snapshot.windows.map((w, i) => (
            <WindowRow key={`${w.name}-${i}`} window={w} />
          ))
        : activeBalances!.map((b, i) => <BalanceRow key={i} balance={b} />)}
    </div>
  );
}

function getQueueEntryStatus(
  entry: SharedProviderFailoverQueueEntry,
  t: TFunction,
): {
  label: string;
  note: string;
  state: "active" | "skipped" | "standby";
  tone: StatusTone;
} {
  if (entry.active) {
    return {
      label: t("openwrt.appCard.queue.active"),
      note: t("openwrt.appCard.queue.servingTraffic"),
      state: "active",
      tone: "success",
    };
  }

  if (entry.health.observed && !entry.health.healthy) {
    const failures = entry.health.consecutiveFailures;

    return {
      label: t("openwrt.appCard.queue.skipped"),
      note:
        failures > 0
          ? t("openwrt.appCard.queue.skippedWithFailures", {
              count: failures,
            })
          : t("openwrt.appCard.queue.skippedByHealthCheck"),
      state: "skipped",
      tone: failures > 1 ? "fail" : "accent",
    };
  }

  return {
    label: t("openwrt.appCard.queue.standby"),
    note: t("openwrt.appCard.queue.standbyRetriesUsed", {
      count: entry.health.consecutiveFailures,
    }),
    state: "standby",
    tone: "neutral",
  };
}

function getQueueHeadLabel(
  queue: SharedProviderFailoverQueueEntry[],
  t: TFunction,
): string {
  if (queue.length === 0) {
    return "—";
  }

  const activeIndex = queue.findIndex((entry) => entry.active);
  const headIndex = activeIndex >= 0 ? activeIndex : 0;

  return t("openwrt.appCard.positionOfTotal", {
    position: headIndex + 1,
    total: queue.length,
  });
}

interface FailoverQueueRowProps {
  appId: SharedProviderAppId;
  entry: SharedProviderFailoverQueueEntry;
  index: number;
  provider: SharedProviderView | null;
  dragDisabled: boolean;
  onOpenProviderPanel?: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
  setNodeRef?: (element: HTMLElement | null) => void;
  style?: CSSProperties;
  isDragging?: boolean;
  dragAttributes?: HTMLAttributes<HTMLButtonElement>;
  dragListeners?: HTMLAttributes<HTMLButtonElement>;
}

function FailoverQueueRow({
  appId,
  entry,
  index,
  provider,
  dragDisabled,
  onOpenProviderPanel,
  setNodeRef,
  style,
  isDragging = false,
  dragAttributes,
  dragListeners,
}: FailoverQueueRowProps) {
  const { t } = useTranslation();
  const providerName = entry.providerName || entry.providerId;
  const status = getQueueEntryStatus(entry, t);

  return (
    <div
      ref={setNodeRef}
      className="owt-app-card__queue-row"
      data-provider-open="true"
      data-dragging={isDragging ? "true" : "false"}
      data-state={status.state}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onOpenProviderPanel?.(appId, entry.providerId);
      }}
    >
      <button
        type="button"
        className="owt-app-card__queue-drag"
        disabled={dragDisabled}
        title={
          dragDisabled
            ? t("openwrt.appCard.queueOrderUpdating")
            : t("openwrt.appCard.dragToReorderProvider", {
                provider: providerName,
              })
        }
        {...dragAttributes}
        {...dragListeners}
        aria-label={t("openwrt.appCard.reorderProvider", {
          provider: providerName,
        })}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="owt-app-card__queue-pos">{index + 1}</span>
      <span className="owt-app-card__queue-icon" aria-hidden="true">
        <OpenWrtProviderIcon
          appId={appId}
          name={providerName}
          size={18}
          source={provider}
        />
      </span>
      <span className="owt-app-card__queue-copy">
        <span className="owt-app-card__queue-name">{providerName}</span>
        <span className="owt-app-card__queue-note">{status.note}</span>
      </span>
      <span
        className="owt-status-pill owt-app-card__queue-state"
        data-tone={status.tone}
      >
        <span className="owt-status-pill__dot" aria-hidden="true" />
        {status.label}
      </span>
    </div>
  );
}

function SortableFailoverQueueRow({
  appId,
  entry,
  index,
  provider,
  dragDisabled,
  onOpenProviderPanel,
}: {
  appId: SharedProviderAppId;
  entry: SharedProviderFailoverQueueEntry;
  index: number;
  provider: SharedProviderView | null;
  dragDisabled: boolean;
  onOpenProviderPanel?: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.providerId,
    disabled: dragDisabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <FailoverQueueRow
      appId={appId}
      entry={entry}
      index={index}
      provider={provider}
      dragDisabled={dragDisabled}
      onOpenProviderPanel={onOpenProviderPanel}
      setNodeRef={setNodeRef}
      style={style}
      isDragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
    />
  );
}

function FailoverQueueSummary({
  appId,
  failoverState,
  providerState,
  autoFailoverEnabled,
  reorderPending,
  onOpenProviderPanel,
  onReorder,
}: {
  appId: SharedProviderAppId;
  failoverState: SharedProviderFailoverState | null;
  providerState: SharedProviderState | null;
  autoFailoverEnabled: boolean;
  reorderPending: boolean;
  onOpenProviderPanel?: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
  onReorder?: (providerIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const queue = failoverState?.failoverQueue ?? [];
  const queuedProviderIds = queue.map((entry) => entry.providerId);
  const providersById = new Map(
    (providerState?.providers ?? [])
      .filter((provider) => provider.providerId)
      .map((provider) => [provider.providerId, provider]),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (queue.length === 0) {
    return (
      <div className="owt-app-card__failover-empty">
        {t("openwrt.appCard.noProvidersInFailoverQueue")}
      </div>
    );
  }

  const canReorder = queue.length > 1 && typeof onReorder === "function";

  function handleDragEnd(event: DragEndEvent) {
    if (!canReorder || reorderPending) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || activeId === overId) {
      return;
    }

    const oldIndex = queuedProviderIds.indexOf(activeId);
    const newIndex = queuedProviderIds.indexOf(overId);

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    onReorder?.(arrayMove(queuedProviderIds, oldIndex, newIndex));
  }

  return (
    <div className="owt-app-card__failover">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={queuedProviderIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="owt-app-card__queue-list">
            {queue.map((entry, index) => (
              <SortableFailoverQueueRow
                key={entry.providerId}
                appId={appId}
                entry={entry}
                index={index}
                provider={providersById.get(entry.providerId) ?? null}
                dragDisabled={!canReorder || reorderPending}
                onOpenProviderPanel={onOpenProviderPanel}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="owt-app-card__failover-foot">
        <span>
          {t(
            autoFailoverEnabled
              ? "openwrt.appCard.autoFailoverOnSummary"
              : "openwrt.appCard.autoFailoverOffSummary",
            { maxRetries: failoverState?.maxRetries ?? 0 },
          )}
        </span>
        <span>
          {t("openwrt.appCard.queueHead", {
            head: reorderPending
              ? t("openwrt.appCard.updating")
              : getQueueHeadLabel(queue, t),
          })}
        </span>
      </div>
    </div>
  );
}

export interface AppCardProps {
  appId: AppCardAppId;
  hostState: OpenWrtHostState;
  serviceRunning: boolean;
  providerState: SharedProviderState | null;
  summary: OpenWrtUsageSummary | null;
  providerStats: OpenWrtProviderStat[];
  recentActivity: OpenWrtRecentActivityItem[];
  loading: boolean;
  error: string | null;
  quotaSnapshot?: ProviderQuotaSnapshot;
  failoverState?: SharedProviderFailoverState | null;
  failoverPending?: boolean;
  optimisticAutoFailoverEnabled?: boolean | null;
  optimisticProxyEnabled?: boolean | null;
  failoverReorderPending?: boolean;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (
    appId: SharedProviderAppId,
    providerId?: string,
  ) => void;
  onSetAutoFailover?: (appId: SharedProviderAppId, enabled: boolean) => void;
  onSetProxyEnabled?: (appId: SharedProviderAppId, enabled: boolean) => void;
  onReorderFailoverQueue?: (
    appId: SharedProviderAppId,
    providerIds: string[],
  ) => void;
  appReorderHandle?: {
    isDragging: boolean;
    dropPosition: "before" | "after" | null;
    rootProps: HTMLAttributes<HTMLElement>;
    handleProps: HTMLAttributes<HTMLButtonElement> & {
      draggable: true;
    };
  };
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
  failoverState,
  failoverPending = false,
  optimisticAutoFailoverEnabled = null,
  optimisticProxyEnabled = null,
  failoverReorderPending = false,
  onOpenActivity,
  onOpenProviderPanel,
  onSetAutoFailover,
  onSetProxyEnabled,
  onReorderFailoverQueue,
  appReorderHandle,
}: AppCardProps) {
  const { t } = useTranslation();
  const appCopy = APP_COPY[appId];
  const appLabel = t(appCopy.labelKey);
  const appSubtitle = appCopy.subtitleKey ? t(appCopy.subtitleKey) : "";
  const isInert = isInertHomeAppId(appId);
  const providerCount = providerState?.providers.length ?? 0;
  const activeProvider = providerState?.activeProvider.configured
    ? providerState.activeProvider
    : null;
  const proxyEnabled =
    optimisticProxyEnabled ??
    failoverState?.proxyEnabled ??
    hostState.proxyEnabled;
  const appIconUrl = getOpenWrtAppIconUrl(appId);
  const autoFailoverEnabled =
    optimisticAutoFailoverEnabled ??
    failoverState?.autoFailoverEnabled ??
    false;
  const runMode: RunMode = autoFailoverEnabled ? "failover" : "normal";
  const canChangeRunMode =
    !isInert &&
    Boolean(activeProvider) &&
    proxyEnabled &&
    Boolean(failoverState) &&
    typeof onSetAutoFailover === "function";
  const canChangeProxy =
    !isInert &&
    Boolean(failoverState) &&
    typeof onSetProxyEnabled === "function";

  if (!activeProvider) {
    const handleEmptyCardClick: MouseEventHandler<HTMLDivElement> = () => {
      if (isInertHomeAppId(appId)) {
        return;
      }

      onOpenProviderPanel(appId);
    };

    const handleEmptyCardKey: KeyboardEventHandler<HTMLDivElement> = (
      event,
    ) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();

      if (isInertHomeAppId(appId)) {
        return;
      }

      onOpenProviderPanel(appId);
    };

    return (
      <div
        className={`owt-app-card owt-app-card--empty${
          isInert ? " owt-app-card--inert" : ""
        }`}
        data-app={appId}
        data-loading={loading ? "true" : "false"}
        role="button"
        tabIndex={isInert ? -1 : 0}
        aria-disabled={isInert ? "true" : undefined}
        onClick={handleEmptyCardClick}
        onKeyDown={handleEmptyCardKey}
        aria-label={
          isInert
            ? t("openwrt.appCard.appNotConfigured", { app: appLabel })
            : t("openwrt.appCard.addProviderForApp", { app: appLabel })
        }
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
              {appLabel}
            </h3>
            <p className="owt-app-card__subtitle">{appSubtitle}</p>
          </div>
          <span className="owt-app-card__spacer" aria-hidden="true" />
          <span className="owt-chip owt-chip--dot">
            {t("openwrt.appCard.notConfigured")}
          </span>
        </div>
        <div className="owt-app-card__empty-cta">
          <span>
            {isInert
              ? t("openwrt.appCard.notSupportedYet")
              : t("openwrt.appCard.noProviderConfiguredYet")}
          </span>
          {!isInert && (
            <span className="owt-app-card__empty-cta-btn">
              {t("openwrt.appCard.addProviderArrow")}
            </span>
          )}
        </div>
        {loading ? <div className="card-shimmer" aria-hidden="true" /> : null}
      </div>
    );
  }

  if (isInertHomeAppId(appId)) {
    return null;
  }

  const status = getStatus({
    hostState,
    loading,
    error,
    providerState,
    serviceRunning,
    recentActivity,
    failoverState: failoverState ?? null,
  });

  const tokensValue = formatAdaptive(sumTokenCounts(summary));
  const requestsValue = formatRequestCount(summary?.totalRequests);
  const costValue = formatCostValue(summary?.totalCost);
  const handleRunModeClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    if (!canChangeRunMode || isInertHomeAppId(appId)) return;

    const nextMode = event.currentTarget.dataset.mode as RunMode | undefined;
    if (!nextMode || nextMode === runMode) return;

    onSetAutoFailover?.(appId, nextMode === "failover");
  };
  const handleProxyToggleClick: MouseEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    event.stopPropagation();
    if (!canChangeProxy || isInertHomeAppId(appId)) return;

    onSetProxyEnabled?.(appId, !proxyEnabled);
  };

  const handleCardClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (
      (event.target as HTMLElement).closest(
        "[data-owt-chip], [data-mode-toggle], [data-cost-info], [data-app-reorder-handle], [data-proxy-toggle]",
      )
    ) {
      return;
    }
    onOpenProviderPanel(appId);
  };

  const handleCardKey: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      if (
        (event.target as HTMLElement).closest(
          "[data-owt-chip], [data-mode-toggle], [data-cost-info], [data-app-reorder-handle], [data-proxy-toggle]",
        )
      ) {
        return;
      }
      event.preventDefault();
      onOpenProviderPanel(appId);
    }
  };

  return (
    <div
      className={`owt-app-card${proxyEnabled ? "" : " owt-app-card--bypassed"}`}
      data-app={appId}
      data-loading={loading ? "true" : "false"}
      data-proxy-enabled={proxyEnabled ? "true" : "false"}
      data-reorderable={appReorderHandle ? "true" : "false"}
      data-dragging={appReorderHandle?.isDragging ? "true" : "false"}
      data-drop-position={appReorderHandle?.dropPosition ?? undefined}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      aria-label={t("openwrt.appCard.openProviders", { app: appLabel })}
      {...appReorderHandle?.rootProps}
    >
      {appReorderHandle ? (
        <button
          type="button"
          className="owt-app-card__drag-handle"
          data-app-reorder-handle="true"
          title={t("openwrt.appCard.dragToReorderApp", { app: appLabel })}
          aria-label={t("openwrt.appCard.reorderApp", { app: appLabel })}
          {...appReorderHandle.handleProps}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <div className="owt-app-card__head">
        <div className="owt-app-card__icon" aria-hidden="true">
          <img src={appIconUrl} alt="" />
        </div>
        <div className="owt-app-card__titles">
          <h3 className="owt-app-card__title">
            {appLabel}
            <span className="owt-app-card__prov-count">
              {" · "}
              {t("openwrt.appCard.providerCount", {
                count: providerCount,
              })}
              <span className="owt-app-card__prov-hover"> →</span>
            </span>
          </h3>
          <p className="owt-app-card__subtitle">{appSubtitle}</p>
        </div>
        <span className="owt-app-card__spacer" aria-hidden="true" />
        <div className="owt-app-card__head-actions">
          <button
            type="button"
            className="owt-app-card__proxy-toggle"
            data-proxy-toggle="true"
            data-proxy-enabled={proxyEnabled ? "true" : "false"}
            role="switch"
            aria-checked={proxyEnabled}
            aria-label={t(
              proxyEnabled
                ? "openwrt.appCard.proxyEnabledTitle"
                : "openwrt.appCard.proxyBypassedTitle",
              { app: appLabel },
            )}
            disabled={!canChangeProxy || failoverPending}
            onClick={handleProxyToggleClick}
            title={t(
              proxyEnabled
                ? "openwrt.appCard.proxyEnabledTitle"
                : "openwrt.appCard.proxyBypassedTitle",
              { app: appLabel },
            )}
          />
          {proxyEnabled ? (
            <button
              type="button"
              className="owt-status-pill owt-status-pill--button"
              data-owt-chip="true"
              data-tone={status.tone}
              onClick={(event) => {
                event.stopPropagation();
                onOpenActivity(appId);
              }}
              title={t("openwrt.appCard.showRecentRequests")}
            >
              <span className="owt-status-pill__dot" aria-hidden="true" />
              {t(status.labelKey)}
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
          ) : (
            <span
              className="owt-status-pill owt-status-pill--bypassed"
              data-owt-chip="true"
              data-tone="neutral"
              title={t("openwrt.appCard.proxyBypassedTitle", {
                app: appLabel,
              })}
            >
              <span className="owt-status-pill__dot" aria-hidden="true" />
              {t("openwrt.appCard.bypassed")}
            </span>
          )}
          {canChangeRunMode ? (
            <div
              className="owt-mode-toggle"
              role="tablist"
              aria-label={t("openwrt.appCard.routingMode", {
                app: appLabel,
              })}
              data-mode-toggle="true"
              data-pending={failoverPending ? "true" : "false"}
              aria-busy={failoverPending ? "true" : undefined}
              onClick={(event) => event.stopPropagation()}
            >
              {(["normal", "failover"] as const).map((modeOption) => (
                <button
                  key={modeOption}
                  type="button"
                  className="owt-mode-toggle__button"
                  role="tab"
                  aria-selected={runMode === modeOption}
                  data-active={runMode === modeOption}
                  data-mode={modeOption}
                  disabled={failoverPending}
                  onClick={handleRunModeClick}
                  title={
                    modeOption === "normal"
                      ? t("openwrt.appCard.mode.normalTitle")
                      : t("openwrt.appCard.mode.failoverTitle")
                  }
                >
                  <span className="owt-mode-toggle__dot" aria-hidden="true" />
                  {modeOption === "normal"
                    ? t("openwrt.appCard.mode.normal")
                    : t("openwrt.appCard.mode.failover")}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        data-mode-body="true"
        data-pending={failoverPending ? "true" : "false"}
      >
        {runMode === "failover" ? (
          <FailoverQueueSummary
            appId={appId}
            failoverState={failoverState ?? null}
            providerState={providerState}
            autoFailoverEnabled={autoFailoverEnabled}
            reorderPending={failoverReorderPending}
            onOpenProviderPanel={onOpenProviderPanel}
            onReorder={(providerIds) => {
              onReorderFailoverQueue?.(appId, providerIds);
            }}
          />
        ) : (
          <div
            className="owt-app-card__active"
            data-provider-open="true"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProviderPanel(
                appId,
                activeProvider.providerId ?? undefined,
              );
            }}
          >
            <div className="owt-app-card__active-row">
              <div className="owt-app-card__mini-icon" aria-hidden="true">
                <OpenWrtProviderIcon
                  appId={appId}
                  name={activeProvider.name.trim() || appLabel}
                  size={18}
                  source={activeProvider}
                />
              </div>
              <div className="owt-app-card__active-labels">
                <div className="owt-app-card__active-top">
                  {t("openwrt.appCard.activeProvider")}
                </div>
                <div className="owt-app-card__active-main">
                  {activeProvider.name.trim() ||
                    t("openwrt.appCard.unnamedProvider")}
                </div>
                <div className="owt-app-card__active-endpoint">
                  {activeProvider.baseUrl.trim() ||
                    t("openwrt.appCard.endpointUnavailable")}
                </div>
              </div>
            </div>
            {quotaSnapshot ? (
              <QuotaBand snapshot={quotaSnapshot} hideLabel />
            ) : null}
          </div>
        )}
      </div>

      <div className="owt-app-card__usage">
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">{t("usage.tokens")}</div>
          <div className="owt-app-card__usage-value">{tokensValue}</div>
        </div>
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">{t("usage.requests")}</div>
          <div className="owt-app-card__usage-value">{requestsValue}</div>
        </div>
        <div className="owt-app-card__usage-cell">
          <div className="owt-app-card__usage-label">
            {t("usage.cost")}
            <button
              type="button"
              className="owt-app-card__usage-info"
              data-cost-info="true"
              aria-label={t("openwrt.appCard.aboutCostNumber")}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <Info className="h-3 w-3" aria-hidden="true" />
              <span className="owt-app-card__usage-tip" role="tooltip">
                <strong>{t("openwrt.appCard.costTooltipTitle")}</strong>{" "}
                {t("openwrt.appCard.costTooltipBody")}
              </span>
            </button>
          </div>
          <div className="owt-app-card__usage-value">
            {costValue}
            <span className="owt-app-card__usage-unit">
              {t("openwrt.appCard.currencyUsd")}
            </span>
          </div>
        </div>
      </div>

      {error ? <p className="owt-app-card__telemetry-note">{error}</p> : null}
      {loading ? <div className="card-shimmer" aria-hidden="true" /> : null}
    </div>
  );
}
