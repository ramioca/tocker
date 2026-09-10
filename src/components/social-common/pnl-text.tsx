/**
 * PnL primitives. Green/red is reserved for PnL and nothing else.
 * OWNER: ui-social — dedupe with UI-CORE's equivalent at merge if one exists.
 */
import { cn } from "@/lib/utils";
import { formatPct, formatUsd } from "./format";

export function pnlColor(value: number | null | undefined): string {
  if (value == null || value === 0) return "var(--muted-foreground)";
  return value > 0 ? "var(--positive, #22c55e)" : "var(--negative, #ef4444)";
}

export function PnlText({
  pct,
  usd,
  className,
  size = "md",
}: {
  pct?: number | null;
  usd?: number | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const primary = pct ?? usd ?? null;
  const sizes = { sm: "text-xs", md: "text-sm", lg: "text-lg" } as const;
  return (
    <span
      className={cn("font-mono tabular-nums font-medium", sizes[size], className)}
      style={{ color: pnlColor(primary) }}
    >
      {pct != null ? formatPct(pct) : null}
      {pct != null && usd != null ? <span className="text-muted-foreground"> · </span> : null}
      {usd != null ? formatUsd(usd, { signed: true, compact: true }) : null}
      {pct == null && usd == null ? "—" : null}
    </span>
  );
}
