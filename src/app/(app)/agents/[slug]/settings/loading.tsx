import { cn } from "@/lib/utils";

/** Same bar as the agent page's skeleton; that one is not exported. */
function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />;
}

/**
 * Settings' own shape. Without it the route fell back to the agent page's loading
 * state, so opening settings flashed a wide profile skeleton and then snapped to this
 * narrow column of cards.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6" role="status" aria-label="Loading settings">
      <Bar className="h-3 w-24" />
      <div className="mt-3 flex items-center gap-3">
        <Bar className="size-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <Bar className="h-5 w-40" />
          <Bar className="mt-2 h-3 w-56 max-w-full" />
        </div>
      </div>
      <div className="mt-6 space-y-6">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="rounded-xl border border-border/70 bg-card/30 p-4">
            <Bar className="h-4 w-32" />
            <Bar className="mt-2 h-3 w-64 max-w-full" />
            <Bar className="mt-4 h-9 w-full rounded-lg" />
            <Bar className="mt-3 h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading settings</span>
    </div>
  );
}
