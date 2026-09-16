import { Sparkline } from "@/components/social-common/sparkline";
import { cn } from "@/lib/utils";

/**
 * The equity trace that rides along an agent card. Decoration with a job: it
 * tells you the shape of the story before you read the number.
 *
 * Pure SVG, server-rendered, no charting library. It used to be Spectrum's
 * recharts `Sparkline`, which needs a `ResponsiveContainer` to measure itself on
 * the client — inside a grid of cards it measured nothing and drew nothing. A
 * card grid is a hot path anyway: it should cost no JavaScript and no layout
 * pass, and it should be correct in the server HTML.
 */
export function MiniSparkline({
  values,
  id,
  pnl,
  className,
}: {
  values: number[];
  /** Stable id for the gradient. Falls back for callers that have none. */
  id?: string;
  pnl?: number | null;
  className?: string;
}) {
  if (values.length < 2) {
    // Hold the space so a card with history and a card without are the same
    // height — a grid that reflows by one row of cards is worse than a gap.
    return <div className={cn("h-9 w-full", className)} aria-hidden />;
  }

  return (
    <Sparkline
      id={id ?? `mini-${values.length}-${Math.round(values[0])}`}
      points={values}
      pnl={pnl ?? null}
      width={320}
      height={36}
      stretch
      className={cn("h-9 w-full", className)}
    />
  );
}
