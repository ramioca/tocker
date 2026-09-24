/**
 * The three read-side rules that only hold if the SQL says so.
 *
 * 1. **The equity series belongs to the current book.** An agent is born in paper mode
 *    on a $10,000 notional and snapshotted every marks pass; going live swaps that for a
 *    real wallet holding ten dollars. Reading both halves as one series prints −99.9% on
 *    the agent card and on the public leaderboard, which is a change of units and not a
 *    loss. Every reader filters to the agent's current mode; rows written before the
 *    column existed carry `null` and count as current.
 * 2. **A private agent's history is its owner's.** `getAgentRuns` / `getAgentTrades` are
 *    reachable as server actions from any id, including one harvested while the agent was
 *    still public.
 * 3. **A failure's reason is owner-only.** The status is not — a record that hides its
 *    losses is worthless — but the string is whatever the provider said, and that has
 *    included an OpenAI key and an RPC URL with its key in the query string.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import {
  getAgentBySlug,
  getAgentRuns,
  getAgentTrades,
  getAgentWindowPnl,
  getEquitySeries,
  listMyAgents,
} from "./agents";
import { getAgentAnalytics } from "./analytics";
import { getLeaderboard, getTopDataSources, MIN_AGGREGATE_AGENTS } from "./discover";
import { REDACTED_ERROR } from "./visibility";

let db: Db;

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const USDC_ID = tokenId("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const STRANGER = "did:privy:a-stranger";
const LEAKY_ERROR = "Incorrect API key provided: sk-proj-9XbQ2mA7fTn1";

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function snapshot(agentId: string, at: Date, equityUsd: number, mode: "paper" | "live" | null) {
  await db.insert(schema.equitySnapshots).values({
    id: nanoid(),
    agentId,
    equityUsd: toNumeric(equityUsd, 6),
    cashUsd: toNumeric(equityUsd, 6),
    at,
    mode,
  });
}

// ---------------------------------------------------------------- mode filter

describe("equity reads are scoped to the agent's current mode", () => {
  /**
   * The exact shape of the operator's first live day: a paper book that ran for a week
   * at ten thousand dollars, then a go-live and two real points around ten dollars.
   * Unfiltered, `pnlOverWindow(series, "all")` is (10.4 − 10_000) / 10_000 ≈ −99.9%.
   */
  async function seedFlippedAgent() {
    const agent = await seedAgent(db, { mode: "live" });
    await snapshot(agent.agentId, daysAgo(7), 10_000, "paper");
    await snapshot(agent.agentId, daysAgo(6), 10_420, "paper");
    await snapshot(agent.agentId, daysAgo(5), 9_980, "paper");
    await snapshot(agent.agentId, daysAgo(1), 10, "live");
    await snapshot(agent.agentId, daysAgo(0), 10.4, "live");
    return agent;
  }

  it("getEquitySeries drops the paper half of a live agent's history", async () => {
    const agent = await seedFlippedAgent();
    const series = await getEquitySeries(agent.agentId, "all");
    expect(series.map((p) => p.equityUsd)).toEqual([10, 10.4]);
  });

  it("getAgentWindowPnl reads +4% and not −99.9%", async () => {
    const agent = await seedFlippedAgent();
    const pnl = await getAgentWindowPnl(agent.agentId, "all");
    expect(pnl).not.toBeNull();
    expect(pnl!.pnlPct).toBeCloseTo(4, 1);
  });

  it("the agent card aggregate (loadAgentAggregates) reads the live book", async () => {
    const agent = await seedFlippedAgent();
    const detail = await getAgentBySlug(agent.slug, agent.userId);
    expect(detail).not.toBeNull();
    expect(detail!.equityUsd).toBeCloseTo(10.4, 6);
    expect(detail!.pnlPct).toBeCloseTo(4, 1);
    expect(detail!.equity.map((p) => p.equityUsd)).toEqual([10, 10.4]);
  });

  it("the public leaderboard ranks a flipped agent on its live book", async () => {
    const agent = await seedFlippedAgent();
    const rows = await getLeaderboard("all", 50);
    const row = rows.find((r) => r.agent.id === agent.agentId);
    expect(row).toBeDefined();
    expect(row!.pnlPct).toBeCloseTo(4, 1);
  });

  it("the Performance tab's drawdown does not count the paper→live step", async () => {
    const agent = await seedFlippedAgent();
    const analytics = await getAgentAnalytics(agent.agentId, "all");
    expect(analytics).not.toBeNull();
    // The unfiltered series steps 9,980 → 10, i.e. a ~99.9% drawdown that would be
    // reported as this agent's worst ever, forever.
    expect(Math.abs(analytics!.maxDrawdownPct ?? 0)).toBeLessThan(50);
  });

  it("keeps rows with a null mode — they predate the column and belong to the current book", async () => {
    const agent = await seedAgent(db, { mode: "paper" });
    await snapshot(agent.agentId, daysAgo(2), 10_000, null);
    await snapshot(agent.agentId, daysAgo(1), 10_500, "paper");
    const series = await getEquitySeries(agent.agentId, "all");
    expect(series.map((p) => p.equityUsd)).toEqual([10_000, 10_500]);
  });

  it("drops the live half for an agent that went back to paper", async () => {
    const agent = await seedAgent(db, { mode: "paper" });
    await snapshot(agent.agentId, daysAgo(3), 10, "live");
    await snapshot(agent.agentId, daysAgo(2), 9, "live");
    await snapshot(agent.agentId, daysAgo(1), 10_000, "paper");
    const series = await getEquitySeries(agent.agentId, "all");
    expect(series.map((p) => p.equityUsd)).toEqual([10_000]);
  });
});

