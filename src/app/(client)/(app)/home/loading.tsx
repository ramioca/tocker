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
 * A bar sitting in a box the height of the text line it stands for. A bar alone is
 * shorter than the line it replaces, and a few pixels a line add up down a page.
 */
function Line({ className, bar }: { className?: string; bar: string }) {
  return (
    <span aria-hidden className={cn("flex items-center", className)}>
      <Bar className={bar} />
    </span>
  );
}

/** A section heading, its one-line summary, and the buttons that wrap under both on a phone. */
function SectionHead({ title, summary, actions }: { title: string; summary: string; actions: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Line className="h-7" bar={cn("h-5", title)} />
        <Line className="mt-1 h-5" bar={cn("h-3.5 max-w-full", summary)} />
      </div>
      <Bar className={cn("h-8 rounded-lg", actions)} />
    </div>
  );
}

/**
 * The skeleton is the loaded page with the words taken out: same panel radii,
 * same four wells, same three-across grid, same row height. Load is a content
 * swap, never a jump — nothing on this page changes size when the data lands.
 *
 * The phone-only pieces are what wraps there: the "Manage agents" button under the
 * number, the "all time…" note under the PnL, the second line of a well's footnote,
 * and an activity row's fill on its own line under the agent.
 */
export default function HomeLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-label="Loading your portfolio"
    >
      <Line className="h-8" bar="h-7 w-28" />
      <Line className="mt-1.5 h-5" bar="h-3.5 w-80 max-w-full" />
      <Line className="h-5 sm:hidden" bar="h-3.5 w-48" />

      <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
        {/* portfolio panel */}
        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <Line className="h-4.5" bar="h-2.5 w-24" />
            <Line className="mt-1 h-9 sm:h-10" bar="h-8 w-52 sm:h-9" />
            <Line className="mt-1 h-5" bar="h-3 w-64 max-w-full" />
            <Line className="mt-1 h-4 sm:hidden" bar="h-3 w-40" />
            <Bar className="mt-3 h-8 w-32 rounded-lg sm:hidden" />
          </div>
          <div className="mt-4 px-5 sm:px-6">
            <Bar className="h-20 w-full rounded-xl sm:h-24" />
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-4 sm:grid-cols-4 sm:px-6 sm:pb-6">
            {/* One footnote line each, except the second row on a phone, where
                "open positions, at the last mark" takes two. */}
            {Array.from({ length: 4 }, (_, i) => (
              <Bar key={i} className={cn("rounded-xl", i < 2 ? "h-[89px]" : "h-[105px] sm:h-[89px]")} />
            ))}
          </div>
        </section>

        {/* agents */}
        <section>
          <SectionHead title="w-36" summary="w-60" actions="w-48" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Bar key={i} className="h-[258px] rounded-xl sm:h-[278px]" />
            ))}
          </div>
        </section>

        {/* activity */}
        <section>
          <SectionHead title="w-44" summary="w-72" actions="w-32" />
          <div className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
            {Array.from({ length: 5 }, (_, i) => (
              // The row's own wrap: agent and time, then (on a phone) the fill, then the
              // note, indented to the avatar — one line wide, about two on a phone.
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                <Bar className="size-7 shrink-0 rounded-lg" />
                <Bar className="size-7 shrink-0 rounded-lg" />
                <Bar className="h-3.5 w-28 shrink-0" />
                <Bar className="ml-auto h-3 w-12 shrink-0 sm:order-3" />
                <Line className="h-5 w-full pl-10 sm:order-2 sm:w-auto sm:flex-1 sm:pl-0" bar="h-3.5 w-40 max-w-full" />
                <span aria-hidden className="flex w-full flex-col gap-2 py-1 pl-10 sm:order-4">
                  <Bar className="h-3 w-3/4" />
                  <Bar className="h-3 w-1/2 sm:hidden" />
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <span className="sr-only">Loading your portfolio</span>
    </div>
  );
}
