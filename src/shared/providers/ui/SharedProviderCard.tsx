import { Pencil, Zap, Trash2, Loader2 } from "lucide-react";
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
  onEdit?: () => void;
  onActivate?: () => void;
  onDelete?: () => void;
}

export function SharedProviderCard({
  appId,
  provider,
  presetLabel,
  actionVisibility,
  isBusy = false,
  isActivatePending = false,
  onEdit,
  onActivate,
  onDelete,
}: SharedProviderCardProps) {
  const providerName = getSharedProviderDisplayName(provider);
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const primaryAction = actionVisibility.activate
    ? "activate"
    : actionVisibility.edit
      ? "edit"
      : null;

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[22px] border bg-card p-4 shadow-sm transition-all sm:p-5",
        provider.active
          ? appPresentation.activeCardClassName
          : "border-border-default hover:border-border-active hover:shadow-md",
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 opacity-70 transition-opacity group-hover:opacity-100",
          appPresentation.accentBarClassName,
        )}
      />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-semibold">
                  {providerName}
                </h3>
                {provider.active ? (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      appPresentation.chipClassName,
                    )}
                  >
                    Active
                  </span>
                ) : null}
                {provider.tokenConfigured ? (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Secret stored
                  </span>
                ) : null}
                {presetLabel ? (
                  <span className="rounded-full border border-border-default px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    Preset: {presetLabel}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                Saved provider details and actions for this route.
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                appPresentation.chipClassName,
              )}
            >
              {appPresentation.label}
            </span>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)]">
            <div className="rounded-2xl border border-border-default/70 bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Base URL
              </p>
              <p className="mt-2 break-all text-sm font-medium text-foreground">
                {provider.baseUrl || "-"}
              </p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-border-default/70 bg-background p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Model
                </dt>
                <dd className="mt-2 break-all font-medium text-foreground">
                  {provider.model || "-"}
                </dd>
              </div>
              <div className="rounded-2xl border border-border-default/70 bg-background p-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Token field
                </dt>
                <dd className="mt-2 break-all font-medium text-foreground">
                  {provider.tokenField}
                </dd>
              </div>
              <div className="rounded-2xl border border-border-default/70 bg-background p-4 sm:col-span-2 xl:col-span-1">
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Provider ID
                </dt>
                <dd className="mt-2 break-all font-medium text-foreground">
                  {provider.providerId || "-"}
                </dd>
              </div>
            </dl>
          </div>

          {provider.notes ? (
            <p className="rounded-2xl border border-border-default/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              {provider.notes}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:w-40 lg:flex-col lg:items-stretch">
          {actionVisibility.edit ? (
            <Button
              type="button"
              variant={primaryAction === "edit" ? "default" : "outline"}
              onClick={onEdit}
              disabled={isBusy}
              aria-label={`Edit ${providerName}`}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          ) : null}
          {actionVisibility.activate ? (
            <Button
              type="button"
              variant="default"
              onClick={onActivate}
              disabled={isBusy}
              aria-label={`Activate ${providerName}`}
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
              onClick={onDelete}
              disabled={isBusy}
              aria-label={`Delete ${providerName}`}
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
