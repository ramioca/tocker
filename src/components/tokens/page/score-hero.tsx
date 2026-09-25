"use client";

import type { ReactNode } from "react";
import type { TokenScore } from "@/server/types";
import { formatRelative } from "@/components/common/format";
import { BlockerList, visibleWarnings } from "@/components/tokens/blocker-list";
import { ScoreBreakdown } from "@/components/tokens/score-breakdown";
import { ScoreDial } from "@/components/tokens/score-dial";
import { VERDICT_META, effectiveVerdict } from "@/components/tokens/verdict";
import { GateList } from "./gate-list";
import { cn } from "@/lib/utils";

/**
 * The verdict, in three columns: the number, where it came from, and what it had
 * to clear.
 *
 * The dial is the one place on the page that animates. A token page is opened
 * deliberately — it is not a feed row — so a single 700ms sweep on the headline
 * number is earned; everything else here is static because it is dense reading.
 *
 * The score shown is always computed under the platform's **default** universe.
 * A public page cannot show a verdict computed against an operator's private
 * thresholds without publishing those thresholds.
 */
export function ScoreHero({
  score,
  action,
  className,
}: {
  score: TokenScore;
  /** Usually the "Block on…" menu. */
  action?: ReactNode;
  className?: string;
}) {
  const verdict = score.verdict ?? effectiveVerdict(score.total, score.blockers);
  const meta = VERDICT_META[verdict];
  // The gates are listed beside it, so a warning that repeats a failed gate goes.
  const warnings = visibleWarnings(score.warnings, score.blockers);

  return (
    <section
      aria-labelledby="score-hero-heading"
      className={cn("rounded-2xl border border-border/80 bg-card/50 p-4 sm:p-5", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="score-hero-heading" className="text-sm font-medium tracking-tight">
          Score
        </h2>
        <div className="flex items-center gap-2">
          <p className="tnum font-mono text-[11px] text-muted-foreground">
            {score.sources.length > 0 ? `${score.sources.join(" + ")} · ` : ""}
            {formatRelative(score.scoredAt)}
          </p>
          {action}
        </div>
      </div>

      <div className="mt-3 grid gap-5 sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_1fr] lg:gap-6">
        <div className="flex flex-col items-center gap-2 self-start">
          <ScoreDial total={score.total} verdict={verdict} blockers={score.blockers} size={132} />
          <p className="max-w-[9.5rem] text-center text-[11px] leading-relaxed text-muted-foreground">
            {meta.meaning}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            How the number was built
          </p>
          <ScoreBreakdown components={score.components} className="mt-2" />
          {warnings.length > 0 ? (
            <BlockerList warnings={warnings} audience="public" className="mt-3" max={4} />
          ) : null}
        </div>

        <GateList blockers={score.blockers} className="lg:border-l lg:border-border/60 lg:pl-6" />
      </div>
    </section>
  );
}
