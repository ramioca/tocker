"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { cn } from "@/lib/utils";
import { Arrow } from "./primitives";

/**
 * The primary CTA: the app's liquid-metal chrome ring around a dark pill, so
 * the landing's most important button is the same object as the "New agent"
 * button inside the product. WebGL2 with the library's own DOM fallback and a
 * hydration-safe mount (see src/components/common/liquid-metal.tsx).
 *
 * Budget: at most two of these on the page (hero + close). The nav uses the
 * plain `.ld-btn-primary`.
 */
export function LiquidCta({
  children,
  className,
  arrow = true,
  ...props
}: { children: ReactNode; className?: string; arrow?: boolean } & Omit<
  ComponentPropsWithoutRef<"button">,
  "className" | "children"
>) {
  return (
    <LiquidMetal preset="chromatic" theme="dark" strength={0.85} className="rounded-full">
      <button
        type="button"
        className={cn(
          "ld-btn group h-12 rounded-full bg-[rgba(12,12,15,0.72)] px-7 text-[var(--ld-paper)]",
          "transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgba(23,21,29,0.8)] active:scale-[0.97]",
          className,
        )}
        {...props}
      >
        {children}
        {arrow ? (
          <Arrow className="transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:translate-x-0.5" />
        ) : null}
      </button>
    </LiquidMetal>
  );
}
