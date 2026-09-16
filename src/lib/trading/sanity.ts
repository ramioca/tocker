/**
 * The last check before real money moves: does the venue's quote agree with what we
 * independently believe the token is worth?
 *
 * This is **not** a slippage guard. Slippage is the difference between the quote and
 * the fill, it is measured after the fact, and the receipt records it. This is the
 * check one step earlier: the quote itself, against a price feed that did not come from
 * the venue. It exists because the ways a first live trade goes catastrophically wrong
 * are not subtle ones —
 *
 *  - a decimals mismatch (the token reports 9, the route assumes 6) misprices by 1000×;
 *  - an address that resolved to a different token with the same symbol;
 *  - a route through an empty pool, where a $100 order moves the price 40×;
 *  - a provider returning a price in the wrong unit.
 *
 * — and every one of them shows up as a quote that is *wildly* off the mark, not
 * fractionally off it. So the default tolerance is deliberately enormous
 * ({@link DEFAULT_MAX_DEVIATION_BPS} = 50%). A memecoin genuinely moving 30% between
 * two feeds mid-launch must not be blocked; a quote 10× off must be. This guard aims at
 * the second and is built to never touch the first.
 *
 * Three refusals to act, each deliberate:
 *
 * 1. **Sells are never checked.** Exits are never blocked by anything — the same rule
 *    the risk guard follows. A token whose price feed has gone strange is exactly the
 *    token you most need to be able to leave.
 * 2. **No reference, no opinion.** A missing or zero mark is missing data, not evidence
 *    of a problem. Blocking on it would take the agent offline every time DexScreener
 *    blinked.
 * 3. **It refuses, it does not adjust.** There is no "cap the size and continue". If
 *    the two numbers disagree by half, we do not know which is right, and guessing with
 *    someone's funded wallet is not a thing this code does.
 */

/** 50%: an order-of-magnitude error trips this; a violent but real move does not. */
export const DEFAULT_MAX_DEVIATION_BPS = 5_000;

/**
 * How far the quote sits from the reference, in basis points of the reference, always
 * positive. `null` when either side is unusable.
 */
export function quoteDeviationBps(quotePriceUsd: number, referencePriceUsd: number | null): number | null {
  if (referencePriceUsd === null || !Number.isFinite(referencePriceUsd) || referencePriceUsd <= 0) return null;
  if (!Number.isFinite(quotePriceUsd) || quotePriceUsd <= 0) return null;
  return Math.abs((quotePriceUsd - referencePriceUsd) / referencePriceUsd) * 10_000;
}

export interface QuoteSanityInput {
  side: "buy" | "sell";
  symbol: string;
  /** Price per whole token the venue quoted. */
  quotePriceUsd: number;
  /** An independently-sourced mark. Null when we have none. */
  referencePriceUsd: number | null;
  maxDeviationBps?: number;
}

export type QuoteSanity =
  | { ok: true; deviationBps: number | null; checked: boolean }
  | { ok: false; deviationBps: number; reason: string };

/**
 * Pure. Returns `ok: true` with `checked: false` whenever there was nothing to compare
 * against, so a caller can tell "agreed" from "could not ask" — the two are very
 * different facts and only one of them is reassuring.
 */
export function checkQuoteSanity(input: QuoteSanityInput): QuoteSanity {
  if (input.side === "sell") return { ok: true, deviationBps: null, checked: false };

  const deviationBps = quoteDeviationBps(input.quotePriceUsd, input.referencePriceUsd);
  if (deviationBps === null) return { ok: true, deviationBps: null, checked: false };

  const limit = input.maxDeviationBps ?? DEFAULT_MAX_DEVIATION_BPS;
  if (deviationBps <= limit) return { ok: true, deviationBps, checked: true };

  const ratio = input.quotePriceUsd / (input.referencePriceUsd as number);
  return {
    ok: false,
    deviationBps,
    reason:
      `Refusing to buy ${input.symbol}: the venue quoted $${input.quotePriceUsd.toPrecision(6)} per token but our ` +
      `independent mark is $${(input.referencePriceUsd as number).toPrecision(6)} — ${ratio >= 1 ? ratio.toFixed(2) : (1 / ratio).toFixed(2)}× ` +
      `${ratio >= 1 ? "higher" : "lower"}, ${(deviationBps / 100).toFixed(0)}% apart. Two prices that far apart mean one of them is ` +
      `wrong (wrong decimals, wrong token, or an empty pool), and this is not a disagreement to resolve with your funds. ` +
      `No order was sent.`,
  };
}
