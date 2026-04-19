import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  SharedProviderAppId,
  SharedProviderFailoverQueueEntry,
  SharedProviderFailoverState,
  SharedProviderView,
} from "../domain";
import {
  SHARED_PROVIDER_APP_PRESENTATION,
  type SharedProviderCardActionVisibility,
  getSharedProviderDisplayName,
} from "./presentation";

type SharedProviderDetailTab = "general" | "failover" | "credentials";

interface SharedProviderDetailPanelProps {
  appId: SharedProviderAppId;
  provider: SharedProviderView;
  detailTab: SharedProviderDetailTab;
  actionVisibility: SharedProviderCardActionVisibility;
  supportsFailoverControls?: boolean;
  failoverState?: SharedProviderFailoverState;
  failoverLoading?: boolean;
  failoverError?: string | null;
  isBusy?: boolean;
  isActivatePending?: boolean;
  onDetailTabChange: (tab: SharedProviderDetailTab) => void;
  onToggleFailoverQueue?: (inQueue: boolean) => void;
  onAutoFailoverEnabledChange?: (enabled: boolean) => void;
  onReorderFailoverQueue?: (providerIds: string[]) => void;
  onSetMaxRetries?: (value: number) => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onActivate?: () => void;
}

function DetailField({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background/80 p-4",
        wide && "sm:col-span-2",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 break-all text-sm font-medium text-foreground",
          mono && "font-mono text-[13px]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function QueueRow({
  entry,
  index,
  total,
  disabled,
  onMove,
}: {
  entry: SharedProviderFailoverQueueEntry;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const healthLabel = entry.health.observed
    ? entry.health.healthy
      ? "Healthy"
      : "Unhealthy"
    : "No health sample";

  return (
    <div className="rounded-2xl border border-border-default/70 bg-background/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {index + 1}. {entry.providerName || entry.providerId}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {entry.providerId}
          </p>
          <p className="text-xs text-muted-foreground">
            {healthLabel}
            {entry.active ? " • Active route" : ""}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move ${entry.providerName || entry.providerId} earlier`}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || index === total - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move ${entry.providerName || entry.providerId} later`}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SharedProviderDetailPanel({
  appId,
  provider,
  detailTab,
  actionVisibility,
  supportsFailoverControls = false,
  failoverState,
  failoverLoading = false,
  failoverError = null,
  isBusy = false,
  isActivatePending = false,
  onDetailTabChange,
  onToggleFailoverQueue,
  onAutoFailoverEnabledChange,
  onReorderFailoverQueue,
  onSetMaxRetries,
  onDuplicate,
  onEdit,
  onActivate,
}: SharedProviderDetailPanelProps) {
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const providerName = getSharedProviderDisplayName(provider);
  const secretValue = provider.tokenConfigured
    ? provider.tokenMasked || "Stored secret"
    : "No stored secret";
  const secretPolicy = provider.tokenConfigured
    ? "Blank preserves the stored secret during edits."
    : "Add a token in the editor to store credentials for this provider.";
  const notesValue = provider.notes || "No notes saved for this provider.";
  const [maxRetriesDraft, setMaxRetriesDraft] = useState(
    String(failoverState?.maxRetries ?? 0),
  );

  useEffect(() => {
    setMaxRetriesDraft(String(failoverState?.maxRetries ?? 0));
  }, [failoverState?.maxRetries, failoverState?.providerId]);

  function handleMove(fromIndex: number, toIndex: number) {
    if (!failoverState || !onReorderFailoverQueue) {
      return;
    }

    const providerIds = failoverState.failoverQueue.map((entry) => entry.providerId);
    const [moved] = providerIds.splice(fromIndex, 1);
    providerIds.splice(toIndex, 0, moved);
    onReorderFailoverQueue(providerIds);
  }

  const providerHealthLabel = !failoverState
    ? "Unavailable"
    : failoverState.providerHealth.observed
      ? failoverState.providerHealth.healthy
        ? "Healthy"
        : "Unhealthy"
      : "No health sample";

  return (
    <section
      data-ccswitch-region="provider-detail-panel"
      className="ccswitch-openwrt-group rounded-[24px] border border-border-default/80 bg-background/85 p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4 border-b border-border-default/70 pb-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  appPresentation.chipClassName,
                )}
              >
                {appPresentation.label}
              </span>
              <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                {provider.active ? "Active route" : "Saved provider"}
              </span>
              {provider.tokenConfigured ? (
                <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  Stored secret
                </span>
              ) : null}
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-semibold text-foreground">
                {providerName}
              </h3>
              <p className="text-sm text-muted-foreground">
                Review selected-provider details using the current OpenWrt
                provider contract and the supported failover controls only.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {actionVisibility.duplicate ? (
              <Button
                type="button"
                variant="outline"
                onClick={onDuplicate}
                disabled={isBusy}
                aria-label={`Duplicate selected ${providerName}`}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </Button>
            ) : null}
            {actionVisibility.edit ? (
              <Button type="button" onClick={onEdit} disabled={isBusy}>
                <Pencil className="h-4 w-4" />
                Edit provider
              </Button>
            ) : null}
            {actionVisibility.activate ? (
              <Button
                type="button"
                variant="outline"
                onClick={onActivate}
                disabled={isBusy}
                aria-busy={isActivatePending}
              >
                {isActivatePending ? (
                  <Zap className="h-4 w-4 animate-pulse" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Activate route
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <DetailField
            label="Base URL"
            value={provider.baseUrl || "No base URL saved"}
            mono
          />
          <DetailField label="Token field" value={provider.tokenField} mono />
          <DetailField
            label="Provider ID"
            value={provider.providerId || "No provider ID"}
            mono
          />
        </div>
      </div>

      <Tabs
        value={detailTab}
        onValueChange={(value) =>
          onDetailTabChange(value as SharedProviderDetailTab)
        }
        className="mt-4 w-full"
      >
        <TabsList
          className={cn(
            "grid w-full rounded-2xl border border-border-default/70 bg-muted/30 p-1",
            supportsFailoverControls ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <TabsTrigger value="general">General</TabsTrigger>
          {supportsFailoverControls ? (
            <TabsTrigger value="failover">Failover</TabsTrigger>
          ) : null}
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <div
            className={cn(
              "rounded-[24px] border p-4 shadow-sm",
              appPresentation.panelClassName,
            )}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border-default/70 bg-background/80 p-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">
                  General provider settings
                </p>
                <p className="text-sm text-muted-foreground">
                  These values come from the selected-provider detail contract
                  already available on the OpenWrt path.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Provider name" value={providerName} />
            <DetailField
              label="Route status"
              value={provider.active ? "Active provider" : "Saved provider"}
            />
            <DetailField
              label="Base URL"
              value={provider.baseUrl || "No base URL saved"}
              mono
              wide
            />
            <DetailField
              label="Model"
              value={provider.model || "No model override"}
            />
            <DetailField label="Notes" value={notesValue} wide />
          </div>
        </TabsContent>

        {supportsFailoverControls ? (
          <TabsContent value="failover" className="mt-4 space-y-4">
            {failoverLoading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-border-default/70 bg-background/80 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading failover state...
              </div>
            ) : failoverError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {failoverError}
              </div>
            ) : failoverState ? (
              <>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-[24px] border border-border-default/70 bg-background/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">
                          Queue membership
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Add or remove this provider from the real OpenWrt
                          failover queue.
                        </p>
                      </div>
                      <Switch
                        checked={failoverState.inFailoverQueue}
                        disabled={isBusy}
                        onCheckedChange={() =>
                          onToggleFailoverQueue?.(failoverState.inFailoverQueue)
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-border-default/70 bg-background/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">
                          Auto failover
                        </p>
                        <p className="text-sm text-muted-foreground">
                          App-level OpenWrt auto-failover state for this route.
                        </p>
                      </div>
                      <Switch
                        checked={failoverState.autoFailoverEnabled}
                        disabled={isBusy}
                        onCheckedChange={onAutoFailoverEnabledChange}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailField label="Provider health" value={providerHealthLabel} />
                  <DetailField
                    label="Queue position"
                    value={
                      failoverState.queuePosition == null
                        ? "Not queued"
                        : String(failoverState.queuePosition + 1)
                    }
                  />
                  <DetailField
                    label="Proxy enabled"
                    value={failoverState.proxyEnabled ? "Enabled" : "Disabled"}
                  />
                  <DetailField
                    label="Active provider"
                    value={failoverState.activeProviderId || "None"}
                    mono
                  />
                </div>

                <div className="rounded-[24px] border border-border-default/70 bg-background/80 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground">
                        Max retries
                      </p>
                      <p className="text-sm text-muted-foreground">
                        This updates the current OpenWrt app-level max retries
                        value only.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={maxRetriesDraft}
                        onChange={(event) => setMaxRetriesDraft(event.target.value)}
                        className="w-28"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          onSetMaxRetries?.(Math.max(0, Number(maxRetriesDraft) || 0))
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-foreground">
                        Failover queue
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Reorder only the current queued providers. No extra
                        routing roles or policies are implied here.
                      </p>
                    </div>
                    <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                      {failoverState.failoverQueueDepth} queued
                    </span>
                  </div>

                  {failoverState.failoverQueueDepth === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border-default/70 bg-muted/10 p-4 text-sm text-muted-foreground">
                      No queued providers yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {failoverState.failoverQueue.map((entry, index) => (
                        <QueueRow
                          key={entry.providerId}
                          entry={entry}
                          index={index}
                          total={failoverState.failoverQueue.length}
                          disabled={isBusy}
                          onMove={handleMove}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </TabsContent>
        ) : null}

        <TabsContent value="credentials" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailField label="Provider name" value={providerName} />
            <DetailField label="Secret policy" value={secretPolicy} />
            <DetailField
              label="Token field"
              value={provider.tokenField}
              mono
            />
            <DetailField
              label="Stored secret state"
              value={secretValue}
              mono={provider.tokenConfigured}
            />
            <DetailField
              label="Endpoint"
              value={provider.baseUrl || "No base URL saved"}
              mono
              wide
            />
            <DetailField
              label="Model default"
              value={provider.model || "No model override"}
            />
            <DetailField label="Notes" value={notesValue} wide />
          </div>

          <div className="ccswitch-openwrt-inline-note rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border-default/70 bg-background/80 p-2 text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-foreground">
                  Secret-safe reads only
                </p>
                <p>
                  This pane shows token field and masked secret state only. Raw
                  secrets are never rendered here.
                </p>
              </div>
            </div>
          </div>

          {provider.tokenConfigured ? (
            <div className="ccswitch-openwrt-inline-note rounded-2xl border border-border-default/70 bg-background px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl border border-border-default/70 bg-muted/20 p-2 text-muted-foreground">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Stored secret detected
                  </p>
                  <p>
                    Leave the token blank in the editor to preserve the stored
                    secret.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </section>
  );
}
