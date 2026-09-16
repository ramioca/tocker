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
 * The skeleton is the loaded page with the words taken out: same panel radii,
 * same four wells, same three-across grid, same row height. Load is a content
 * swap, never a jump — nothing on this page changes size when the data lands.
 */
export default function HomeLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-label="Loading your portfolio"
    >
      <Bar className="h-7 w-28" />
      <Bar className="mt-2.5 h-3.5 w-80 max-w-full" />

      <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
        {/* portfolio panel */}
        <section className="glass-panel overflow-hidden rounded-2xl">
          <div className="px-5 pt-5 sm:px-6 sm:pt-6">
            <Bar className="h-2.5 w-24" />
            <Bar className="mt-2 h-9 w-52" />
            <Bar className="mt-2 h-3 w-64 max-w-full" />
          </div>
          <div className="mt-4 px-5 sm:px-6">
            <Bar className="h-20 w-full rounded-xl sm:h-24" />
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-4 sm:grid-cols-4 sm:px-6 sm:pb-6">
            {Array.from({ length: 4 }, (_, i) => (
              <Bar key={i} className="h-[74px] rounded-xl" />
            ))}
          </div>
        </section>

        {/* agents */}
        <section>
          <Bar className="h-6 w-36" />
          <Bar className="mt-2 h-3.5 w-60 max-w-full" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Bar key={i} className="h-[218px] rounded-xl" />
            ))}
          </div>
        </section>

        {/* activity */}
        <section>
          <Bar className="h-6 w-44" />
          <Bar className="mt-2 h-3.5 w-72 max-w-full" />
          <div className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Bar className="size-7 shrink-0 rounded-lg" />
                <Bar className="size-7 shrink-0 rounded-lg" />
                <Bar className="h-3.5 w-28 shrink-0" />
                <Bar className="h-3.5 w-40 max-w-[30%]" />
                <Bar className="ml-auto h-3 w-12 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </div>

      <span className="sr-only">Loading your portfolio</span>
    </div>
  );
}
