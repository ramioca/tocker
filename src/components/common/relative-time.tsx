"use client";

import { useSyncExternalStore } from "react";
import { useCoarseNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { formatExact, formatRelative } from "./format";

const subscribeNever = () => () => {};

/**
 * False on the server and through hydration, true after. An exact time has to be
 * written in the reader's timezone, which only the browser knows: rendered on the
 * server it comes out in the server's zone (UTC), and `suppressHydrationWarning` then
 * keeps that text — "1:58 AM" for someone whose clock says 6:58 PM, a day earlier.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * No animation: a timestamp that redraws every thirty seconds must never draw
 * attention. The clock is shared across every instance on the page, and the
 * hydration warning is suppressed because server and client necessarily read
 * the clock a few hundred milliseconds apart. The exact time on hover is added
 * after hydration, in the reader's own zone (see `useHydrated`).
 */
export function RelativeTime({
  iso: isoDate,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const now = useCoarseNow();
  const hydrated = useHydrated();

  return (
    <time
      dateTime={isoDate}
      title={hydrated ? formatExact(isoDate) : undefined}
      suppressHydrationWarning
      className={cn("text-muted-foreground", className)}
    >
      {formatRelative(isoDate, now)}
    </time>
  );
}

/**
 * The exact moment, visibly, in the reader's timezone and naming it: "Sep 24, 6:58:59 PM
 * PDT". For audit trails and admin tables, where every row reading "1h ago" answers
 * nothing and a phone has no hover to reveal a title. Empty until hydrated, because the
 * server does not know the reader's zone; `tabular-nums` so a column of them lines up.
 */
export function LocalTime({
  iso: isoDate,
  className,
  dateOnly = false,
}: {
  iso: string;
  className?: string;
  /** The calendar day alone ("Sep 24, 2026"), still the reader's: a join date, not a log line. */
  dateOnly?: boolean;
}) {
  const hydrated = useHydrated();
  return (
    <time dateTime={isoDate} className={cn("tabular-nums", className)}>
      {hydrated ? (dateOnly ? formatLocalDate(isoDate) : formatExact(isoDate)) : ""}
    </time>
  );
}

function formatLocalDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
