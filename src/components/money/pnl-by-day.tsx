import { formatSignedPct, formatSignedUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { PnlDay } from "@/server/queries/money";
import { dayNote, movedMoney, tallyDays } from "./day-tally";

/**
 * Thirty days of P&L as one row each: the date, a bar either side of zero, the number.
 *
 * A diverging bar rather than a column chart because the question is "how many red days
 * and how bad" — and a column chart answers that only if you can read a pixel height.
 * Every bar shares one scale (the largest absolute day), so a −$3 day next to a −$300
 * day looks like what it is.
 *
 * Weekends get no special treatment: crypto does not close, and shading Saturdays would
 * imply a market rhythm this product does not have.
 *
 * Pure SVG-free CSS and no client JS: thirty rows is a list, and a list is a hot path.
 */

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function label(day: string): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? day : dayFormatter.format(at);
}

export function PnlByDay({ days }: { days: PnlDay[] }) {
  const scored = days.filter((d) => d.pnlUsd !== null);
  if (scored.length === 0) {
    return (
      <p className="glass-card rounded-2xl px-4 py-8 text-center text-sm text-muted-foreground">
        A daily number needs two days of marks. The first one lands after tomorrow&rsquo;s first snapshot.
      </p>
    );
  }

  const peak = Math.max(...scored.map((d) => Math.abs(d.pnlUsd ?? 0)), 0);
  const { up, down, flat, best, worst } = tallyDays(days);
  // Only a gain is a "best" and only a loss a "worst": a month of green days must
  // not print "worst +$2.10".
  const extremes = [
    best ? `best ${formatSignedUsd(best.pnlUsd)} on ${label(best.day)}` : null,
    worst ? `worst ${formatSignedUsd(worst.pnlUsd)} on ${label(worst.day)}` : best ? "no down days" : null,
  ].filter(Boolean);
  const today = days.at(-1)?.day;

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--glass-hairline)] px-4 py-3">
        <p className="tnum text-xs text-muted-foreground">
          <span className="text-positive">{up} up</span> · <span className="text-negative">{down} down</span> ·{" "}
          {flat} flat
        </p>
        {extremes.length > 0 ? (
          <p className="tnum text-[11px] text-muted-foreground">{extremes.join(" · ")}</p>
        ) : null}
      </div>

      <ul className="divide-y divide-[var(--glass-hairline)]">
        {days.map((day, index) => {
          const pnl = day.pnlUsd;
          const share = peak > 0 && pnl !== null ? Math.min(1, Math.abs(pnl) / peak) : 0;
          const width = `${(share * 50).toFixed(2)}%`;
          const isToday = day.day === today;
          // Money in or out, or an agent joining or leaving: the number is net of it, but
          // the bar is muted and the row says what moved, so a deposit is never read as a win.
          const previous = days[index - 1];
          const moved = movedMoney(day, previous);
          // The note also names what the agents paid for their own thinking that day.
          // That is left out of the number too, but it is a small running cost and not
          // money moving, so it does not mute the bar; `dayNote` is null on a day with
          // neither.
          const note = dayNote(day, previous);

          return (
            <li
              key={day.day}
              className={cn(
                // One label width at every size: 3.75rem wrapped "Sep 25 NOW" onto two
                // lines on a phone and made today's row twice the height of the rest.
                "grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 px-4 py-1.5",
                isToday && "bg-muted/25",
              )}
            >
              <span className="tnum whitespace-nowrap text-[11px] text-muted-foreground">
                {label(day.day)}
                {isToday ? <span className="ml-1 text-[9px] uppercase tracking-wide">now</span> : null}
              </span>

              {/* One track, zero in the middle: left of the line is red, right is green. */}
              <span className="min-w-0">
                <span aria-hidden className="relative block h-2 rounded-full bg-muted/35">
                  <span className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-[var(--glass-hairline)]" />
                  {pnl !== null && pnl !== 0 ? (
                    <span
                      className={cn(
                        "absolute inset-y-0 block",
                        pnl > 0 ? "left-1/2 rounded-r-full" : "right-1/2 rounded-l-full",
                        moved ? "bg-muted-foreground/45" : pnl > 0 ? "bg-positive" : "bg-negative",
                      )}
                      style={{ width }}
                    />
                  ) : null}
                </span>
                {note ? (
                  <span className="tnum mt-1 block truncate text-center text-[10px] leading-3 text-muted-foreground">
                    {note}
                  </span>
                ) : null}
              </span>

              <span className="tnum flex items-baseline justify-end gap-2 text-right text-xs">
                {pnl === null ? (
                  // Same widths as a day with a number, so this row's `auto` column
                  // matches the rest and the zero line does not shift.
                  <>
                    <span className="w-[5.5rem] text-muted-foreground">—</span>
                    <span aria-hidden className="hidden w-14 sm:inline-block" />
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        "w-[5.5rem] font-medium",
                        pnl > 0 ? "text-positive" : pnl < 0 ? "text-negative" : "text-muted-foreground",
                      )}
                    >
                      {formatSignedUsd(pnl)}
                    </span>
                    <span className="hidden w-14 text-[11px] text-muted-foreground sm:inline">
                      {day.pnlPct === null ? "—" : formatSignedPct(day.pnlPct, 1)}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
