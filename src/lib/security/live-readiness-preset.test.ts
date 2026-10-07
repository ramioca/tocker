/**
 * The chain the go-live screen says the first-trade preset will keep, against the chain
 * the preset keeps.
 *
 * The screen reads "Base and Solana → Base only" off the FIRST chain the checklist
 * reports (`caps.chains[0]`); it has no other way to know. For an agent that pays for its
 * own thinking the preset keeps Solana wherever it sits in the list, so the checklist has
 * to report Solana first for such an agent, or the screen promises one chain and the
 * server keeps another.
 *
 * The checklist is evaluated whole against in-memory PGlite, with no auth app and no
 * network: every other row answers from the database or from nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { AgentConfig } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { evaluateLiveReadiness, withFirstTradePreset } from "./live-readiness";

let db: Db;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
  vi.stubEnv("PRIVY_APP_SECRET", "");
  vi.stubEnv("X402_MOCK", "1");
  vi.stubEnv("SOLANA_RPC_URL", "");
  // Nothing here needs a network, and nothing may reach one if a row tries.
  globalThis.fetch = (async () => {
    throw new Error("no network in this test");
  }) as typeof fetch;
  db = await setupTestDb();
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const PAYS_PER_USE: AgentConfig["llm"] = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc",
  usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

/** The checklist for an agent with these chains, and the config it was evaluated on. */
async function checklist(chains: AgentConfig["chains"], llm?: AgentConfig["llm"]) {
  const agent = await seedAgent(db, { config: { chains, dataSources: [], ...(llm ? { llm } : {}) } });
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
  if (!row) throw new Error("agent row missing");
  const readiness = await evaluateLiveReadiness({
    agentId: agent.agentId,
    slug: agent.slug,
    ownerId: agent.userId,
    config: row.config,
    walletBudget: row.walletBudget,
  });
  return { readiness, config: row.config };
}

describe("the chains the live checklist reports", () => {
  it("put Solana first for an agent that pays per use: the chain the preset keeps is the one the screen names", async () => {
    for (const chains of [["base", "solana"], ["solana", "base"]] as Array<AgentConfig["chains"]>) {
      const { readiness, config } = await checklist(chains, PAYS_PER_USE);
      expect(readiness.caps.chains).toEqual(["solana", "base"]);
      // What the screen says will be kept, and what the server keeps.
      expect(withFirstTradePreset(config).chains).toEqual([readiness.caps.chains[0]]);
    }
  }, 60_000);

  it("are a key agent's chains exactly as stored, and the preset keeps the first of them as it always has", async () => {
    for (const chains of [["base", "solana"], ["solana", "base"], ["base"]] as Array<AgentConfig["chains"]>) {
      const { readiness, config } = await checklist(chains);
      expect(readiness.caps.chains).toEqual(chains);
      expect(withFirstTradePreset(config).chains).toEqual([chains[0]]);
    }
    // Old pay-per-use limits left in a key agent's config change nothing.
    const { readiness } = await checklist(["base", "solana"], { ...PAYS_PER_USE, source: "key" });
    expect(readiness.caps.chains).toEqual(["base", "solana"]);
  }, 60_000);
});
