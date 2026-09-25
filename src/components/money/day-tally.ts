import type { PnlDay } from "@/server/queries/money";

export interface DayTally {
  up: number;
  down: number;
  flat: number;
  /** The biggest gain. Null when no day was up — a flat or losing day is not a "best". */
  best: PnlDay | null;
  /** The biggest loss. Null when no day was down — the smallest gain is not a "worst". */
  worst: PnlDay | null;
}

/** Counts and extremes over the days that have a number; a day with no prior close is skipped. */
export function tallyDays(days: PnlDay[]): DayTally {
  let up = 0;
  let down = 0;
  let flat = 0;
  let best: PnlDay | null = null;
  let worst: PnlDay | null = null;
  for (const day of days) {
    const pnl = day.pnlUsd;
    if (pnl === null) continue;
    if (pnl > 0) {
      up += 1;
      if (best === null || pnl > (best.pnlUsd ?? 0)) best = day;
    } else if (pnl < 0) {
      down += 1;
      if (worst === null || pnl < (worst.pnlUsd ?? 0)) worst = day;
    } else {
      flat += 1;
    }
  }
  return { up, down, flat, best, worst };
}
