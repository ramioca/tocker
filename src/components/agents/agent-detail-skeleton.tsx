import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)}
    />
  );
}

/**
 * The agent page before it has loaded: header card, the 2×3 stat grid, the tab strip
 * and the chart, at the loaded page's sizes, so the swap is a fill-in rather than a
 * jump. Meant for `agents/[slug]/loading.tsx` — the "My agents" grid skeleton is the
 * wrong shape for someone else's agent, and announces the wrong thing.
 */
export function AgentDetailSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-label="Loading agent"
    >
      <div className="glass-panel rounded-2xl px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Bar className="size-16 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <Bar className="h-6 w-48 max-w-full" />
            <Bar className="mt-2.5 h-3.5 w-64 max-w-full" />
            <Bar className="mt-3 h-4 w-56 max-w-full" />
            <Bar className="mt-5 h-8 w-28 rounded-full" />
          </div>
          <div className="shrink-0 sm:flex sm:flex-col sm:items-end">
            <Bar className="h-3 w-20" />
            <Bar className="mt-2 h-7 w-32" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="glass-card block h-[100px] rounded-xl motion-safe:animate-pulse sm:h-[122px]"
          />
        ))}
      </div>

      <div className="mt-6 flex gap-4 overflow-hidden px-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Bar key={i} className="h-4 w-16" />
        ))}
      </div>

      <span aria-hidden className="glass-panel mt-4 block h-[400px] rounded-2xl motion-safe:animate-pulse" />

      <span className="sr-only">Loading agent</span>
    </div>
  );
}
