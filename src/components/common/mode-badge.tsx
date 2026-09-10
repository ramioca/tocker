import { cn } from "@/lib/utils";
import type { AgentMode } from "@/server/types";

/**
 * Paper vs live is the single most consequential fact about an agent — whether
 * the money is real. It gets a hard, unmissable treatment everywhere it appears.
 */
export function ModeBadge({
  mode,
  className,
  size = "sm",
}: {
  mode: AgentMode;
  className?: string;
  size?: "xs" | "sm";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold uppercase tracking-wide",
        size === "xs" ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        mode === "live"
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      {mode === "live" ? (
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
      ) : null}
      {mode}
    </span>
  );
}
