import { type ReactNode, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock3, ListOrdered, Loader2, Power, RefreshCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  RuntimeSurfacePlatformAdapter,
  SharedRuntimeAppView,
  SharedRuntimeProviderHealth,
  SharedRuntimeQueueEntry,
} from "./domain";
import { normalizeSharedRuntimeState } from "./domain";
import {
  formatSharedRuntimeListenTarget,
  formatSharedRuntimeNumber,
  formatSharedRuntimePercentage,
  formatSharedRuntimeUptime,
  getSharedRuntimeAppLabel,
  getSharedRuntimeDisplayName,
  getSharedRuntimeHealthPresentation,
  getSharedRuntimeSourceLabel,
  getSortedSharedRuntimeQueue,
  SHARED_RUNTIME_APP_PRESENTATION,
} from "./ui";
import {
  SharedRuntimeErrorState,
  SharedRuntimeLoadingState,
} from "./ui";

const RUNTIME_QUERY_KEY = ["shared-runtime-surface"] as const;

export interface SharedRuntimeSurfaceProps {
  adapter: RuntimeSurfacePlatformAdapter;
  className?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown runtime error.";
}

function StatusBadge({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full border px-3 py-1 text-xs font-medium", className)}
    >
      {children}
    </Badge>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-background/80 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function HealthBadge({
  health,
}: {
  health: SharedRuntimeProviderHealth | null | undefined;
}) {
  const presentation = getSharedRuntimeHealthPresentation(health);

  return (
    <Badge
      variant="outline"
      className={cn("rounded-full border px-2.5 py-1 text-xs", presentation.className)}
    >
      {presentation.label}
    </Badge>
  );
}

function QueueEntryRow({
  entry,
  fallbackOrder,
}: {
  entry: SharedRuntimeQueueEntry;
  fallbackOrder: number;
}) {
  const health = getSharedRuntimeHealthPresentation(entry.health);
  const queueOrder = entry.sortIndex ?? fallbackOrder;

  return (
    <li className="rounded-2xl border border-border-default bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-full border-border-default bg-muted/40 px-2.5 py-1 text-xs"
            >
              P{queueOrder}
            </Badge>
            <p className="font-medium">{entry.providerName || entry.providerId}</p>
            {entry.active ? (
              <Badge
                variant="outline"
                className="rounded-full border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300"
              >
                Active provider
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Provider ID: {entry.providerId}</p>
        </div>
        <Badge
          variant="outline"
          className={cn("rounded-full border px-2.5 py-1 text-xs", health.className)}
        >
          {health.label}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{health.description}</p>
    </li>
  );
}

function ServiceSummaryCard({
  running,
  reachable,
  listenAddress,
  listenPort,
  proxyEnabled,
  statusSource,
  statusError,
  activeConnections,
  totalRequests,
  successRate,
  failoverCount,
  uptimeSeconds,
}: {
  running: boolean;
  reachable: boolean;
  listenAddress: string;
  listenPort: number | null;
  proxyEnabled: boolean;
  statusSource: string;
  statusError: string | null;
  activeConnections: number | null;
  totalRequests: number | null;
  successRate: number | null;
  failoverCount: number | null;
  uptimeSeconds: number | null;
}) {
  return (
    <Card
      className={cn(
        "h-full rounded-3xl border-border-default bg-card/95",
        !reachable && "border-amber-500/30 bg-amber-500/[0.03]",
      )}
    >
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">Service summary</CardTitle>
            <CardDescription>
              Live-vs-fallback runtime status for the OpenWrt proxy service.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              className={
                running
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
              }
            >
              {running ? "Running" : "Stopped"}
            </StatusBadge>
            <StatusBadge
              className={
                reachable
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }
            >
              {reachable ? "Daemon reachable" : "Daemon unreachable"}
            </StatusBadge>
            <StatusBadge
              className={
                statusSource === "live-status"
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }
            >
              {getSharedRuntimeSourceLabel(statusSource)}
            </StatusBadge>
            <StatusBadge
              className={
                proxyEnabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
              }
            >
              {proxyEnabled ? "Proxy enabled" : "Proxy disabled"}
            </StatusBadge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusError ? (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <AlertTitle>Fallback reason</AlertTitle>
            <AlertDescription>{statusError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricTile
            icon={<Power className="h-4 w-4" />}
            label="Listen target"
            value={formatSharedRuntimeListenTarget(listenAddress, listenPort)}
          />
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label="Active connections"
            value={formatSharedRuntimeNumber(activeConnections)}
          />
          <MetricTile
            icon={<ListOrdered className="h-4 w-4" />}
            label="Request totals"
            value={formatSharedRuntimeNumber(totalRequests)}
          />
          <MetricTile
            icon={<RefreshCcw className="h-4 w-4" />}
            label="Success rate"
            value={formatSharedRuntimePercentage(successRate)}
          />
          <MetricTile
            icon={<ListOrdered className="h-4 w-4" />}
            label="Failover count"
            value={formatSharedRuntimeNumber(failoverCount)}
          />
          <MetricTile
            icon={<Clock3 className="h-4 w-4" />}
            label="Uptime"
            value={formatSharedRuntimeUptime(uptimeSeconds)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AppRuntimeCard({ app }: { app: SharedRuntimeAppView }) {
  const appPresentation = SHARED_RUNTIME_APP_PRESENTATION[app.appId];
  const healthPresentation = getSharedRuntimeHealthPresentation(
    app.activeProviderHealth,
  );
  const queueEntries = getSortedSharedRuntimeQueue(app.failoverQueue);
  const activeProviderName = app.activeProvider.configured
    ? getSharedRuntimeDisplayName(app.activeProvider)
    : "No active provider";

  return (
    <Card
      role="article"
      aria-label={`${getSharedRuntimeAppLabel(app.appId)} runtime card`}
      className={cn(
        "h-full rounded-3xl border-border-default bg-card/95",
        app.activeProvider.active && appPresentation.activeCardClassName,
      )}
    >
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                appPresentation.accentClassName,
              )}
            >
              {appPresentation.label}
            </Badge>
            <div>
              <CardTitle className="text-xl">{activeProviderName}</CardTitle>
              <CardDescription>
                {app.activeProvider.providerId
                  ? `Provider ID: ${app.activeProvider.providerId}`
                  : "No active provider is configured yet."}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge
              className={
                app.proxyEnabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
              }
            >
              {app.proxyEnabled ? "Proxy enabled" : "Proxy disabled"}
            </StatusBadge>
            <StatusBadge
              className={
                app.autoFailoverEnabled
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
              }
            >
              {app.autoFailoverEnabled
                ? "Auto-failover enabled"
                : "Auto-failover disabled"}
            </StatusBadge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            icon={<ListOrdered className="h-4 w-4" />}
            label="Provider count"
            value={formatSharedRuntimeNumber(app.providerCount)}
          />
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label="Observed"
            value={formatSharedRuntimeNumber(app.observedProviderCount)}
          />
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label="Healthy / Unhealthy"
            value={`${formatSharedRuntimeNumber(app.healthyProviderCount)} / ${formatSharedRuntimeNumber(app.unhealthyProviderCount)}`}
          />
          <MetricTile
            icon={<ListOrdered className="h-4 w-4" />}
            label="Queue depth"
            value={formatSharedRuntimeNumber(app.failoverQueueDepth)}
          />
        </div>

        <div className="rounded-2xl border border-border-default bg-background/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Active provider health</p>
              <p className="text-sm text-muted-foreground">
                {healthPresentation.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <HealthBadge health={app.activeProviderHealth} />
              {app.usingLegacyDefault ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300"
                >
                  Legacy default
                </Badge>
              ) : null}
              {app.maxRetries > 0 ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-border-default bg-muted/40 px-2.5 py-1 text-xs"
                >
                  Max retries: {app.maxRetries}
                </Badge>
              ) : null}
            </div>
          </div>
          {app.activeProvider.model ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Model: {app.activeProvider.model}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Failover queue preview</p>
              <p className="text-sm text-muted-foreground">
                Read-only queue ordering and provider health for {appPresentation.label}.
              </p>
            </div>
            <Badge
              variant="outline"
              className="rounded-full border-border-default bg-muted/40 px-2.5 py-1 text-xs"
            >
              Queue depth: {app.failoverQueueDepth}
            </Badge>
          </div>
          {queueEntries.length > 0 ? (
            <ol className="space-y-3">
              {queueEntries.map((entry, index) => (
                <QueueEntryRow
                  key={`${entry.providerId}-${entry.sortIndex ?? index}`}
                  entry={entry}
                  fallbackOrder={index + 1}
                />
              ))}
            </ol>
          ) : (
            <div className="rounded-2xl border border-dashed border-border-default bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              No providers are queued for failover right now.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SharedRuntimeSurface({
  adapter,
  className,
}: SharedRuntimeSurfaceProps) {
  const query = useQuery({
    queryKey: RUNTIME_QUERY_KEY,
    queryFn: () => adapter.getRuntimeState(),
  });
  const adapterRef = useRef(adapter);

  useEffect(() => {
    if (adapterRef.current === adapter) {
      return;
    }

    adapterRef.current = adapter;
    void query.refetch();
  }, [adapter, query]);

  if (query.isPending && !query.data) {
    return <SharedRuntimeLoadingState />;
  }

  if (query.isError && !query.data) {
    return (
      <SharedRuntimeErrorState
        message={getErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const runtimeState = normalizeSharedRuntimeState(query.data!);
  const refreshError =
    query.isError && query.data ? getErrorMessage(query.error) : null;

  return (
    <section className={cn("space-y-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Runtime status</h2>
          <p className="text-sm text-muted-foreground">
            Shared read-only runtime surface for service health, failover, and active routing.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
          disabled={query.isFetching}
        >
          {query.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Refresh status
        </Button>
      </div>

      {refreshError ? (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <AlertTitle>Latest refresh failed</AlertTitle>
          <AlertDescription>{refreshError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
        <ServiceSummaryCard {...runtimeState.service} />
        {runtimeState.apps.map((app) => (
          <AppRuntimeCard key={app.appId} app={app} />
        ))}
      </div>
    </section>
  );
}