// ------------------------------------------------------- run & trade visibility

describe("all-time PnL has one basis", () => {
  it("measures a paper agent against its notional, so the card, header and chart agree", async () => {
    // The first mark landed after the first fill's fee. Last-minus-first read +$758.42
    // on the card and header while the chart, drawn against $10,000, read +$756.58.
    const agent = await seedAgent(db, { mode: "paper" });
    await snapshot(agent.agentId, daysAgo(5), 9_998.16, "paper");
    await snapshot(agent.agentId, daysAgo(1), 10_756.58, "paper");

    const detail = await getAgentBySlug(agent.slug, agent.userId);
    expect(detail!.pnlUsd).toBeCloseTo(756.58, 6);
    expect(detail!.pnlPct).toBeCloseTo(7.5658, 4);

    const [card] = await listMyAgents(agent.userId);
    expect(card.pnlUsd).toBeCloseTo(756.58, 6);
  });
});

describe("run and trade history are gated on the viewer", () => {
  async function seedFailedRun(agentId: string) {
    const id = nanoid();
    await db.insert(schema.agentRuns).values({
      id,
      agentId,
      trigger: "manual",
      status: "failed",
      error: LEAKY_ERROR,
      summary: null,
      startedAt: daysAgo(1),
      finishedAt: daysAgo(1),
    });
    return id;
  }

  async function seedFailedTrade(agentId: string, ownerId: string) {
    const id = nanoid();
    await db.insert(schema.trades).values({
      id,
      agentId,
      ownerId,
      chain: "solana",
      side: "buy",
      tokenId: BONK_ID,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(0, 12),
      amountUsd: toNumeric(2, 6),
      priceUsd: toNumeric(0.000021, 12),
      feeUsd: toNumeric(0.1, 6),
      status: "failed",
      error: LEAKY_ERROR,
      isPaper: false,
      origin: "agent",
    });
    return id;
  }

  it("shows a stranger that a public agent's run failed, without the provider's words", async () => {
    const agent = await seedAgent(db);
    await seedFailedRun(agent.agentId);

    const mine = await getAgentRuns(agent.agentId, null, agent.userId);
    expect(mine.items[0].error).toBe(LEAKY_ERROR);

    const theirs = await getAgentRuns(agent.agentId, null, STRANGER);
    expect(theirs.items).toHaveLength(1);
    expect(theirs.items[0].status).toBe("failed");
    expect(theirs.items[0].error).toBe(REDACTED_ERROR);
    expect(JSON.stringify(theirs.items)).not.toContain("sk-proj");
  });

  it("does the same for a failed trade", async () => {
    const agent = await seedAgent(db);
    await seedFailedTrade(agent.agentId, agent.userId);

    const mine = await getAgentTrades(agent.agentId, null, agent.userId);
    expect(mine.items[0].error).toBe(LEAKY_ERROR);

    const theirs = await getAgentTrades(agent.agentId, null, STRANGER);
    expect(theirs.items[0].status).toBe("failed");
    expect(theirs.items[0].error).toBe(REDACTED_ERROR);
  });

  it("returns nothing at all for a private agent, to anyone but its owner", async () => {
    const agent = await seedAgent(db);
    await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, agent.agentId));
    await seedFailedRun(agent.agentId);
    await seedFailedTrade(agent.agentId, agent.userId);

    expect((await getAgentRuns(agent.agentId, null, agent.userId)).items).toHaveLength(1);
    expect((await getAgentTrades(agent.agentId, null, agent.userId)).items).toHaveLength(1);

    // An id harvested while the agent was public must stop working when it is made private.
    expect((await getAgentRuns(agent.agentId, null, STRANGER)).items).toEqual([]);
    expect((await getAgentTrades(agent.agentId, null, STRANGER)).items).toEqual([]);
    expect((await getAgentRuns(agent.agentId, null, null)).items).toEqual([]);
    expect((await getAgentTrades(agent.agentId, null, null)).items).toEqual([]);
  });
});

