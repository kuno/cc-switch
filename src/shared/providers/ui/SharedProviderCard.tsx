import { Copy, Pencil, Zap, Trash2, Loader2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SharedProviderAppId, SharedProviderView } from "../domain";
import {
  SHARED_PROVIDER_APP_PRESENTATION,
  type SharedProviderCardActionVisibility,
  getSharedProviderDisplayName,
} from "./presentation";

interface SharedProviderCardProps {
  appId: SharedProviderAppId;
  provider: SharedProviderView;
  presetLabel?: string | null;
  actionVisibility: SharedProviderCardActionVisibility;
  isBusy?: boolean;
  isActivatePending?: boolean;
  selected?: boolean;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onActivate?: () => void;
  onDelete?: () => void;
  onSelect?: () => void;
}

export function SharedProviderCard({
  appId,
  provider,
  presetLabel,
  actionVisibility,
  isBusy = false,
  isActivatePending = false,
  selected = false,
  onDuplicate,
  onEdit,
  onActivate,
  onDelete,
  onSelect,
}: SharedProviderCardProps) {
  const providerName = getSharedProviderDisplayName(provider);
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const primaryAction = actionVisibility.activate
    ? "activate"
    : actionVisibility.edit
      ? "edit"
      : null;
  const providerMeta = [
    provider.tokenConfigured ? "Stored secret" : null,
    presetLabel ? `Preset: ${presetLabel}` : null,
    provider.providerId ? `Provider ID ${provider.providerId}` : null,
  ].filter((value): value is string => Boolean(value));

  function handleSelect() {
    onSelect?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleSelect();
  }

  function stopSelection(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <article
      aria-busy={isBusy || isActivatePending}
      aria-selected={selected}
      data-ccswitch-provider-selected={selected ? "true" : "false"}
      tabIndex={0}
      className={cn(
        "ccswitch-openwrt-provider-card group relative overflow-hidden rounded-[22px] border bg-card p-4 shadow-sm transition-all sm:p-5",
        "focus:outline-none focus:ring-2 focus:ring-blue-500/20",
        provider.active
          ? appPresentation.activeCardClassName
          : "border-border-default hover:border-border-active hover:shadow-md",
        selected && "ring-2 ring-border-active ring-offset-2 ring-offset-background",
      )}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 opacity-70 transition-opacity group-hover:opacity-100",
          appPresentation.accentBarClassName,
        )}
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold">{providerName}</h3>
              {provider.active ? (
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    appPresentation.chipClassName,
                  )}
                >
                  Active provider
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Saved provider settings and actions for this route.
            </p>
            {providerMeta.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {providerMeta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
          <span
            className={cn(
              "w-fit rounded-full px-3 py-1 text-xs font-semibold",
              appPresentation.chipClassName,
            )}
          >
            {appPresentation.label}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="ccswitch-openwrt-group rounded-2xl border border-border-default/70 bg-muted/20 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Base URL
            </p>
            <p className="mt-2 break-all text-sm font-medium text-foreground">
              {provider.baseUrl || "-"}
            </p>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
            <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background p-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Model
              </dt>
              <dd className="mt-2 break-all font-medium text-foreground">
                {provider.model || "-"}
              </dd>
            </div>
            <div className="ccswitch-openwrt-stat-card rounded-2xl border border-border-default/70 bg-background p-4">
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Token field
              </dt>
              <dd className="mt-2 break-all font-medium text-foreground">
                {provider.tokenField}
              </dd>
            </div>
          </dl>
        </div>

        {provider.notes ? (
          <p className="ccswitch-openwrt-inline-note rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            {provider.notes}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border-default/70 pt-4">
          {actionVisibility.duplicate ? (
            <Button
              type="button"
              variant="outline"
              onClick={(event) => {
                stopSelection(event);
                onDuplicate?.();
              }}
              disabled={isBusy}
              aria-label={`Duplicate ${providerName}`}
            >
              <Copy className="h-4 w-4" />
              Duplicate
            </Button>
          ) : null}
          {actionVisibility.edit ? (
            <Button
              type="button"
              variant={primaryAction === "edit" ? "default" : "outline"}
              onClick={(event) => {
                stopSelection(event);
                onEdit?.();
              }}
              disabled={isBusy}
              aria-label={`Edit ${providerName}`}
              aria-busy={isBusy}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null}
          {actionVisibility.activate ? (
            <Button
              type="button"
              variant="default"
              onClick={(event) => {
                stopSelection(event);
                onActivate?.();
              }}
              disabled={isBusy}
              aria-label={`Activate ${providerName}`}
              aria-busy={isActivatePending}
            >
              {isActivatePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Activate
            </Button>
          ) : null}
          {actionVisibility.delete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={(event) => {
                stopSelection(event);
                onDelete?.();
              }}
              disabled={isBusy}
              aria-label={`Delete ${providerName}`}
              aria-busy={isBusy}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
