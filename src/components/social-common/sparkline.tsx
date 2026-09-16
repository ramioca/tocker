/**
 * Equity sparkline. Pure SVG, no client JS, no animation — these live in list rows,
 * which per the motion budget is a hot path.
 *
 * NOTE: Spectrum's `sparkline-chart` needs `recharts`, which is not installed in this
 * workspace (see the merge notes). Swap this for it if recharts lands.
 */
import { cn } from "@/lib/utils";
import { pnlColor } from "./pnl-text";

export function Sparkline({
  points,
  id,
  width = 96,
  height = 28,
  pnl,
  className,
  fill = true,
  stretch = false,
}: {
  points: number[];
  /** Stable, unique id — used for the gradient + clip ids. */
  id: string;
  width?: number;
  height?: number;
  /** Drives the stroke color; defaults to the series' own direction. */
  pnl?: number | null;
  className?: string;
  fill?: boolean;
  /**
   * Fill the container instead of holding the intrinsic size. The stroke is
   * already `non-scaling-stroke`, so the line keeps its weight when the box is
   * stretched — only the geometry is distorted, which is exactly what a
   * full-bleed equity trace wants.
   */
  stretch?: boolean;
}) {
  if (points.length < 2) {
    return <div className={cn("bg-muted/40 rounded", className)} style={{ width, height }} aria-hidden />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const line = points.map((v, i) => `${(pad + i * stepX).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${pad},${height} ${line} ${(width - pad).toFixed(2)},${height}`;
  const direction = pnl ?? points[points.length - 1] - points[0];
  const color = pnlColor(direction);
  const gradId = `spark-${id}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={stretch ? undefined : width}
      height={stretch ? undefined : height}
      preserveAspectRatio={stretch ? "none" : undefined}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Equity trend, ${direction >= 0 ? "up" : "down"} over the period`}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${gradId})`} />
        </>
      ) : null}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
