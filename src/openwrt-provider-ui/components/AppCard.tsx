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
import { GripVertical, Info } from "lucide-react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEventHandler,
  MouseEventHandler,
} from "react";
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
    label: string;
    subtitle?: string;
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
  opencode: {
    label: "OpenCode",
  },
  openclaw: {
    label: "OpenClaw",
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
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]];
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
  return formatAdaptive(numeric);
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

  if (error) {
    return { label: "Unavailable", tone: "fail" };
  }

  // recent live failures override the daemon's probe-based health, which can lag by hours
  if ((recentActivity[0]?.statusCode ?? 0) >= 400) {
    return { label: "Degraded", tone: "warn" };
  }

  const providerHealth = failoverState?.providerHealth;
  if (providerHealth?.observed) {
    if (providerHealth.healthy) {
      return { label: "Running", tone: "success" };
    }
    if (providerHealth.lastSuccessAt === null && providerHealth.lastFailureAt === null) {
      return { label: "Unavailable", tone: "neutral" };
    }
    return { label: "Unavailable", tone: "fail" };
  }

  return { label: "Standby", tone: "neutral" };
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
          <span className="owt-quota-row__pct">{remainingPct}% remaining</span>
        )}
        {resetLabel && (
          <span className="owt-quota-row__reset">resets {resetLabel}</span>
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

function QuotaBand({
  snapshot,
  hideLabel,
}: {
  snapshot: ProviderQuotaSnapshot;
  hideLabel?: boolean;
}) {
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
        : activeBalances!.map((b, i) => <BalanceRow key={i} balance={b} />)}
    </div>
  );
}

function getQueueEntryStatus(entry: SharedProviderFailoverQueueEntry): {
  label: string;
  note: string;
  tone: StatusTone;
} {
  if (entry.active) {
    return {
      label: "ACTIVE",
      note: "Serving traffic",
      tone: "success",
    };
  }

  if (entry.health.observed && !entry.health.healthy) {
    const failures = entry.health.consecutiveFailures;

    return {
      label: "SKIPPED",
      note:
        failures > 0
          ? `Skipped · ${failures} failure${failures === 1 ? "" : "s"}`
          : "Skipped by health check",
      tone: failures > 1 ? "fail" : "accent",
    };
  }

  return {
    label: "STANDBY",
    note: `Standby · ${entry.health.consecutiveFailures} retries used`,
    tone: "neutral",
  };
}

function getQueueHeadLabel(queue: SharedProviderFailoverQueueEntry[]): string {
  if (queue.length === 0) {
    return "—";
  }

  const activeIndex = queue.findIndex((entry) => entry.active);
  const headIndex = activeIndex >= 0 ? activeIndex : 0;

  return `${headIndex + 1} of ${queue.length}`;
}

