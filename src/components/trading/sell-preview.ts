/**
 * What the two manual-sell surfaces (the Sell position dialog and the Trade sheet) say
 * around a preview, in one place so they say the same thing.
 *
 * The rule behind every sentence here: a preview is a courtesy, not a gate. The order is
 * checked and priced again on the server the moment it is confirmed, so a preview that
 * failed, timed out or could not get a quote must never be the reason someone cannot
 * get out of a position. It says what it could not find out, and leaves Sell enabled.
 */
import type { Chain } from "@/server/types";

/** How long a preview may stay silent before the surface stops waiting on it. */
export const PREVIEW_PATIENCE_MS = 8_000;

/** The preview request threw: offline, a deploy in flight, a framework 500. */
export const PREVIEW_FAILED = "Couldn't load a preview.";
/** Nothing came back within {@link PREVIEW_PATIENCE_MS}. A late answer still replaces it. */
export const PREVIEW_SLOW = "The preview is taking a while.";
/** Follows either of the above, and any error a sell's preview returned. */
export const STILL_SELLABLE = "You can still sell: the order is checked and priced again when you confirm.";

/** A sell's preview error, followed by the sentence that it does not hold the exit shut. */
export function unpreviewedLine(error: string): string {
  const said = error.trim();
  // Some of the action's refusals are fragments ("Sign in first"); finish the sentence.
  return `${/[.!?…]$/.test(said) ? said : `${said}.`} ${STILL_SELLABLE}`;
}

/** Shown while a sell is in flight. */
export const SENDING_SELL = "Sending the order. A live sell can take up to a minute. Keep this open.";

/** What confirming will do, said for the venue this position actually sells on. */
export function sellVenueLine(chain: Chain, isPaper: boolean): string {
  if (isPaper) return "Simulated at the live price. No real tokens move.";
  return chain === "solana"
    ? "Sells at Jupiter's price the moment you confirm."
    : "Sells through a swap on Base the moment you confirm.";
}

/** The status line when the venue did not quote; `note` is the server's reason. */
export function noQuoteLine(note: string | null | undefined): string {
  const reason = note?.trim();
  return `No live quote right now. ${reason ? `${reason} ` : ""}You can still sell: the order is priced again when you confirm.`;
}

/** A quote this far under the last price is worth a sentence. */
const THIN_POOL_PCT = 3;

/**
 * How far the quoted proceeds sit under the slice's value at the last price, in percent,
 * when that is more than 3%; null otherwise. On a thin pool the gap is the price impact
 * of the sale itself, and a smaller slice pays less of it.
 */
export function thinPoolPct(proceedsUsd: number | null | undefined, markValueUsd: number | null | undefined): number | null {
  if (typeof proceedsUsd !== "number" || typeof markValueUsd !== "number") return null;
  if (!Number.isFinite(proceedsUsd) || !Number.isFinite(markValueUsd) || markValueUsd <= 0 || proceedsUsd < 0) return null;
  const under = (1 - proceedsUsd / markValueUsd) * 100;
  // The margin is float noise: $97 on $100 computes to 3.0000000000000027.
  return under - THIN_POOL_PCT > 1e-9 ? under : null;
}

/** "That is 7.4% under the last price: …" */
export function thinPoolLine(pct: number): string {
  const shown = pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1).replace(/\.0$/, "");
  return `That is ${shown}% under the last price: this pool is thin. Smaller slices may sell better.`;
}

/** The fees a preview carries: Tocker's flat fee, and the venue's when it quoted one. */
type PreviewFees = { tockerUsd: number; venueUsd: number | null };

/**
 * The label of the row under Fees, or null when the preview knows of no fee to take off
 * (the proceeds line is then already the whole answer). A venue that did not quote its
 * fee is not counted, and the label says so rather than calling the figure "after fees".
 */
export function afterFeesLabel(fees: PreviewFees | null | undefined): string | null {
  if (!fees) return null;
  const tocker = fees.tockerUsd > 0;
  const venue = fees.venueUsd !== null && fees.venueUsd > 0;
  if (!tocker && !venue) return null;
  return tocker && fees.venueUsd === null ? "After the Tocker fee ≈" : "After fees ≈";
}

/**
 * What a quoted sale leaves once those fees are taken off, the way the book counts a
 * sell (`applyFillToPosition`, `realisedOnSale`): proceeds less the venue's fee and
 * Tocker's. The fees are the preview's own figures, never a constant. Null without a
 * quote. Can go below zero, and should: selling a few cents of dust costs more than it
 * brings in, and that is worth seeing before confirming.
 */
export function proceedsAfterFees(proceedsUsd: number | null | undefined, fees: PreviewFees): number | null {
  if (typeof proceedsUsd !== "number" || !Number.isFinite(proceedsUsd)) return null;
  const tocker = fees.tockerUsd > 0 ? fees.tockerUsd : 0;
  const venue = fees.venueUsd !== null && fees.venueUsd > 0 ? fees.venueUsd : 0;
  return proceedsUsd - tocker - venue;
}

/**
 * What one sale realised, after every fee, the way the position row books it
 * (`applyFillToPosition`): proceeds less fees, less the average cost of the tokens sold.
 * Display only. `pct` is against that cost and null when there is none to measure from.
 */
export function realisedOnSale(input: {
  /** Gross USD the fill paid. */
  amountUsd: number;
  amountToken: number;
  /** Venue, network and platform fees together (the receipt's total). */
  totalFeeUsd: number;
  /** What the position held and cost per token, read before the sale. */
  heldToken: number;
  avgCostUsd: number;
}): { usd: number; pct: number | null } {
  // The book never realises more tokens than it held, whatever the venue reports sold.
  const sold = Math.min(input.amountToken, input.heldToken);
  const basis = sold * input.avgCostUsd;
  const usd = input.amountUsd - input.totalFeeUsd - basis;
  return { usd, pct: basis > 0 ? (usd / basis) * 100 : null };
}
