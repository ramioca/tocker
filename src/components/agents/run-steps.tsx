"use client";

import { useMemo } from "react";
import { Coins } from "lucide-react";
import { AgentSteps } from "@/components/spectrumui/blocks/ai-assistants/agent-steps";
import { ReasoningTrace } from "@/components/spectrumui/blocks/ai-assistants/reasoning-trace";
import { ToolChips } from "@/components/spectrumui/blocks/ai-assistants/tool-chips";
import type {
  ReasoningStep,
  ToolCall,
} from "@/components/spectrumui/blocks/ai-assistants/types";
import { formatUsd } from "@/components/common/format";
import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";
import type { RunStep, RunSummary } from "@/server/types";

interface X402Payment {
  sourceId: string;
  amountUsd: number;
  network: string;
  simulated: boolean;
}

function summarise(payload: Record<string, unknown>): string {
  const result = "result" in payload ? payload.result : payload;
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function readX402(payload: Record<string, unknown>): X402Payment | null {
  const raw = payload.x402;
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  const args = (payload.args ?? {}) as Record<string, unknown>;
  const result = (payload.result ?? {}) as Record<string, unknown>;
  return {
    sourceId: String(result.sourceId ?? args.sourceId ?? "data source"),
    amountUsd: typeof x.amountUsd === "number" ? x.amountUsd : 0,
    network: String(x.network ?? "—"),
    simulated: Boolean(x.simulated),
  };
}

/**
 * A run is the agent showing its work. The three registry blocks each carry one
 * layer of it: what it thought, what it called, and what it paid for.
 */
export function RunSteps({
  steps,
  status,
  durationMs,
  className,
}: {
  steps: RunStep[];
  status: RunSummary["status"];
  /** Total wall time of the run — what "thought for" actually measures. */
  durationMs?: number | null;
  className?: string;
}) {
  const { calls, reasoning, payments } = useMemo(() => {
    const calls: ToolCall[] = [];
    const reasoning: ReasoningStep[] = [];
    const payments: X402Payment[] = [];
    const openByTool = new Map<string, ToolCall>();

    for (const step of steps) {
      const at = new Date(step.createdAt).getTime();

      if (step.kind === "thought" || step.kind === "message") {
        const text = step.payload.text;
        if (typeof text === "string" && text.length > 0) {
          reasoning.push({ id: step.id, content: text });
        }
        continue;
      }

      if (step.kind === "error") {
        calls.push({
          id: step.id,
          name: step.toolName ?? "error",
          status: "error",
          result: summarise(step.payload),
          startedAt: at,
          completedAt: at + (step.durationMs ?? 0),
        });
        continue;
      }

      if (step.kind === "tool_call") {
        const call: ToolCall = {
          id: step.id,
          name: step.toolName ?? "tool",
          args: (step.payload.args ?? step.payload) as Record<string, unknown>,
          status: "running",
          startedAt: at,
        };
        calls.push(call);
        openByTool.set(call.name, call);
        continue;
      }

      // tool_result — attach to the most recent open call with the same name.
      const name = step.toolName ?? "tool";
      const open = openByTool.get(name);
      const payment = readX402(step.payload);
      if (payment) payments.push(payment);

      if (open) {
        open.status = "success";
        open.result = summarise(step.payload);
        open.completedAt = at + (step.durationMs ?? 0);
        openByTool.delete(name);
      } else {
        calls.push({
          id: step.id,
          name,
          status: "success",
          result: summarise(step.payload),
          startedAt: at,
          completedAt: at + (step.durationMs ?? 0),
        });
      }
    }

    if (status !== "running" && status !== "queued") {
      for (const call of openByTool.values()) {
        call.status = status === "failed" ? "error" : "cancelled";
      }
    }

    return { calls, reasoning, payments };
  }, [steps, status]);

  if (steps.length === 0) {
    return (
      <EmptyState
        title="No steps recorded"
        description="This run ended before the model produced a step."
        className="py-8"
      />
    );
  }

  const totalSpend = payments.reduce((sum, payment) => sum + payment.amountUsd, 0);

  return (
    <div className={cn("space-y-5", className)}>
      {reasoning.length > 0 ? (
        <ReasoningTrace
          steps={reasoning}
          status={status === "running" ? "thinking" : "complete"}
          durationMs={durationMs ?? undefined}
          defaultOpen={status === "running"}
          className="max-w-none"
        />
      ) : null}

      {calls.length > 0 ? (
        <div className="space-y-3">
          <ToolChips calls={calls} variant="Row" className="max-w-none" />
          <AgentSteps steps={calls} className="max-w-none" />
        </div>
      ) : null}

      {payments.length > 0 ? (
        <section className="glass-inset rounded-xl p-3">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Coins aria-hidden className="size-3.5" />
            x402 payments
            <span className="tnum ml-auto font-mono text-xs font-normal text-foreground">
              {formatUsd(totalSpend)}
            </span>
          </h4>
          <ul className="mt-2 space-y-1">
            {payments.map((payment, i) => (
              <li
                key={`${payment.sourceId}-${i}`}
                className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
              >
                <span className="truncate text-foreground/80">{payment.sourceId}</span>
                <span className="truncate opacity-60">{payment.network}</span>
                {payment.simulated ? (
                  <span className="rounded border border-border px-1 text-[9px] uppercase">
                    simulated
                  </span>
                ) : null}
                <span className="tnum ml-auto">{formatUsd(payment.amountUsd)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
