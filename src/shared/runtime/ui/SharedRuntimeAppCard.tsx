import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SharedRuntimeAppStatus } from "../domain";
import {
  SHARED_RUNTIME_APP_PRESENTATION,
  formatSharedRuntimeCount,
  getSharedRuntimeActiveProviderLabel,
} from "./presentation";
import { SharedRuntimeFailoverQueuePreview } from "./SharedRuntimeFailoverQueuePreview";
import { SharedRuntimeHealthBadge } from "./SharedRuntimeHealthBadge";
import { SharedRuntimeStatusChip } from "./SharedRuntimeStatusChip";

function AppStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-background/70 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function SharedRuntimeAppCard({
  status,
}: {
  status: SharedRuntimeAppStatus;
}) {
  const appPresentation = SHARED_RUNTIME_APP_PRESENTATION[status.app];
  const activeProviderLabel = getSharedRuntimeActiveProviderLabel({
    providerName: status.activeProvider.name,
    providerId: status.activeProviderId,
  });

  return (
    <Card
      className={cn(
        "rounded-3xl border shadow-sm",
        appPresentation.panelClassName,
      )}
    >
      <CardHeader className="space-y-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  appPresentation.accentClassName,
                )}
              >
                {appPresentation.label}
              </span>
              <SharedRuntimeStatusChip
                label={status.proxyEnabled ? "Proxy enabled" : "Proxy disabled"}
                tone={status.proxyEnabled ? "enabled" : "disabled"}
              />
              <SharedRuntimeStatusChip
                label={
                  status.autoFailoverEnabled
                    ? "Auto-failover enabled"
                    : "Auto-failover disabled"
                }
                tone={status.autoFailoverEnabled ? "enabled" : "disabled"}
              />
              <SharedRuntimeStatusChip label="Read only" tone="neutral" />
              {status.usingLegacyDefault ? (
                <SharedRuntimeStatusChip
                  label="Legacy default slot"
                  tone="fallback"
                />
              ) : null}
            </div>

            <div className="space-y-1">
              <CardTitle className="text-lg">{activeProviderLabel}</CardTitle>
              <CardDescription className="text-sm">
                {status.activeProviderId
                  ? `Active provider ID: ${status.activeProviderId}`
                  : "No active provider ID reported yet."}
              </CardDescription>
            </div>
          </div>

          <div
            className={cn(
              "rounded-2xl border px-4 py-3 text-sm",
              appPresentation.mutedPanelClassName,
            )}
          >
            <p className="text-xs uppercase tracking-wide opacity-80">
              Active provider health
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SharedRuntimeHealthBadge health={status.activeProviderHealth} />
              {status.activeProviderHealth?.observed ? (
                <span>
                  {status.activeProviderHealth.consecutiveFailures} consecutive
                  failures
                </span>
              ) : (
                <span>No live observation reported yet.</span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5 pt-0">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <AppStat
            label="Providers"
            value={formatSharedRuntimeCount(status.providerCount)}
          />
          <AppStat
            label="Observed"
            value={formatSharedRuntimeCount(status.observedProviderCount)}
          />
          <AppStat
            label="Healthy"
            value={formatSharedRuntimeCount(status.healthyProviderCount)}
          />
          <AppStat
            label="Unhealthy"
            value={formatSharedRuntimeCount(status.unhealthyProviderCount)}
          />
          <AppStat
            label="Queue depth"
            value={formatSharedRuntimeCount(status.failoverQueueDepth)}
          />
          <AppStat
            label="Max retries"
            value={formatSharedRuntimeCount(status.maxRetries)}
          />
        </div>

        <div className="rounded-2xl border border-border-default bg-background/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Failover queue preview</p>
              <p className="text-sm text-muted-foreground">
                Read-only queue order and health for the next available
                providers.
              </p>
            </div>
            <SharedRuntimeStatusChip
              label={`${formatSharedRuntimeCount(status.failoverQueueDepth)} queued`}
              tone="neutral"
            />
          </div>

          <SharedRuntimeFailoverQueuePreview
            queue={status.failoverQueue}
            className="mt-4"
          />
        </div>
      </CardContent>
    </Card>
  );
}
