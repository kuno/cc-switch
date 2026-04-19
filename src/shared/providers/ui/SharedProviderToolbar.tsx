import { RefreshCcw, Search, X } from "lucide-react";
import type { SharedProviderAppId } from "../domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SHARED_PROVIDER_APP_PRESENTATION } from "./presentation";
import { getSharedProviderSearchSummary } from "./search";

interface SharedProviderToolbarProps {
  appId: SharedProviderAppId;
  searchQuery: string;
  visibleCount: number;
  totalCount: number;
  disabled?: boolean;
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
  isRefreshing = false,
  onSearchQueryChange,
  onRefresh,
  onAddProvider,
}: SharedProviderToolbarProps) {
  const appLabel = SHARED_PROVIDER_APP_PRESENTATION[appId].label;
  const searchSummary = getSharedProviderSearchSummary(
    searchQuery,
    visibleCount,
    totalCount,
  );

  return (
    <div className="space-y-3 rounded-xl border border-border-default bg-muted/20 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search providers"
            className="pl-9 pr-10"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={`Search ${appLabel} providers`}
            disabled={disabled}
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
      {searchSummary ? (
        <p className="text-sm text-muted-foreground">{searchSummary}</p>
      ) : null}
    </div>
  );
}
