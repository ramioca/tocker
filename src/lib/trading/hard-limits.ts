/**
 * The three settings an owner may switch on that every older config lacks, as every
 * reader should see them: the position limit, the cash reserve, and the switch that skips
 * a scheduled run with no room to buy.
 *
 * A leaf with nothing but the config type, like `readSizing` beside it, so the settings
 * page (which runs in a browser) reads a stored config the same way the risk guard does.
 * The rules themselves are in `./risk.ts`; nothing here decides a trade.
 */
import type { AgentConfig } from "@/db/schema";

type Risk = AgentConfig["risk"];

/**
 * `risk.maxOpenPositions` as every reader sees it: a whole number of positions, or null
 * for no limit. Absent, null or not a number is no limit, which is every config written
 * before the field existed. A number is always a limit and is read downwards: 2.5 is 2,
 * and anything under 1 allows no new position at all. The schema refuses those on a
 * save, so only a row written some other way can hold one, and it must not read as
 * looser than it says.
 */
export function readMaxOpenPositions(risk: Risk | null | undefined): number | null {
  const raw = risk?.maxOpenPositions;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

/**
 * `risk.cashReserveUsd` in USD, to the ledger's six decimals. Absent, zero, negative or
 * not a number is no reserve, which is every config written before the field existed.
 */
export function readCashReserveUsd(risk: Risk | null | undefined): number {
  const raw = risk?.cashReserveUsd;
  if (typeof raw !== "number" || !Number.isFinite(raw) || !(raw > 0)) return 0;
  return Math.round(raw * 1e6) / 1e6;
}

/** `schedule.skipWhenFull`: on only when it is stored as exactly `true`. */
export function readSkipWhenFull(schedule: AgentConfig["schedule"] | null | undefined): boolean {
  return schedule?.skipWhenFull === true;
}
