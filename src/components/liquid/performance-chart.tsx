"use client";

import { useRef } from "react";
import { useInView } from "motion/react";
import { PortfolioChart, type PortfolioChartProps } from "@/components/spectrumui/charts/portfolio-chart";

/**
 * The Performance section's equity chart. Its line draws in once, when the
 * chart is on screen, not at page load thousands of pixels above it.
 */
export function PerformanceChart(props: Omit<PortfolioChartProps, "intro">) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.3 });
  return (
    <div ref={ref}>
      <PortfolioChart {...props} intro={seen} />
    </div>
  );
}
