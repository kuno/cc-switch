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

  return (
    <article
      className={cn(
        "rounded-2xl border p-4 transition-all",
        provider.active
          ? appPresentation.activeCardClassName
          : "border-border-default bg-card hover:border-border-active hover:shadow-sm",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{providerName}</h3>
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
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Base URL
              </dt>
              <dd className="truncate font-medium">
                {provider.baseUrl || "-"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Model
              </dt>
              <dd className="truncate font-medium">{provider.model || "-"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Token field
              </dt>
              <dd className="truncate font-medium">{provider.tokenField}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Provider ID
              </dt>
              <dd className="truncate font-medium">
                {provider.providerId || "-"}
              </dd>
            </div>
          </dl>
          {provider.notes ? (
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {provider.notes}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {actionVisibility.edit ? (
            <Button
              type="button"
              variant="outline"
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
              variant="outline"
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
