/**
 * The hard gates, pass and fail, in the order SPEC lists them.
 *
 * A list of failures alone is misleading: "one blocker" reads very differently
 * from "one of nine checks failed". So every gate is shown with a green check or
 * a red cross, and a failing one borrows its sentence from
 * {@link explainBlocker} — the same prose the run transcript and the model's
 * prompt see, so the UI and the agent can never tell different stories.
 *
 * Server-safe: no state, no motion. It sits inside a page a person opened
 * deliberately, and it must be readable before hydration.
 */
import { Check, X } from "lucide-react";
import { explainBlocker } from "@/lib/tokens/score";
import { cn } from "@/lib/utils";

/** Same warm amber the blocker list uses. Red belongs to PnL. */
const FAIL = "oklch(0.7 0.16 45)";
const PASS = "oklch(0.72 0.15 158)";

interface Gate {
  id: string;
  label: string;
  /** What the gate guarantees when it passes. */
  passes: string;
  /** Blocker codes that mean this gate failed. */
  matches: (code: string) => boolean;
}

const GATES: Gate[] = [
  {
    id: "blocklist",
    label: "Not blocklisted",
    passes: "Not on the platform blocklist",
    matches: (code) => code === "blocklisted",
  },
  {
    id: "mint",
    label: "Mint authority revoked",
    passes: "Supply cannot be inflated",
    matches: (code) => code.startsWith("mint_authority"),
  },
  {
    id: "freeze",
    label: "Freeze authority revoked",
    passes: "Balances cannot be frozen",
    matches: (code) => code.startsWith("freeze_authority"),
  },
  {
    id: "honeypot",
    label: "Not a honeypot",
    passes: "Sells go through",
    matches: (code) => code === "honeypot",
  },
  {
    id: "tax",
    label: "Transfer tax within limits",
    passes: "No punitive buy or sell tax",
    matches: (code) => code.startsWith("buy_tax_") || code.startsWith("sell_tax_"),
  },
  {
    id: "liquidity",
    label: "Liquidity above the floor",
    passes: "Deep enough to get back out",
    matches: (code) => code.startsWith("liquidity_"),
  },
  {
    id: "holders",
    label: "Enough holders",
    passes: "Held by more than a handful of wallets",
    matches: (code) => code.startsWith("holder_count") || code === "holders_below_floor",
  },
  {
    id: "age",
    label: "Age inside the window",
    passes: "Past the first-minutes rug window",
    matches: (code) => code.startsWith("age_"),
  },
  {
    id: "top10",
    label: "Supply not concentrated",
    passes: "Top 10 wallets hold under the ceiling",
    matches: (code) => code.startsWith("top10_holders"),
  },
];

export function GateList({
  blockers,
  className,
}: {
  blockers: readonly string[];
  className?: string;
}) {
  const rows = GATES.map((gate) => {
    const failing = blockers.filter((code) => gate.matches(code));
    return { gate, failing };
  });
  // Anything the gate table does not recognise still has to surface.
  const unmatched = blockers.filter((code) => !GATES.some((gate) => gate.matches(code)));
  const failed = rows.filter((row) => row.failing.length > 0).length + unmatched.length;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Hard gates
        </p>
        <p className="tnum font-mono text-[11px]" style={{ color: failed > 0 ? FAIL : PASS }}>
          {failed === 0 ? `${GATES.length} passed` : `${failed} failed`}
        </p>
      </div>

      <ul className="mt-2 space-y-1">
        {rows.map(({ gate, failing }) => {
          const ok = failing.length === 0;
          const color = ok ? PASS : FAIL;
          return (
            <li key={gate.id} className="flex items-start gap-2">
              {ok ? (
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
              ) : (
                <X aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color }} />
              )}
              <span className="min-w-0">
                <span className={cn("block text-xs leading-relaxed", ok ? "text-foreground/80" : "font-medium")}>
                  {ok ? gate.passes : capitalise(failing.map(explainBlocker).join("; "))}
                </span>
                <span className="sr-only">{ok ? "passed" : "failed"}: {gate.label}</span>
              </span>
            </li>
          );
        })}
        {unmatched.map((code) => (
          <li key={code} className="flex items-start gap-2">
            <X aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color: FAIL }} />
            <span className="text-xs leading-relaxed font-medium">{capitalise(explainBlocker(code))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}
