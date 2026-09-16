"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChartEmpty } from "@/components/spectrumui/charts/chart-engine";
import { formatAbsolute, formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { ScoreHistoryPoint } from "@/server/types";
import type { TokenMarker } from "@/server/queries/trading";

/**
 * Price over the charted window, with the viewer's **own** entries and exits on it.
 *
 * ## Why the markers are owner-only
 *
 * A price line is public. Where somebody got in and out of it is not. Two or three
 * marked entries on a chart is a readable strategy — it shows the trigger, the hold and
 * the exit discipline in one glance, which is exactly the thing this product promises
 * operators it will not publish. So markers come from `myTokenMarkers()`, which filters
 * on `agents.ownerId = viewerId` in SQL and returns nothing for an anonymous viewer.
 * This component renders whatever it is handed; the *query* is what enforces the rule,
 * because a component prop can be passed the wrong array and a `WHERE` clause cannot.
 *
 * A viewer with no markers gets the price line and an aggregate caption — how many
 * agents traded the token — which says the token is active without saying who or when.
 *
 * ## Why an SVG and not a chart library
 *
 * The same reason the score chart next to it is one: a fixed-height plot in real pixels
 * keeps the labels from stretching, the marker glyphs have to land exactly on a
 * (time, price) pair, and the whole thing is about ninety points of a walk that needs
 * no interpolation.
 */

const PAD = { top: 12, right: 10, bottom: 22, left: 44 };
const VIEW_W = 720;

export interface PricePoint {
  at: string;
  priceUsd: number;
}

/** Price points from score history — the series we already store for every token. */
export function pricePointsFrom(history: readonly ScoreHistoryPoint[]): PricePoint[] {
  return history.flatMap((p) =>
    p.priceUsd !== null && Number.isFinite(p.priceUsd) && p.priceUsd > 0
      ? [{ at: p.at, priceUsd: p.priceUsd }]
      : [],
  );
}

interface Placed extends TokenMarker {
  cx: number;
  cy: number;
}

export function PriceChart({
  points,
  markers = [],
  /** Public aggregate shown when the viewer has no markers of their own. */
  agentCount = 0,
  height = 240,
  className,
}: {
  points: readonly PricePoint[];
  /** The viewer's own fills. Never anyone else's — see the module doc. */
  markers?: readonly TokenMarker[];
  agentCount?: number;
  height?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const series = useMemo(
    () =>
      points
        .map((p) => ({ ...p, t: new Date(p.at).getTime() }))
        .filter((p) => Number.isFinite(p.t) && p.priceUsd > 0)
        .sort((a, b) => a.t - b.t),
    [points],
  );

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].t;
    const last = series[series.length - 1].t;
    const span = Math.max(1, last - first);

    // The y range has to cover the markers too. A stop loss that filled below every
    // price we ever sampled would otherwise be drawn off the bottom of the plot — the
    // one marker you most need to see, missing.
    const prices = [...series.map((p) => p.priceUsd), ...markers.map((m) => m.priceUsd)].filter(
      (p) => Number.isFinite(p) && p > 0,
    );
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const pad = (hi - lo) * 0.08 || hi * 0.08 || 1;
    const yLo = Math.max(0, lo - pad);
    const yHi = hi + pad;
    const range = yHi - yLo || 1;

    const x = (t: number) => PAD.left + ((t - first) / span) * plotW;
    const y = (price: number) => PAD.top + (1 - (price - yLo) / range) * plotH;

    const coords = series.map((p) => ({ ...p, cx: x(p.t), cy: y(p.priceUsd) }));
    const placed: Placed[] = markers.flatMap((m) => {
      const t = new Date(m.at).getTime();
      if (!Number.isFinite(t) || !(m.priceUsd > 0)) return [];
      // Clamped into the plot so a fill just outside the charted window still shows at
      // the edge rather than vanishing.
      const cx = Math.min(PAD.left + plotW, Math.max(PAD.left, x(t)));
      return [{ ...m, cx, cy: y(m.priceUsd) }];
    });

    return { coords, placed, yLo, yHi, first, last };
  }, [series, markers, plotW, plotH]);

  const onMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !geometry) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const px = ((event.clientX - rect.left) / rect.width) * VIEW_W;
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
    [geometry],
  );

  if (!geometry) {
    return (
      <ChartEmpty
        height={height}
        variant="line"
        title="No price history yet"
        description="Price is recorded every time this token is scored. The line fills in from the next sweep."
      />
    );
  }

  const { coords, placed } = geometry;
  const line = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(2)},${p.cy.toFixed(2)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].cx.toFixed(2)},${(PAD.top + plotH).toFixed(2)} L${coords[0].cx.toFixed(2)},${(PAD.top + plotH).toFixed(2)} Z`;
  const latest = coords[coords.length - 1];
  const hovered = active === null ? null : coords[active];
  const rising = latest.priceUsd >= coords[0].priceUsd;
  const stroke = rising ? "var(--positive)" : "var(--negative)";
  const marker = placed.find((m) => m.tradeId === hoveredMarker) ?? null;

  return (
    <figure className={cn("w-full min-w-0", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Price history, ${coords.length} points, latest ${formatUsd(latest.priceUsd)}${
          placed.length > 0 ? `, with ${placed.length} of your own fills marked` : ""
        }`}
        className="block touch-pan-y overflow-visible"
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="price-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.12" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Two reference prices, top and bottom of the plotted range. */}
        {[geometry.yHi, geometry.yLo].map((price, i) => {
          const cy = PAD.top + (i === 0 ? 0 : plotH);
          return (
            <g key={price}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={cy}
                y2={cy}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="3 5"
                opacity="0.6"
              />
              <text
                x={PAD.left - 6}
                y={cy + (i === 0 ? 8 : 0)}
                textAnchor="end"
                className="tnum fill-muted-foreground font-mono text-[9px]"
              >
                {formatUsd(price)}
              </text>
            </g>
          );
        })}

        <path d={area} fill="url(#price-chart-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

        {hovered ? (
          <g>
            <line x1={hovered.cx} x2={hovered.cx} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--border)" strokeWidth="1" />
            <circle cx={hovered.cx} cy={hovered.cy} r="3.5" fill={stroke} stroke="var(--background)" strokeWidth="1.5" />
          </g>
        ) : null}

        {/* The viewer's own fills. Buys point up, sells point down, and a guardian exit
            carries a ring so a rule-driven sell is distinguishable from a decided one. */}
        {placed.map((m) => (
          <g
            key={m.tradeId}
            onPointerEnter={() => setHoveredMarker(m.tradeId)}
            onPointerLeave={() => setHoveredMarker(null)}
            className="cursor-default"
          >
            {m.origin === "guardian" ? (
              <circle cx={m.cx} cy={m.cy} r="7" fill="none" stroke="var(--primary)" strokeWidth="1" opacity="0.7" />
            ) : null}
            <path
              d={
                m.side === "buy"
                  ? `M${m.cx},${m.cy - 5} L${m.cx + 4.5},${m.cy + 3} L${m.cx - 4.5},${m.cy + 3} Z`
                  : `M${m.cx},${m.cy + 5} L${m.cx + 4.5},${m.cy - 3} L${m.cx - 4.5},${m.cy - 3} Z`
              }
              fill={m.side === "buy" ? "var(--positive)" : "var(--negative)"}
              stroke="var(--background)"
              strokeWidth="1"
            />
            {/* A generous invisible hit area: the glyph is 9px wide on a 720px viewBox. */}
            <circle cx={m.cx} cy={m.cy} r="10" fill="transparent" />
          </g>
        ))}

        <text x={PAD.left} y={height - 6} className="tnum fill-muted-foreground font-mono text-[9px]">
          {shortDate(coords[0].at)}
        </text>
        <text
          x={PAD.left + plotW}
          y={height - 6}
          textAnchor="end"
          className="tnum fill-muted-foreground font-mono text-[9px]"
        >
          {shortDate(latest.at)}
        </text>
      </svg>

      <figcaption
        className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground"
        aria-live="polite"
      >
        {marker ? (
          <>
            <span className={marker.side === "buy" ? "text-positive" : "text-negative"}>
              {marker.side === "buy" ? "Bought" : "Sold"} {formatUsd(marker.amountUsd)}
            </span>
            <span>@ {formatUsd(marker.priceUsd)}</span>
            <span className="font-sans">{formatAbsolute(marker.at)}</span>
            <span className="font-sans">{marker.agentName}</span>
            {marker.exitReason ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 font-sans text-[10px] text-primary">
                {marker.exitReason.replace(/_/g, " ")}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-sans">{hovered ? formatAbsolute(hovered.at) : "Latest"}</span>
            <span className="text-foreground">{formatUsd((hovered ?? latest).priceUsd)}</span>
            {placed.length > 0 ? (
              <span className="font-sans">
                {placed.length} of your fill{placed.length === 1 ? "" : "s"} marked
              </span>
            ) : agentCount > 0 ? (
              <span className="font-sans">
                {agentCount} agent{agentCount === 1 ? "" : "s"} traded this
              </span>
            ) : null}
          </>
        )}
      </figcaption>
    </figure>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
