"use client";

/**
 * What these floors would have let through.
 *
 * The bug: a one-hour `maxAgeHours` emptied every sweep, and the only place that
 * showed up was the next morning's run summary. A threshold form that cannot answer
 * "and what does that do?" makes the operator learn from production. So the sliders
 * now carry their own consequence, read off the last 24 hours of score history and
 * held next to the settings that are actually saved.
 *
 * Four rules it lives by:
 *  - it never blocks Save. It is a read, it is debounced, it fails to one muted
 *    sentence, and nothing about the form waits on it.
 *  - it never shifts the layout. The skeleton is the shape of an answer, and once
 *    there are numbers they stay on screen — a refetch dims them rather than
 *    replacing them with a shimmer. Dragging a slider must not move the Save button.
 *  - it never re-animates. This block updates every time a slider settles, which is
 *    tens of times in one sitting; a fade on each one is decoration to look past.
 *  - it never overstates. History cannot answer the authority, concentration or age
 *    gates for every token, and the line under the count says exactly which.
 */

import { useEffect, useRef, useState } from "react";
import { GeckoTerminalLink } from "@/components/common/chart-link";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { formatAge, formatCompactUsd, formatHolders } from "@/components/tokens";
import { previewUniverseAction, type UniversePreviewPair } from "@/server/actions/universe-preview";
import { cn } from "@/lib/utils";
import type { UniverseConfig } from "@/components/agents/builder/types";
import type { Chain } from "@/server/types";

/**
 * 600ms. Long enough that dragging a slider across its ladder fires one query rather
 * than eleven, short enough that letting go feels like it answered immediately. The
 * first load skips it: the section should already say something when it is reached.
 */
const DEBOUNCE_MS = 600;

/** Six rows: enough to recognise what cleared the bar, not so many it becomes a table. */
const VISIBLE_EXAMPLES = 6;

