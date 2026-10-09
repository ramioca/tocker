/**
 * What a paper starting balance may be, and the sentences that refuse one. Pure: the
 * builder's typed box, the settings page and the server actions all read the range from
 * here, so the form never offers an amount the server would turn away.
 *
 * The balance is what a paper book starts with: its cash is this minus buys plus sells
 * minus fees (`./paper.ts`), and its public PnL, its chart and its place on the
 * leaderboard are all measured against it.
 */

/** The smallest funding preset: a paper book is not offered smaller than a real one is usually given. */
export const PAPER_BALANCE_MIN_USD = 10;
/**
 * Paper money is imaginary, but the number is persisted as `numeric` and drives every
 * sizing rule; an absurd one makes the book meaningless. Well above anything anyone would
 * fund an agent with.
 */
export const PAPER_BALANCE_MAX_USD = 10_000_000;

export const PAPER_BALANCE_TOO_LOW = "Paper starting balance must be $10 or more";
export const PAPER_BALANCE_TOO_HIGH = "Paper starting balance must be $10,000,000 or less";

/**
 * Why an agent's paper starting balance can no longer be changed (`paperBalanceLock`,
 * ./paper-history.ts):
 *
 *  - `paper`: it has paper history, so the balance is what that history is measured against.
 *  - `live`: it has none, but it has a real-money order. Paper cash is worked out from
 *    every filled trade, the real ones too (`getPaperCash`, ./paper.ts), so its paper book
 *    opens on the balance plus what those trades made or lost. Choosing the balance after
 *    that result is known would be choosing the percentage it is shown as.
 */
export type PaperBalanceLock = "paper" | "live";

/**
 * Why a save that changes the balance was refused although the page offered the change:
 * the agent traded after the page was loaded. The settings page looks for these sentences
 * to know it has to ask the server again.
 */
export const PAPER_BALANCE_TRADED =
  "This agent has traded on paper, so its paper balance can no longer be changed. Nothing was saved.";
export const PAPER_BALANCE_TRADED_LIVE =
  "This agent has traded with real money, and its paper book counts those trades, so its paper balance can no longer be changed. Nothing was saved.";

/** The refusal for each reason the balance is closed. */
export const PAPER_BALANCE_REFUSED: Record<PaperBalanceLock, string> = {
  paper: PAPER_BALANCE_TRADED,
  live: PAPER_BALANCE_TRADED_LIVE,
};

/** Why this value cannot be a paper starting balance, as the sentence to show, or null when it can. */
export function checkPaperStartingUsd(value: unknown): string | null {
  if (typeof value === "number" && value > PAPER_BALANCE_MAX_USD) return PAPER_BALANCE_TOO_HIGH;
  // Written as "not at least", so anything with no amount in it (a string, NaN, nothing
  // at all) is refused here too.
  if (typeof value !== "number" || !(value >= PAPER_BALANCE_MIN_USD)) return PAPER_BALANCE_TOO_LOW;
  return null;
}

/** Whether two balances are the same amount once each is kept to the cent, as the column keeps them. */
export function sameBalance(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}
