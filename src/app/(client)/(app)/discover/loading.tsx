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
 * Three stacked page modules at the panel radius, with the real row height. The
 * rows pulse; nothing moves, because a loading state that animates position
 * makes the swap into content read as a jump.
 */
export default function DiscoverLoading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10"
      role="status"
      aria-label="Loading Discover"
    >
      <Bar className="h-7 w-36" />
      <Bar className="mt-2.5 h-3.5 w-[34rem] max-w-full" />

      <div className="mt-10 space-y-14">
        {[6, 8, 4].map((rows, section) => (
          <section key={section}>
            <Bar className="h-6 w-44" />
            <Bar className="mt-2 h-3.5 w-72 max-w-full" />
            <div className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5 sm:px-5">
                  <Bar className="size-8 shrink-0 rounded-lg" />
                  <Bar className="h-3.5 w-40 max-w-[40%]" />
                  <Bar className="ml-auto h-3.5 w-20 shrink-0" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <span className="sr-only">Loading Discover</span>
    </div>
  );
}
