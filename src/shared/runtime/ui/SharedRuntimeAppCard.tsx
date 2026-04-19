import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  SharedRuntimeAppStatus,
  SharedRuntimeFailoverQueueEntry,
} from "../domain";
import type { RuntimeSurfaceFailoverControlAdapter } from "../types";
import {
  SHARED_RUNTIME_APP_PRESENTATION,
  formatSharedRuntimeCount,
  getSharedRuntimeActiveProviderLabel,
} from "./presentation";
import { SharedRuntimeFailoverQueuePreview } from "./SharedRuntimeFailoverQueuePreview";
import { SharedRuntimeHealthBadge } from "./SharedRuntimeHealthBadge";
import { SharedRuntimeInlineNote } from "./SharedRuntimeStates";
import { SharedRuntimeStatusChip } from "./SharedRuntimeStatusChip";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Runtime failover control request failed.";
}

function AppStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default bg-background/70 px-3 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function SharedRuntimeAppCard({
  status,
  failoverControls,
  onRefresh,
}: {
  status: SharedRuntimeAppStatus;
  failoverControls?: RuntimeSurfaceFailoverControlAdapter;
  onRefresh?: () => Promise<void>;
}) {
  const appPresentation = SHARED_RUNTIME_APP_PRESENTATION[status.app];
  const activeProviderLabel = getSharedRuntimeActiveProviderLabel({
    providerName: status.activeProvider.name,
    providerId: status.activeProviderId,
  });
  const controlsEnabled = Boolean(failoverControls && onRefresh);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const queueProviderIds = useMemo(
    () => new Set(status.failoverQueue.map((entry) => entry.providerId)),
    [status.failoverQueue],
  );
  const availableProvidersQuery = useQuery({
    queryKey: ["shared-runtime-failover-providers", status.app],
    queryFn: () => failoverControls!.getAvailableFailoverProviders(status.app),
    enabled: controlsEnabled,
    retry: false,
  });
  const availableProviders = useMemo(
    () =>
      (availableProvidersQuery.data ?? []).filter(
        (provider) =>
          provider.providerId.trim() &&
          !queueProviderIds.has(provider.providerId),
      ),
    [availableProvidersQuery.data, queueProviderIds],
  );

  useEffect(() => {
    if (!controlsEnabled) {
      setSelectedProviderId("");
      return;
    }

    if (availableProviders.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId("");
      }
      return;
    }

    if (
      availableProviders.some(
        (provider) => provider.providerId === selectedProviderId,
      )
    ) {
      return;
    }

    setSelectedProviderId(availableProviders[0]?.providerId ?? "");
  }, [availableProviders, controlsEnabled, selectedProviderId]);

  async function refreshAvailableProviders() {
    const result = await availableProvidersQuery.refetch();
    if (result.error) {
      throw result.error;
    }
  }

  async function runMutation(
    action: string,
    mutation: () => Promise<void>,
    options: {
      refreshAvailableProviders?: boolean;
    } = {},
  ) {
    if (!failoverControls || !onRefresh) {
      return;
    }

    setMutationError(null);
    setPendingAction(action);

    try {
      await mutation();
      await onRefresh();

      if (options.refreshAvailableProviders) {
        await refreshAvailableProviders();
      }
    } catch (error) {
      setMutationError(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }

  function renderQueueEntryActions(
    entry: SharedRuntimeFailoverQueueEntry,
    index: number,
  ) {
    if (!controlsEnabled || !failoverControls || !onRefresh) {
      return null;
    }

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={Boolean(pendingAction)}
        aria-label={`Remove ${entry.providerName || entry.providerId} from ${appPresentation.label} failover queue`}
        aria-busy={pendingAction === `remove-${entry.providerId}-${index}`}
        onClick={() => {
          void runMutation(
            `remove-${entry.providerId}-${index}`,
            () =>
              failoverControls.removeFromFailoverQueue(
                status.app,
                entry.providerId,
              ),
            {
              refreshAvailableProviders: true,
            },
          );
        }}
      >
        {pendingAction === `remove-${entry.providerId}-${index}` ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        Remove
      </Button>
    );
  }

  const availableProvidersError =
    availableProvidersQuery.isError && controlsEnabled
      ? getErrorMessage(availableProvidersQuery.error)
      : null;
  const addDisabled =
    !controlsEnabled ||
    Boolean(pendingAction) ||
    availableProvidersQuery.isPending ||
    Boolean(availableProvidersError) ||
    !selectedProviderId;

  return (
    <Card
      role="region"
      aria-label={`${appPresentation.label} runtime card`}
      aria-busy={Boolean(pendingAction) || availableProvidersQuery.isFetching}
      className={cn(
        "ccswitch-openwrt-surface-card ccswitch-openwrt-surface-card--runtime rounded-3xl border shadow-sm",
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
              <SharedRuntimeStatusChip
                label={
                  controlsEnabled ? "Failover controls enabled" : "Read only"
                }
                tone="neutral"
              />
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
              "ccswitch-openwrt-group rounded-2xl border px-4 py-3 text-sm",
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

        <div className="ccswitch-openwrt-group ccswitch-openwrt-group--raised rounded-2xl border border-border-default bg-background/70 p-4">
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
            renderEntryActions={
              controlsEnabled ? renderQueueEntryActions : undefined
            }
          />
        </div>

        {controlsEnabled ? (
          <div className="ccswitch-openwrt-group ccswitch-openwrt-group--muted rounded-2xl border border-border-default bg-muted/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Failover controls</p>
                <p className="text-sm text-muted-foreground">
                  Persist auto-failover and queue membership for this app
                  without changing provider activation directly.
                </p>
              </div>
              {pendingAction ? (
                <SharedRuntimeStatusChip label="Updating..." tone="neutral" />
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="ccswitch-openwrt-group ccswitch-openwrt-group--raised rounded-2xl border border-border-default bg-background/80 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Auto-failover</p>
                    <p className="text-sm text-muted-foreground">
                      Toggle the persisted `auto_failover_enabled` setting for{" "}
                      {appPresentation.label}.
                    </p>
                  </div>
                  <Switch
                    checked={status.autoFailoverEnabled}
                    disabled={Boolean(pendingAction)}
                    aria-label={`${appPresentation.label} auto-failover`}
                    aria-busy={pendingAction === "toggle-auto-failover"}
                    onCheckedChange={(enabled) => {
                      void runMutation("toggle-auto-failover", () =>
                        failoverControls!.setAutoFailoverEnabled(
                          status.app,
                          enabled,
                        ),
                      );
                    }}
                  />
                </div>
              </div>

              <div className="ccswitch-openwrt-group ccswitch-openwrt-group--raised rounded-2xl border border-border-default bg-background/80 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Add saved provider</p>
                  <p className="text-sm text-muted-foreground">
                    Queue a saved provider for {appPresentation.label} without
                    activating it.
                  </p>
                </div>

                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <label
                    className="sr-only"
                    htmlFor={`${status.app}-failover-provider`}
                  >
                    Add saved provider to {appPresentation.label} failover queue
                  </label>
                  <select
                    id={`${status.app}-failover-provider`}
                    aria-label={`Saved providers available for ${appPresentation.label} failover queue`}
                    className="ccswitch-openwrt-field h-10 w-full rounded-md border border-border-default bg-background px-3 text-sm shadow-sm focus:border-border-active focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedProviderId}
                    disabled={addDisabled}
                    onChange={(event) => {
                      setSelectedProviderId(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      {availableProvidersQuery.isPending
                        ? "Loading saved providers..."
                        : availableProviders.length > 0
                          ? "Select a saved provider"
                          : "No saved providers available"}
                    </option>
                    {availableProviders.map((provider) => (
                      <option
                        key={provider.providerId}
                        value={provider.providerId}
                      >
                        {provider.providerName}
                        {provider.model.trim() ? ` (${provider.model})` : ""}
                      </option>
                    ))}
                  </select>

                  <Button
                    type="button"
                    className="gap-1.5"
                    disabled={addDisabled}
                    aria-busy={pendingAction === `add-${selectedProviderId}`}
                    onClick={() => {
                      if (!selectedProviderId) {
                        return;
                      }

                      void runMutation(
                        `add-${selectedProviderId}`,
                        () =>
                          failoverControls!.addToFailoverQueue(
                            status.app,
                            selectedProviderId,
                          ),
                        {
                          refreshAvailableProviders: true,
                        },
                      );
                    }}
                  >
                    {pendingAction === `add-${selectedProviderId}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PlusCircle className="h-4 w-4" />
                    )}
                    Add to queue
                  </Button>
                </div>

                {availableProvidersError ? (
                  <SharedRuntimeInlineNote
                    title="Saved-provider options unavailable"
                    description={availableProvidersError}
                    tone="warning"
                  />
                ) : null}
              </div>
            </div>

            {mutationError ? (
              <div className="mt-4">
                <SharedRuntimeInlineNote
                  title="Last control action failed"
                  description={mutationError}
                  tone="warning"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
