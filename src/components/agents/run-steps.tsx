"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Coins } from "lucide-react";
import { ReasoningTrace } from "@/components/spectrumui/blocks/ai-assistants/reasoning-trace";
import type { ReasoningStep, ToolCallStatus } from "@/components/spectrumui/blocks/ai-assistants/types";
import { formatDuration, formatUsd } from "@/components/common/format";
import { EmptyState } from "@/components/common/empty-state";
import { describeCall, describeResult, narrateRun, type CallHint } from "@/lib/agent/narrate";
import { cn } from "@/lib/utils";
import type { RunStep, RunSummary } from "@/server/types";

interface X402Payment {
  sourceId: string;
  amountUsd: number;
  network: string;
  simulated: boolean;
}

/**
 * One row of the transcript: a sentence for the call, a sentence for the result, and the
 * raw JSON kept one click away rather than in the operator's face.
 */
interface TranscriptStep {
  id: string;
  /** The tool name — still the honest label for the raw panel. */
  tool: string;
  status: ToolCallStatus;
  /** `describeCall`, re-derived once the result reveals the symbol. */
  call: string;
  /** `describeResult`, null while the call is still in flight. */
  detail: string | null;
  startedAt: number;
  completedAt?: number;
  /** Raw payloads, for the `raw` disclosure. */
  input?: unknown;
  output?: unknown;
}

function readInput(payload: Record<string, unknown>): unknown {
  // The run logger writes `{ input }`; the mock transcripts write `{ args }`; a payload
  // written by neither is its own input.
  if ("input" in payload) return payload.input;
  if ("args" in payload) return payload.args;
  return payload;
}

function readResult(payload: Record<string, unknown>): unknown {
  // `{ result }` from the logger, or the payload itself — the guardian step in
  // `src/lib/agent/run.ts` writes `{ summary, exits, skipped }` with no envelope.
  return "result" in payload ? payload.result : payload;
}

