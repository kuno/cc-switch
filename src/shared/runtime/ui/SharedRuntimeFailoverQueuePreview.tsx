import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SharedRuntimeFailoverQueueEntry } from "../domain";
import {
  getSharedRuntimeActiveProviderLabel,
  sortSharedRuntimeFailoverQueue,
} from "./presentation";
import { SharedRuntimeHealthBadge } from "./SharedRuntimeHealthBadge";
import { SharedRuntimeStatusChip } from "./SharedRuntimeStatusChip";

export function SharedRuntimeFailoverQueuePreview({
  queue,
  maxVisible,
  emptyLabel = "No failover providers queued.",
  className,
  renderEntryActions,
}: {
  queue: SharedRuntimeFailoverQueueEntry[];
  maxVisible?: number;
  emptyLabel?: string;
  className?: string;
  renderEntryActions?: (
    entry: SharedRuntimeFailoverQueueEntry,
    index: number,
  ) => ReactNode;
}) {
  const orderedQueue = sortSharedRuntimeFailoverQueue(queue);
  const visibleQueue =
    typeof maxVisible === "number"
      ? orderedQueue.slice(0, Math.max(maxVisible, 0))
      : orderedQueue;
  const remainingCount = orderedQueue.length - visibleQueue.length;

  if (orderedQueue.length === 0) {
    return (
      <div
        className={cn(
          "ccswitch-openwrt-state-shell rounded-2xl border border-dashed border-border-default bg-muted/15 px-4 py-3 text-sm text-muted-foreground",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {visibleQueue.map((entry, index) => (
        <div
          key={`${entry.providerId}-${entry.sortIndex ?? index}`}
          className="ccswitch-openwrt-group ccswitch-openwrt-group--raised rounded-2xl border border-border-default bg-background/80 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  #{index + 1}
                </span>
                <p className="font-medium">
                  {getSharedRuntimeActiveProviderLabel({
                    providerName: entry.providerName,
                    providerId: entry.providerId,
                  })}
                </p>
                {entry.active ? (
                  <SharedRuntimeStatusChip
                    label="Active provider"
                    tone="active"
                  />
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {entry.providerId}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <SharedRuntimeHealthBadge health={entry.health} />
              {renderEntryActions ? renderEntryActions(entry, index) : null}
            </div>
          </div>

          {entry.health.observed ? (
            <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p>Consecutive failures: {entry.health.consecutiveFailures}</p>
              <p>
                Last error:{" "}
                {entry.health.lastError?.trim()
                  ? entry.health.lastError
                  : "None reported"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No live health observation reported for this queue entry yet.
            </p>
          )}
        </div>
      ))}

      {remainingCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          +{remainingCount} more queued
        </p>
      ) : null}
    </div>
  );
}