export function UniversePreview({
  agentId,
  universe,
  chains,
  className,
}: {
  agentId: string;
  /** The form's live universe — this re-runs whenever any of it changes. */
  universe: UniverseConfig;
  /** The form's live chains, so toggling one is reflected rather than ignored. */
  chains: Chain[];
  className?: string;
}) {
  const [pair, setPair] = useState<UniversePreviewPair | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which universe the numbers on screen answer for. Pending is derived — the current
  // bar has no answer yet — rather than flipped on and off in the effect.
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);

  // The universe is a fresh object on every change, so the effect keys off its
  // content. Chains ride along: a chain toggle changes what the preview should scan.
  // The timer reads the request back out of the same string, so the effect depends on
  // one content hash rather than on two object identities that change every render.
  const key = JSON.stringify([chains, universe]);
  const pending = answeredKey !== key;
  // Responses can land out of order — a wide bar takes longer than a narrow one.
  // Only the newest request is allowed to write.
  const latest = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const seq = (latest.current += 1);
    const delay = mounted.current ? DEBOUNCE_MS : 0;
    mounted.current = true;
    const requestKey = key;

    const timer = setTimeout(() => {
      void (async () => {
        const [c, u] = JSON.parse(requestKey) as [Chain[], UniverseConfig];
        try {
          const result = await previewUniverseAction(agentId, u, c);
          if (seq !== latest.current) return;
          if (result.ok) {
            setPair(result.data);
            setError(null);
          } else {
            setError(result.error);
          }
        } catch {
          if (seq !== latest.current) return;
          setError("Could not read the last 24 hours of scores");
        } finally {
          if (seq === latest.current) setAnsweredKey(requestKey);
        }
      })();
    }, delay);

    return () => clearTimeout(timer);
  }, [agentId, key]);

  return (
    <div className={cn("space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3", className)}>
      {pair ? (
        <PreviewBody pair={pair} pending={pending} />
      ) : error ? (
        <PreviewError message={error} />
      ) : (
        <PreviewSkeleton />
      )}
      {/* An error that arrives on top of numbers keeps the numbers: the last good
          answer is more use than a sentence saying there isn't one. */}
      {pair && error ? <PreviewError message={error} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------------ body

function PreviewBody({ pair, pending }: { pair: UniversePreviewPair; pending: boolean }) {
  const { proposed, saved } = pair;
  const changed = proposed.passing !== saved.passing;
  // The case this whole component exists for: a bar that lets nothing through while
  // the saved one was finding candidates. That is not a statistic, it is a warning.
  const emptied = proposed.passing === 0 && saved.passing > 0;
  const examples = proposed.examples.slice(0, VISIBLE_EXAMPLES);

  return (
    <div
      aria-busy={pending}
      className={cn(
        "space-y-2.5 transition-opacity duration-150 ease-out",
        pending && "opacity-50",
      )}
    >
      <p
        aria-live="polite"
        className={cn("text-xs leading-relaxed", emptied ? "text-destructive" : "text-muted-foreground")}
      >
        {proposed.scanned === 0 ? (
          <>No tokens were scored in the last 24 h, so there is nothing to test this bar against yet.</>
        ) : (
          <>
            In the last 24 h,{" "}
            <strong className="font-semibold tabular-nums text-foreground">{proposed.passing}</strong> of{" "}
            <span className="tabular-nums">{proposed.scanned}</span> scored token
            {proposed.scanned === 1 ? "" : "s"} would have cleared this bar
            {changed ? (
              <span className="text-muted-foreground">
                {" "}
                (<span className="tabular-nums">{saved.passing}</span> with your saved settings)
              </span>
            ) : null}
            .
          </>
        )}
      </p>

      {examples.length > 0 ? (
        <ul className="space-y-1">
          {examples.map((example) => (
            <li
              key={`${example.chain}:${example.address}`}
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <ScoreBadge total={example.total} size="xs" numberOnly />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{example.symbol}</span>
              <span className="shrink-0 tabular-nums">{formatCompactUsd(example.liquidityUsd)}</span>
              <span className="hidden shrink-0 tabular-nums sm:inline">
                {formatHolders(example.holderCount)} holders
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums">{formatAge(example.ageHours)}</span>
              <GeckoTerminalLink chain={example.chain} address={example.address} symbol={example.symbol} size="xs" />
            </li>
          ))}
        </ul>
      ) : null}

      {proposed.gatesSkipped.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground/80">
          {namesOf(proposed.gatesSkipped)} not in history — checked live at run time.
        </p>
      ) : null}
    </div>
  );
}

function PreviewError({ message }: { message: string }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      {message}. The bar still saves — the preview is the only thing missing.
    </p>
  );
}

/** "Authorities and age", "Age", "Mint authority, top-10 holders and tax". */
export function namesOf(gates: string[]): string {
  // The two authority gates are one idea to the reader, and naming both spends the
  // sentence on a distinction that changes nothing they would do about it.
  const authorities = gates.filter((gate) => gate.endsWith("authority"));
  const rest = gates.filter((gate) => !gate.endsWith("authority"));
  const names = authorities.length > 1 ? ["authorities", ...rest] : [...authorities, ...rest];
  if (names.length === 0) return "";

  const sentence =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return sentence[0].toUpperCase() + sentence.slice(1);
}

// -------------------------------------------------------------------- skeleton

/**
 * The shape of an answer — one sentence and three rows — so the section does not
 * jump when the real numbers arrive. Shown on the first load only; after that a
 * refetch dims the previous answer instead of throwing it away.
 */
function PreviewSkeleton() {
  return (
    <div aria-hidden className="space-y-2.5">
      <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted/60" />
      <div className="space-y-1">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-2">
            <div className="h-5 w-8 animate-pulse rounded-md bg-muted/60" />
            <div className="h-3 flex-1 animate-pulse rounded bg-muted/40" />
          </div>
        ))}
      </div>
      <span className="sr-only">Working out what these settings would have let through</span>
    </div>
  );
}
