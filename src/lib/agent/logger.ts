/**
 * Sequential step log for one run. The run detail page replays these in order, so the
 * `seq` counter must be monotonic even when steps are written from several awaits.
 */
import { nanoid } from "nanoid";
import { agentRunSteps, getDb } from "@/db";

export type StepKind = "thought" | "tool_call" | "tool_result" | "message" | "error";

export interface StepInput {
  kind: StepKind;
  toolName?: string | null;
  payload: Record<string, unknown>;
  durationMs?: number | null;
}

export class RunLogger {
  private seq = 0;
  private tail: Promise<void> = Promise.resolve();
  readonly runId: string;

  constructor(runId: string) {
    this.runId = runId;
  }

  get stepCount(): number {
    return this.seq;
  }

  /** Serialised so concurrent tool calls cannot interleave `seq` values. */
  log(step: StepInput): Promise<void> {
    const seq = this.seq++;
    this.tail = this.tail.then(async () => {
      const db = await getDb();
      await db.insert(agentRunSteps).values({
        id: nanoid(),
        runId: this.runId,
        seq,
        kind: step.kind,
        toolName: step.toolName ?? null,
        payload: safePayload(step.payload),
        durationMs: step.durationMs ?? null,
      });
    });
    return this.tail;
  }

  /** Awaits every pending write. Call before marking the run finished. */
  flush(): Promise<void> {
    return this.tail;
  }
}

const MAX_PAYLOAD_CHARS = 24_000;

/** Keeps a single step from ballooning the runs table with a whole API response. */
function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  try {
    const json = JSON.stringify(payload);
    if (json !== undefined && json.length <= MAX_PAYLOAD_CHARS) return JSON.parse(json) as Record<string, unknown>;
    return { truncated: true, preview: (json ?? "").slice(0, MAX_PAYLOAD_CHARS) };
  } catch {
    return { unserializable: true };
  }
}
