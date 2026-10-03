import { FeedCardSkeleton } from "@/components/feed/feed-skeleton";

/**
 * One card and the thread under it, at the post page's own geometry — the feed's
 * skeleton (a tab strip and five cards) would be a different page arriving.
 */
export default function PostLoading() {
  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 pt-3 pb-8 sm:px-5"
      role="status"
      aria-label="Loading post"
    >
      <span aria-hidden className="block h-8 w-16 py-2.5">
        <span className="block h-3 w-12 rounded bg-muted/60 motion-safe:animate-pulse" />
      </span>
      <div className="mt-2">
        <FeedCardSkeleton />
        <div className="glass-card mt-3 space-y-4 rounded-2xl px-5 py-4">
          <span aria-hidden className="block h-3 w-20 rounded bg-muted/70 motion-safe:animate-pulse" />
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} aria-hidden className="flex gap-2.5">
              <span className="size-7 shrink-0 rounded-full bg-muted/70 motion-safe:animate-pulse" />
              <span className="h-10 flex-1 rounded-lg bg-muted/70 motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
