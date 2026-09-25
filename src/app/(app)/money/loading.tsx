import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />
  );
}

/**
 * The page's frame with the words taken out: the title, one block, one agent table.
 * The block stands in for whichever comes first — the live headline, or the "nothing
 * live yet" empty state every new account sees — so the top of the page holds still
 * either way. It does not draw the live-only equity chart and day list: most accounts
 * are paper-only, and for them those would appear only to vanish. A live account's
 * page grows below the block when the data lands instead.
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
        {/* headline, or the empty state */}
        <Bar className="h-80 w-full rounded-2xl" />

        {/* by agent */}
        <section className="space-y-4">
          <div>
            <Bar className="h-5 w-20" />
            <Bar className="mt-1.5 h-3 w-80 max-w-full" />
          </div>
          <div className="glass-card overflow-hidden rounded-2xl">
            <div className="border-b border-[var(--glass-hairline)] px-3 py-2.5">
              <Bar className="h-2.5 w-24" />
            </div>
            <div className="divide-y divide-[var(--glass-hairline)]">
              {Array.from({ length: 3 }, (_, i) => (
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