/** What the result knows that the call did not: the symbol, and whether it proposed. */
function hintFrom(result: unknown): CallHint {
  if (result === null || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  return {
    symbol: typeof r.symbol === "string" ? r.symbol : null,
    proposed: r.proposed === true,
  };
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

function json(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * A run is the agent showing its work — and the operator should be able to read it
 * without decoding JSON. Every row leads with a sentence (`src/lib/agent/narrate.ts`),
 * the raw payloads sit behind a per-step `raw` toggle, and a transcript long enough to
 * need one opens with a digest of the whole tick.
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
  const { transcript, reasoning, payments, digest } = useMemo(() => {
    const transcript: TranscriptStep[] = [];
    const reasoning: ReasoningStep[] = [];
    const payments: X402Payment[] = [];
    const openByTool = new Map<string, TranscriptStep[]>();
    const takeOpen = (toolName: string | null | undefined): TranscriptStep | undefined => {
      const queue = openByTool.get(toolName ?? "tool");
      const call = queue?.shift();
      if (queue && queue.length === 0) openByTool.delete(toolName ?? "tool");
      return call;
    };

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
        // A tool that threw: close its own call as failed, rather than leaving the call
        // "running" forever next to a detached error row.
        const open = takeOpen(step.toolName);
        const detail = describeResult(step.toolName, step.payload);
        if (open) {
          open.status = "error";
          open.detail = detail;
          open.output = step.payload;
          open.completedAt = at + (step.durationMs ?? 0);
        } else {
          transcript.push({
            id: step.id,
            tool: step.toolName ?? "error",
            status: "error",
            call: step.toolName === null ? "The run failed" : describeCall(step.toolName, null),
            detail,
            startedAt: at,
            completedAt: at + (step.durationMs ?? 0),
            output: step.payload,
          });
        }
        continue;
      }

      if (step.kind === "tool_call") {
        const input = readInput(step.payload);
        const call: TranscriptStep = {
          id: step.id,
          tool: step.toolName ?? "tool",
          status: "running",
          call: describeCall(step.toolName, input),
          detail: null,
          startedAt: at,
          input,
        };
        transcript.push(call);
        // A queue per name, not a slot: the model calls score_token three times in one
        // step and the results land in order, so the *oldest* open call is the one each
        // result belongs to. A single slot lost two of the three and left one "running".
        const queue = openByTool.get(call.tool);
        if (queue) queue.push(call);
        else openByTool.set(call.tool, [call]);
        continue;
      }

      // tool_result — attach to the oldest open call with the same name.
      const name = step.toolName ?? "tool";
      const open = takeOpen(name);
      const payment = readX402(step.payload);
      if (payment) payments.push(payment);

      const output = readResult(step.payload);
      const detail = describeResult(step.toolName, output);

      if (open) {
        open.status = "success";
        open.detail = detail;
        open.output = output;
        open.completedAt = at + (step.durationMs ?? 0);
        // Now that the symbol (and whether it proposed) is known, the call line can stop
        // saying "7uvL…mnop" and start saying "DOVE".
        open.call = describeCall(step.toolName, open.input, hintFrom(output));
      } else {
        transcript.push({
          id: step.id,
          tool: name,
          status: "success",
          call: describeCall(step.toolName, null, hintFrom(output)),
          detail,
          startedAt: at,
          completedAt: at + (step.durationMs ?? 0),
          output,
        });
      }
    }

    if (status !== "running" && status !== "queued") {
      for (const queue of openByTool.values()) {
        for (const call of queue) call.status = status === "failed" ? "error" : "cancelled";
      }
    }

    // The model sometimes calls `finish` twice in a row with the same summary; one
    // "Finishing" row says it, two read as a stutter. Keep the first and stretch its end.
    const merged: TranscriptStep[] = [];
    for (const row of transcript) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.tool === "finish" &&
        row.tool === "finish" &&
        prev.call === row.call &&
        prev.detail === row.detail
      ) {
        prev.completedAt = Math.max(prev.completedAt ?? prev.startedAt, row.completedAt ?? row.startedAt);
        if (row.status === "error") prev.status = "error";
        continue;
      }
      merged.push(row);
    }

    return { transcript: merged, reasoning, payments, digest: narrateRun(steps) };
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
      {digest !== "" && steps.length > 3 ? (
        <section className="glass-inset rounded-xl px-3.5 py-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            What happened
          </h4>
          <p className="tnum mt-1.5 text-[13px] leading-[1.65] text-foreground/85">{digest}</p>
        </section>
      ) : null}

      {reasoning.length > 0 ? (
        <ReasoningTrace
          steps={reasoning}
          status={status === "running" ? "thinking" : "complete"}
          durationMs={durationMs ?? undefined}
          defaultOpen={status === "running"}
          className="max-w-none"
        />
      ) : null}

      {/* No tool-name chip strip above the list: it said every step a second time, as
          raw names with a green dot each, and the rows already carry status and time. */}
      {transcript.length > 0 ? (
        <ol className="w-full">
          {transcript.map((step, index) => (
            <StepRow key={step.id} step={step} last={index === transcript.length - 1} />
          ))}
        </ol>
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

/**
 * Only failure gets colour. A green tick on every one of twenty rows is twenty things
 * competing for an eye that is looking for the one row that went wrong.
 */
const DOT: Record<ToolCallStatus, string> = {
  pending: "bg-muted-foreground/25",
  running: "bg-primary motion-safe:animate-pulse",
  success: "bg-muted-foreground/40",
  error: "bg-destructive",
  cancelled: "bg-muted-foreground/20",
};

function StepRow({ step, last }: { step: TranscriptStep; last: boolean }) {
  const [rawOpen, setRawOpen] = useState(false);
  const failed = step.status === "error";
  const elapsed =
    step.completedAt === undefined ? null : formatDuration(step.completedAt - step.startedAt);
  const rawId = `raw-${step.id}`;

  return (
    <li className="relative flex gap-3">
      <div className="flex flex-col items-center pt-[7px]">
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT[step.status])} />
        {!last ? <span className="mt-1 w-px flex-1 bg-border/70" /> : null}
      </div>

      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3.5")}>
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">{step.call}</p>
          {step.status === "running" ? (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary">
              running
            </span>
          ) : elapsed !== null ? (
            <span className="tnum shrink-0 font-mono text-[10px] text-muted-foreground">
              {elapsed}
            </span>
          ) : null}
        </div>

        {step.detail !== null ? (
          <p
            // The only locale-dependent text in a transcript is a proposal's expiry
            // clock, which server and client necessarily read in different timezones.
            suppressHydrationWarning
            className={cn(
              "tnum mt-0.5 text-[12px] leading-[1.55]",
              failed ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {step.detail}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setRawOpen((open) => !open)}
          aria-expanded={rawOpen}
          aria-controls={rawId}
          className="focus-ring -ml-0.5 mt-1 flex items-center gap-0.5 rounded px-0.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-2.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              rawOpen && "rotate-90",
            )}
          />
          raw
        </button>

        <div
          id={rawId}
          // Collapsed to zero height is still focusable; inert takes it out of the Tab order.
          inert={!rawOpen}
          className="grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{ gridTemplateRows: rawOpen ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <div className="mt-1.5 space-y-1.5 rounded-lg border border-border/60 bg-background/40 p-2.5">
              <RawBlock label={`${step.tool} · input`} value={step.input} />
              {step.output === undefined ? null : (
                <RawBlock label={`${step.tool} · result`} value={step.output} />
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

function RawBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="tnum mt-0.5 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-muted-foreground">
        {json(value)}
      </pre>
    </div>
  );
}
