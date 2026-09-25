"use client";

import Link, { useLinkStatus } from "next/link";
import { cn } from "@/lib/utils";

/**
 * "Show older" under the notifications list. A link, not a fetch: `?pages=` asks the
 * server page for one more page, which renders the whole list again with the older
 * rows under the ones already read, day groups, receipts and proposal cards included.
 * `scroll={false}` keeps the reader where they were; the rows above do not move.
 *
 * No prefetch: each extra page is another walk of the cursor, and most visits never
 * ask for one.
 */
export function ShowOlder({ nextPages }: { nextPages: number }) {
  return (
    <Link
      href={`/notifications?pages=${nextPages}`}
      scroll={false}
      prefetch={false}
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-xl border border-border px-4 text-sm text-muted-foreground",
        "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 hover:text-foreground active:scale-[0.97]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      <Label />
    </Link>
  );
}

/** Its own component because the link's pending state is only readable beneath it. */
function Label() {
  const { pending } = useLinkStatus();
  return <span aria-live="polite">{pending ? "Loading older…" : "Show older"}</span>;
}
