import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)}
    />
  );
}

/** Same header, same three-across grid, same card height as the loaded page. */
export default function MyAgentsLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-label="Loading your agents"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Bar className="h-6 w-32" />
          <Bar className="mt-2 h-3.5 w-64 max-w-full" />
        </div>
        <Bar className="h-9 w-28 rounded-lg" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} aria-hidden className="glass block h-[218px] rounded-xl motion-safe:animate-pulse" />
        ))}
      </div>

      <span className="sr-only">Loading your agents</span>
    </div>
  );
}
