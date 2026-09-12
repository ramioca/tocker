/**
 * The smallest unit of the score vocabulary: a number and the word for it.
 * Server-safe, no motion — it shows up in lists and a list is a hot path.
 */
import type { ScoreVerdict } from "@/server/types";
import { cn } from "@/lib/utils";
import { VERDICT_META, effectiveVerdict, verdictColor, verdictTint } from "./verdict";

const SIZES = {
  xs: "h-5 gap-1 px-1.5 text-[10px]",
  sm: "h-6 gap-1.5 px-2 text-[11px]",
  md: "h-7 gap-1.5 px-2.5 text-xs",
} as const;

export function ScoreBadge({
  total,
  verdict,
  blockers,
  size = "sm",
  /** Hide the word and show only the number — for dense tables. */
  numberOnly = false,
  className,
}: {
  total: number;
  /** Pass the server's verdict when you have it; otherwise it is derived. */
  verdict?: ScoreVerdict;
  blockers?: readonly string[];
  size?: keyof typeof SIZES;
  numberOnly?: boolean;
  className?: string;
}) {
  const resolved = verdict ?? effectiveVerdict(total, blockers);
  const meta = VERDICT_META[resolved];
  const color = verdictColor(resolved);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium whitespace-nowrap",
        SIZES[size],
        className,
      )}
      style={{
        color,
        backgroundColor: verdictTint(color, 12),
        borderColor: verdictTint(color, 30),
      }}
      title={`${Math.round(total)} / 100 — ${meta.label}. ${meta.meaning}`}
    >
      <span className="tnum font-mono font-semibold">{Math.round(total)}</span>
      {numberOnly ? (
        <span className="sr-only">{meta.label}</span>
      ) : (
        <span className="opacity-85">{meta.label}</span>
      )}
    </span>
  );
}

/** The four bands laid out end to end. Used under the score slider in the builder. */
export function VerdictScale({
  active,
  className,
}: {
  active: ScoreVerdict;
  className?: string;
}) {
  const order: ScoreVerdict[] = ["avoid", "watch", "candidate", "strong"];
  return (
    <ul className={cn("flex gap-1", className)}>
      {order.map((verdict) => {
        const isActive = verdict === active;
        const color = verdictColor(verdict);
        return (
          <li
            key={verdict}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "flex-1 rounded-md border px-1.5 py-1 text-center text-[10px] font-medium",
              // Colour only, so the row never reflows as the slider moves.
              "transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            )}
            style={
              isActive
                ? {
                    color,
                    backgroundColor: verdictTint(color, 14),
                    borderColor: verdictTint(color, 34),
                  }
                : {
                    color: "var(--muted-foreground)",
                    backgroundColor: "transparent",
                    borderColor: "var(--border)",
                  }
            }
          >
            {VERDICT_META[verdict].label}
            <span className="tnum ml-1 hidden font-mono opacity-60 sm:inline">
              {VERDICT_META[verdict].range}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
