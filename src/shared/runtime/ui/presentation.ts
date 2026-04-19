import type {
  SharedRuntimeProxyStatus,
  SharedRuntimeAppId,
  SharedRuntimeFailoverQueueEntry,
  SharedRuntimeProviderHealth,
  SharedRuntimeServiceStatus,
} from "../domain";

export type SharedRuntimeChipTone =
  | "running"
  | "stopped"
  | "live"
  | "fallback"
  | "enabled"
  | "disabled"
  | "healthy"
  | "unhealthy"
  | "unknown"
  | "active"
  | "neutral";

export const SHARED_RUNTIME_APP_PRESENTATION: Record<
  SharedRuntimeAppId,
  {
    label: string;
    accentClassName: string;
    panelClassName: string;
    mutedPanelClassName: string;
  }
> = {
  claude: {
    label: "Claude",
    accentClassName:
      "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    panelClassName:
      "border-orange-500/25 bg-gradient-to-br from-orange-500/[0.12] via-background to-background",
    mutedPanelClassName:
      "border-orange-500/15 bg-orange-500/[0.06] text-orange-700 dark:text-orange-200",
  },
  codex: {
    label: "Codex",
    accentClassName:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    panelClassName:
      "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.12] via-background to-background",
    mutedPanelClassName:
      "border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-200",
  },
  gemini: {
    label: "Gemini",
    accentClassName:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    panelClassName:
      "border-blue-500/25 bg-gradient-to-br from-blue-500/[0.12] via-background to-background",
    mutedPanelClassName:
      "border-blue-500/15 bg-blue-500/[0.06] text-blue-700 dark:text-blue-200",
  },
};

export const SHARED_RUNTIME_CHIP_CLASSNAMES: Record<
  SharedRuntimeChipTone,
  string
> = {
  running:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  stopped:
    "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  live: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  fallback:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  enabled:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  disabled:
    "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  healthy:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unhealthy:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  unknown:
    "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  active:
    "border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15",
  neutral: "border-border-default bg-muted/30 text-muted-foreground",
};

function titleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSharedRuntimeStatusSourceLabel(statusSource: string): string {
  if (statusSource === "live-status") {
    return "Live daemon status";
  }

  if (statusSource === "config-fallback") {
    return "Config fallback";
  }

  return titleCaseWords(statusSource || "unknown");
}

export function getSharedRuntimeStatusSourceDescription(
  service: SharedRuntimeServiceStatus,
): string {
  if (service.statusSource === "live-status" && service.reachable) {
    return "Showing live daemon status from the running proxy service.";
  }

  if (service.statusSource === "config-fallback") {
    return service.statusError
      ? "The daemon could not be reached. Showing saved OpenWrt configuration and failover context instead."
      : "Live daemon status is unavailable. Showing saved OpenWrt configuration instead.";
  }

  if (!service.reachable) {
    return "Runtime status is currently unreachable. Showing the latest available state.";
  }

  return "Showing the latest runtime state reported by the OpenWrt backend.";
}

export function hasSharedRuntimeLiveTelemetry(
  service: SharedRuntimeServiceStatus,
  _runtime: SharedRuntimeProxyStatus,
): boolean {
  return service.statusSource === "live-status" && service.reachable;
}

export function getSharedRuntimeHealthTone(
  health: SharedRuntimeProviderHealth | null | undefined,
): SharedRuntimeChipTone {
  if (!health?.observed) {
    return "unknown";
  }

  return health.healthy ? "healthy" : "unhealthy";
}

export function getSharedRuntimeHealthLabel(
  health: SharedRuntimeProviderHealth | null | undefined,
): string {
  const tone = getSharedRuntimeHealthTone(health);

  if (tone === "healthy") {
    return "Healthy";
  }

  if (tone === "unhealthy") {
    return "Unhealthy";
  }

  return "Unknown";
}

export function getSharedRuntimeActiveProviderLabel({
  providerName,
  providerId,
}: {
  providerName?: string | null;
  providerId?: string | null;
}): string {
  return providerName?.trim() || providerId?.trim() || "No active provider";
}

export function formatSharedRuntimeCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

export function formatSharedRuntimePercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}

export function formatSharedRuntimeUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const wholeSeconds = Math.floor(seconds);
  const days = Math.floor(wholeSeconds / 86_400);
  const hours = Math.floor((wholeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainderSeconds = wholeSeconds % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${remainderSeconds}s`);

  return parts.join(" ");
}

export function formatSharedRuntimeListenEndpoint(
  service: SharedRuntimeServiceStatus,
): string {
  const host = service.listenAddress?.trim() || "—";
  const port = Number.isFinite(service.listenPort) ? service.listenPort : "—";
  return `${host}:${port}`;
}

export function sortSharedRuntimeFailoverQueue(
  queue: SharedRuntimeFailoverQueueEntry[],
): SharedRuntimeFailoverQueueEntry[] {
  return queue
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftSort = left.entry.sortIndex ?? Number.MAX_SAFE_INTEGER;
      const rightSort = right.entry.sortIndex ?? Number.MAX_SAFE_INTEGER;

      if (leftSort !== rightSort) {
        return leftSort - rightSort;
      }

      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}
