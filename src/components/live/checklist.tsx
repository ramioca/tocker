"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, CircleAlert, X } from "lucide-react";
import type { ReadinessStep } from "@/lib/security/types";
import { cn } from "@/lib/utils";

/**
 * The checklist.
 *
 * Every row states what is true right now rather than what to do, and carries the
 * one link that fixes it. A row is green only when the check ran and passed —
 * "could not tell" is red, because a checklist that goes green on an unanswered
 * question is worse than no checklist.
 *
 * The only motion is the state mark swapping when a row changes verdict, which is
 * the one moment worth noticing on this screen.
 */
export function Checklist({ steps }: { steps: ReadinessStep[] }) {
  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
      {steps.map((step, index) => (
        <ChecklistRow key={step.id} step={step} index={index} />
      ))}
    </ol>
  );
}

function ChecklistRow({ step, index }: { step: ReadinessStep; index: number }) {
  const reduce = useReducedMotion();

  return (
    <li
      className={cn(
        "glass flex gap-3 p-4",
        step.state === "fail" ? "bg-destructive/[0.04]" : "bg-card/30",
      )}
    >
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={step.state}
            initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 28 }}
            className={cn(
              "grid size-6 place-items-center rounded-full border",
              step.state === "pass" && "border-positive/40 bg-positive/15 text-positive",
              step.state === "warn" && "border-amber-500/40 bg-amber-500/15 text-amber-500",
              step.state === "fail" && "border-destructive/40 bg-destructive/15 text-destructive",
            )}
          >
            {step.state === "pass" ? (
              <Check aria-hidden className="size-3.5" />
            ) : step.state === "warn" ? (
              <CircleAlert aria-hidden className="size-3.5" />
            ) : (
              <X aria-hidden className="size-3.5" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-sm font-medium">
          <span className="tnum font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
          {step.title}
          <span className="sr-only">
            {step.state === "pass" ? " — ready" : step.state === "warn" ? " — warning" : " — not ready"}
          </span>
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</p>
        {step.fix ? (
          <Link
            href={step.fix.href}
            className="mt-2 inline-flex items-center gap-1 rounded text-xs font-medium text-foreground underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {step.fix.label}
            <ArrowUpRight aria-hidden className="size-3" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}
