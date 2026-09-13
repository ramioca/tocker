"use client";

import { useCoarseNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { formatAbsolute } from "@/components/common/format";

/** "42m" / "5.2h" / "3.1d" — a duration, not a relative timestamp. Pure. */
export function heldLabel(openedAt: string | null, now: number): string {
  if (openedAt === null) return "—";
  const ms = now - new Date(openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

/**
 * How long a position has been open, against the shared coarse clock (one timer for the
 * whole page, see `useCoarseNow`). A client component because reading the clock in a
 * server render is impure — and because "held 4.9h" should quietly become "5.0h" without
 * a refresh. No animation: a number nobody is watching must not move the eye.
 */
export function HeldFor({ openedAt, className }: { openedAt: string | null; className?: string }) {
  const now = useCoarseNow();
  if (openedAt === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <time
      dateTime={openedAt}
      title={`Opened ${formatAbsolute(openedAt)}`}
      suppressHydrationWarning
      className={cn("tnum text-muted-foreground", className)}
    >
      {heldLabel(openedAt, now)}
    </time>
  );
}
