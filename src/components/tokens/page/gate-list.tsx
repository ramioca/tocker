/**
 * The hard gates, pass and fail, in the order SPEC lists them.
 *
 * A list of failures alone is misleading: "one blocker" reads very differently
 * from "one of nine checks failed". So every gate is shown with a green check or
 * a red cross, and a failing one borrows its sentence from {@link describeBlocker}
 * — the same words the Discover radar uses for the same failure, in the public
 * voice ("the platform's floor"), because this score was taken under the default
 * universe and there is no "your" to address. `explainBlocker` stays the prompt's
 * vocabulary; it is written for a model, not a reader.
 *
 * A gate no provider could answer is neither: an `*_unknown` code, or the honeypot and
 * tax gates when nothing that simulates a sell was read. Those rows say "Couldn't
 * check" with a muted icon and are counted apart from the failures — a green check
 * there would claim a sell was tested when nobody tested it.
 *
 * Server-safe: no state, no motion. It sits inside a page a person opened
 * deliberately, and it must be readable before hydration.
 */
import { Check, CircleHelp, X } from "lucide-react";
import { describeBlocker } from "@/components/tokens/blocker-copy";
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
  /** Needs a source that checks sells; without one, "no blocker" is not a pass. */
  needsSellCheck?: boolean;
  /** What to say when it could not be checked and no code says it better. */
  unchecked?: string;
}

/** Sources whose reading covers honeypot and transfer tax. GoPlus simulates both on Base. */
const SELL_CHECK_SOURCES = new Set(["goplus"]);

const isUnknown = (code: string) => code.endsWith("_unknown");

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
    needsSellCheck: true,
    unchecked: "Couldn't check whether sells go through",
  },
  {
    id: "tax",
    label: "Transfer tax within limits",
    passes: "No punitive buy or sell tax",
    matches: (code) => code.startsWith("buy_tax_") || code.startsWith("sell_tax_"),
    needsSellCheck: true,
    unchecked: "Couldn't check the buy and sell tax",
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

type RowState = "pass" | "fail" | "unknown";

export function GateList({
  blockers,
  sources = [],
  className,
}: {
  blockers: readonly string[];
  /** Which providers the reading came from; decides whether the sell gates were checked. */
  sources?: readonly string[];
  className?: string;
}) {
  const sellChecked = sources.some((source) => SELL_CHECK_SOURCES.has(source));
  const rows = GATES.map((gate) => {
    const codes = blockers.filter((code) => gate.matches(code));
    const failing = codes.filter((code) => !isUnknown(code));
    const unknown = codes.filter(isUnknown);
    const state: RowState =
      failing.length > 0 ? "fail" : unknown.length > 0 || (gate.needsSellCheck && !sellChecked) ? "unknown" : "pass";
    const text =
      state === "pass"
        ? gate.passes
        : state === "fail"
          ? failing.map((code) => describeBlocker(code, "public").title).join("; ")
          : unknown.length > 0
            ? unknown.map((code) => describeBlocker(code, "public").title).join("; ")
            : (gate.unchecked ?? `Couldn't check: ${gate.label.toLowerCase()}`);
    return { key: gate.id, state, text };
  });
  // Anything the gate table does not recognise still has to surface.
  for (const code of blockers) {
    if (GATES.some((gate) => gate.matches(code))) continue;
    rows.push({ key: code, state: isUnknown(code) ? "unknown" : "fail", text: describeBlocker(code, "public").title });
  }
  const failed = rows.filter((row) => row.state === "fail").length;
  const unchecked = rows.filter((row) => row.state === "unknown").length;
  const passed = rows.filter((row) => row.state === "pass").length;
  const tally = [failed > 0 ? `${failed} failed` : `${passed} passed`, unchecked > 0 ? `${unchecked} unchecked` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Hard gates
        </p>
        <p
          className={cn("tnum font-mono text-[11px]", failed === 0 && unchecked > 0 && "text-muted-foreground")}
          style={failed > 0 ? { color: FAIL } : unchecked > 0 ? undefined : { color: PASS }}
        >
          {tally}
        </p>
      </div>

      <ul className="mt-2 space-y-1">
        {rows.map(({ key, state, text }) => (
          <li key={key} className="flex items-start gap-2">
            {state === "pass" ? (
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color: PASS }} />
            ) : state === "fail" ? (
              <X aria-hidden className="mt-0.5 size-3.5 shrink-0" style={{ color: FAIL }} />
            ) : (
              <CircleHelp aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0">
              {/* The verdict leads, the way the icon does: after the sentence, and with
                  the gate's pass-name, a failure read "…not revoked failed: Mint
                  authority revoked" — which sounds like a pass. */}
              <span
                className={cn(
                  "block text-xs leading-relaxed",
                  state === "pass" ? "text-foreground/80" : state === "fail" ? "font-medium" : "text-muted-foreground",
                )}
              >
                <span className="sr-only">
                  {state === "pass" ? "Passed: " : state === "fail" ? "Failed: " : "Not checked: "}
                </span>
                {text}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
