"use client";

import { useEffect, useRef } from "react";
import { animate } from "motion/react";

/**
 * A figure that counts up from zero the first time it scrolls into view, in tabular
 * numerals so the digits never jostle. The server renders the final value, so the page
 * reads right without script and under reduced motion; a screen reader is handed the
 * final text in a hidden copy and never hears the digits run. Each frame writes
 * the element's text directly; React never re-renders for it.
 *
 * Only a figure still below the fold is wound back to zero; one already on screen at
 * hydration keeps its value rather than blinking.
 */
export function Ticker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  signed = false,
  className,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Print a leading + on a positive value (and a true minus on a negative one). */
  signed?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const text = format(value, decimals, prefix, suffix, signed);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;

    el.textContent = format(0, decimals, prefix, suffix, signed);
    let stop: (() => void) | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const run = animate(0, value, {
          duration: 1.1,
          ease: [0.16, 1, 0.3, 1],
          onUpdate: (v) => {
            el.textContent = format(v, decimals, prefix, suffix, signed);
          },
        });
        stop = () => run.stop();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop?.();
      el.textContent = format(value, decimals, prefix, suffix, signed);
    };
  }, [value, decimals, prefix, suffix, signed]);

  return (
    <span className={className ? `lp-tick ${className}` : "lp-tick"}>
      <span className="lp-sr">{text}</span>
      <span ref={ref} aria-hidden className="lp-tick-digits" style={{ minWidth: `${text.length}ch` }}>
        {text}
      </span>
    </span>
  );
}

function format(v: number, decimals: number, prefix: string, suffix: string, signed: boolean) {
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
  return `${sign}${prefix}${abs}${suffix}`;
}
