"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import type { ScoreVerdict, TokenScore } from "@/server/types";
import { TokenScoreRow } from "@/components/tokens/token-candidate-row";
import { VERDICT_META, verdictTint } from "@/components/tokens";
import { EmptyState } from "@/components/common/empty-state";
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
        <RadarHeading />
        <EmptyState
          className="mt-5"
          icon={<Sparkles />}
          title="Nothing scored in the last day"
          description="Quiet chains, or a quiet sweep. The board fills itself from the free discovery feeds the moment an agent runs."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="scoreboard-heading">
      <RadarHeading />

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
          className="glass-card flex flex-wrap gap-1 rounded-lg p-1"
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
          {/* "avoid", the verdict the chips above count — not "blocked", which is the
              blocklist's word and means something an owner did. */}
          Hide avoid
        </button>

        <p className="tnum ml-auto text-xs text-muted-foreground">
          {rows.length} of {scores.length}
        </p>
      </div>

      <div className="glass-panel mt-3 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
        {rows.map((score) => (
          /*
            The row is a disclosure — expanding the breakdown in place is the cheaper
            action and stays the primary one. The page link sits *beside* it.

            It used to be absolutely positioned over the row (`top-2 right-10`), which
            put it straight through the score badge on any row tall enough to matter —
            the highest-scoring five, where the badge is the thing you are reading. An
            overlay on a row whose internals this file does not own can only ever guess
            at where the gaps are, and the gaps move with the content. So: a real column
            in a flex row. The link cannot collide with anything because the row is
            sized around it.
          */
          <div key={score.tokenId} className="group/row flex items-start">
            <TokenScoreRow
              score={score}
              showTopBlocker
              emphasizeChange={sort === "change"}
              href={`/tokens/${score.chain}/${score.address}`}
              className="min-w-0 flex-1"
            />
            <Link
              href={`/tokens/${score.chain}/${score.address}`}
              aria-label={`Open the ${score.symbol} token page`}
              title="Token page"
              className={cn(
                // Hidden on a phone, where the row is two dense lines and the chevron —
                // opening the breakdown — is the thing you actually want on that screen.
                // The open breakdown carries its own "Open token page" link there.
                "mt-2 mr-2 hidden shrink-0 items-center gap-1 rounded-md px-1.5 py-1 sm:inline-flex",
                // Permanently visible at 70% rather than hover-only: a link nobody can
                // see is a link nobody uses.
                "text-[10px] text-muted-foreground opacity-70 transition-opacity duration-150",
                "focus-ring hover:bg-muted hover:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100",
              )}
            >
              <span className="hidden lg:inline">Token page</span>
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Also the streaming fallback's heading (`radar-section.tsx`), so it does not jump. */
export function RadarHeading() {
  return (
    <div>
      <h2
        id="scoreboard-heading"
        className="flex items-center gap-2 text-lg font-medium tracking-tight"
      >
        <Sparkles className="size-4.5 text-primary" aria-hidden />
        On the sweep&rsquo;s radar
      </h2>
      {/* The sweep reads the trending and top-organic feeds as well as new launches, so
          a three-year-old token can sit here. The copy says what it is, not "fresh". */}
      <p className="mt-1 text-sm text-muted-foreground">
        New launches, trending and top organic tokens from the discovery feeds, scored 0-100.
        Tap a row for the breakdown and the gates it failed.
      </p>
    </div>
  );
}
