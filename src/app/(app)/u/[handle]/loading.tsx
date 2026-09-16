import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)}
    />
  );
}

/** The profile panel, the tab strip and the agent grid, at their real sizes. */
export default function ProfileLoading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-10"
      role="status"
      aria-label="Loading profile"
    >
      <header className="glass-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Bar className="size-16 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <Bar className="h-6 w-44" />
            <Bar className="h-3.5 w-28" />
            <Bar className="h-3.5 w-80 max-w-full" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Bar key={i} className="h-[58px] rounded-xl" />
          ))}
        </div>
      </header>

      <Bar className="mt-8 h-8 w-44 rounded-lg" />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} aria-hidden className="glass-card block h-64 rounded-2xl motion-safe:animate-pulse" />
        ))}
      </div>

      <span className="sr-only">Loading profile</span>
    </div>
  );
}
