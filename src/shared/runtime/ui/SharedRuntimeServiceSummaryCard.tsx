import { Activity, Clock3, RotateCw, Router, TrendingUp } from "lucide-react";
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
    <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default bg-background/80 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
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

  return (
    <Card className="ccswitch-openwrt-surface-card rounded-3xl border-border-default bg-card/95 shadow-sm">
      <CardHeader className="space-y-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
            <SharedRuntimeStatusChip
              label={`Proxy ${service.proxyEnabled ? "enabled" : "disabled"}`}
              tone={service.proxyEnabled ? "enabled" : "disabled"}
            />
          </div>
        </div>

        {service.statusError?.trim() ? (
          <div className="ccswitch-openwrt-inline-note ccswitch-openwrt-inline-note--warning rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Runtime detail: {service.statusError}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-3 p-5 pt-0 sm:grid-cols-2 xl:grid-cols-3">
        <RuntimeMetric
          label="Listen endpoint"
          value={formatSharedRuntimeListenEndpoint(service)}
          icon={<Router className="h-4 w-4" />}
        />
        {hasLiveTelemetry ? (
          <>
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
            <RuntimeMetric
              label="Uptime"
              value={formatSharedRuntimeUptime(runtime.uptimeSeconds)}
              icon={<Clock3 className="h-4 w-4" />}
            />
          </>
        ) : (
          <div className="ccswitch-openwrt-state-shell rounded-2xl border border-dashed border-border-default bg-muted/15 p-4 text-sm text-muted-foreground sm:col-span-1 xl:col-span-2">
            Live telemetry is unavailable while this view is showing config or
            unreachable fallback state.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