// ------------------------------------------------------------ discover aggregates

describe("the public data-source leaderboard", () => {
  async function pay(agentId: string, sourceId: string, amountUsd: number) {
    await db.insert(schema.x402Payments).values({
      id: nanoid(),
      agentId,
      sourceId,
      url: `https://example.test/${sourceId}`,
      network: "eip155:8453",
      amountUsd: toNumeric(amountUsd, 6),
      settled: true,
    });
  }

  it("suppresses a source fewer than three public agents have bought", async () => {
    const source = `k-anon-${nanoid(6)}`;
    for (let i = 0; i < MIN_AGGREGATE_AGENTS - 1; i += 1) {
      const agent = await seedAgent(db);
      await pay(agent.agentId, source, 0.5);
    }
    const rows = await getTopDataSources(50);
    expect(rows.find((r) => r.id === source)).toBeUndefined();

    // The third public buyer is what makes the row publishable.
    const third = await seedAgent(db);
    await pay(third.agentId, source, 0.5);
    const after = await getTopDataSources(50);
    const row = after.find((r) => r.id === source);
    expect(row).toBeDefined();
    expect(row!.agentCount).toBe(MIN_AGGREGATE_AGENTS);
    expect(row!.spendUsd).toBeCloseTo(1.5, 6);
  });

  it("counts no private agent, neither in the head count nor in the spend", async () => {
    const source = `private-${nanoid(6)}`;
    for (let i = 0; i < MIN_AGGREGATE_AGENTS; i += 1) {
      const agent = await seedAgent(db);
      await pay(agent.agentId, source, 1);
    }
    const priv = await seedAgent(db);
    await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, priv.agentId));
    await pay(priv.agentId, source, 99);

    const row = (await getTopDataSources(50)).find((r) => r.id === source);
    expect(row).toBeDefined();
    expect(row!.agentCount).toBe(MIN_AGGREGATE_AGENTS);
    expect(row!.spendUsd).toBeCloseTo(MIN_AGGREGATE_AGENTS, 6);
  });

  it("drops a source only a private agent bought, entirely", async () => {
    const source = `private-only-${nanoid(6)}`;
    const priv = await seedAgent(db);
    await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, priv.agentId));
    await pay(priv.agentId, source, 12);
    expect((await getTopDataSources(50)).find((r) => r.id === source)).toBeUndefined();
  });
});
