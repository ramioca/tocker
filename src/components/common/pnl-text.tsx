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
  className,
  size = "sm",
}: {
  usd?: number | null;
  pct?: number | null;
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const basis = usd ?? pct ?? 0;
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
        <span className="ml-1.5 opacity-70">{formatSignedPct(pct)}</span>
      ) : pct !== undefined && pct !== null ? (
        formatSignedPct(pct)
      ) : null}
    </span>
  );
}

export function pnlTone(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "text-muted-foreground";
  return value > 0 ? "text-positive" : "text-negative";
}
