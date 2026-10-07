/**
 * The first-trade preset, as the action writes it.
 *
 * The preset keeps one chain. For an agent that pays for its own thinking that chain has
 * to be Solana, the one its wallet pays from: keeping "the first" took Solana off a Base
 * agent whose owner had added it for pay-per-use, and left a config that every other save
 * refuses. Here the real preset runs through the real action against in-memory PGlite;
 * only what would leave the process is stubbed (the session, the cache, the wallet
 * policy write and the checklist's reads).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { AgentConfig } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { usdcChoiceProblem } from "@/lib/agent/inference";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { FIRST_TRADE_PRESET } from "@/lib/security/live-readiness";
import type { Session } from "@/server/types";

let session: Session | null = null;
const checkedWith = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/security/live-readiness", async (importOriginal) => ({
  // The preset is the real one. The checklist reads wallets and the chain, so it is not.
  ...(await importOriginal<typeof import("@/lib/security/live-readiness")>()),
  evaluateLiveReadiness: async (input: { config: AgentConfig }) => {
    checkedWith(input.config);
    return { ready: true, steps: [] };
  },
}));
vi.mock("@/lib/security/mfa", () => ({
  secondFactorBlock: async () => null,
  getMfaStatus: async () => ({ available: false, appMethods: [], userMethods: [], enrolled: false }),
  rememberMfaStatus: async () => undefined,
  lastKnownMfaMethods: async () => [],
}));
vi.mock("@/lib/wallets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallets")>()),
  withdrawFromAgent: async () => ({ txHash: null, actionId: null, status: "failed" }),
  // The wallet policy comes down with the cap; Privy is not asked.
  applyAgentBudgetPolicy: async (input: { perTxUsd: number }) => ({ perTxUsd: input.perTxUsd, policyIds: { solana: "pol_test" } }),
}));
vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async () => ({}),
  snapshotEquity: async () => undefined,
}));

const { applyFirstTradePresetAction } = await import("./security");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  checkedWith.mockReset();
});

const PAYS_PER_USE: AgentConfig["llm"] = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc",
  usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

/** An agent with these chains, signed in as its owner. */
async function ownedAgent(chains: AgentConfig["chains"], llm?: AgentConfig["llm"]) {
  const seeded = await seedAgent(db, { config: { chains, ...(llm ? { llm } : {}), risk: { maxTradeUsd: 100, maxDailyTrades: 10 } } });
  session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return seeded;
}

async function configOf(agentId: string): Promise<AgentConfig> {
  const [row] = await db.select({ config: schema.agents.config }).from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!row) throw new Error("agent row missing");
  return row.config;
}

describe("applyFirstTradePresetAction", () => {
  it("leaves a pay-per-use agent on Solana, the chain it pays from, when Solana is not its first", async () => {
    const agent = await ownedAgent(["base", "solana"], PAYS_PER_USE);
    // The order a Base agent gets when its owner adds Solana, and a config the server accepts.
    expect(usdcChoiceProblem(await configOf(agent.agentId))).toBeNull();

    expect((await applyFirstTradePresetAction(agent.agentId)).ok).toBe(true);

    const saved = await configOf(agent.agentId);
    expect(saved.chains).toEqual(["solana"]);
    expect(saved.llm).toMatchObject({ source: "usdc", usdc: PAYS_PER_USE.usdc });
    // Still a config every other save accepts: the settings form is not blocked by it.
    expect(usdcChoiceProblem(saved)).toBeNull();
    // The rest of the preset is what it was.
    expect(saved.risk.maxTradeUsd).toBe(FIRST_TRADE_PRESET.maxTradeUsd);
    expect(saved.risk.maxDailyTrades).toBe(FIRST_TRADE_PRESET.maxDailyTrades);
    // The checklist that follows is run on that same config.
    expect(checkedWith).toHaveBeenCalledTimes(1);
    expect((checkedWith.mock.calls[0]?.[0] as AgentConfig).chains).toEqual(["solana"]);

    // And the log says which chain it was left on.
    const [audit] = await db
      .select({ summary: schema.auditEvents.summary, metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.agentId, agent.agentId), eq(schema.auditEvents.kind, "first_trade_preset")));
    expect(audit?.summary).toContain("solana only");
    expect(audit?.metadata).toMatchObject({ before: { chains: ["base", "solana"] }, after: { chains: ["solana"] } });
  });

  it("keeps a key agent's first chain, as it always has", async () => {
    const base = await ownedAgent(["base", "solana"]);
    expect((await applyFirstTradePresetAction(base.agentId)).ok).toBe(true);
    expect((await configOf(base.agentId)).chains).toEqual(["base"]);

    const solana = await ownedAgent(["solana", "base"]);
    expect((await applyFirstTradePresetAction(solana.agentId)).ok).toBe(true);
    expect((await configOf(solana.agentId)).chains).toEqual(["solana"]);
  });

  it("is the owner's alone", async () => {
    const agent = await ownedAgent(["base", "solana"], PAYS_PER_USE);
    const stranger = await seedAgent(db);
    session = { userId: stranger.userId, handle: "stranger", displayName: null, avatarUrl: null, email: null };
    expect(await applyFirstTradePresetAction(agent.agentId)).toEqual({ ok: false, error: "You do not own this agent" });
    expect((await configOf(agent.agentId)).chains).toEqual(["base", "solana"]);

    session = null;
    expect(await applyFirstTradePresetAction(agent.agentId)).toEqual({ ok: false, error: "Sign in first" });
  });
});
