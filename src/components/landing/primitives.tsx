"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/components/spectrumui/ease";
import { cn } from "@/lib/utils";

/**
 * The landing's building blocks. Everything here is plain DOM plus one
 * in-view reveal; the section builders compose these and add their own motion.
 * Type classes live in landing.css so the scale is one source of truth.
 */

export function Container({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("ld-container", className)} {...props} />;
}

export const Section = forwardRef<HTMLElement, ComponentPropsWithoutRef<"section">>(
  function Section({ className, ...props }, ref) {
    return <section ref={ref} className={cn("ld-section", className)} {...props} />;
  },
);

export function Eyebrow({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("ld-mono ld-eyebrow", className)} {...props} />;
}

/** Section header: eyebrow, heading, lead. Heading may be one string or lines. */
export function SectionHeader({
  eyebrow,
  heading,
  body,
  className,
  headingClassName,
  as: Tag = "h2",
}: {
  eyebrow: string;
  heading: string | ReadonlyArray<string>;
  body?: string;
  className?: string;
  headingClassName?: string;
  as?: "h2" | "h3";
}) {
  const lines = typeof heading === "string" ? [heading] : heading;
  return (
    <div className={cn("max-w-[44rem]", className)}>
      <Reveal>
        <Eyebrow>{eyebrow}</Eyebrow>
      </Reveal>
      <Tag className={cn("ld-h2 mt-5", headingClassName)}>
        {lines.map((line, i) => (
          <RevealLine key={line} delay={0.06 * i}>
            {line}
          </RevealLine>
        ))}
      </Tag>
      {body ? (
        <Reveal delay={0.18}>
          <p className="ld-lead mt-6 max-w-[38rem]">{body}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ reveals */

const VIEWPORT = { once: true, amount: 0.15 } as const;

/** Opacity + 12px rise, once, at 15% into the viewport. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 12,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

const LINE_VARIANTS = {
  hidden: { y: "110%" },
  visible: { y: "0%" },
} as const;

/**
 * Per-line mask reveal for headings: translateY(110%) → 0 behind an overflow
 * clip. The viewport observer sits on the OUTER clip span, not the translated
 * inner one — the inner starts entirely outside the clip, so it would never
 * intersect the viewport and never animate.
 */
export function RevealLine({
  children,
  delay = 0,
  className,
  inView = true,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** false = animate on mount (the hero), true = animate when scrolled into view. */
  inView?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className={cn("ld-line", className)}
      initial={reduced ? "visible" : "hidden"}
      {...(inView ? { whileInView: "visible", viewport: VIEWPORT } : { animate: "visible" })}
    >
      <motion.span
        className="ld-line-inner"
        variants={LINE_VARIANTS}
        transition={{ duration: 0.7, ease: EASE_OUT, delay }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}

/* ------------------------------------------------------------------ buttons */

type ButtonBase = {
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonBase & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">) {
  return (
    <button
      type="button"
      className={cn("ld-btn", `ld-btn-${variant}`, size === "sm" && "ld-btn-sm", className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonBase & Omit<ComponentPropsWithoutRef<"a">, "className" | "children">) {
  return (
    <a
      className={cn("ld-btn", `ld-btn-${variant}`, size === "sm" && "ld-btn-sm", className)}
      {...props}
    />
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path
        d="M2 8h11M8.5 3.5 13 8l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------- mark */

/**
 * The flat Ticker Knot, for chrome (nav, footer). Under 40px the brand kit
 * says to use the flat vector, so this is an inline SVG of exactly that.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden
      className={className}
      focusable="false"
    >
      <defs>
        <linearGradient id="ld-stem" x1="60" y1="36" x2="171" y2="223" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F9F7F2" />
          <stop offset="0.58" stopColor="#EDE9E3" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
        <linearGradient id="ld-loop" x1="18" y1="97" x2="217" y2="98" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F4F4F1" />
          <stop offset="0.43" stopColor="#DED5F8" />
          <stop offset="0.72" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#7155D9" />
        </linearGradient>
      </defs>
      <path
        d="M108 16C94 16 83 27 83 41V160C83 195 101 222 130 236C145 243 163 234 167 218C170 205 163 193 151 188C139 183 133 173 133 159V42C133 27 122 16 108 16Z"
        fill="url(#ld-stem)"
      />
      <path
        d="M34 75C21 75 13 86 16 99C17 105 21 110 27 114L54 129C75 141 96 142 118 131L152 113C163 107 174 107 187 113C198 118 211 113 216 102C221 90 215 77 204 72C177 59 151 60 126 73L94 91C83 97 73 97 62 91L44 79C41 76 38 75 34 75Z"
        fill="url(#ld-loop)"
      />
    </svg>
  );
}
