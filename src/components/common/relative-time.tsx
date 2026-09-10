"use client";

import { useCoarseNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { formatAbsolute, formatRelative } from "./format";

/**
 * No animation: a timestamp that redraws every thirty seconds must never draw
 * attention. The clock is shared across every instance on the page, and the
 * hydration warning is suppressed because server and client necessarily read
 * the clock a few hundred milliseconds apart.
 */
export function RelativeTime({
  iso: isoDate,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const now = useCoarseNow();

  return (
    <time
      dateTime={isoDate}
      title={formatAbsolute(isoDate)}
      suppressHydrationWarning
      className={cn("text-muted-foreground", className)}
    >
      {formatRelative(isoDate, now)}
    </time>
  );
}
