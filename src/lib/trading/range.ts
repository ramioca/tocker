/**
 * Recent price range for a token, for volatility-scaled sizing.
 *
 * The range comes from `token_score_history`, which already stores a price with every
 * scoring — so measuring volatility costs one indexed read and no provider call. That
 * matters: sizing runs on every order, and a sizing mode that fans out to a price API
 * would be a sizing mode nobody could afford to leave on.
 *
 * The honest caveat, stated here rather than hidden: history is sampled at scoring
 * time, not per candle, so this is the range *we observed*, not the true intraday high
 * and low. It under-reports rather than over-reports, which for a mode that only ever
 * shrinks tickets means it errs towards the normal size — never towards a bigger one.
 */
import { getScoreHistory } from "@/lib/tokens/history";
import { rangePctFrom } from "./sizing";

/** Days of history a range asks for. One is enough to catch a launch going vertical. */
export const RANGE_DAYS = 1;

/**
 * High-to-low range over the last day as a percent of the latest price, or `null` when
 * we have fewer than three observations. Never throws — no range means the sizing
 * functions simply have no opinion and fall back to percent-of-equity.
 */
export async function recentRangePct(tokenId: string, days = RANGE_DAYS): Promise<number | null> {
  try {
    const history = await getScoreHistory(tokenId, { days, limit: 200 });
    return rangePctFrom(history.map((p) => p.priceUsd));
  } catch {
    return null;
  }
}
