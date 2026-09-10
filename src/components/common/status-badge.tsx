import { cn } from "@/lib/utils";
import type { AgentStatus, RunSummary } from "@/server/types";

const AGENT_TONE: Record<AgentStatus, string> = {
  draft: "border-border bg-muted/50 text-muted-foreground",
  active: "border-positive/35 bg-positive/12 text-positive",
  paused: "border-border bg-muted/60 text-foreground/70",
  error: "border-destructive/40 bg-destructive/12 text-destructive",
};

const AGENT_LABEL: Record<AgentStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  error: "Error",
};

export function StatusBadge({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        AGENT_TONE[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "active" && "motion-safe:animate-pulse",
        )}
      />
      {AGENT_LABEL[status]}
    </span>
  );
}

const RUN_TONE: Record<RunSummary["status"], string> = {
  queued: "border-border bg-muted/50 text-muted-foreground",
  running: "border-primary/40 bg-primary/12 text-primary",
  succeeded: "border-positive/35 bg-positive/12 text-positive",
  failed: "border-destructive/40 bg-destructive/12 text-destructive",
  cancelled: "border-border bg-muted/50 text-muted-foreground",
};

export function RunStatusBadge({
  status,
  className,
}: {
  status: RunSummary["status"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        RUN_TONE[status],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          status === "running" && "motion-safe:animate-pulse",
        )}
      />
      {status}
    </span>
  );
}
