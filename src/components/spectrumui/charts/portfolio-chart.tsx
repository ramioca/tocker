'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  type ChartStatus,
  ChartDataTable,
  ChartState,
  DAY_MS,
  DOWN,
  EASE,
  Keyframes,
  MARKET_RANGES,
  type MarketRange,
  RangeSelector,
  RollingNumber,
  SURFACE,
  UP,
  chartClock,
  formatAxisPrice,
  formatMoney,
  formatSignedPct,
  intradayPoints,
  marketVarsClassName,
  monotonePath,
  mulberry32,
  niceTicks,
  sampleRows,
  timeTickLabels,
  useElementWidth,
  useHoverIndexKeys,
  usePrefersReducedMotion,
  useTween,
  useTweenNumber,
} from './chart-engine';

export type PortfolioPoint = {
  t: number;
  value: number;
  basis: number;
};

const SERIES_END = Date.UTC(2026, 7, 21);
const SERIES_LEN = 420;

function generatePortfolio(seed: number, start: number): PortfolioPoint[] {
  const rand = mulberry32(seed);
  const out: PortfolioPoint[] = [];
  let value = start;
  let basis = start;
  for (let i = 0; i < SERIES_LEN; i += 1) {
    if (i > 0 && i % 30 === 0) {
      const add = Math.round(start * 0.045);
      basis += add;
      value += add;
    }
    value = Math.max(1, value * (1 + (rand() - 0.47) * 0.021));
    out.push({
      t: SERIES_END - (SERIES_LEN - 1 - i) * DAY_MS,
      value: Math.round(value),
      basis: Math.round(basis),
    });
  }
  return out;
}

export const PORTFOLIO = generatePortfolio(31_337, 42_000);

const PAD = { top: 12, right: 66, bottom: 22, left: 12 };
/** Half a time-axis label's width at 10.5px mono, for keeping the first one inside the plot. */
const labelHalf = (label = '') => Math.ceil(label.length * 3.2);
const DRAWDOWN_SHARE = 0.24;
const GAP = 14;

export interface PortfolioChartProps {
  className?: string;
  data?: PortfolioPoint[];
  label?: string;
  ranges?: MarketRange[];
  defaultRange?: string;
  showDrawdown?: boolean;
  height?: number;
  status?: ChartStatus;
  onRetry?: () => void;
  /**
   * Cap on the screen-reader table's rows. Longer views are sampled evenly (the latest
   * point always kept), so a 90-day view reads as ~15 rows rather than 90 — and is not
   * 450 hidden nodes on a marketing page. Omit for every point.
   */
  tableMaxRows?: number;
  /**
   * Whether the line may draw in. Pass false until the chart is on screen (a page that
   * mounts it far below the fold), then true to play the intro there. Default true.
   */
  intro?: boolean;
  /**
   * The zone the dates and times are printed in (an IANA name). Default UTC, which
   * the server and the browser agree on; a page that knows the viewer's zone passes it.
   */
  timeZone?: string;
  /**
   * Switch to the browser's own zone once hydrated. The server and the first render keep
   * `timeZone`, so hydration matches; a viewer the page did not know yet (no zone cookie
   * on their first visit) still reads their own hours a moment later. Off for a series
   * whose days are UTC days, like the landing page's sample.
   */
  followViewer?: boolean;
}

const noSubscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function PortfolioChart({
  className,
  data = PORTFOLIO,
  label = 'Portfolio',
  ranges = MARKET_RANGES,
  defaultRange = '1Y',
  showDrawdown = true,
  height = 400,
  status = 'ready',
  onRetry,
  tableMaxRows,
  intro = true,
  timeZone = 'UTC',
  followViewer = false,
}: PortfolioChartProps) {
  const viewerZone = React.useSyncExternalStore(noSubscribe, browserZone, () => timeZone);
  const zone = followViewer ? viewerZone : timeZone;
  const clock = chartClock(zone);
  const reduce = usePrefersReducedMotion();
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [rangeLabel, setRangeLabel] = React.useState(
    () => ranges.find((r) => r.label === defaultRange)?.label ?? ranges[ranges.length - 1].label,
  );
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  // Scrubbing from the keyboard is announced (below); a pointer's hover is not.
  const [keyScrub, setKeyScrub] = React.useState(false);

  const range = ranges.find((r) => r.label === rangeLabel) ?? ranges[ranges.length - 1];
  const view = React.useMemo(() => {
    const bars = range.bars;
    if (bars == null || bars >= data.length) return data;
    return data.slice(data.length - bars);
  }, [data, range.bars]);

  const n = view.length;
  // An hourly stretch prints times as well as dates; a daily series stays as it was.
  const intraday = React.useMemo(() => intradayPoints(view.map((p) => p.t)), [view]);
  const shortLabel = (i: number) =>
    intraday[i] ? `${clock.day(view[i].t)} ${clock.time(view[i].t)}` : clock.day(view[i].t);
  const fullLabel = (i: number) =>
    intraday[i]
      ? `${clock.date(view[i].t)}, ${clock.time(view[i].t)} ${clock.zone(view[i].t)}`
      : clock.date(view[i].t);

  const drawdowns = React.useMemo(() => {
    const out: number[] = [];
    let peak = -Infinity;
    for (const point of view) {
      peak = Math.max(peak, point.value);
      out.push(peak > 0 ? ((point.value - peak) / peak) * 100 : 0);
    }
    return out;
  }, [view]);

  const maxDrawdown = React.useMemo(() => Math.min(0, ...drawdowns), [drawdowns]);

  const w = Math.max(width, 260);
  const h = height;
  const x0 = PAD.left;
  const x1 = w - PAD.right;
  const plotW = Math.max(1, x1 - x0);
  const innerTop = PAD.top;
  const innerBottom = h - PAD.bottom;
  const ddH = showDrawdown ? (innerBottom - innerTop) * DRAWDOWN_SHARE : 0;
  const valueTop = innerTop;
  const valueBottom = innerBottom - (showDrawdown ? ddH + GAP : 0);
  const ddTop = innerBottom - ddH;

  const step = plotW / Math.max(n, 1);
  const cx = React.useCallback((i: number) => x0 + step * (i + 0.5), [x0, step]);

  const rawDomain = React.useMemo(() => {
    if (!n) return [0, 1] as const;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of view) {
      lo = Math.min(lo, p.value, p.basis);
      hi = Math.max(hi, p.value, p.basis);
    }
    const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
    return [lo - pad, hi + pad] as const;
  }, [view, n]);

  const [dLo, dHi] = useTween([rawDomain[0], rawDomain[1]], { duration: 520, enabled: !reduce });
  const valueY = React.useCallback(
    (v: number) => valueBottom - ((v - dLo) / (dHi - dLo || 1)) * (valueBottom - valueTop),
    [dLo, dHi, valueBottom, valueTop],
  );
  const ddY = React.useCallback(
    (v: number) => ddTop + (Math.abs(v) / Math.max(1, Math.abs(maxDrawdown))) * ddH,
    [ddTop, ddH, maxDrawdown],
  );

  const valuePath = React.useMemo(
    () => monotonePath(view.map((p, i) => ({ x: cx(i), y: valueY(p.value) }))),
    [view, cx, valueY],
  );
  const basisPath = React.useMemo(
    () => monotonePath(view.map((p, i) => ({ x: cx(i), y: valueY(p.basis) }))),
    [view, cx, valueY],
  );
  const ddPath = React.useMemo(() => {
    if (!showDrawdown || !n) return '';
    const line = monotonePath(drawdowns.map((v, i) => ({ x: cx(i), y: ddY(v) })));
    return `${line}L${cx(n - 1)},${ddTop}L${cx(0)},${ddTop}Z`;
  }, [showDrawdown, drawdowns, cx, ddY, ddTop, n]);

  const valueTicks = React.useMemo(() => niceTicks(dLo, dHi, 4), [dLo, dHi]);
  // One label format per axis, as precise as its tick gap (see formatAxisPrice).
  const axisScale = React.useMemo(() => Math.max(0, ...valueTicks.map(Math.abs)), [valueTicks]);
  const axisStep = valueTicks.length > 1 ? valueTicks[1] - valueTicks[0] : undefined;
  const timeTicks = React.useMemo(() => {
    if (!n) return [];
    const want = Math.max(2, Math.min(6, Math.floor(plotW / 96)));
    const gap = Math.max(1, Math.floor((n - 1) / (want - 1 || 1)));
    const out: number[] = [];
    for (let i = 0; i < n; i += gap) out.push(i);
    if (out[out.length - 1] !== n - 1) {
      while (out.length && cx(n - 1) - cx(out[out.length - 1]) < 62) out.pop();
      out.push(n - 1);
    }
    return out;
  }, [n, plotW, cx]);
  const tickLabels = React.useMemo(
    () => timeTickLabels(view.map((p) => p.t), timeTicks, chartClock(zone)),
    [view, timeTicks, zone],
  );

  const activeIndex = hoverIndex ?? n - 1;
  const hoverLabel = hoverIndex != null && view[hoverIndex] ? shortLabel(hoverIndex) : '';
  // 10px mono runs about 6.1px a character; 54px was the old badge's width for a date.
  const badgeHalf = Math.max(27, Math.ceil(hoverLabel.length * 3.1) + 7);
  const active = view[activeIndex];
  const activeDd = drawdowns[activeIndex] ?? 0;
  const pnl = active ? active.value - active.basis : 0;
  const pnlPct = active && active.basis ? (pnl / active.basis) * 100 : 0;
  const up = pnl >= 0;
  const readoutColor = up ? UP : DOWN;
  const latest = view[n - 1];
  const dirColor = latest && latest.value >= latest.basis ? UP : DOWN;
  // The chart's name describes the latest point, whatever is being scrubbed.
  const latestPct = latest && latest.basis ? ((latest.value - latest.basis) / latest.basis) * 100 : 0;

  const displayValue = useTweenNumber(active?.value ?? 0, {
    duration: 260,
    enabled: !reduce && hoverIndex == null,
  });

  const onHoverKeys = useHoverIndexKeys({ count: n, setIndex: setHoverIndex });
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!keyScrub) setKeyScrub(true);
    onHoverKeys(event);
  };

  const onMove = (clientX: number) => {
    if (keyScrub) setKeyScrub(false);
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * w;
    setHoverIndex(Math.max(0, Math.min(n - 1, Math.floor((x - x0) / step))));
  };

  const { stride: tableStride, indices: tableRows } = React.useMemo(
    () => sampleRows(n, tableMaxRows),
    [n, tableMaxRows],
  );

  const uid = React.useId().replace(/:/g, '');
  const ready = width > 0;
  const introKey = rangeLabel;

  return (
    <div
      ref={wrapRef}
      className={cn(
        'flex w-full flex-col text-neutral-400 dark:text-neutral-500',
        marketVarsClassName,
        className,
      )}
    >
      <Keyframes />

      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <span className="font-mono text-[12px] font-medium tracking-wide text-neutral-950 dark:text-white">
            {label}
          </span>
          <div className="mt-1 flex items-end gap-2.5">
            <RollingNumber
              value={hoverIndex != null ? (active?.value ?? 0) : displayValue}
              format={(v) => formatMoney(v, true)}
              animate={!reduce}
              className="font-mono text-[26px] font-medium text-neutral-950 dark:text-white"
            />
            {/* Full dollars and cents at every size, so the figure never flips format as it crosses $1,000. */}
            <span className="mb-1 font-mono text-[12px] tabular-nums" style={{ color: readoutColor }}>
              {up ? '+' : '−'}
              {formatMoney(Math.abs(pnl))} ({formatSignedPct(pnlPct)})
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mono text-[10.5px] tabular-nums">
            <span className="text-neutral-400 dark:text-neutral-500">
              {active ? fullLabel(activeIndex) : ''}
            </span>
            <span className="text-neutral-500 dark:text-neutral-400">
              Basis{' '}
              <span className="text-neutral-950 dark:text-white">
                {formatMoney(active?.basis ?? 0, true)}
              </span>
            </span>
            {/* Drawdown figures belong with the drawdown pane. */}
            {showDrawdown ? (
              <>
                <span className="text-neutral-500 dark:text-neutral-400">
                  Drawdown{' '}
                  <span style={{ color: activeDd < -0.05 ? DOWN : undefined }} className="text-neutral-950 dark:text-white">
                    {activeDd.toFixed(2)}%
                  </span>
                </span>
                <span className="text-neutral-500 dark:text-neutral-400">
                  Max DD <span className="text-neutral-950 dark:text-white">{maxDrawdown.toFixed(2)}%</span>
                </span>
              </>
            ) : null}
          </div>
        </div>

        <RangeSelector ranges={ranges} value={rangeLabel} onChange={setRangeLabel} reduce={reduce} />
      </div>

      {/* The plot is one picture (role="img"), so a keyboard scrub is read out here. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {keyScrub && hoverIndex != null && active
          ? `${fullLabel(activeIndex)}: ${formatMoney(active.value)}, ${formatSignedPct(pnlPct)} against cost basis`
          : ''}
      </span>

      <ChartState

        status={status}

        height={height}

        variant="line"

        empty={{ title: 'No positions', description: 'Once the account holds a position its value will be tracked here.' }}

        onRetry={onRetry}

      >

      <div className="relative w-full" style={{ height }}>
        {!ready ? null : (
          <svg
            ref={svgRef}
            width={w}
            height={h}
            viewBox={`0 0 ${w} ${h}`}
            className="block w-full touch-pan-y select-none overflow-visible"
            role="img"
            aria-label={`${label} value ${formatMoney(latest?.value ?? 0)}, ${formatSignedPct(latestPct)} against cost basis.${
              showDrawdown ? ` Max drawdown ${maxDrawdown.toFixed(2)} percent.` : ''
            } Arrow keys step through the dates.`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setHoverIndex(null);
              setKeyScrub(false);
            }}
            onPointerMove={(e) => onMove(e.clientX)}
            onPointerDown={(e) => onMove(e.clientX)}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={`${uid}-value`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={dirColor} stopOpacity={0.26} />
                <stop offset="100%" stopColor={dirColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`${uid}-dd`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={DOWN} stopOpacity={0.32} />
                <stop offset="100%" stopColor={DOWN} stopOpacity={0.04} />
              </linearGradient>
            </defs>

            <g shapeRendering="crispEdges">
              {valueTicks.map((tick) => {
                const y = valueY(tick);
                if (y < valueTop - 1 || y > valueBottom + 1) return null;
                return (
                  <line
                    key={tick}
                    x1={x0}
                    x2={x1}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    strokeOpacity={0.12}
                    strokeDasharray="2 4"
                  />
                );
              })}
            </g>
            <g className="font-mono">
              {valueTicks.map((tick) => {
                const y = valueY(tick);
                if (y < valueTop - 1 || y > valueBottom + 1) return null;
                return (
                  <text
                    key={tick}
                    x={x1 + 8}
                    y={y}
                    dominantBaseline="middle"
                    fontSize={10.5}
                    fill="currentColor"
                    className="tabular-nums"
                  >
                    {formatAxisPrice(tick, axisScale, axisStep)}
                  </text>
                );
              })}
            </g>

            <g key={`${introKey}-value`}>
              <path
                d={`${valuePath}L${cx(n - 1)},${valueBottom}L${cx(0)},${valueBottom}Z`}
                fill={`url(#${uid}-value)`}
                style={reduce ? undefined : intro ? { animation: 'spectrum-mc-fade 560ms ease-out both' } : { opacity: 0 }}
              />
              <path
                d={basisPath}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.5}
                strokeWidth={1.4}
                strokeDasharray="5 4"
              />
              <path
                d={valuePath}
                fill="none"
                stroke={dirColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                style={
                  reduce
                    ? undefined
                    : intro
                      ? { strokeDasharray: 1, animation: `spectrum-mc-draw 900ms ${EASE} both` }
                      : { strokeDasharray: 1, strokeDashoffset: 1 }
                }
              />
            </g>

            {showDrawdown ? (
              <g key={`${introKey}-dd`}>
                <line
                  x1={x0}
                  x2={x1}
                  y1={ddTop}
                  y2={ddTop}
                  stroke="currentColor"
                  strokeOpacity={0.18}
                  shapeRendering="crispEdges"
                />
                <path
                  d={ddPath}
                  fill={`url(#${uid}-dd)`}
                  stroke={DOWN}
                  strokeWidth={1.2}
                  strokeOpacity={0.75}
                  style={
                    reduce ? undefined : intro ? { animation: 'spectrum-mc-fade 620ms ease-out 120ms both' } : { opacity: 0 }
                  }
                />
                <text
                  x={x0 + 2}
                  y={ddTop - 5}
                  fontSize={9.5}
                  fontWeight={600}
                  fill="currentColor"
                  opacity={0.55}
                  className="font-mono uppercase tracking-wider"
                >
                  Drawdown
                </text>
                <text
                  x={x1 + 8}
                  y={ddTop + ddH}
                  dominantBaseline="middle"
                  fontSize={9.5}
                  fill="currentColor"
                  className="font-mono tabular-nums"
                >
                  {maxDrawdown.toFixed(1)}%
                </text>
              </g>
            ) : null}

            <g className="font-mono">
              {timeTicks.map((i, k) => {
                const point = view[i];
                if (!point) return null;
                return (
                  <text
                    key={i}
                    // Kept inside the chart by half the label's width: 10.5px mono runs about
                    // 6.4px a character, and "Oct 7 15:38" is twice as long as "Oct 8".
                    x={Math.max(x0 + 14, labelHalf(tickLabels[k]) + 2, Math.min(x1 - 14, cx(i)))}
                    y={innerBottom + 14}
                    textAnchor="middle"
                    fontSize={10.5}
                    fill="currentColor"
                    className="tabular-nums"
                  >
                    {tickLabels[k]}
                  </text>
                );
              })}
            </g>

            {hoverIndex != null && view[hoverIndex] ? (
              <g>
                {/* The badge under the axis fits its label: "Oct 8", or "Oct 8 14:57" on an hourly stretch. */}
                <line
                  x1={cx(hoverIndex)}
                  x2={cx(hoverIndex)}
                  y1={valueTop}
                  y2={innerBottom}
                  stroke="currentColor"
                  strokeOpacity={0.42}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={cx(hoverIndex)}
                  cy={valueY(view[hoverIndex].value)}
                  r={4.5}
                  fill={SURFACE}
                  stroke={dirColor}
                  strokeWidth={2}
                />
                <circle
                  cx={cx(hoverIndex)}
                  cy={valueY(view[hoverIndex].basis)}
                  r={3}
                  fill={SURFACE}
                  stroke="currentColor"
                  strokeOpacity={0.6}
                  strokeWidth={1.75}
                />
                <g
                  transform={`translate(${Math.max(x0 + badgeHalf + 1, Math.min(x1 - badgeHalf - 1, cx(hoverIndex)))}, ${innerBottom + 4})`}
                >
                  <rect x={-badgeHalf} y={0} width={badgeHalf * 2} height={16} rx={4} className="fill-neutral-900 dark:fill-white" />
                  <text
                    x={0}
                    y={8.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={10}
                    fontWeight={600}
                    className="fill-white font-mono tabular-nums dark:fill-neutral-950"
                  >
                    {hoverLabel}
                  </text>
                </g>
              </g>
            ) : null}
          </svg>
        )}
      </div>
      </ChartState>
      <ChartDataTable
        caption={`${label} — value, cost basis and drawdown by date${
          latest && intraday.some(Boolean) ? ` and time (${clock.zone(latest.t)})` : ''
        }${tableStride > 1 ? `, one row in ${tableStride}` : ''}`}
        columns={['Date', 'Value', 'Basis', 'Drawdown %']}
        rows={tableRows.map((i) => [shortLabel(i), formatMoney(view[i].value), formatMoney(view[i].basis), drawdowns[i].toFixed(2)])}
      />
    </div>
  );
}

export function DefaultPortfolioChart(props: PortfolioChartProps) {
  return <PortfolioChart {...props} />;
}

export function FlatPortfolioChart(props: PortfolioChartProps) {
  return <PortfolioChart showDrawdown={false} height={300} defaultRange="6M" {...props} />;
}
