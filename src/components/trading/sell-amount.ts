/**
 * Dollar figures for a sell typed against a position's mark.
 *
 * The risk guard refuses a sell larger than the position is worth, to the billionth of
 * a dollar. A figure pre-filled with `toFixed(2)` rounds half the time *up* — $3,528.146
 * becomes "3528.15" — so the dialog's own default was refused and "Sell everything"
 * never enabled. Flooring to the cent keeps every figure the dialog offers inside the
 * mark, which is what the guard checks against.
 */

/**
 * `value` rounded down to whole cents. The nudge absorbs float noise, so a value that is
 * exactly 3528.15 on paper (3528.1499999… in binary) stays 3528.15 rather than dropping
 * a cent. It is 1e-7 of a cent — a billionth of a dollar, the guard's own tolerance — so
 * the result can never exceed the value by more than the guard forgives.
 */
export function floorCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * 100 + 1e-7) / 100;
}

/** The typed text for `pct` percent of a position worth `valueUsd`, never above the mark. */
export function sliceText(valueUsd: number, pct: number): string {
  return floorCents((valueUsd * pct) / 100).toFixed(2);
}

/**
 * A share of the position, as the dialog and the published note say it. Whole percents
 * called a $10 sell of a $2,140 position "0% of the position" — in the trade's public
 * note too — so small shares keep a decimal and anything under 1% says so.
 */
export function pctLabel(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct < 10) return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(pct)}%`;
}

/**
 * The shares of a position offered as one-tap sell sizes. One list, so the Trade sheet
 * and the Sell position dialog stop offering different slices of the same holding.
 */
export const SELL_SLICES = [25, 50, 75, 100] as const;

/** A slice chip's text: 100% is "All". */
export function sliceLabel(pct: number): string {
  return pct === 100 ? "All" : `${pct}%`;
}
