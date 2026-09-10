import { Sparkline } from "@/components/spectrumui/charts/sparkline-chart";
import { cn } from "@/lib/utils";

/**
 * The 30-point equity trace that rides along an agent card. It is decoration
 * with a job: it tells you the shape of the story before you read the number.
 */
export function MiniSparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) {
    return <div className={cn("h-8 w-full", className)} aria-hidden />;
  }

  // `framed` is what supplies the chart colour variables, so keep it and just
  // give the frame the height we want.
  return <Sparkline data={values.map((value, i) => ({ i, value }))} filled className={cn("h-8", className)} />;
}
