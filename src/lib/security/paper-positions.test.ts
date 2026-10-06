/**
 * The count `goLiveAction` refuses on and the live checklist's "No paper positions open"
 * row, which must be the same number.
 *
 * Real code against in-memory PGlite. The checklist is evaluated whole, on a Base-only
 * agent with no data sources and no auth app configured, so every other row answers from
 * the database or from nothing and no request leaves the process.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb, type SeededAgent } from "@/lib/agent/test-support";
import { USDC_MINT } from "@/lib/wallets/funding";
import { evaluateLiveReadiness } from "./live-readiness";
import { listSimulatedOpenPositions, simulatedOpenPositions } from "./paper-positions";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

let db: Db;

beforeAll(async () => {
  // No auth app and no real payments: the wallet, second-factor and data rows then read
  // nothing over the network, whatever the shell that runs the suite has exported.
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
  vi.stubEnv("PRIVY_APP_SECRET", "");
  vi.stubEnv("X402_MOCK", "1");

  db = await setupTestDb();
  for (const [address, symbol, decimals] of [
    [BONK, "BONK", 5],
    [WIF, "WIF", 6],
    [USDC_MINT.solana, "USDC", 6],
  ] as const) {
    await db
      .insert(schema.tokens)
      .values({ id: `solana:${address}`, chain: "solana", address, symbol, decimals })
      .onConflictDoNothing();
  }
  // Generous: PGlite + drizzle-kit pushSchema can take well over the default hook timeout.
}, 120_000);

afterAll(() => {
  vi.unstubAllEnvs();
});

async function hold(agentId: string, address: string, amountToken = "1000"): Promise<void> {
  await db.insert(schema.positions).values({
    agentId,
    tokenId: `solana:${address}`,
    amountToken,
    avgCostUsd: "0.00002",
  });
}

async function close(agentId: string, address: string): Promise<void> {
  await db
    .update(schema.positions)
    .set({ amountToken: "0" })
    .where(and(eq(schema.positions.agentId, agentId), eq(schema.positions.tokenId, `solana:${address}`)));
}

async function recordTrade(
  agent: SeededAgent,
  address: string,
  overrides: { isPaper: boolean; status: "filled" | "failed" },
): Promise<void> {
  await db.insert(schema.trades).values({
    id: `trade_${nanoid(8)}`,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: "buy",
    tokenId: `solana:${address}`,
    quoteTokenId: `solana:${USDC_MINT.solana}`,
    amountToken: "1000",
    amountUsd: "20",
    priceUsd: "0.02",
    status: overrides.status,
    isPaper: overrides.isPaper,
  });
}

describe("simulatedOpenPositions", () => {
  it("is zero for an agent that holds nothing", async () => {
    const agent = await seedAgent(db);
    expect(await simulatedOpenPositions(db, agent.agentId)).toBe(0);
    expect(await listSimulatedOpenPositions(db, agent.agentId)).toEqual([]);
  });

  it("counts every held token the agent never filled a live order in, with its symbol", async () => {
    const agent = await seedAgent(db);
    await hold(agent.agentId, BONK);
    await hold(agent.agentId, WIF);
    await recordTrade(agent, BONK, { isPaper: true, status: "filled" });

    expect(await simulatedOpenPositions(db, agent.agentId)).toBe(2);
    const held = await listSimulatedOpenPositions(db, agent.agentId);
    expect(held.map((position) => position.symbol).sort()).toEqual(["BONK", "WIF"]);
  });

  it("leaves out a token the agent has filled a real order in: those may be real tokens", async () => {
    const agent = await seedAgent(db);
    await hold(agent.agentId, BONK);
    await hold(agent.agentId, WIF);
    await recordTrade(agent, BONK, { isPaper: false, status: "filled" });

    const held = await listSimulatedOpenPositions(db, agent.agentId);
    expect(held).toEqual([{ tokenId: `solana:${WIF}`, symbol: "WIF" }]);
  });

  it("does not let a live order that failed stand in for a wallet holding", async () => {
    const agent = await seedAgent(db);
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: false, status: "failed" });

    expect(await simulatedOpenPositions(db, agent.agentId)).toBe(1);
  });

  it("does not count a position that has been sold down to nothing", async () => {
    const agent = await seedAgent(db);
    await hold(agent.agentId, BONK, "0");

    expect(await simulatedOpenPositions(db, agent.agentId)).toBe(0);
  });

  it("only reads the agent it was asked about", async () => {
    const holder = await seedAgent(db);
    const other = await seedAgent(db);
    await hold(holder.agentId, BONK);

    expect(await simulatedOpenPositions(db, other.agentId)).toBe(0);
  });
});

describe("the live checklist's paper-positions row", () => {
  /** Base only, no paid data: nothing on the checklist has a chain or a vendor to ask. */
  async function seedChecklistAgent(mode: "paper" | "live" = "paper") {
    const agent = await seedAgent(db, { mode, config: { chains: ["base"], dataSources: [] } });
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    const evaluate = () =>
      evaluateLiveReadiness({
        agentId: agent.agentId,
        slug: agent.slug,
        ownerId: agent.userId,
        config: row.config,
        walletBudget: row.walletBudget,
      });
    return { agent, evaluate };
  }

  it("is on the checklist, red, with the count the action refuses on and a link to the positions", async () => {
    const { agent, evaluate } = await seedChecklistAgent();
    await hold(agent.agentId, BONK);
    await hold(agent.agentId, WIF);

    const readiness = await evaluate();
    const step = readiness.steps.find((entry) => entry.id === "paperPositions");

    expect(step?.state).toBe("fail");
    expect(step?.detail).toContain(`${await simulatedOpenPositions(db, agent.agentId)} paper positions are still open`);
    expect(step?.detail).toMatch(/\((BONK, WIF|WIF, BONK)\)/);
    expect(step?.fix).toEqual({ label: "Sell them on the agent page", href: `/agents/${agent.slug}#positions` });
    // Any red row keeps `ready` false, and `ready` is what shows the hold button. (Other
    // rows are red here too, with no auth app; the row above is the one under test.)
    expect(readiness.ready).toBe(false);
  });

  it("turns green once the paper positions are sold", async () => {
    const { agent, evaluate } = await seedChecklistAgent();
    await hold(agent.agentId, BONK);
    expect((await evaluate()).steps.find((entry) => entry.id === "paperPositions")?.state).toBe("fail");

    await close(agent.agentId, BONK);

    const step = (await evaluate()).steps.find((entry) => entry.id === "paperPositions");
    expect(step?.state).toBe("pass");
    expect(step?.fix).toBeNull();
  });

  it("does not hold real tokens against the agent", async () => {
    const { agent, evaluate } = await seedChecklistAgent();
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: false, status: "filled" });

    expect((await evaluate()).steps.find((entry) => entry.id === "paperPositions")?.state).toBe("pass");
  });

  it("has nothing to say about an agent that is already live", async () => {
    const { agent, evaluate } = await seedChecklistAgent("live");
    await hold(agent.agentId, BONK);

    const step = (await evaluate()).steps.find((entry) => entry.id === "paperPositions");
    expect(step?.state).toBe("pass");
    expect(step?.fix).toBeNull();
  });
});