interface FailoverQueueRowProps {
  appId: SharedProviderAppId;
  entry: SharedProviderFailoverQueueEntry;
  index: number;
  provider: SharedProviderView | null;
  dragDisabled: boolean;
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
  setNodeRef,
  style,
  isDragging = false,
  dragAttributes,
  dragListeners,
}: FailoverQueueRowProps) {
  const providerName = entry.providerName || entry.providerId;
  const status = getQueueEntryStatus(entry);

  return (
    <div
      ref={setNodeRef}
      className="owt-app-card__queue-row"
      data-dragging={isDragging ? "true" : "false"}
      data-state={entry.active ? "active" : status.label.toLowerCase()}
      style={style}
    >
      <button
        type="button"
        className="owt-app-card__queue-drag"
        disabled={dragDisabled}
        title={
          dragDisabled
            ? "Queue order is updating"
            : `Drag to reorder ${providerName}`
        }
        {...dragAttributes}
        {...dragListeners}
        aria-label={`Reorder ${providerName}`}
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
}: {
  appId: SharedProviderAppId;
  entry: SharedProviderFailoverQueueEntry;
  index: number;
  provider: SharedProviderView | null;
  dragDisabled: boolean;
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
  onReorder,
}: {
  appId: SharedProviderAppId;
  failoverState: SharedProviderFailoverState | null;
  providerState: SharedProviderState | null;
  autoFailoverEnabled: boolean;
  reorderPending: boolean;
  onReorder?: (providerIds: string[]) => void;
}) {
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
        No providers in failover queue
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
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="owt-app-card__failover-foot">
        <span>
          Auto-failover {autoFailoverEnabled ? "on" : "off"} · max{" "}
          {failoverState?.maxRetries ?? 0} retries
        </span>
        <span>
          Head: {reorderPending ? "Updating" : getQueueHeadLabel(queue)}
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
  failoverReorderPending?: boolean;
  onOpenActivity: (appId: SharedProviderAppId) => void;
  onOpenProviderPanel: (appId: SharedProviderAppId) => void;
  onSetAutoFailover?: (appId: SharedProviderAppId, enabled: boolean) => void;
  onReorderFailoverQueue?: (
    appId: SharedProviderAppId,
    providerIds: string[],
  ) => void;
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
  failoverReorderPending = false,
  onOpenActivity,
  onOpenProviderPanel,
  onSetAutoFailover,
  onReorderFailoverQueue,
}: AppCardProps) {
  const appCopy = APP_COPY[appId];
  const isInert = isInertHomeAppId(appId);
  const providerCount = providerState?.providers.length ?? 0;
  const activeProvider = providerState?.activeProvider.configured
    ? providerState.activeProvider
    : null;
  const appIconUrl = getOpenWrtAppIconUrl(appId);
  const autoFailoverEnabled =
    optimisticAutoFailoverEnabled ??
    failoverState?.autoFailoverEnabled ??
    false;
  const runMode: RunMode = autoFailoverEnabled ? "failover" : "normal";
  const canChangeRunMode =
    !isInert &&
    Boolean(activeProvider) &&
    Boolean(failoverState) &&
    typeof onSetAutoFailover === "function";

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
            ? `${appCopy.label} not configured`
            : `Add a ${appCopy.label} provider`
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
              {appCopy.label}
            </h3>
            <p className="owt-app-card__subtitle">{appCopy.subtitle ?? ""}</p>
          </div>
          <span className="owt-app-card__spacer" aria-hidden="true" />
          <span className="owt-chip owt-chip--dot">Not configured</span>
        </div>
        <div className="owt-app-card__empty-cta">
          <span>
            {isInert ? "Not supported yet" : "No provider configured yet"}
          </span>
          {!isInert && (
            <span className="owt-app-card__empty-cta-btn">
              Add a provider →
            </span>
          )}
        </div>
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
  const requestsValue = formatAdaptive(summary?.totalRequests ?? 0);
  const costValue = formatCostValue(summary?.totalCost);
  const handleRunModeClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    if (!canChangeRunMode || isInertHomeAppId(appId)) return;

    const nextMode = event.currentTarget.dataset.mode as RunMode | undefined;
    if (!nextMode || nextMode === runMode) return;

    onSetAutoFailover?.(appId, nextMode === "failover");
  };

  const handleCardClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (
      (event.target as HTMLElement).closest(
        "[data-owt-chip], [data-mode-toggle], [data-cost-info]",
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
          "[data-owt-chip], [data-mode-toggle], [data-cost-info]",
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
        <div className="owt-app-card__head-actions">
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
          {canChangeRunMode ? (
            <div
              className="owt-mode-toggle"
              role="tablist"
              aria-label={`${appCopy.label} routing mode`}
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
                      ? "Manually use the selected active provider"
                      : "Route through the ordered failover queue"
                  }
                >
                  <span className="owt-mode-toggle__dot" aria-hidden="true" />
                  {modeOption === "normal" ? "Normal" : "Failover"}
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
            onReorder={(providerIds) => {
              onReorderFailoverQueue?.(appId, providerIds);
            }}
          />
        ) : (
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
            {quotaSnapshot ? (
              <QuotaBand snapshot={quotaSnapshot} hideLabel />
            ) : null}
          </div>
        )}
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
          <div className="owt-app-card__usage-label">
            Cost
            <button
              type="button"
              className="owt-app-card__usage-info"
              data-cost-info="true"
              aria-label="About this cost number"
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <Info className="h-3 w-3" aria-hidden="true" />
              <span className="owt-app-card__usage-tip" role="tooltip">
                <strong>Estimated, not billed.</strong> This figure is computed
                from local request logs and public API prices. Actual charges
                come from each provider&apos;s billing dashboard.
              </span>
            </button>
          </div>
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
