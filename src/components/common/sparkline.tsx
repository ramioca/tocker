/**
 * A price line, small enough to sit inside a row of numbers.
 *
 * Stroke only, no fill, no gradient, no client JavaScript: this renders next to a
 * price on a card that may appear three-up, and the job is to say *which shape* the
 * last few hours had before the reader parses a single digit. The filled equity trace
 * with its gradient lives in `social-common/sparkline` and is a different instrument —
 * that one is the hero of an agent card, this one is a footnote to a number.
 *
 * Colour comes from first → last through `pnlTone`, so it borrows the app's one green
 * and one red rather than introducing a third opinion about direction, and a flat
 * series is muted because sideways is not a win.
 */
import { pnlTone } from "@/components/common/pnl-text";
import { sparklinePath } from "@/components/agents/proposals/proposal-stats";
import { cn } from "@/lib/utils";

export function Sparkline({
  points,
  width = 80,
  height = 24,
  label = "Recent price",
  className,
}: {
  /** Oldest first. Fewer than two finite values renders a held space, not a line. */
  points: readonly number[];
  width?: number;
  height?: number;
  /** Prefix of the accessible name — "Recent price, up over the last 24 points". */
  label?: string;
  className?: string;
}) {
  const geometry = sparklinePath(points, { width, height });

  // Hold the box either way: a card with history and a card without must be the same
  // height, or a three-up grid reflows as the data arrives.
  if (geometry === null) {
    return <span aria-hidden className={cn("inline-block", className)} style={{ width, height }} />;
  }

  const { d, direction } = geometry;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}, ${direction > 0 ? "up" : direction < 0 ? "down" : "flat"} over the period shown`}
      className={cn("shrink-0 overflow-visible", pnlTone(direction), className)}
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
