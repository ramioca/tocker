/**
 * The slippage tolerance one manual sell runs under.
 *
 * An agent's Slippage tolerance is the ceiling on every order it places, and it was the
 * ceiling on the owner's own exits too: on a token moving faster than that setting, the
 * only way out was to leave the sell, change the agent's settings, and come back. The
 * owner may instead widen it for the one sell in front of them.
 *
 * Deliberately narrow. Sells only: a buy has no urgency that justifies a worse fill. It
 * can only widen, never tighten, so it cannot be used to place an order the agent's own
 * setting would send anyway but that is more likely to fail on chain. And it stops at
 * 15%, the loosest tolerance the Solana executor already accepts on its own when
 * Jupiter refuses the agent's number. Anything else is ignored and the agent's setting
 * applies, rather than refusing the sell: an exit is never blocked over this field.
 *
 * Pure and dependency-free, so the action, the Sell dialog and the Trade sheet share it.
 */

/** The widest tolerance an owner may pick for one manual sell: 15%. */
export const MAX_MANUAL_SELL_SLIPPAGE_BPS = 1_500;

/** The wider choices a sell surface offers, before the agent's own setting is applied. */
const WIDER_STEPS_BPS: readonly number[] = [500, 1_000, MAX_MANUAL_SELL_SLIPPAGE_BPS];

/**
 * The tolerance to send to the venue and record on the receipt: `requestedBps` when it
 * is a sell's whole number of basis points between the agent's own setting and the cap,
 * the agent's setting otherwise. `requestedBps` arrives from the browser, so it is
 * `unknown` until proven a number.
 */
export function manualSellSlippageBps(input: {
  side: "buy" | "sell";
  /** The agent's own Slippage tolerance. */
  agentBps: number;
  requestedBps: unknown;
}): number {
  const { side, agentBps, requestedBps } = input;
  if (side !== "sell") return agentBps;
  if (typeof requestedBps !== "number" || !Number.isInteger(requestedBps)) return agentBps;
  if (requestedBps < agentBps || requestedBps > MAX_MANUAL_SELL_SLIPPAGE_BPS) return agentBps;
  return requestedBps;
}

/** 5%, 10% and 15%, less whatever the agent's own setting already covers. */
export function widerSlippageChoices(agentBps: number): number[] {
  return WIDER_STEPS_BPS.filter((bps) => bps > agentBps);
}

/** "3%" for 300 bps, "2.5%" for 250. */
export function slippagePctLabel(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}
