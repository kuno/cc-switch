import { RefreshCcw, Search, X } from "lucide-react";
import type { SharedProviderAppId } from "../domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SHARED_PROVIDER_APP_PRESENTATION } from "./presentation";

interface SharedProviderToolbarProps {
  appId: SharedProviderAppId;
  searchQuery: string;
  visibleCount: number;
  totalCount: number;
  disabled?: boolean;
  searchDisabled?: boolean;
  isRefreshing?: boolean;
  onSearchQueryChange: (value: string) => void;
  onRefresh: () => void;
  onAddProvider?: () => void;
}

export function SharedProviderToolbar({
  appId,
  searchQuery,
  visibleCount,
  totalCount,
  disabled = false,
  searchDisabled = false,
  isRefreshing = false,
  onSearchQueryChange,
  onRefresh,
  onAddProvider,
}: SharedProviderToolbarProps) {
  const appLabel = SHARED_PROVIDER_APP_PRESENTATION[appId].label;
  const appPresentation = SHARED_PROVIDER_APP_PRESENTATION[appId];
  const normalizedSearchQuery = searchQuery.trim();
  const searchSummary = normalizedSearchQuery
    ? `Showing ${visibleCount} ${visibleCount === 1 ? "result" : "results"} for "${normalizedSearchQuery}" out of ${totalCount}.`
    : null;

  return (
    <div className="ccswitch-openwrt-group ccswitch-openwrt-toolbar space-y-4 rounded-2xl border border-border-default/80 bg-gradient-to-br from-background via-background to-muted/30 p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                appPresentation.chipClassName,
              )}
            >
              {appLabel}
            </span>
            <span className="rounded-full border border-border-default bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              {totalCount} saved
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Search saved providers, refresh the current list, or start a new
              draft.
            </p>
            <p className="text-sm text-muted-foreground">
              Presets only shape the editor draft until you save the provider.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={disabled || isRefreshing}
          >
            <RefreshCcw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
            Refresh
          </Button>
          {onAddProvider ? (
            <Button type="button" onClick={onAddProvider} disabled={disabled}>
              Add provider
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search providers"
            className="ccswitch-openwrt-field h-11 rounded-xl border-border-default/80 bg-background/90 pl-9 pr-10"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={`Search ${appLabel} providers`}
            disabled={searchDisabled}
          />
          {searchQuery ? (
            <button
              type="button"
              aria-label="Clear search"
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground",
                disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => onSearchQueryChange("")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {searchSummary ??
            "Saved providers stay in this list until you edit, activate, or remove them."}
        </p>
      </div>
    </div>
  );
}
