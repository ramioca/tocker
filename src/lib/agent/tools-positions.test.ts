import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { newBudget } from "@/lib/x402/types";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { RunLogger } from "./logger";
import { buildPositionTools, type PositionReview } from "./tools-positions";
import type { RunContext } from "./tools";
import { seedAgent, setupTestDb } from "./test-support";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

beforeEach(() => {
  resetPriceCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: 0.0000027 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

interface ReviewResult {
  ok: boolean;
  count: number;
  rescored?: number;
  positions: PositionReview[];
  rendered: string;
}

/** Calls `review_positions` the way the AI SDK would, and returns its payload. */
async function review(agentId: string): Promise<ReviewResult> {
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) throw new Error("agent missing");
  const runId = `run-${agentId.slice(0, 8)}`;
  await db
    .insert(schema.agentRuns)
    .values({ id: runId, agentId, trigger: "manual", status: "running", startedAt: new Date() })
    .onConflictDoNothing({ target: schema.agentRuns.id });

  const budget = newBudget(agent.config.risk.maxDataSpendUsdPerRun);
  const ctx: RunContext = {
    runId,
    agent: {
      id: agent.id,
      ownerId: agent.ownerId,
      slug: agent.slug,
      name: agent.name,
      mode: agent.mode,
      config: agent.config,
    },
    x402: { agentId: agent.id, runId, mode: agent.mode, wallets: [], budget },
    budget,
    logger: new RunLogger(runId),
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };

  const tools = buildPositionTools(ctx);
  // `ToolSet` erases each tool's input type, so the call is typed the way the SDK would
  // call it rather than through the erased signature.
  type ToolExec = (input: unknown, options: unknown) => Promise<unknown>;
  const execute = tools.review_positions?.execute as unknown as ToolExec | undefined;
  if (!execute) throw new Error("review_positions is not registered");
  const result = await execute({}, { toolCallId: "call-1", messages: [] });
  await ctx.logger.flush();
  return result as unknown as ReviewResult;
}

describe("review_positions", () => {
  it("reports held time, score drift, liquidity and distance to every armed rule", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 30, takeProfitPct: 40, trailingStopPct: 25, maxHoldHours: 48, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    // Entry 0.0000030, mark 0.0000027 (−10%), peak 0.0000031, opened 5h ago.
    await db.insert(schema.positions).values({
      agentId,
      tokenId: BONK_ID,
      amountToken: "10000000.000000000000",
      avgCostUsd: "0.000003000000",
      openedAt: new Date(Date.now() - 5 * 3_600_000),
      peakPriceUsd: "0.000003100000",
      entryScore: "74.00",
      entryLiquidityUsd: "310000.00",
    });

    const result = await review(agentId);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.rescored).toBe(1);

    const [position] = result.positions;
    expect(position?.symbol).toBe("BONK");
    expect(position?.heldHours).toBeCloseTo(5, 1);
    expect(position?.returnPct).toBeCloseTo(-10, 1);
    expect(position?.entryScore).toBe(74);
    expect(position?.currentScore).not.toBeNull();
    expect(position?.currentLiquidityUsd).not.toBeNull();
    expect(position?.liquidityChangePct).not.toBeNull();
    // 30% stop with a −10% position → 20 points of headroom; 40% target → 50 away.
    expect(position?.stopDistancePct).toBeCloseTo(20, 1);
    expect(position?.takeProfitDistancePct).toBeCloseTo(50, 1);
    // 25% trail, −12.9% off the peak → 12.1 points of room.
    expect(position?.trailingStopDistancePct).toBeCloseTo(12.1, 0);
    expect(position?.hoursUntilMaxHold).toBeCloseTo(43, 0);
    expect(position?.pendingExitReason).toBeNull();
    expect(result.rendered).toContain("BONK [solana]");
    expect(result.rendered).toContain("stop +20.0pp");

    // The call is in the transcript, like every other tool.
    const steps = await db.select().from(schema.agentRunSteps);
    expect(steps.filter((s) => s.toolName === "review_positions" && s.kind === "tool_call")).toHaveLength(1);
    expect(steps.filter((s) => s.toolName === "review_positions" && s.kind === "tool_result")).toHaveLength(1);
  });

  it("flags a position the exit engine is about to close, and tells the model to leave it alone", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 15, takeProfitPct: 40, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    await db.insert(schema.positions).values({
      agentId,
      tokenId: BONK_ID,
      amountToken: "10000000.000000000000",
      avgCostUsd: "0.000003600000", // −25%, through the 15% stop
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: "0.000003600000",
    });

    const result = await review(agentId);
    const [position] = result.positions;
    expect(position?.verdict).toBe("exit_candidate");
    expect(position?.pendingExitReason).toBe("stop_loss");
    expect(position?.reason).toContain("no action needed from you");
  });

  it("watches a position that is close to its stop", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 12, takeProfitPct: 100, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    await db.insert(schema.positions).values({
      agentId,
      tokenId: BONK_ID,
      amountToken: "10000000.000000000000",
      avgCostUsd: "0.000002930000", // ≈ −7.8%, inside 5pp of a 12% stop
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: "0.000002930000",
    });

    const result = await review(agentId);
    expect(result.positions[0]?.verdict).toBe("watch");
    expect(result.positions[0]?.reason).toContain("above the 12% stop");
  });

  it("says so plainly when the agent is flat", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const result = await review(agentId);
    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.rendered).toContain("flat");
  });
});
