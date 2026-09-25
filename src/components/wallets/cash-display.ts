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
