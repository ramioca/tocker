/**
 * The sweep's scoreboard, streamed. Every five minutes the cache runs out and the next
 * render sweeps 24 candidates and scores 12 against outside providers; outside a
 * Suspense boundary that stalled the leaderboard and everything else on /discover
 * behind whichever provider was slowest. The page starts the sweep alongside its other
 * queries and hands the promise down, so it costs nothing extra when it is warm.
 */
import type { TokenScore } from "@/server/types";
import { cn } from "@/lib/utils";
import { RadarHeading, TrendingTokens } from "./trending-tokens";

export async function RadarSection({ scores }: { scores: Promise<TokenScore[]> }) {
  return <TrendingTokens scores={await scores} />;
}

function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />;
}

/** The page asks the sweep for twelve, so a full board is twelve rows tall. */
const ROWS = 12;

/**
 * The real heading, then the chips, the sort bar and a full board of rows at the
 * scoreboard's row height (a 32px icon in `py-2.5`). It pulses in place, and the
 * sections under it do not jump when the rows land.
 */
export function RadarSkeleton() {
  return (
    <section aria-labelledby="scoreboard-heading" aria-busy="true">
      <RadarHeading />
      <div className="mt-4 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-[26px] w-[4.5rem] rounded-md" />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Bar className="h-[34px] w-60 max-w-[65%] rounded-lg" />
        <Bar className="h-[30px] w-[5.25rem] rounded-lg" />
      </div>
      <div className="glass-panel mt-3 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <Bar className="size-8 shrink-0 rounded-full" />
            {/* Line boxes of the real row's two lines (text-sm, then 11px mono). */}
            <span className="min-w-0 flex-1">
              <span className="flex h-5 items-center">
                <Bar className="h-3.5 w-20" />
              </span>
              <span className="mt-0.5 flex h-4 items-center">
                <Bar className="h-3 w-40 max-w-full" />
              </span>
            </span>
            <Bar className="h-6 w-12 shrink-0 rounded-md" />
            {/* Where the row's disclosure chevron sits, so the badge lands in place. */}
            <span aria-hidden className="size-4 shrink-0" />
          </div>
        ))}
      </div>
      <span role="status" className="sr-only">
        Scoring the sweep
      </span>
    </section>
  );
}
