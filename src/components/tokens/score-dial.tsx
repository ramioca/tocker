"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ScoreVerdict } from "@/server/types";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { cn } from "@/lib/utils";
import { VERDICT_META, effectiveVerdict, verdictColor, verdictTint } from "./verdict";

/**
 * The headline number. This is the one piece of motion in the score vocabulary:
 * the arc sweeps to its value once, on a card that a person opens deliberately
 * — a trade, a token page — never in a scrolling list.
 *
 * The sweep is 700ms ease-out and the digits roll with it. Under
 * `prefers-reduced-motion` both land instantly.
 */
export function ScoreDial({
  total,
  verdict,
  blockers,
  size = 128,
  label,
  className,
}: {
  total: number;
  verdict?: ScoreVerdict;
  blockers?: readonly string[];
  size?: number;
  /** Overrides the verdict word under the number. */
  label?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const resolved = verdict ?? effectiveVerdict(total, blockers);
  const meta = VERDICT_META[resolved];
  const color = verdictColor(resolved);

  const clamped = Math.max(0, Math.min(100, total));
  const stroke = Math.max(5, Math.round(size * 0.07));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // 270° of arc, opened at the bottom, so the gap reads as a gauge not a donut.
  const sweep = 0.75;
  const arc = circumference * sweep;

  return (
    <div
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score ${Math.round(clamped)} out of 100 — ${meta.label}`}
    >
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-[225deg]"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          initial={reduce ? false : { strokeDashoffset: arc }}
          animate={{ strokeDashoffset: arc * (1 - clamped / 100) }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.7, ease: [0.23, 1, 0.32, 1] }
          }
          style={{ filter: `drop-shadow(0 0 6px ${verdictTint(color, 35)})` }}
        />
      </svg>

      <div className="relative flex flex-col items-center leading-none">
        <span style={{ fontSize: Math.round(size * 0.28) }}>
          <NumberTicker
            value={Math.round(clamped)}
            duration={reduce ? 0 : 0.7}
            stagger={0}
            startOnView
            className="tnum font-mono font-semibold"
          />
        </span>
        <span
          className="mt-1 text-[10px] font-medium tracking-wide uppercase"
          style={{ color }}
        >
          {label ?? meta.label}
        </span>
      </div>
    </div>
  );
}
