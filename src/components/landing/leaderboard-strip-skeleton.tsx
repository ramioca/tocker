export function LeaderboardStripSkeleton() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 lg:py-24" aria-busy>
      <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
      <div className="mt-3 h-5 w-96 max-w-full animate-pulse rounded bg-muted/60" />
      <ol className="mt-10 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-4 px-5 py-4">
            <span className="size-8 shrink-0 animate-pulse rounded-xl bg-muted" />
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
            <span className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ol>
      <span className="sr-only">Loading the leaderboard</span>
    </section>
  );
}
