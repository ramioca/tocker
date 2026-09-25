"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ScoreHistoryPoint } from "@/server/types";
import { ChartEmpty, useElementWidth } from "@/components/spectrumui/charts/chart-engine";
import { formatAbsolute, formatUsd } from "@/components/common/format";
import { VERDICT_META, verdictTint } from "@/components/tokens/verdict";
import { formatCompactUsd } from "@/components/tokens/format";
import { cn } from "@/lib/utils";
import { isNoDataReading, scorePaths } from "./score-history-paths";
import { axisLabels } from "./time-span";

/**
 * 30 days of score, with the verdict bands shaded behind the line.
 *
 * The bands are the whole point. A line from 74 to 58 is a number moving; the
 * same line crossing out of `candidate` into `watch` is the moment an agent
 * stopped being allowed to buy it. Shading the bands makes the threshold
 * visible without a legend, and the y axis is pinned to 0-100 so two tokens are
 * always comparable.
 *
 * One SVG, no chart library: a fixed-height plot measured in real pixels means
 * labels never stretch, and 90 points of a step-ish walk need no interpolation.
 *
 * "Real pixels" means the viewBox is as wide as the element, measured. A fixed
 * 720-unit viewBox letterboxed instead: at 390px the drawing shrank to 46% (9px labels
 * at 4px) inside a tall empty band, and at 1440px it sat centred with ~110px of dead
 * space either side.
 *
 * A reading where no provider answered (no price, liquidity or holders) is a gap, not
 * a point: the line breaks around it and it sits on the baseline as a hollow tick.
 * Drawn as a point it was a vertical crash to 0 that read as a rug.
 */

const BANDS = [
  { verdict: "avoid", lo: 0, hi: 40 },
  { verdict: "watch", lo: 40, hi: 60 },
  { verdict: "candidate", lo: 60, hi: 80 },
  { verdict: "strong", lo: 80, hi: 100 },
] as const;

// Left and right match the price chart above it (`trading/price-chart.tsx`), so the
// two plots share an x range and the same instant sits at the same x in both.
const PAD = { top: 10, right: 10, bottom: 20, left: 44 };
/** Width before the first measurement (server render), and the sparkline's fixed box. */
const VIEW_W = 720;

