import { Activity, Clock3, RotateCw, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  SharedRuntimeProxyStatus,
  SharedRuntimeServiceStatus,
} from "../domain";
import {
  formatSharedRuntimeCount,
  formatSharedRuntimeListenEndpoint,
  formatSharedRuntimePercent,
  formatSharedRuntimeUptime,
  hasSharedRuntimeLiveTelemetry,
  getSharedRuntimeStatusSourceDescription,
  getSharedRuntimeStatusSourceLabel,
} from "./presentation";
import { SharedRuntimeStatusChip } from "./SharedRuntimeStatusChip";

function RuntimeMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-default/70 bg-background/70 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function SharedRuntimeServiceSummaryCard({
  service,
  runtime,
}: {
  service: SharedRuntimeServiceStatus;
  runtime: SharedRuntimeProxyStatus;
}) {
  const hasLiveTelemetry = hasSharedRuntimeLiveTelemetry(service, runtime);
  const telemetrySourceLabel =
    service.statusSource === "live-status"
      ? "Live"
      : service.statusSource === "config-fallback"
        ? "Fallback"
        : getSharedRuntimeStatusSourceLabel(service.statusSource);

  return (
    <Card className="ccswitch-openwrt-surface-card rounded-3xl border-border-default bg-card/95 shadow-sm">
      <CardHeader className="space-y-4 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">Service Summary</CardTitle>
            <CardDescription className="max-w-2xl text-sm">
              {getSharedRuntimeStatusSourceDescription(service)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <SharedRuntimeStatusChip
              label={service.running ? "Running" : "Stopped"}
              tone={service.running ? "running" : "stopped"}
            />
            <SharedRuntimeStatusChip
              label={getSharedRuntimeStatusSourceLabel(service.statusSource)}
              tone={service.reachable ? "live" : "fallback"}
            />
          </div>
        </div>

        {service.statusError?.trim() ? (
          <div className="ccswitch-openwrt-inline-note ccswitch-openwrt-inline-note--warning rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Runtime detail: {service.statusError}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-4 p-5 pt-0 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="ccswitch-openwrt-group rounded-2xl border border-border-default bg-background/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Service endpoint
          </p>
          <p className="mt-2 text-lg font-semibold text-foreground">
            {formatSharedRuntimeListenEndpoint(service)}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Proxy mode
              </dt>
              <dd className="mt-2 text-sm font-medium text-foreground">
                {service.proxyEnabled ? "Proxy enabled" : "Proxy disabled"}
              </dd>
            </div>
            <div className="rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3">
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Telemetry source
              </dt>
              <dd className="mt-2 text-sm font-medium text-foreground">
                {telemetrySourceLabel}
              </dd>
            </div>
          </dl>
        </div>
        {hasLiveTelemetry ? (
          <div className="rounded-2xl border border-border-default bg-background/80 p-4">
            <div className="mb-3 space-y-1">
              <p className="text-sm font-medium text-foreground">
                Live telemetry
              </p>
              <p className="text-sm text-muted-foreground">
                Current daemon activity and failover health for this router.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <RuntimeMetric
                label="Active connections"
                value={formatSharedRuntimeCount(runtime.activeConnections)}
                icon={<Activity className="h-4 w-4" />}
              />
              <RuntimeMetric
                label="Total requests"
                value={formatSharedRuntimeCount(runtime.totalRequests)}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <RuntimeMetric
                label="Success rate"
                value={formatSharedRuntimePercent(runtime.successRate)}
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <RuntimeMetric
                label="Failover count"
                value={formatSharedRuntimeCount(runtime.failoverCount)}
                icon={<RotateCw className="h-4 w-4" />}
              />
              <div className="sm:col-span-2">
                <RuntimeMetric
                  label="Uptime"
                  value={formatSharedRuntimeUptime(runtime.uptimeSeconds)}
                  icon={<Clock3 className="h-4 w-4" />}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="ccswitch-openwrt-state-shell rounded-2xl border border-dashed border-border-default bg-muted/15 p-4 text-sm text-muted-foreground">
            Live telemetry is unavailable while this view is showing config or
            unreachable fallback state.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
