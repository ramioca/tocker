import { cn } from "@/lib/utils";

/** Same bar as the agent page's skeleton; that one is not exported. */
function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block rounded bg-muted/70 motion-safe:animate-pulse", className)} />;
}

/**
 * Settings' own shape: the agent bar, the eight steps, one step's title and fields, and
 * from `lg` the agent card in its column. Without it the route fell back to the agent
 * page's loading state, and a skeleton in any other shape flashes a page that is not
 * coming. The widths and the columns are the ones the page itself uses.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-[1120px] px-4 pt-3 pb-6 sm:px-6 sm:pt-6"
      role="status"
      aria-label="Loading settings"
    >
      {/* The agent bar, on the grid the bar itself is laid out on, so it is the same height
          at every width and nothing below moves when the page arrives: the back link, the
          picture, the name and under it one line; then the balance and four actions. One
          row from lg, stacked below. */}
      <div className="flex flex-col gap-3 border-b border-white/[0.07] pb-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6">
        <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 sm:gap-y-0 lg:flex-1 lg:basis-72">
          <span className="-ml-2 grid size-9 place-items-center max-sm:size-11 sm:row-span-2 pointer-coarse:size-11">
            <Bar className="size-4" />
          </span>
          <Bar className="size-7 rounded-lg sm:row-span-2" />
          <div className="flex h-5 items-center">
            <Bar className="h-4 w-40 max-w-full" />
          </div>
          <div className="col-span-full flex h-[18px] items-center sm:col-span-1 sm:col-start-3">
            <Bar className="h-3 w-56 max-w-full" />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:shrink-0">
          <div className="flex h-5 items-center">
            <Bar className="h-4 w-24" />
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
            {[0, 1, 2, 3].map((action) => (
              <Bar key={action} className="h-9 rounded-lg max-sm:h-11 sm:w-20 pointer-coarse:h-11" />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-1 sm:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-12">
        <div className="mx-auto w-full max-w-2xl min-w-0 lg:mx-0">
          {/* The rail: eight segments, and from sm an icon and a one-word label under each.
              The line that says which step this is lies over the bottom of the row on a
              phone and sits under it from sm, as on the page. */}
          <div className="relative">
            <div className="grid grid-cols-8 sm:gap-1">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((step) => (
                <div key={step} className="h-11 px-[3px] pt-2 sm:h-14 sm:px-0 sm:pt-1">
                  <Bar className="h-1 w-full rounded-full sm:h-0.5" />
                  <Bar className="mt-2.5 hidden size-4 sm:block" />
                  <Bar className="mt-1.5 hidden h-3 w-10 max-w-full sm:block" />
                </div>
              ))}
            </div>
            <Bar className="absolute bottom-0.5 left-0 h-3 w-32 sm:static sm:mt-4" />
          </div>

          {/* One step: its title, its lead, four fields. */}
          <Bar className="mt-2 h-6 w-52 max-w-full sm:mt-3 sm:h-7" />
          <Bar className="mt-2 h-4 w-full max-w-md sm:mt-3" />
          <div className="mt-5 space-y-5 sm:mt-8">
            {[0, 1, 2, 3].map((field) => (
              <div key={field}>
                <Bar className="h-3 w-28" />
                <Bar className="mt-2 h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>

        {/* The agent card, in its own column from lg. */}
        <div className="hidden lg:block">
          <div className="rounded-2xl border border-white/[0.09] bg-card/50 p-5">
            <Bar className="h-3 w-20" />
            <div className="mt-4 flex items-center gap-3">
              <Bar className="size-12 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Bar className="h-5 w-36 max-w-full" />
                <Bar className="mt-2 h-3 w-48 max-w-full" />
              </div>
            </div>
            <div className="mt-6 space-y-4">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <Bar className="size-4" />
                  <Bar className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading settings</span>
    </div>
  );
}
