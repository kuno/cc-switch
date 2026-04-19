import {
  AlertCircle,
  Loader2,
  RadioTower,
  SearchSlash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SharedRuntimeLoadingState() {
  return (
    <div className="space-y-4 rounded-3xl border border-dashed border-border-default bg-muted/10 p-6">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">Loading runtime surface...</p>
          <p className="text-sm text-muted-foreground">
            Fetching service status, app health, and failover queue previews.
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="space-y-3 rounded-3xl border border-border-default bg-background/80 p-5"
          >
            <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted/70" />
            <div className="grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, itemIndex) => (
                <div
                  key={itemIndex}
                  className="h-16 animate-pulse rounded-2xl bg-muted/60"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SharedRuntimeEmptyState({
  title = "No runtime status available yet.",
  description = "The backend did not return a runtime snapshot for this router.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border-default bg-muted/10 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <SearchSlash className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function SharedRuntimeErrorState({
  title = "Unable to load runtime status.",
  description = "Check the OpenWrt RPC bridge and retry once the daemon is reachable again.",
  detail,
  onRetry,
}: {
  title?: string;
  description?: string;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-destructive/40 bg-destructive/5 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <RadioTower className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
      </div>

      {detail?.trim() ? (
        <div className="max-w-xl rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-900 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{detail}</p>
          </div>
        </div>
      ) : null}

      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function SharedRuntimeInlineNote({
  title,
  description,
  tone = "neutral",
}: {
  title: string;
  description: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-border-default bg-muted/20",
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-muted-foreground">{description}</p>
    </div>
  );
}
