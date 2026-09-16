import { cn } from "@/lib/utils";

/**
 * Thirty UTC days, one bar each. Pure SVG, server-rendered, no charting library and no
 * client JavaScript.
 *
 * A bar chart rather than a line: these series are counts and sums per day, and most
 * days are zero on a young deployment. A line through zeros invents a trend between
 * them; thirty bars where four are tall says "four days had activity", which is the
 * true shape.
 *
 * The hover readout is a native SVG `<title>`, so a number is one pointer away without
 * a single byte of JavaScript. The row of bars is `aria-hidden` and the accessible
 * summary lives in the figure's label — thirty individually announced rectangles is
 * noise, not access.
 */

export interface DailyBarsPoint {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  value: number;
}

export function DailyBars({
  points,
  label,
  total,
  format,
  className,
  height = 92,
}: {
  points: DailyBarsPoint[];
  label: string;
  /** The window's total, already formatted. Shown next to the label. */
  total: string;
  /** How one bar's value reads in its tooltip. */
  format: (value: number) => string;
  className?: string;
  height?: number;
}) {
  const width = 720;
  const gap = 3;
  const barWidth = points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;
  const max = points.reduce((m, p) => Math.max(m, p.value), 0);
  const empty = max <= 0;
  // A floor of 2px so a day with activity is never invisible next to a much bigger one.
  const scale = (value: number) => (max <= 0 ? 0 : Math.max(value > 0 ? 2 : 0, (value / max) * height));

  const first = points[0]?.day ?? "";
  const last = points[points.length - 1]?.day ?? "";

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="tnum font-mono text-xs text-foreground">{total}</span>
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="mt-2 block"
        role="img"
        aria-label={`${label}: ${total} over the last ${points.length} days, peak ${format(max)}`}
      >
        {/* The baseline is drawn even when every bar is zero, so the chart still reads
            as a chart with nothing in it rather than as a failure to render. */}
        <line
          x1="0"
          x2={width}
          y1={height - 0.5}
          y2={height - 0.5}
          stroke="var(--glass-hairline-strong)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((point, i) => {
          const h = scale(point.value);
          return (
            <rect
              key={point.day}
              x={i * (barWidth + gap)}
              y={height - h}
              width={barWidth}
              height={h}
              rx="1"
              fill="var(--primary)"
              opacity={point.value > 0 ? 0.85 : 0}
            >
              <title>{`${point.day} · ${format(point.value)}`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="tnum mt-1 flex items-baseline justify-between font-mono text-[10px] text-muted-foreground">
        <span>{shortDay(first)}</span>
        {empty ? <span className="font-sans">nothing yet</span> : <span>peak {format(max)}</span>}
        <span>{shortDay(last)}</span>
      </div>
    </figure>
  );
}

/** `2026-09-16` → `Sep 16`. Parsed as UTC so the label matches the bucket. */
function shortDay(day: string): string {
  if (!day) return "—";
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
