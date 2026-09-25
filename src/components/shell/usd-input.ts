/**
 * A dollar amount as it is typed: digits and one decimal point, at most two places.
 *
 * Withdraw used to strip only what was not a digit or a dot, so "1.2.3" was accepted
 * (and read as NaN — a dead button with no reason), and "12.3456789" was shown as
 * $12.35 while the unrounded figure went to the wallet. Capping at cents while typing
 * means the number on screen is the number that is signed. Everything after a second
 * point is dropped rather than merged, so a stray keystroke cannot move the decimal.
 */
export function sanitizeUsdInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const point = cleaned.indexOf(".");
  if (point === -1) return cleaned;
  const cents = cleaned.slice(point + 1).split(".")[0].slice(0, 2);
  return `${cleaned.slice(0, point)}.${cents}`;
}
