import { formatUsd } from "@/components/common/format";
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

/**
 * True when money moved in or out that day, or the set of agents changed: the day's
 * number is already net of the flow, but it rests on an estimate of where the flow landed,
 * so it is shown muted and kept out of best and worst.
 */
export function movedMoney(day: PnlDay, previous: PnlDay | undefined): boolean {
  return day.flowUsd !== 0 || (previous !== undefined && previous.agents !== day.agents);
}

/** "excl. $500.00 deposit" / "excl. $40.00 withdrawal": what the day's number leaves out. */
export function flowText(flowUsd: number): string | null {
  if (flowUsd > 0) return `excl. ${formatUsd(flowUsd)} deposit`;
  if (flowUsd < 0) return `excl. ${formatUsd(-flowUsd)} withdrawal`;
  return null;
}

/** The note under a day that moved money, or null for an ordinary trading day. */
export function dayNote(day: PnlDay, previous: PnlDay | undefined): string | null {
  const flow = flowText(day.flowUsd);
  if (flow) return flow;
  if (previous !== undefined && previous.agents !== day.agents) {
    return day.agents > previous.agents ? "new agent" : "agent left";
  }
  return null;
}

/**
 * Counts and extremes over the days that have a number; a day with no prior close is
 * skipped. A day that moved money still counts as up, down or flat — its number is net of
 * the flow — but it is never the best or worst day, since a deposit landing mid-day can
 * push that number either way.
 */
export function tallyDays(days: PnlDay[]): DayTally {
  let up = 0;
  let down = 0;
  let flat = 0;
  let best: PnlDay | null = null;
  let worst: PnlDay | null = null;
  days.forEach((day, index) => {
    const pnl = day.pnlUsd;
    if (pnl === null) return;
    const ranked = !movedMoney(day, days[index - 1]);
    if (pnl > 0) {
      up += 1;
      if (ranked && (best === null || pnl > (best.pnlUsd ?? 0))) best = day;
    } else if (pnl < 0) {
      down += 1;
      if (ranked && (worst === null || pnl < (worst.pnlUsd ?? 0))) worst = day;
    } else {
      flat += 1;
    }
  });
  return { up, down, flat, best, worst };
}
