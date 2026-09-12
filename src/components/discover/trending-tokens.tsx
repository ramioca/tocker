"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { ScoreVerdict, TokenScore } from "@/server/types";
import { TokenScoreRow } from "@/components/tokens/token-candidate-row";
import { VERDICT_META, verdictTint } from "@/components/tokens";
import { cn } from "@/lib/utils";

type SortKey = "score" | "age" | "liquidity" | "change";

const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: "score", label: "Score", hint: "Highest composite first" },
  { key: "age", label: "Newest", hint: "Youngest token first" },
  { key: "liquidity", label: "Liquidity", hint: "Deepest book first" },
  { key: "change", label: "24h", hint: "Biggest move first" },
];

function compare(key: SortKey, a: TokenScore, b: TokenScore): number {
  switch (key) {
    case "age":
      return (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity);
    case "liquidity":
      return (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1);
    case "change":
      return (b.priceChange24hPct ?? -Infinity) - (a.priceChange24hPct ?? -Infinity);
    case "score":
    default:
      return b.total - a.total;
  }
}

/**
 * The fresh-launch scoreboard: what the discovery feeds surfaced recently, what
 * it scored, and — for anything that failed a hard gate — why. Showing the rugs
 * is the point. A board that only lists the winners teaches nobody what a rug
 * looks like at the moment it is still tempting.
 */
export function TrendingTokens({ scores }: { scores: TokenScore[] }) {
  const [sort, setSort] = useState<SortKey>("score");
  const [hideAvoid, setHideAvoid] = useState(false);

  const rows = useMemo(() => {
    const filtered = hideAvoid ? scores.filter((score) => score.verdict !== "avoid") : scores;
    return filtered.slice().sort((a, b) => compare(sort, a, b));
  }, [scores, sort, hideAvoid]);

  const counts = useMemo(() => {
    const tally: Record<ScoreVerdict, number> = { avoid: 0, watch: 0, candidate: 0, strong: 0 };
    for (const score of scores) tally[score.verdict] += 1;
    return tally;
  }, [scores]);

  if (scores.length === 0) {
    return (
      <section aria-labelledby="scoreboard-heading">
        <Heading />
        <p className="mt-5 rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          Nothing has been scored in the last day. Quiet chains, or a quiet sweep.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="scoreboard-heading">
      <Heading />

      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Verdict spread">
        {(["strong", "candidate", "watch", "avoid"] as ScoreVerdict[]).map((verdict) => {
          const meta = VERDICT_META[verdict];
          return (
            <li
              key={verdict}
              className="tnum inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
              style={{
                color: meta.color,
                borderColor: verdictTint(meta.color, 30),
                backgroundColor: verdictTint(meta.color, 8),
              }}
            >
              <span className="font-mono font-semibold">{counts[verdict]}</span>
              <span className="opacity-85">{meta.label.toLowerCase()}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Sort the scoreboard"
          className="flex flex-wrap gap-1 rounded-lg border border-border/70 bg-card/30 p-1"
        >
          {SORTS.map((option) => {
            const active = sort === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={active}
                title={option.hint}
                onClick={() => setSort(option.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  // Tab-like control: colour only, no motion. It gets pressed a lot.
                  "transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={hideAvoid}
          onClick={() => setHideAvoid((value) => !value)}
          className={cn(
            "rounded-lg border px-2.5 py-1.5 text-xs font-medium",
            "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hideAvoid
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Hide blocked
        </button>

        <p className="tnum ml-auto text-xs text-muted-foreground">
          {rows.length} of {scores.length}
        </p>
      </div>

      <div className="mt-3 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
        {rows.map((score) => (
          <TokenScoreRow key={score.tokenId} score={score} showTopBlocker />
        ))}
      </div>
    </section>
  );
}

function Heading() {
  return (
    <div>
      <h2
        id="scoreboard-heading"
        className="flex items-center gap-2 text-lg font-medium tracking-tight"
      >
        <Sparkles className="size-4.5 text-primary" aria-hidden />
        Fresh off the mint
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything the discovery feeds turned up recently, scored 0-100. Tap a row for the
        breakdown and the gates it failed.
      </p>
    </div>
  );
}
