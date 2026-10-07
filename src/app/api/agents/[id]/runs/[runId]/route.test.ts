/**
 * The run detail a browser polls, and what it says about a run that paid for its own
 * thinking.
 *
 * What the run was charged and why it stopped are its owner's to see, like the
 * transcript. A stranger watching a public agent gets the track record and nothing of
 * that; and a key agent's run answers exactly as it did before pay-per-use existed, with
 * no new field at all.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { describeInferenceStop } from "@/lib/x402/inference-types";

let sessionUserId: string | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => (sessionUserId ? { userId: sessionUserId, handle: "viewer", displayName: null, avatarUrl: null, email: null } : null),
}));

const { GET } = await import("./route");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  sessionUserId = null;
});

async function read(agentId: string, runId: string): Promise<Record<string, unknown>> {
  const res = await GET(new Request(`http://localhost/api/agents/${agentId}/runs/${runId}`), {
    params: Promise.resolve({ id: agentId, runId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

async function runRow(agentId: string, values: Partial<typeof schema.agentRuns.$inferInsert>): Promise<string> {
  const id = nanoid();
  const at = new Date();
  await db.insert(schema.agentRuns).values({ id, agentId, trigger: "schedule", status: "succeeded", startedAt: at, finishedAt: at, summary: "Held.", ...values });
  return id;
}

describe("GET /api/agents/[id]/runs/[runId]", () => {
  it("tells the owner what a pay-per-use run was charged, on which model, and why it stopped", async () => {
    const agent = await seedAgent(db);
    const runId = await runRow(agent.agentId, {
      status: "failed",
      error: describeInferenceStop("paid_no_answer").detail,
      llmSource: "usdc",
      model: "google/gemini-2.5-flash",
      inferenceSpendUsd: "0.012345",
      stopReason: "paid_no_answer",
    });
    sessionUserId = agent.userId;

    const detail = await read(agent.agentId, runId);
    expect(detail.thinking).toMatchObject({
      spendUsd: 0.012345,
      model: "google/gemini-2.5-flash",
      stop: { reason: "paid_no_answer", kind: "platform", title: describeInferenceStop("paid_no_answer").title },
    });
    expect(detail.error).toBe(describeInferenceStop("paid_no_answer").detail);
  });

  it("tells nobody else: a stranger gets the track record and none of it", async () => {
    const agent = await seedAgent(db);
    const runId = await runRow(agent.agentId, { llmSource: "usdc", model: "google/gemini-2.5-flash", inferenceSpendUsd: "0.012345", stopReason: "run_cap" });

    for (const viewer of [null, (await seedAgent(db)).userId]) {
      sessionUserId = viewer;
      const detail = await read(agent.agentId, runId);
      expect("thinking" in detail).toBe(false);
      expect(detail.status).toBe("succeeded");
      expect(detail.summary).toBe("Held.");
      const text = JSON.stringify(detail);
      expect(text).not.toContain("0.012345");
      expect(text).not.toContain("run_cap");
      expect(text).not.toContain("gemini");
    }
  });

  it("answers for a key agent's run as it always did, with no new field for anyone", async () => {
    const agent = await seedAgent(db);
    const recorded = await runRow(agent.agentId, { llmSource: "key", model: "claude-sonnet-5" });
    // And a row written before the columns existed.
    const older = await runRow(agent.agentId, {});
    sessionUserId = agent.userId;

    for (const runId of [recorded, older]) {
      const detail = await read(agent.agentId, runId);
      expect("thinking" in detail).toBe(false);
      expect(Object.keys(detail).sort()).toEqual(
        [
          "agentId", "createdAt", "dataSpendUsd", "error", "finishedAt", "id", "inputTokens", "outputTokens", "refusedCount",
          "startedAt", "status", "stepCount", "steps", "summary", "tradeCount", "trades", "transcriptVisible", "trigger",
        ].sort(),
      );
    }
  });
});
