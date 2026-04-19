import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { emptySharedProviderView } from "@/shared/providers/domain";
import type {
  SharedRuntimeAppId,
  SharedRuntimeAppStatus,
  SharedRuntimeStatusView,
} from "./domain";
import {
  SharedRuntimeAppCard,
  SharedRuntimeEmptyState,
  SharedRuntimeErrorState,
  SharedRuntimeInlineNote,
  SharedRuntimeLoadingState,
  SharedRuntimeServiceSummaryCard,
} from "./ui";

const RUNTIME_QUERY_KEY = ["shared-runtime-surface"] as const;
const RUNTIME_APP_ORDER = ["claude", "codex", "gemini"] as const satisfies
  readonly SharedRuntimeAppId[];

export interface RuntimeSurfacePlatformAdapter {
  getRuntimeSurface(): Promise<SharedRuntimeStatusView>;
}

export interface SharedRuntimeSurfaceProps {
  adapter: RuntimeSurfacePlatformAdapter;
  className?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load runtime status.";
}

function createEmptyAppStatus(appId: SharedRuntimeAppId): SharedRuntimeAppStatus {
  return {
    app: appId,
    providerCount: 0,
    proxyEnabled: false,
    autoFailoverEnabled: false,
    maxRetries: 0,
    activeProviderId: null,
    activeProvider: emptySharedProviderView(appId),
    activeProviderHealth: null,
    usingLegacyDefault: false,
    failoverQueueDepth: 0,
    failoverQueue: [],
    observedProviderCount: 0,
    healthyProviderCount: 0,
    unhealthyProviderCount: 0,
  };
}

function normalizeAppStatuses(
  statuses: SharedRuntimeAppStatus[],
): SharedRuntimeAppStatus[] {
  const statusByApp = new Map(statuses.map((status) => [status.app, status]));

  return RUNTIME_APP_ORDER.map(
    (appId) => statusByApp.get(appId) ?? createEmptyAppStatus(appId),
  );
}

export function SharedRuntimeSurface({
  adapter,
  className,
}: SharedRuntimeSurfaceProps) {
  const adapterRef = useRef(adapter);
  const runtimeQuery = useQuery({
    queryKey: RUNTIME_QUERY_KEY,
    queryFn: () => adapterRef.current.getRuntimeSurface(),
  });

  useEffect(() => {
    if (adapterRef.current === adapter) {
      return;
    }

    adapterRef.current = adapter;
    void runtimeQuery.refetch();
  }, [adapter, runtimeQuery.refetch]);

  if (runtimeQuery.isPending && !runtimeQuery.data) {
    return <SharedRuntimeLoadingState />;
  }

  if (runtimeQuery.isError && !runtimeQuery.data) {
    return (
      <SharedRuntimeErrorState
        detail={getErrorMessage(runtimeQuery.error)}
        onRetry={() => {
          void runtimeQuery.refetch();
        }}
      />
    );
  }

  const runtimeSurface = runtimeQuery.data;

  if (!runtimeSurface) {
    return <SharedRuntimeEmptyState />;
  }

  const orderedApps = normalizeAppStatuses(runtimeSurface.apps);
  const refreshError =
    runtimeQuery.isError && runtimeQuery.data
      ? getErrorMessage(runtimeQuery.error)
      : null;

  return (
    <section className={cn("space-y-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Runtime Surface
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Shared read-only runtime composition for service status, app health,
            and failover queue previews.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void runtimeQuery.refetch();
          }}
          disabled={runtimeQuery.isFetching}
        >
          {runtimeQuery.isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Refresh status
        </Button>
      </div>

      {refreshError ? (
        <SharedRuntimeInlineNote
          title="Latest refresh failed"
          description={refreshError}
          tone="warning"
        />
      ) : null}

      <div className="space-y-4">
        <SharedRuntimeServiceSummaryCard
          service={runtimeSurface.service}
          runtime={runtimeSurface.runtime}
        />

        <div className="grid gap-4 xl:grid-cols-3">
          {orderedApps.map((status) => (
            <SharedRuntimeAppCard key={status.app} status={status} />
          ))}
        </div>
      </div>
    </section>
  );
}