export function ScoreHistoryChart({
  history,
  height = 220,
  className,
  padLeft = PAD.left,
}: {
  history: ScoreHistoryPoint[];
  height?: number;
  className?: string;
  /**
   * The left gutter, in px. Pass the price chart's own (`priceAxisPadLeft`) so a
   * micro-cap's wider price labels do not push its plot right of this one.
   */
  padLeft?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // On a wrapper that is always mounted: the hook observes once, on mount, and the
  // empty state has no <figure> to hand it.
  const [frameRef, measured] = useElementWidth<HTMLDivElement>();
  const viewW = measured > 0 ? Math.round(measured) : VIEW_W;

  const points = useMemo(
    () =>
      history
        .map((p) => ({ ...p, t: new Date(p.at).getTime(), gap: isNoDataReading(p) }))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t),
    [history],
  );

  const plotW = Math.max(1, viewW - padLeft - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const first = points[0].t;
    const last = points[points.length - 1].t;
    const span = Math.max(1, last - first);
    const x = (t: number) => padLeft + ((t - first) / span) * plotW;
    const y = (total: number) => PAD.top + (1 - Math.max(0, Math.min(100, total)) / 100) * plotH;
    const coords = points.map((p) => ({ ...p, cx: x(p.t), cy: y(p.total) }));
    return { coords, first, last, x, y };
  }, [points, plotW, plotH, padLeft]);

  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !geometry) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const px = ((event.clientX - rect.left) / rect.width) * viewW;
      let best = 0;
      let bestDistance = Infinity;
      geometry.coords.forEach((point, i) => {
        const d = Math.abs(point.cx - px);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      setActive(best);
    },
    [geometry, viewW],
  );

  const validCount = points.filter((p) => !p.gap).length;

  if (!geometry || points.length < 2 || validCount === 0) {
    return (
      <div ref={frameRef} className={cn("w-full min-w-0", className)}>
        <ChartEmpty
          height={height}
          variant="line"
          title="No score history yet"
          description="Every time this token is scored, a point lands here. The curve fills in from the next sweep."
        />
      </div>
    );
  }

  const { coords } = geometry;
  const baseline = PAD.top + plotH;
  const { line, area, lone } = scorePaths(coords, baseline);
  const gaps = coords.filter((p) => p.gap);
  const hovered = active === null ? null : coords[active];
  // The newest *reading*: a trailing gap is not the latest score.
  const latest = coords.findLast((p) => !p.gap) ?? coords[coords.length - 1];
  const [firstLabel, lastLabel] = axisLabels(coords[0].t, coords[coords.length - 1].t);

  return (
    <div ref={frameRef} className={cn("w-full min-w-0", className)}>
      <figure className="w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`Score history, ${validCount} reading${validCount === 1 ? "" : "s"}${gaps.length > 0 ? `, ${gaps.length} where no provider answered` : ""}, latest ${Math.round(latest.total)} out of 100`}
          // Hidden only until the first measurement, so the drawing never visibly snaps
          // from the 720-unit fallback to the real width after hydration.
          style={{ opacity: measured > 0 ? 1 : 0 }}
          className="block touch-pan-y overflow-visible transition-opacity duration-150 ease-out"
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id="score-history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.13" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Verdict bands — the thresholds, not decoration. */}
          {BANDS.map((band) => {
            const top = PAD.top + (1 - band.hi / 100) * plotH;
            const bandHeight = ((band.hi - band.lo) / 100) * plotH;
            const color = VERDICT_META[band.verdict].color;
            return (
              <g key={band.verdict}>
                <rect
                  x={padLeft}
                  y={top}
                  width={plotW}
                  height={bandHeight}
                  fill={verdictTint(color, 7)}
                />
                {band.lo > 0 ? (
                  <>
                    <line
                      x1={padLeft}
                      x2={padLeft + plotW}
                      y1={top + bandHeight}
                      y2={top + bandHeight}
                      stroke={verdictTint(color, 30)}
                      strokeWidth="1"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={padLeft - 6}
                      y={top + bandHeight + 3}
                      textAnchor="end"
                      className="tnum fill-muted-foreground font-mono text-[9px]"
                    >
                      {band.lo}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}

          <path d={area} fill="url(#score-history-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {lone.map((p, i) => (
            <circle key={`lone-${i}`} cx={p.cx} cy={p.cy} r="1.75" fill="var(--primary)" />
          ))}
          {gaps.map((p, i) => (
            <circle
              key={`gap-${i}`}
              cx={p.cx}
              cy={baseline - 3}
              r="2.5"
              fill="var(--background)"
              stroke="var(--muted-foreground)"
              strokeWidth="1"
            />
          ))}

          {hovered ? (
            <g>
              <line
                x1={hovered.cx}
                x2={hovered.cx}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--border)"
                strokeWidth="1"
              />
              {hovered.gap ? (
                <circle
                  cx={hovered.cx}
                  cy={baseline - 3}
                  r="3.5"
                  fill="var(--background)"
                  stroke="var(--foreground)"
                  strokeWidth="1.25"
                />
              ) : (
                <circle
                  cx={hovered.cx}
                  cy={hovered.cy}
                  r="3.5"
                  fill={VERDICT_META[hovered.verdict].color}
                  stroke="var(--background)"
                  strokeWidth="1.5"
                />
              )}
            </g>
          ) : (
            <circle
              cx={latest.cx}
              cy={latest.cy}
              r="3"
              fill={VERDICT_META[latest.verdict].color}
              stroke="var(--background)"
              strokeWidth="1.5"
            />
          )}

          {/* Client-only, like the measured width: the labels are in the viewer's time
              zone, which the server cannot know, and a mismatch would fail hydration. */}
          {measured > 0 ? (
            <>
              <text x={padLeft} y={height - 6} className="tnum fill-muted-foreground font-mono text-[9px]">
                {firstLabel}
              </text>
              <text
                x={padLeft + plotW}
                y={height - 6}
                textAnchor="end"
                className="tnum fill-muted-foreground font-mono text-[9px]"
              >
                {lastLabel}
              </text>
            </>
          ) : null}
        </svg>

        <figcaption
          className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          {(() => {
            const point = hovered ?? latest;
            if (point.gap) {
              return (
                <>
                  <span className="font-sans">{formatAbsolute(point.at)}</span>
                  <span className="font-sans">No provider answered</span>
                </>
              );
            }
            const meta = VERDICT_META[point.verdict];
            return (
              <>
                <span className="font-sans">{hovered ? formatAbsolute(point.at) : "Latest"}</span>
                <span style={{ color: meta.color }}>
                  {Math.round(point.total)} · {meta.label.toLowerCase()}
                </span>
                {point.priceUsd === null ? null : <span>{formatUsd(point.priceUsd)}</span>}
                {point.liquidityUsd === null ? null : <span>{formatCompactUsd(point.liquidityUsd)} liq</span>}
              </>
            );
          })()}
        </figcaption>
      </figure>
    </div>
  );
}

/**
 * Price over the same window, taken from the same history rows.
 *
 * It is deliberately small and next to the score: the question a token page has
 * to answer is "did the score move before the price did", and two charts at the
 * same width with the same x range is the only honest way to show it.
 */
export function PriceSparkline({
  history,
  height = 72,
  className,
}: {
  history: ScoreHistoryPoint[];
  height?: number;
  className?: string;
}) {
  const points = useMemo(
    () =>
      history
        .flatMap((p) => (p.priceUsd === null ? [] : [{ t: new Date(p.at).getTime(), price: p.priceUsd }]))
        .filter((p) => Number.isFinite(p.t) && p.price > 0)
        .sort((a, b) => a.t - b.t),
    [history],
  );

  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const span = Math.max(1, last.t - first.t);
  const lo = Math.min(...points.map((p) => p.price));
  const hi = Math.max(...points.map((p) => p.price));
  const range = hi - lo || hi || 1;
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - 14;

  const coords = points.map((p) => ({
    cx: PAD.left + ((p.t - first.t) / span) * plotW,
    cy: 6 + (1 - (p.price - lo) / range) * plotH,
  }));
  const line = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(2)},${p.cy.toFixed(2)}`).join(" ");
  const rising = last.price >= first.price;
  const stroke = rising ? "var(--positive)" : "var(--negative)";

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Price</p>
        <p className="tnum font-mono text-[11px] text-muted-foreground">
          {formatUsd(lo)} – {formatUsd(hi)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Price over the same window, ${rising ? "up" : "down"} from ${formatUsd(first.price)} to ${formatUsd(last.price)}`}
        className="mt-1 block"
      >
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
