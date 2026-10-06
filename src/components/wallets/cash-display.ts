import { floorCents } from "@/components/shell/withdraw-amount";
import type { UnifiedCash } from "@/lib/wallets/funding";

/**
 * Cash is shown floored to the cent, never rounded. USDC has six decimals, so 12.349 is
 * a normal balance: rounded it reads "$12.35" here while Withdraw (which can only send
 * what is there) offers "$12.34", and the two screens disagree about the same wallet.
 */
export const shownUsdc = (usdcUsd: number) => floorCents(usdcUsd);

/**
 * The headline figure, as the sum of the floored per-chain figures so the rows under it
 * always add up to it. Agent equity is marked, not spendable, so it is added as is.
 */
export function shownCashTotal(cash: UnifiedCash, scope: "own" | "all" = "own"): number {
  const own = cash.perChain.reduce((sum, c) => sum + shownUsdc(c.usdcUsd), 0);
  // Summed in cents: adding floats of cents drifts (0.1 + 0.2).
  const ownRounded = Math.round(own * 100) / 100;
  return scope === "all" ? Math.round((ownRounded + cash.inAgentsUsd) * 100) / 100 : ownRounded;
}

/**
 * True when {@link shownCashTotal} for this scope is missing something that could not be
 * read: one of the user's wallets, or (on the all-in figure) one of their agents. The
 * sum is then a floor and is not printed as the balance. A failed read shown as "$0.00"
 * is a person told their money is gone.
 */
export function cashUnavailable(cash: UnifiedCash, scope: "own" | "all" = "own"): boolean {
  const ownUnread = cash.perChain.some((c) => c.readFailed === true);
  return scope === "all" ? ownUnread || cash.partial === true : ownUnread;
}

/** What is said in place of a balance that could not be read. */
export const BALANCE_UNAVAILABLE = "Balance unavailable right now";

/**
 * What the all-in figure is called. "Cash" is spendable USDC; once the figure also
 * counts what agents hold (some of it open positions) it is a total, and calling it cash
 * made the top bar and Home's Cash print two different numbers under one word.
 */
export function cashScopeLabel(cash: UnifiedCash | undefined): "cash" | "total" {
  return cash && cash.agents.length > 0 ? "total" : "cash";
}

/** The Cash panel's title, naming what its headline figure adds up. */
export function cashPanelTitle(cash: UnifiedCash | undefined): string {
  if (!cash || cash.agents.length === 0) return "Cash";
  return cash.agents.some((agent) => agent.parked) ? "Cash + agents" : "Cash + live agents";
}

/** The legend's first clause: what the headline figure is made of, in the panel's own words. */
export function cashLegendLead(cash: UnifiedCash): string {
  const wallets = "USDC across your wallets on Base and Solana";
  const live = cash.agents.some((agent) => !agent.parked);
  const parked = cash.agents.some((agent) => agent.parked);
  const liveClause = "live agents' equity (their cash and open positions at today's marks)";
  const parkedClause = "USDC waiting in agents that are not live yet";
  if (live && parked) return `Total is ${wallets}, plus what your agents hold: ${liveClause} and ${parkedClause}`;
  if (live) return `Total is ${wallets}, plus your ${liveClause}`;
  if (parked) return `Total is ${wallets}, plus ${parkedClause}`;
  return `Cash is ${wallets}`;
}
