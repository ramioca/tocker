import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span
      className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)}
      aria-hidden
    />
  );
}

/**
 * The skeleton mirrors the real card's geometry exactly, so the reveal is a
 * content swap rather than a layout jump. Nothing here says "loading" in words —
 * the shape already does.
 */
export function FeedCardSkeleton() {
  return (
    <article className="glass rounded-2xl px-4 py-4 sm:px-5">
      <div className="flex gap-3">
        <Bar className="size-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <Bar className="h-3 w-28" />
            <Bar className="h-3 w-16" />
          </div>
          <Bar className="h-[86px] w-full rounded-xl" />
          <Bar className="h-3 w-4/5" />
          <Bar className="h-3 w-2/3" />
          <div className="flex gap-4 border-t border-[var(--glass-hairline)] pt-3">
            <Bar className="h-3 w-10" />
            <Bar className="h-3 w-10" />
            <Bar className="h-3 w-10" />
          </div>
        </div>
      </div>
    </article>
  );
}

export function FeedSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3 py-4" role="status" aria-label="Loading feed">
      {Array.from({ length: count }, (_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  );
}
