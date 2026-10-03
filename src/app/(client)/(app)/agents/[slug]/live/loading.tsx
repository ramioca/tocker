import { cn } from "@/lib/utils";

/** Same bar as the agent page's skeleton; that one is not exported. */
function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />;
}

/** The go-live checklist's shape: back link, title, intro, then one row per check. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6" role="status" aria-label="Loading checklist">
      <Bar className="h-3 w-32" />
      <Bar className="mt-3 h-5 w-44" />
      <Bar className="mt-2 h-3 w-full" />
      <Bar className="mt-1.5 h-3 w-4/5" />
      <ul className="mt-6 space-y-2">
        {Array.from({ length: 8 }, (_, row) => (
          <li key={row} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/30 p-3">
            <Bar className="size-6 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bar className="h-3.5 w-40 max-w-full" />
              <Bar className="mt-1.5 h-3 w-64 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading checklist</span>
    </div>
  );
}
