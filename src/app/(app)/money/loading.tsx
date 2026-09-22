import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />
  );
}

/**
 * The loaded page with the words taken out: same panel, same four wells, same chart
 * height, same thirty rows. Nothing on `/money` changes size when the data lands, so the
 * swap is a swap and never a jump.
 *
 * It is worth having: the page waits on `getPortfolio` per live agent, which reads a
 * wallet balance over the network.
 */
export default function MoneyLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-label="Loading your money"
    >
      <Bar className="h-8 w-24" />
      <Bar className="mt-2.5 h-3.5 w-96 max-w-full" />

      <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
        {/* headline */}
        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <Bar className="h-2.5 w-28" />
            <Bar className="mt-2 h-9 w-48" />
            <Bar className="mt-2 h-3 w-[28rem] max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-4 sm:grid-cols-4 sm:px-6 sm:pb-6">
            {Array.from({ length: 4 }, (_, i) => (
              <Bar key={i} className="h-[74px] rounded-xl" />
            ))}
          </div>
        </section>

        {/* equity chart */}
        <section className="space-y-4">
          <Bar className="h-5 w-20" />
          <Bar className="h-[320px] w-full rounded-2xl" />
        </section>

        {/* p&l by day */}
        <section className="space-y-4">
          <Bar className="h-5 w-28" />
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--glass-hairline)] px-4 py-3">
              <Bar className="h-3 w-40" />
            </div>
            <div className="divide-y divide-[var(--glass-hairline)]">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="grid grid-cols-[3.75rem_1fr_auto] items-center gap-3 px-4 py-1.5 sm:grid-cols-[4.5rem_1fr_auto]">
                  <Bar className="h-2.5 w-10" />
                  <Bar className="h-2 w-full rounded-full" />
                  <Bar className="h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* by agent */}
        <section className="space-y-4">
          <Bar className="h-5 w-20" />
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--glass-hairline)] px-3 py-2.5">
              <Bar className="h-2.5 w-24" />
            </div>
            <div className="divide-y divide-[var(--glass-hairline)]">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <Bar className="h-3.5 w-32 shrink-0" />
                  <Bar className="ml-auto h-3.5 w-16 shrink-0" />
                  <Bar className="h-3.5 w-16 shrink-0" />
                  <Bar className="hidden h-3.5 w-14 shrink-0 sm:block" />
                  <Bar className="hidden h-3.5 w-14 shrink-0 sm:block" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <span className="sr-only">Loading your money</span>
    </div>
  );
}
