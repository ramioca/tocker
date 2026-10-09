/**
 * The paper starting balance as the builder and an agent's settings page say it: its
 * short form, the words around its control, and the amount a create sends. Pure, no
 * React, so a node test can hold every string (`paper-balance.test.ts`).
 *
 * The range itself is the server's (`src/lib/trading/paper-balance.ts`); nothing here
 * decides whether an amount is allowed.
 */
import { formatUsd } from "@/components/common/format";
import { PAPER_BALANCE_MAX_USD, PAPER_BALANCE_MIN_USD, type PaperBalanceLock } from "@/lib/trading/paper-balance";
import type { BuilderDraft } from "./types";

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * The balance in the short form of the Schedule step's buttons, for any amount: "$10K",
 * "$1.5K", "$2.5M", and otherwise the amount itself ("$250", "$1,250", "$12,345.67").
 *
 * It never rounds. A short form is used only where it is the number: thousands to one
 * decimal and millions to two, which is as far as they stay short. So the same string can
 * be typed back into the box and gives the same amount, which the typed entry relies on
 * (`typed-value.ts`), and no card ever shows a balance the agent does not have.
 */
export function paperLabel(usd: number): string {
  if (usd >= 1_000_000 && usd % 10_000 === 0) return `$${usd / 1_000_000}M`;
  if (usd >= 1_000 && usd < 1_000_000 && usd % 100 === 0) return `$${usd / 1_000}K`;
  // Whole dollars are said without cents, as the buttons say theirs.
  return Number.isInteger(usd) ? `$${WHOLE.format(usd)}` : formatUsd(usd);
}

/**
 * The paper balance a create sends.
 *
 * A funded agent has no paper book worth pretending about: its paper balance is the money
 * it is actually given. Funding starts at $5 and a paper balance at $10, so an agent
 * funded with less starts its paper book on the smallest balance there is. Its owner can
 * change that in its settings for as long as it has not traded.
 */
export function paperBalanceForCreate(draft: Pick<BuilderDraft, "funding" | "paperStartingUsd">): number {
  return draft.funding.mode === "fund"
    ? Math.max(PAPER_BALANCE_MIN_USD, draft.funding.amountUsd)
    : draft.paperStartingUsd;
}

/** "from $10 to $10M", for the sentences under the control. */
const RANGE = `from ${paperLabel(PAPER_BALANCE_MIN_USD)} to ${paperLabel(PAPER_BALANCE_MAX_USD)}`;

/** What the control is called. On a live agent it says what the balance is for. */
export function paperBalanceLabel(mode?: "paper" | "live"): string {
  return mode === "live" ? "Paper balance, used if you switch back to paper" : "Paper starting balance";
}

/** Under the control while an agent is being made. */
export const PAPER_BALANCE_HINT = `Pick one or type any amount ${RANGE}. Fake money, real prices, real fills at real quotes.`;
/** Under the control of a saved agent that has not traded, on paper or with real money. */
export const PAPER_BALANCE_OPEN_HINT = `It has not traded yet, so you can still change this. Pick one or type any amount ${RANGE}.`;
/**
 * Under the balance of a saved agent that has traded: why there is no control. One
 * sentence for each reason the server gives (`PaperBalanceLock`). Real-money trades close
 * it because paper cash counts them, and the sentence says so.
 */
export const PAPER_BALANCE_LOCKED_HINTS: Record<PaperBalanceLock, string> = {
  paper: "It has traded on paper, so its balance is part of its record.",
  live: "It has traded with real money, and its paper book counts those trades, so its balance is part of its record.",
};
