import { AlertCircle, Loader2, Plus, Search, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SharedProviderAppId } from "../domain";
import { SHARED_PROVIDER_APP_PRESENTATION } from "./presentation";

interface SharedProviderEmptyStateProps {
  appId: SharedProviderAppId;
  canAdd: boolean;
  onAddProvider?: () => void;
  searchQuery?: string;
  onClearSearch?: () => void;
}

export function SharedProviderLoadingState({
  appId: _appId,
}: {
  appId: SharedProviderAppId;
}) {
  return (
    <div className="ccswitch-openwrt-state-shell space-y-4 rounded-2xl border border-dashed border-border-default bg-muted/10 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="font-medium">Loading provider settings...</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Fetching saved providers and provider state for this router.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="ccswitch-openwrt-group ccswitch-openwrt-group--raised space-y-3 rounded-2xl border border-border-default bg-background p-4"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="h-8 animate-pulse rounded bg-muted/60" />
              <div className="h-8 animate-pulse rounded bg-muted/60" />
              <div className="h-8 animate-pulse rounded bg-muted/60" />
              <div className="h-8 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SharedProviderErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ccswitch-openwrt-state-shell ccswitch-openwrt-state-shell--warning flex min-h-48 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <ServerCrash className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Could not load provider settings.</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Retry after the OpenWrt service or RPC bridge is available again.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function SharedProviderEmptyState({
  appId,
  canAdd,
  onAddProvider,
  searchQuery,
  onClearSearch,
}: SharedProviderEmptyStateProps) {
  const appLabel = SHARED_PROVIDER_APP_PRESENTATION[appId].label;
  const isSearchEmpty = Boolean(searchQuery?.trim());

  return (
    <div className="ccswitch-openwrt-state-shell flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border-default bg-muted/10 px-6 text-center">
      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full",
          isSearchEmpty ? "bg-muted" : "bg-primary/10",
        )}
      >
        {isSearchEmpty ? (
          <Search className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Plus className="h-6 w-6 text-primary" />
        )}
      </div>
      <div className="space-y-1">
        <p className="font-medium">
          {isSearchEmpty
            ? `No saved providers match "${searchQuery?.trim()}".`
            : `No ${appLabel} providers saved.`}
        </p>
        <p className="max-w-lg text-sm text-muted-foreground">
          {isSearchEmpty
            ? "Clear the search to review every saved provider again."
            : canAdd
              ? "Save a provider to start routing this app through the router."
              : "This router can show saved providers here, but adding a provider is unavailable."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {isSearchEmpty && onClearSearch ? (
          <Button type="button" variant="outline" onClick={onClearSearch}>
            Clear search
          </Button>
        ) : null}
        {!isSearchEmpty && canAdd && onAddProvider ? (
          <Button type="button" onClick={onAddProvider}>
            Add provider
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SharedProviderAccessState({
  tone = "info",
  title,
  description,
}: {
  tone?: "info" | "warning";
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        "ccswitch-openwrt-inline-note rounded-2xl border px-4 py-3 text-sm",
        tone === "warning"
          ? "ccswitch-openwrt-inline-note--warning border-amber-500/30 bg-amber-500/5"
          : "border-border-default bg-muted/20",
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            tone === "warning" ? "text-amber-600" : "text-muted-foreground",
          )}
        />
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
