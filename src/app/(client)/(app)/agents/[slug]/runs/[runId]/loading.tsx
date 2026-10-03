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
 * A run page before it has loaded: back link, header, summary, the five stat tiles and
 * the transcript. Without this, the nearest boundary was the "My agents" grid — the
 * wrong shape, announced as "Loading your agents".
 */
export default function RunLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" role="status" aria-label="Loading run">
      <Bar className="h-3.5 w-28" />

      <div className="mt-3 flex items-center gap-3">
        <Bar className="size-9 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Bar className="h-5 w-40 max-w-full" />
          <Bar className="mt-2 h-3.5 w-52 max-w-full" />
        </div>
      </div>

      <Bar className="mt-4 h-12 w-full rounded-xl" />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Bar key={i} className="h-[52px] rounded-lg" />
        ))}
      </div>

      <Bar className="mt-6 h-3 w-24" />
      <div className="mt-3 space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-14 rounded-xl" />
        ))}
      </div>

      <span className="sr-only">Loading run</span>
    </div>
  );
}
