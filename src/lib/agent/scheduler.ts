/**
 * Scheduler: pick up every active agent whose `nextRunAt` is due and tick it.
 *
 * Runs in batches of 5 with `Promise.allSettled` so one slow LLM cannot stall the
 * others, and caps the batch at 20 agents per invocation so a cron tick stays inside
 * a serverless timeout.
 */
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { agents, getDb } from "@/db";
import { runAgent, type RunAgentResult } from "./run";

export interface TickResult {
  due: number;
  results: Array<RunAgentResult & { agentId: string }>;
}

const BATCH_SIZE = 5;

export async function findDueAgents(limit = 20, now: Date = new Date()): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.status, "active"), isNotNull(agents.nextRunAt), lte(agents.nextRunAt, now)))
    .orderBy(asc(agents.nextRunAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Runs every due agent. Never throws: a failed agent shows up in `results`. */
export async function tickDueAgents(limit = 20, now: Date = new Date()): Promise<TickResult> {
  const due = await findDueAgents(limit, now);
  const results: Array<RunAgentResult & { agentId: string }> = [];

  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((agentId) => runAgent({ agentId, trigger: "schedule" })));
    settled.forEach((outcome, idx) => {
      const agentId = batch[idx] as string;
      if (outcome.status === "fulfilled") {
        results.push({ agentId, ...outcome.value });
      } else {
        results.push({
          agentId,
          runId: "",
          status: "failed",
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    });
  }

  return { due: due.length, results };
}
