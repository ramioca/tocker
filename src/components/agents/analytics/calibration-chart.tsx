"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ScoreBandStat } from "@/server/types";
import { formatSignedPct, formatSignedUsd } from "@/components/common/format";
import { VERDICT_META, verdictTint } from "@/components/tokens/verdict";
import { calibrationSentence } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * Realized return by the score the token had at entry.
 *
 * This is the operator's only feedback loop on `universe.minScore`. If 40-59
 * loses money and 80+ makes it, the floor is too low and this chart says so in a
 * sentence. If every band is flat, the score is not what decided the outcome and
 * the strategy prompt is — which is also worth knowing.
 *
 * Bars diverge from a centre line because the sign is the whole message, and they
 * are the PnL green and red rather than the verdict ramp: the bar *is* money. The
 * band label keeps its verdict colour so the reader can tie a row back to the
 * badge they see everywhere else.
 */

const BAND_VERDICT = {
  "0-39": "avoid",
  "40-59": "watch",
  "60-79": "candidate",
  "80-100": "strong",
} as const;

export function CalibrationChart({ bands }: { bands: ScoreBandStat[] }) {
  const reduce = useReducedMotion();
  const populated = bands.filter((band) => band.trades > 0);
  const scale = Math.max(10, ...bands.map((band) => Math.abs(band.avgReturnPct ?? 0)));
  const sentence = calibrationSentence(bands);

  return (
    <section aria-labelledby="calibration-heading" className="rounded-xl border border-border/70 bg-card/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="calibration-heading" className="text-sm font-medium tracking-tight">
          Did the score predict the outcome?
        </h3>
        <p className="text-[11px] text-muted-foreground">average realized return per entry-score band</p>
      </div>

      {populated.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Nothing closed in this window yet. The bands fill in as positions are exited.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2.5">
            {bands.map((band, index) => {
              const verdict = BAND_VERDICT[band.band];
              const meta = VERDICT_META[verdict];
              const value = band.avgReturnPct;
              const empty = band.trades === 0 || value === null;
              const magnitude = empty ? 0 : (Math.abs(value) / scale) * 50;
              const positive = (value ?? 0) >= 0;

              return (
                <li key={band.band} className="grid grid-cols-[5.5rem_1fr_5rem] items-center gap-2 sm:grid-cols-[7rem_1fr_6rem]">
                  <span className="min-w-0">
                    <span
                      className="tnum block truncate font-mono text-xs font-semibold"
                      style={{ color: empty ? "var(--muted-foreground)" : meta.color }}
                    >
                      {band.band}
                    </span>
                    <span className="tnum block text-[10px] text-muted-foreground">
                      {band.trades === 0 ? "no trades" : `${band.trades} trade${band.trades === 1 ? "" : "s"}`}
                    </span>
                  </span>

                  <span
                    aria-hidden
                    className="relative h-6 overflow-hidden rounded-md"
                    style={{ backgroundColor: verdictTint(meta.color, 6) }}
                  >
                    <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                    {empty ? null : (
                      <motion.span
                        className={cn(
                          "absolute inset-y-1 rounded-sm",
                          positive ? "bg-positive/70" : "bg-negative/70",
                        )}
                        style={positive ? { left: "50%" } : { right: "50%" }}
                        initial={reduce ? false : { width: 0 }}
                        animate={{ width: `${magnitude}%` }}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { duration: 0.36, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] }
                        }
                      />
                    )}
                  </span>

                  <span className="text-right">
                    <span
                      className={cn(
                        "tnum block font-mono text-xs font-medium",
                        empty
                          ? "text-muted-foreground"
                          : positive
                            ? "text-positive"
                            : "text-negative",
                      )}
                    >
                      {empty ? "—" : formatSignedPct(value, 1)}
                    </span>
                    <span className="tnum block text-[10px] text-muted-foreground">
                      {band.trades === 0 ? "" : formatSignedUsd(band.totalPnlUsd)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {sentence ? (
            <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-foreground/85">
              {sentence}{" "}
              <span className="text-muted-foreground">
                Raise or lower this agent&rsquo;s score floor accordingly — it is the one number that
                decides what it is allowed to buy.
              </span>
            </p>
          ) : null}

          <table className="sr-only">
            <caption>Average realized return by entry-score band</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">Trades</th>
                <th scope="col">Average return</th>
                <th scope="col">Total PnL</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((band) => (
                <tr key={band.band}>
                  <th scope="row">{band.band}</th>
                  <td>{band.trades}</td>
                  <td>{band.avgReturnPct === null ? "n/a" : formatSignedPct(band.avgReturnPct, 1)}</td>
                  <td>{formatSignedUsd(band.totalPnlUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
