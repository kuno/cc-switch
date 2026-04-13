import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SharedRuntimeLoadingState() {
  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-border-default bg-muted/10 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="font-medium">Loading runtime status...</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Fetching the current service summary and per-app failover surface.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.25fr_repeat(3,minmax(0,1fr))]">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="space-y-3 rounded-2xl border border-border-default bg-background p-5"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted/80" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="h-8 animate-pulse rounded bg-muted/70" />
              <div className="h-8 animate-pulse rounded bg-muted/70" />
              <div className="h-8 animate-pulse rounded bg-muted/60" />
              <div className="h-8 animate-pulse rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SharedRuntimeErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
        <AlertTriangle className="h-6 w-6 text-amber-600" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">Unable to load runtime status.</p>
        <p className="max-w-xl text-sm text-muted-foreground">{message}</p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
