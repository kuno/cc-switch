import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { emptySharedProviderView } from "@/shared/providers/domain";
import type { SharedRuntimeAppId, SharedRuntimeAppStatus } from "./domain";
import {
  supportsRuntimeFailoverControls,
  type RuntimeSurfacePlatformAdapter,
} from "./types";
import {
  SharedRuntimeAppCard,
  SharedRuntimeEmptyState,
  SharedRuntimeErrorState,
  SharedRuntimeInlineNote,
  SharedRuntimeLoadingState,
  SharedRuntimeServiceSummaryCard,
} from "./ui";

const RUNTIME_QUERY_KEY = ["shared-runtime-surface"] as const;
const RUNTIME_APP_ORDER = [
  "claude",
  "codex",
  "gemini",
] as const satisfies readonly SharedRuntimeAppId[];

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

function createEmptyAppStatus(
  appId: SharedRuntimeAppId,
): SharedRuntimeAppStatus {
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
  const failoverControls = supportsRuntimeFailoverControls(adapter)
    ? adapter
    : undefined;
  const refreshError =
    runtimeQuery.isError && runtimeQuery.data
      ? getErrorMessage(runtimeQuery.error)
      : null;

  async function refreshRuntimeSurface() {
    const result = await runtimeQuery.refetch();
    if (result.error) {
      throw result.error;
    }
  }

  return (
    <section
      data-ccswitch-region="runtime-surface"
      data-ccswitch-layout="embedded-stack"
      aria-busy={runtimeQuery.isFetching}
      className={cn(
        "ccswitch-openwrt-page-section ccswitch-openwrt-page-section--runtime space-y-5",
        className,
      )}
    >
      <div
        data-ccswitch-region="runtime-header"
        data-ccswitch-layout="stack-to-row"
        className="ccswitch-openwrt-page-header flex flex-col gap-3"
      >
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Runtime Surface
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {failoverControls
              ? "Shared runtime composition for service status, app health, and bounded failover controls."
              : "Shared read-only runtime composition for service status, app health, and failover queue previews."}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ccswitch-openwrt-page-action"
          aria-busy={runtimeQuery.isFetching}
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

      <div
        data-ccswitch-region="runtime-body"
        data-ccswitch-layout="embedded-stack"
        className="space-y-3"
      >
        <div data-ccswitch-region="runtime-summary">
          <SharedRuntimeServiceSummaryCard
            service={runtimeSurface.service}
            runtime={runtimeSurface.runtime}
          />
        </div>

        <div
          data-ccswitch-region="runtime-app-grid"
          data-ccswitch-layout="responsive-grid"
          className="grid gap-3"
        >
          {orderedApps.map((status) => (
            <SharedRuntimeAppCard
              key={status.app}
              status={status}
              failoverControls={failoverControls}
              onRefresh={failoverControls ? refreshRuntimeSurface : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
