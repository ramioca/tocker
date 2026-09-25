import { cn } from "@/lib/utils";
import { formatSignedPct, formatSignedUsd } from "./format";

/**
 * The only component allowed to paint green or red. Always signed, always
 * tabular so a column of them never jitters, and zero stays neutral because a
 * flat position is not a win.
 */
export function PnlText({
  usd,
  pct,
  dp = 2,
  className,
  size = "sm",
}: {
  usd?: number | null;
  pct?: number | null;
  /** Decimals on the percentage. Most PnL percentages in the app are printed at 1. */
  dp?: number;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  // Tone follows what is printed: a −0.004% move reads "0.00%", so it is neutral too.
  const basis = usd ?? (pct === null || pct === undefined ? 0 : Number(pct.toFixed(dp)));
  const tone =
    basis > 0 ? "text-positive" : basis < 0 ? "text-negative" : "text-muted-foreground";

  const sizes = {
    xs: "text-[11px]",
    sm: "text-sm",
    md: "text-base",
    lg: "text-2xl",
  } as const;

  return (
    <span className={cn("tnum font-medium", tone, sizes[size], className)}>
      {usd !== undefined && usd !== null ? formatSignedUsd(usd) : null}
      {usd !== undefined && usd !== null && pct !== undefined && pct !== null ? (
        // Weight, not opacity, sets it back: dimmed red on the dark card measured 3.65:1 at
        // 11px, and the percentage is the half of the figure people compare across rows.
        <span className="ml-1.5 font-normal">{formatSignedPct(pct, dp)}</span>
      ) : pct !== undefined && pct !== null ? (
        formatSignedPct(pct, dp)
      ) : null}
    </span>
  );
}

/**
 * Green, red or neutral for a signed number. Pass the `dp` the number is printed at so
 * the colour matches the text: a −0.03% move printed "0.0%" is flat, not a red loss.
 */
export function pnlTone(value: number | null | undefined, dp?: number): string {
  const shown = value === null || value === undefined || dp === undefined ? value : Number(value.toFixed(dp));
  if (shown === null || shown === undefined || shown === 0 || Number.isNaN(shown)) return "text-muted-foreground";
  return shown > 0 ? "text-positive" : "text-negative";
}
