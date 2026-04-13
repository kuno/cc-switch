import type { SharedProviderAppId } from "@/shared/providers/domain";
import { SHARED_PROVIDER_APP_PRESENTATION } from "@/shared/providers/ui";
import type {
  SharedRuntimeProviderHealth,
  SharedRuntimeProviderSummary,
  SharedRuntimeQueueEntry,
} from "../domain";

export const SHARED_RUNTIME_APP_PRESENTATION = SHARED_PROVIDER_APP_PRESENTATION;

export function getSharedRuntimeDisplayName(
  provider: Pick<SharedRuntimeProviderSummary, "name" | "providerId">,
): string {
  return provider.name.trim() || provider.providerId || "Unavailable";
}

export function getSharedRuntimeAppLabel(appId: SharedProviderAppId): string {
  return SHARED_RUNTIME_APP_PRESENTATION[appId].label;
}

export function getSharedRuntimeSourceLabel(source: string): string {
  if (source === "live-status") {
    return "Live daemon status";
  }

  if (source === "config-fallback") {
    return "Config fallback";
  }

  return source
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((token) => token[0].toUpperCase() + token.slice(1))
    .join(" ");
}

export function formatSharedRuntimeListenTarget(
  address: string,
  port: number | null,
): string {
  if (!address && port == null) {
    return "Unavailable";
  }

  if (port == null) {
    return address || "Unavailable";
  }

  return `${address}:${port}`;
}

export function formatSharedRuntimeNumber(value: number | null): string {
  if (value == null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US").format(value);
}

export function formatSharedRuntimePercentage(value: number | null): string {
  if (value == null) {
    return "Unavailable";
  }

  return `${value.toFixed(1)}%`;
}

export function formatSharedRuntimeUptime(value: number | null): string {
  if (value == null) {
    return "Unavailable";
  }

  const totalSeconds = Math.max(0, value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function getSortedSharedRuntimeQueue(
  entries: SharedRuntimeQueueEntry[],
): SharedRuntimeQueueEntry[] {
  return [...entries].sort((left, right) => {
    if (left.sortIndex == null && right.sortIndex == null) {
      return 0;
    }

    if (left.sortIndex == null) {
      return 1;
    }

    if (right.sortIndex == null) {
      return -1;
    }

    return left.sortIndex - right.sortIndex;
  });
}

export function getSharedRuntimeHealthPresentation(
  health: SharedRuntimeProviderHealth | null | undefined,
): {
  label: string;
  className: string;
  description: string;
} {
  if (!health) {
    return {
      label: "Unavailable",
      className:
        "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      description: "The runtime adapter did not return a health snapshot.",
    };
  }

  if (!health.observed) {
    return {
      label: "Unknown",
      className:
        "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
      description: "No health observation has been recorded yet.",
    };
  }

  if (health.healthy) {
    return {
      label: "Healthy",
      className:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      description:
        health.lastSuccessAt != null
          ? `Observed healthy. Last success at ${health.lastSuccessAt}.`
          : "Observed healthy on the latest runtime check.",
    };
  }

  return {
    label: "Unhealthy",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    description:
      health.lastError?.trim() ||
      `Observed unhealthy after ${health.consecutiveFailures} consecutive failures.`,
  };
}
