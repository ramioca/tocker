export function LeaderboardStripSkeleton() {
  return (
    <ol
      className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50"
      aria-busy
    >
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-5 py-4">
          <span className="size-8 shrink-0 animate-pulse rounded-xl bg-muted" />
          <span className="h-4 w-40 animate-pulse rounded bg-muted" />
          <span className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
        </li>
      ))}
      <span className="sr-only">Loading the leaderboard</span>
    </ol>
  );
}
