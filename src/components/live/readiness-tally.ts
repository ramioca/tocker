import type { LiveReadiness } from "@/lib/security/types";

/**
 * The preflight counter, counted the way `readiness.ready` decides: amber rows do not
 * block. Counting only green rows read "6/10 ready" next to an armed Go-live hold.
 */
export function readinessTally(readiness: Pick<LiveReadiness, "steps" | "ready">): {
  fail: number;
  warn: number;
  pass: number;
  label: string;
} {
  const fail = readiness.steps.filter((step) => step.state === "fail").length;
  const warn = readiness.steps.filter((step) => step.state === "warn").length;
  const pass = readiness.steps.length - fail - warn;
  const label = readiness.ready
    ? `Ready to go live${warn > 0 ? ` · ${warn} to review` : ""}`
    : [fail > 0 ? `${fail} blocking` : null, warn > 0 ? `${warn} to review` : null, pass > 0 ? `${pass} ready` : null]
        .filter(Boolean)
        .join(" · ");
  return { fail, warn, pass, label };
}
