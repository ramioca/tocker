/**
 * Reading a number somebody typed into a slider's exact-value box. The box shows the
 * formatted value ("$400.00", "−15%", "300 bps") and people type the same shapes back,
 * so currency, grouping and percent marks are tolerated — but nothing else is. The old
 * reader stripped every non-digit, so "abc" became the minimum, "1e3" became 13 and a
 * "-20" stop loss became −1%.
 */
export type ParseValue = (text: string) => number | null;

const NUMBER = /^-?\d*\.?\d+$/;

/** Strip `$`, `,`, `%` and whitespace; anything left must be a plain decimal. */
export function parseTypedNumber(text: string): number | null {
  const cleaned = text.replace(/[$,%\s]/g, "").replace(/^[−–]/, "-");
  if (!NUMBER.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** For thresholds shown as a drop ("−15%"): the sign is decoration, "-20" means 20. */
export const parseMagnitude: ParseValue = (text) => {
  const parsed = parseTypedNumber(text);
  return parsed === null ? null : Math.abs(parsed);
};

/** Slippage is stored in bps, but people think in percent: "1.5%" is 150 bps, "150" is 150. */
export const parseBps: ParseValue = (text) => {
  const trimmed = text.trim().replace(/\s*bps$/i, "");
  const parsed = parseTypedNumber(trimmed);
  if (parsed === null) return null;
  return trimmed.endsWith("%") ? Math.round(parsed * 100) : parsed;
};
