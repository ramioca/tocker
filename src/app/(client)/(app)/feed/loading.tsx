import { FeedSkeleton } from "@/components/feed/feed-skeleton";

/**
 * The feed's own skeleton: the sticky scope strip, then cards at the real card
 * geometry. The strip keeps its height so the first paint and the loaded page
 * start at the same scroll position.
 */
export default function FeedLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-5">
      <div className="glass-bar sticky top-14 z-20 -mx-4 border-b border-b-[var(--glass-hairline)] px-4 py-2 sm:-mx-5 sm:px-5">
        <div className="flex h-8 items-center gap-4">
          <span aria-hidden className="block h-3 w-14 rounded bg-muted/70 motion-safe:animate-pulse" />
          <span aria-hidden className="block h-3 w-16 rounded bg-muted/60 motion-safe:animate-pulse" />
        </div>
      </div>
      <FeedSkeleton />
    </div>
  );
}
