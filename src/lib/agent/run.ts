import "server-only";

export interface RunAgentInput {
  agentId: string;
  trigger: "schedule" | "manual" | "webhook";
}
export interface RunAgentResult {
  runId: string;
  status: "succeeded" | "failed" | "skipped";
  summary?: string;
  error?: string;
}

/**
 * Execute one agent tick. OWNER: runtime. See SPEC.md → Agent run loop.
 * Must be safe to call concurrently (skips if a run is already `running`).
 */
export async function runAgent(_input: RunAgentInput): Promise<RunAgentResult> {
  throw new Error("runAgent not implemented (runtime workstream)");
}
