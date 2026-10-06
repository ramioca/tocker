import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { newBudget } from "@/lib/x402/types";
import { RunLogger } from "./logger";
import { buildTools, type RunContext } from "./tools";
import { seedAgent, setupTestDb } from "./test-support";

let db: Db;
let fetched: string[];

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
});

beforeEach(() => {
  // Nothing in these tests may reach the network: a data tool that fetches is the bug.
  fetched = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;

/** The data tools of a seeded agent with this `dataSources` list, called the way the AI SDK would. */
async function dataTools(dataSources: string[]) {
  const { agentId } = await seedAgent(db, { config: { dataSources } });
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  const agent = rows[0];
  if (!agent) throw new Error("agent missing");
  const runId = `run-${agentId.slice(0, 8)}`;
  await db.insert(schema.agentRuns).values({ id: runId, agentId, trigger: "manual", status: "running", startedAt: new Date() });

  const budget = newBudget(agent.config.risk.maxDataSpendUsdPerRun);
  const ctx: RunContext = {
    runId,
    agent: { id: agent.id, ownerId: agent.ownerId, slug: agent.slug, name: agent.name, mode: agent.mode, config: agent.config },
    x402: { agentId: agent.id, runId, mode: agent.mode, wallets: [], budget },
    budget,
    logger: new RunLogger(runId),
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };
  const tools = buildTools(ctx);
  const call = (name: "query_data_source" | "search_data_sources" | "score_token") => {
    const execute = tools[name]?.execute as unknown as ToolExec | undefined;
    if (!execute) throw new Error(`${name} is not registered`);
    return (input: unknown) => execute(input, { toolCallId: `call_${name}`, messages: [] });
  };
  const payments = () => db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
  return { query: call("query_data_source"), search: call("search_data_sources"), score: call("score_token"), budget, payments };
}

describe("query_data_source", () => {
  it("buys from a source the owner enabled", async () => {
    const t = await dataTools(["x-search"]);
    const res = await t.query({ sourceId: "x-search", params: { query: "BONK" } });
    expect(res.ok).toBe(true);
    expect(await t.payments()).toHaveLength(1);
    expect(t.budget.spentUsd).toBeGreaterThan(0);
  });

  it("refuses a registry source the owner did not enable", async () => {
    const t = await dataTools(["x-search"]);
    const res = await t.query({ sourceId: "cmc-quotes", params: { symbols: ["SOL"] } });
    expect(res.ok).toBe(false);
    expect(String(res.reason)).toContain("not enabled for this agent");
    expect(await t.payments()).toHaveLength(0);
    expect(t.budget.spentUsd).toBe(0);
  });

  it("treats an empty list as none, not as every source", async () => {
    const t = await dataTools([]);
    for (const sourceId of ["x-search", "cmc-quotes", "dripmetrics-summary"]) {
      const res = await t.query({ sourceId, params: { query: "BONK" } });
      expect(res.ok, sourceId).toBe(false);
      expect(String(res.reason), sourceId).toContain("No data sources are enabled");
    }
    expect(await t.payments()).toHaveLength(0);
    expect(t.budget.spentUsd).toBe(0);
  });

  it("refuses a retired source id, whatever the saved config says", async () => {
    // A saved config can still name a retired id.
    for (const dataSources of [["bazaar"], ["bazaar", "x-search"], []]) {
      const t = await dataTools(dataSources);
      const res = await t.query({
        sourceId: "bazaar",
        params: { resourceUrl: "https://other.example/data" },
      });
      expect(res.ok).toBe(false);
      expect(String(res.reason)).toContain('There is no data source "bazaar"');
      expect(await t.payments()).toHaveLength(0);
      expect(t.budget.spentUsd).toBe(0);
    }
    expect(fetched).toEqual([]);
  });

  it("does not echo an arbitrarily long source id back to the model", async () => {
    const t = await dataTools(["x-search"]);
    const res = await t.query({ sourceId: "x".repeat(5000), params: {} });
    expect(res.ok).toBe(false);
    expect(String(res.reason).length).toBeLessThan(200);
  });
});

describe("search_data_sources", () => {
  it("answers from the registry alone, with no outside listings and no request", async () => {
    const t = await dataTools(["x-search"]);
    const res = await t.search({ query: "sentiment" });
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty("bazaar");
    const registry = res.registry as Array<{ id: string; configured: boolean; url: string }>;
    expect(registry.length).toBeGreaterThan(0);
    expect(registry.find((s) => s.id === "x-search")?.configured).toBe(true);
    expect(registry.every((s) => s.id !== "bazaar")).toBe(true);
    expect(registry.filter((s) => s.id !== "x-search").every((s) => s.configured === false)).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("honours the price ceiling it is given", async () => {
    const t = await dataTools(["x-search"]);
    const cheap = (await t.search({ query: "base", maxUsdPrice: 0.01 })).registry as Array<{ priceUsd: number | null }>;
    expect(cheap.every((s) => s.priceUsd === null || s.priceUsd <= 0.01)).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("matches on the words of a query, not on the whole phrase", async () => {
    const t = await dataTools(["x-search"]);
    const ids = async (query: string) => ((await t.search({ query })).registry as Array<{ id: string }>).map((s) => s.id);
    expect(await ids("twitter sentiment")).toContain("x-search");
    expect(await ids("token safety solana")).toContain("deepnets-token-safety");
    expect(await ids("zzzz qqqq")).toEqual([]);
    expect(fetched).toEqual([]);
  });
});

describe("score_token", () => {
  it("buys no paid signal on explicit flags when no source is enabled", async () => {
    // [] is also what a saved list that only named a retired id reads as.
    const t = await dataTools([]);
    const res = await t.score({
      chain: "solana",
      address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      deep: true,
      smartMoney: true,
    });
    expect(res.ok).toBe(true);
    expect(await t.payments()).toHaveLength(0);
    expect(t.budget.spentUsd).toBe(0);
  });

  it("still buys the signal an enabled source provides", async () => {
    const t = await dataTools(["x-search"]);
    const res = await t.score({ chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", deep: true });
    expect(res.ok).toBe(true);
    expect((await t.payments()).map((row) => row.sourceId)).toEqual(["x-search"]);
  });
});
