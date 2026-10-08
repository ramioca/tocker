/**
 * Skipping a scheduled run when the agent has no room to buy (`schedule.skipWhenFull`).
 *
 * An agent that is at its position limit, or has no cash for an order worth placing, or
 * has used the day's buys, still woke on every tick: it bought data, paid for its
 * thinking and ended by placing nothing, or an order too small to be placed. With the
 * switch on, such a run is not started. Everything here is the decision and its words,
 * pure, so the run loop and the status line cannot come to disagree about either. The
 * test itself is the risk guard's own (`roomToBuy`, src/lib/trading/risk.ts).
 *
 * What is never skipped: a run started by hand, a run whose book could not be read (it
 * goes ahead as it always did), a run of an agent that holds a position with every exit
 * rule off (the run is then the only thing that can sell it), and the exit engine, which
 * runs on its own clock (`/api/cron/marks`) whether or not the agent thinks.
 */
import type { AgentConfig } from "@/db/schema";
import { fmtUsd } from "@/lib/money";
import { DUST_POSITION_USD } from "@/lib/trading/dust";
import { hasAnyExitRule, toExitRules } from "@/lib/trading/exits";
import { readSkipWhenFull } from "@/lib/trading/hard-limits";
import { roomToBuy, type BuyRoom, type RiskPortfolio } from "@/lib/trading/risk";
import { MIN_ACCOUNT_OPENING_BUY_USD } from "@/lib/wallets/gas";

/** Why an agent has no room to buy: `roomToBuy`'s answer when it is no. */
export type NoRoom = Extract<BuyRoom, { ok: false }>;

/**
 * The smallest buy that could open a position this agent would keep.
 *
 * Two floors. A position under `DUST_POSITION_USD` leaves the book at once and no exit
 * rule watches it. And on Solana, with real money, the first buy of a token opens an
 * account for it, which Tocker does only for a buy of `MIN_ACCOUNT_OPENING_BUY_USD` or
 * more (src/lib/wallets/gas.ts): a smaller one is turned down at the venue, after the run
 * has already paid to find it. An agent that trades more than one chain is given the
 * lowest of its chains' floors, because the book has one cash figure for all of them.
 */
export function smallestBuyUsd(agent: { mode: "paper" | "live"; config: Pick<AgentConfig, "chains"> }): number {
  const floors = agent.config.chains.map((chain) =>
    agent.mode === "live" && chain === "solana" ? Math.max(DUST_POSITION_USD, MIN_ACCOUNT_OPENING_BUY_USD) : DUST_POSITION_USD,
  );
  return floors.length > 0 ? Math.min(...floors) : DUST_POSITION_USD;
}

/**
 * Whether any of the agent's exit rules is on. The exit engine sells for an agent only
 * then (`runGuardian` passes over one with none), so this is what "automatic exits still
 * run" depends on.
 */
export function exitRulesOn(config: Pick<AgentConfig, "risk">): boolean {
  return hasAnyExitRule(toExitRules(config.risk));
}

/**
 * Whether a scheduled run of this agent is left unstarted, and why. Null means it runs:
 * the switch is off, the book could not be read (`book` is null, or a wallet did not
 * answer and its cash is known to be too low), nothing but a run would sell what it
 * holds, or there is room to buy.
 */
export function fullRunSkip(
  agent: { mode: "paper" | "live"; config: AgentConfig },
  book: { portfolio: RiskPortfolio; cashReadFailed: boolean } | null,
): NoRoom | null {
  if (!readSkipWhenFull(agent.config.schedule)) return null;
  if (book === null || book.cashReadFailed) return null;
  // With every exit rule off the model is the only seller the agent has. A full agent
  // whose runs were skipped would then never sell again: it stays full, so it stays
  // skipped, and a position could go to nothing with nobody looking. So while it holds
  // anything its runs go ahead, as they did before the switch existed.
  if (!exitRulesOn(agent.config) && book.portfolio.positions.some((position) => position.amountToken > 0)) return null;
  const room = roomToBuy(agent, book.portfolio, { smallestUsd: smallestBuyUsd(agent) });
  return room.ok ? null : room;
}

/** The reason in a few words, for inside a sentence: "3 of 3 positions". */
export function noRoomWords(room: NoRoom): string {
  switch (room.code) {
    case "position_limit": {
      const { open, limit, held, waiting } = room.positions;
      // Over the limit (it was lowered under what the agent already had), "5 of 3" reads
      // as a mistake, so the two figures are said apart.
      const taken =
        limit !== null && open > limit
          ? `${waiting === 0 ? `${held} held` : `${open} counted`}, limit ${limit}`
          : `${open} of ${limit} position${limit === 1 ? "" : "s"}`;
      if (waiting === 0) return taken;
      return `${taken}, ${waiting === 1 ? "one of them a buy" : `${waiting} of them buys`} waiting for your approval`;
    }
    case "ticket": {
      const smallest = `under the ${fmtUsd(room.smallestUsd)} smallest order`;
      // Bound by the sizing mode or the concentration cap, the figure is not cash.
      if (room.bound !== "cash") return `its largest allowed buy is ${fmtUsd(room.ticketUsd)}, ${smallest}`;
      return room.reserveUsd > 0
        ? `${fmtUsd(room.ticketUsd)} to spend after its ${fmtUsd(room.reserveUsd)} reserve, ${smallest}`
        : `${fmtUsd(room.ticketUsd)} to spend, ${smallest}`;
    }
    case "daily_limit":
      return `${room.tradesToday} of ${room.maxDailyTrades} buys used today`;
  }
}

/** What is true while runs are being skipped, in one line. */
export function skippingRunsTitle(room: NoRoom): string {
  return `Skipping scheduled runs: no room to buy (${noRoomWords(room)})`;
}

/** What goes on regardless, for an agent with an exit rule on. */
export const SKIPPING_RUNS_STILL = "Automatic exits still run.";

/**
 * The whole sentence, for a line with no room for a title and a detail. `exitsOn` is
 * {@link exitRulesOn}: an agent with every exit rule off is not told that exits run.
 * (Such an agent is only ever skipped while it holds nothing, see {@link fullRunSkip}.)
 */
export function skippingRunsSentence(room: NoRoom, exitsOn: boolean): string {
  return exitsOn ? `${skippingRunsTitle(room)}. ${SKIPPING_RUNS_STILL}` : `${skippingRunsTitle(room)}.`;
}
