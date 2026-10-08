/**
 * Creating, changing, running and deleting agents, as far as the platform's money and
 * the public record are concerned.
 *
 * `getSession` and `next/cache` are mocked because these are server actions, and the
 * wallet library because it would call Privy; its stand-in writes the same wallet rows
 * the real one does, since those rows are what the daily limit counts and what a chain
 * switched on later is checked against. The run loop is mocked so "Run now" starts
 * nothing. The limits, the kill switch, the audit row and the database are the real code
 * against in-memory PGlite.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { USDC_NOT_AVAILABLE } from "@/lib/agent/inference";
import { PROVIDER_UNSUPPORTED } from "@/lib/agent/providers";
import { RUN_REFUSED_WHILE_PAUSED, RUN_REFUSED_WITHOUT_KEY, RunRefusedError } from "@/lib/agent/run-gate";
import { attachLlmKey, seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { setTradingPaused } from "@/lib/security/kill-switch";
import { MAX_NEW_AGENTS_PER_DAY, RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { DATA_SPEND_CARRYOVER, realDataSpend24h } from "@/lib/x402/daily-budget";
import { DEFAULT_PAY_PER_USE_MODEL, describeInferenceStop } from "@/lib/x402/inference-types";
import { uniqueSlug } from "@/server/queries/_shared";
import type { Chain, Session } from "@/server/types";

let session: Session | null = null;
let db: Db;

/** What the wallet stand-in was asked for, and whether the next call should fail like an outage. */
const walletCalls: Array<{ agentId: string; chains: Chain[]; existingAgent: boolean }> = [];
const budgetCalls: Array<{ agentId: string; perTxUsd: number }> = [];
let walletOutage = false;
const startRun = vi.fn<(input: { agentId: string; trigger: string; invocationStartedAt?: number }) => Promise<{ runId: string }>>(
  async () => ({ runId: "run_test" }),
);

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/wallets", () => ({
  createAgentWallets: async (input: { agentId: string; userId: string; chains?: Chain[]; existingAgent?: boolean }) => {
    const chains = input.chains ?? [];
    walletCalls.push({ agentId: input.agentId, chains, existingAgent: input.existingAgent === true });
    if (walletOutage) throw new Error("503 from the wallet provider");
    const rows = chains.map((chain) => ({
      id: `paper_${input.agentId}_${chain}`,
      chain,
      address: `Paper${chain}${input.agentId}`,
    }));
    await db
      .insert(schema.wallets)
      .values(rows.map((w) => ({ ...w, kind: "agent_server" as const, userId: input.userId, agentId: input.agentId })))
      .onConflictDoNothing();
    return rows;
  },
  getAgentWallets: async (agentId: string) =>
    db
      .select({ id: schema.wallets.id, chain: schema.wallets.chain, address: schema.wallets.address })
      .from(schema.wallets)
      .where(and(eq(schema.wallets.agentId, agentId), eq(schema.wallets.kind, "agent_server"))),
  applyAgentBudgetPolicy: async (input: { agentId: string; perTxUsd: number }) => {
    budgetCalls.push({ agentId: input.agentId, perTxUsd: input.perTxUsd });
    return null;
  },
}));
vi.mock("@/lib/wallets/stranded", () => ({
  readStrandedHoldings: async () => ({ ok: true, holdings: [] }),
}));
vi.mock("@/lib/agent/run", () => ({
  reapStaleRuns: async () => 0,
  startRun: (input: { agentId: string; trigger: string; invocationStartedAt?: number }) => startRun(input),
  STALE_RUN_MS: 600_000,
}));

const { createAgent, deleteAgent, triggerRun, updateAgent } = await import("./agents");

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  walletOutage = false;
  walletCalls.length = 0;
  budgetCalls.length = 0;
  startRun.mockClear();
  // The buckets are process-wide; every case starts with a full allowance.
  limiter.reset();
});

/** Runs `fn` with the error log quiet: these cases fail on purpose, and say so in the log. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

/** A fresh account, signed in. */
async function newOwner(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `t${nanoid(6)}`, displayName: "Test" });
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return userId;
}

const create = (name = `Agent ${nanoid(4)}`) =>
  createAgent({ name, isPublic: true, llmKeyId: null, config: DEFAULT_AGENT_CONFIG });

/** Wallet rows as an agent created `hoursAgo` would have left them, whether or not it still exists. */
async function pastCreation(userId: string, hoursAgo: number): Promise<void> {
  const agentId = nanoid();
  await db.insert(schema.wallets).values({
    id: `paper_${agentId}_solana`,
    kind: "agent_server",
    chain: "solana",
    address: `PaperSol${agentId}`,
    userId,
    agentId,
    createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
  });
}

describe("createAgent: new agents in a day", () => {
  it("refuses once the account has set up the day's allowance, even if those agents are gone", async () => {
    const userId = await newOwner();
    // Created today and since deleted: the agents are gone, the wallet rows are not.
    for (let i = 0; i < MAX_NEW_AGENTS_PER_DAY; i += 1) await pastCreation(userId, 1);

    const result = await create();

    expect(result).toEqual({
      ok: false,
      error: `You've set up ${MAX_NEW_AGENTS_PER_DAY} agents in the last 24 hours, the most Tocker creates in a day. Try again tomorrow.`,
    });
    expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);
  });

  it("counts an agent once however many wallets it has, and forgets creations older than a day", async () => {
    const userId = await newOwner();
    for (let i = 0; i < MAX_NEW_AGENTS_PER_DAY; i += 1) await pastCreation(userId, 25);
    // One agent from today with two wallets is one creation, not two.
    const agentId = nanoid();
    await db.insert(schema.wallets).values(
      (["solana", "base"] as const).map((chain) => ({
        id: `paper_${agentId}_${chain}`,
        kind: "agent_server" as const,
        chain,
        address: `Paper${chain}${agentId}`,
        userId,
        agentId,
      })),
    );

    const result = await create();

    expect(result.ok).toBe(true);
  });

  it("does not count another account's creations", async () => {
    const other = await newOwner();
    for (let i = 0; i < MAX_NEW_AGENTS_PER_DAY; i += 1) await pastCreation(other, 1);
    await newOwner();

    expect((await create()).ok).toBe(true);
  });

  it("is not reset by deleting what was created", async () => {
    const userId = await newOwner();
    for (let i = 0; i < MAX_NEW_AGENTS_PER_DAY - 1; i += 1) await pastCreation(userId, 1);

    const made = await create();
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect((await deleteAgent(made.data.id)).ok).toBe(true);

    const again = await create();
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatch(/in the last 24 hours/);
  });
});

describe("deleteAgent: what it spent on data today", () => {
  it("carries the day's real data spend into the audit log, so the daily ceiling still counts it", async () => {
    const seeded = await seedAgent(db);
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    // A second agent the owner keeps, to ask the ceiling through afterwards.
    const kept = await seedAgent(db);
    await db.update(schema.agents).set({ ownerId: seeded.userId }).where(eq(schema.agents.id, kept.agentId));
    await db.insert(schema.x402Payments).values([
      { id: nanoid(), agentId: seeded.agentId, sourceId: "x-search", url: "https://twitter.use.x402atlas.com/search", network: "eip155:8453", amountUsd: "1.250000" },
      // A fixture is not money.
      { id: nanoid(), agentId: seeded.agentId, sourceId: "x-search", url: "https://twitter.use.x402atlas.com/search", network: "eip155:8453", amountUsd: "9.000000", simulated: true },
    ]);
    expect((await realDataSpend24h(kept.agentId)).ownerUsd).toBeCloseTo(1.25, 6);

    expect((await deleteAgent(seeded.agentId)).ok).toBe(true);

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.agentId, seeded.agentId), eq(schema.auditEvents.kind, "budget_change")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ reason: DATA_SPEND_CARRYOVER, dataSpendUsd: 1.25 });
    expect(rows[0]?.summary).toContain("$1.25 of data");
    expect((await realDataSpend24h(kept.agentId)).ownerUsd).toBeCloseTo(1.25, 6);
  });

  it("writes nothing for an agent that bought no real data", async () => {
    const seeded = await seedAgent(db);
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };

    expect((await deleteAgent(seeded.agentId)).ok).toBe(true);

    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agentId, seeded.agentId))).toHaveLength(0);
  });
});

describe("createAgent: the hourly allowance", () => {
  const perHour = RATE_LIMITS.agentCreate.limit;

  it("is not spent by a request the form was always going to refuse", async () => {
    await newOwner();
    for (let i = 0; i < perHour + 3; i += 1) {
      expect(await createAgent({ name: "x", isPublic: true, llmKeyId: null, config: DEFAULT_AGENT_CONFIG })).toEqual({
        ok: false,
        error: "Give your agent a name",
      });
    }
    expect(walletCalls).toHaveLength(0);

    expect((await create()).ok).toBe(true);
  });

  it("is handed back when the create failed before it made anything", async () => {
    const userId = await newOwner();
    walletOutage = true;
    // More retries than the hour allows, each one told to try again.
    for (let i = 0; i < perHour + 3; i += 1) {
      expect(await quietly(() => create())).toEqual({
        ok: false,
        error: "Could not create the agent — nothing was saved. Try again in a minute.",
      });
    }
    expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);

    // The outage ends, and the person who retried as told is not locked out for it.
    walletOutage = false;
    expect((await create()).ok).toBe(true);
  });

  it("still stops a burst, with a sentence that says when to come back and blames nobody", async () => {
    const userId = await newOwner();
    // The allowance is spent in this process: the wallet rows that the daily limit
    // counts are not there yet, as in a burst that arrives all at once.
    for (let i = 0; i < perHour; i += 1) limiter.consume(`agent:create:${userId}`, RATE_LIMITS.agentCreate);

    const refused = await create();

    expect(refused).toEqual({
      ok: false,
      error: `You've tried to create an agent ${perHour} times this hour. Try again in 60 minutes.`,
    });
    expect(walletCalls).toHaveLength(0);
    expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);
  });

  it("counts a create that succeeded", async () => {
    const userId = await newOwner();
    expect((await create()).ok).toBe(true);
    const next = limiter.consume(`agent:create:${userId}`, RATE_LIMITS.agentCreate);
    expect(next.remaining).toBe(perHour - 2);
  });
});

describe("createAgent: slugs that are routes", () => {
  it("never gives an agent the builder's own address", async () => {
    await newOwner();
    for (const name of ["New", "new", "NEW!"]) {
      const made = await create(name);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      expect(made.data.slug).not.toBe("new");
      expect(made.data.slug).toMatch(/^new-agent(-\d+)?$/);
    }
  });

  it("leaves every other name's slug as it was", async () => {
    const tag = nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x");
    expect(await uniqueSlug(`Newcomer ${tag}`, db)).toBe(`newcomer-${tag}`);
    expect(await uniqueSlug(`Brand New ${tag}`, db)).toBe(`brand-new-${tag}`);
  });
});

describe("updateAgent: the paper starting balance", () => {
  it("cannot be rewritten once the agent exists", async () => {
    const seeded = await seedAgent(db, { paperStartingUsd: "1000" });
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };

    // Raising it is +999,900% on the leaderboard; lowering it inflates all-time PnL.
    for (const paperStartingUsd of [10_000_000, 1]) {
      const result = await updateAgent(seeded.agentId, { paperStartingUsd, tagline: `tried ${paperStartingUsd}` });
      expect(result.ok).toBe(true);
      const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, seeded.agentId));
      expect(Number(row?.paperStartingUsd)).toBe(1000);
      // The rest of the save still lands.
      expect(row?.tagline).toBe(`tried ${paperStartingUsd}`);
    }
  });

  it("is still set, and bounded, when the agent is created", async () => {
    await newOwner();
    const made = await createAgent({ name: "Balanced", isPublic: true, llmKeyId: null, config: DEFAULT_AGENT_CONFIG, paperStartingUsd: 2500 });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, made.data.id));
    expect(Number(row?.paperStartingUsd)).toBe(2500);

    expect(
      await createAgent({ name: "Too rich", isPublic: true, llmKeyId: null, config: DEFAULT_AGENT_CONFIG, paperStartingUsd: 99_999_999_999 }),
    ).toEqual({ ok: false, error: "Paper starting balance must be $10,000,000 or less" });
  });
});

/**
 * Every save of an active agent's settings used to set its next run a whole interval
 * out, whether or not the schedule was touched: an owner tuning a prompt kept pushing the
 * run away. The next run now moves only when the schedule does.
 */
describe("updateAgent: the next run", () => {
  const MINUTE = 60_000;
  const withInterval = (intervalMinutes: number, strategyPrompt = DEFAULT_AGENT_CONFIG.strategyPrompt) => ({
    ...DEFAULT_AGENT_CONFIG,
    strategyPrompt,
    schedule: { intervalMinutes },
  });
  const nextRunOf = async (agentId: string) =>
    (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]?.nextRunAt ?? null;

  /** A signed-in owner's active agent on every 15 minutes, with `patch` on its row. */
  async function agentWith(patch: Partial<typeof schema.agents.$inferInsert> = {}): Promise<string> {
    const seeded = await seedAgent(db);
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    await db.update(schema.agents).set(patch).where(eq(schema.agents.id, seeded.agentId));
    return seeded.agentId;
  }

  it("is left where it was by a save that does not change the interval", async () => {
    const due = new Date(Date.now() + 3 * MINUTE);
    const agentId = await agentWith({ nextRunAt: due });

    expect((await updateAgent(agentId, { config: withInterval(15, `${DEFAULT_AGENT_CONFIG.strategyPrompt} Hold winners longer.`) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toEqual(due);
    // Nor by one that does not carry the config at all.
    expect((await updateAgent(agentId, { tagline: "tuned" })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toEqual(due);

    // An agent already overdue stays overdue: the save does not take its turn away.
    const overdue = new Date(Date.now() - 2 * MINUTE);
    await db.update(schema.agents).set({ nextRunAt: overdue }).where(eq(schema.agents.id, agentId));
    expect((await updateAgent(agentId, { config: withInterval(15, `${DEFAULT_AGENT_CONFIG.strategyPrompt} Cut losers sooner.`) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toEqual(overdue);
  });

  it("is counted from the save when the interval changed: one interval on, less the grace", async () => {
    const agentId = await agentWith({ nextRunAt: new Date(Date.now() + 3 * MINUTE) });

    const before = Date.now();
    expect((await updateAgent(agentId, { config: withInterval(60) })).ok).toBe(true);
    const next = (await nextRunOf(agentId))?.getTime() ?? 0;
    expect(next).toBeGreaterThanOrEqual(before + 59 * MINUTE);
    expect(next).toBeLessThanOrEqual(Date.now() + 59 * MINUTE);
  });

  it("is cleared when the agent is set to run by hand only, and set again when it is given a schedule", async () => {
    const agentId = await agentWith({ nextRunAt: new Date(Date.now() + 3 * MINUTE) });

    expect((await updateAgent(agentId, { config: withInterval(0) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toBeNull();

    const before = Date.now();
    expect((await updateAgent(agentId, { config: withInterval(15) })).ok).toBe(true);
    expect((await nextRunOf(agentId))?.getTime()).toBeGreaterThanOrEqual(before + 14 * MINUTE);
  });

  it("is given to a live agent that has an interval and no next run at all", async () => {
    const agentId = await agentWith({ mode: "live", nextRunAt: null });

    const before = Date.now();
    expect((await updateAgent(agentId, { config: withInterval(15) })).ok).toBe(true);
    const next = (await nextRunOf(agentId))?.getTime() ?? 0;
    expect(next).toBeGreaterThanOrEqual(before + 14 * MINUTE);
    expect(next).toBeLessThanOrEqual(Date.now() + 14 * MINUTE);
  });

  /**
   * "Real money only": created active with its schedule held, so it takes no paper tick
   * before it goes live (`holdSchedule`). Going live is what starts it, not a save.
   */
  it("is not started by a save while the agent's schedule is held for going live", async () => {
    const agentId = await agentWith({ mode: "paper", nextRunAt: null });

    expect((await updateAgent(agentId, { config: withInterval(15, `${DEFAULT_AGENT_CONFIG.strategyPrompt} Size down in chop.`) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toBeNull();
    expect((await updateAgent(agentId, { config: withInterval(30) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toBeNull();
  });

  it("is not written for an agent that is not active", async () => {
    const agentId = await agentWith({ status: "paused", nextRunAt: null });
    expect((await updateAgent(agentId, { config: withInterval(60) })).ok).toBe(true);
    expect(await nextRunOf(agentId)).toBeNull();
  });
});

describe("updateAgent: a chain switched on after creation", () => {
  /** A Solana-only agent, as the default builder makes it, owned by the signed-in user. */
  async function solanaOnly(): Promise<{ id: string; userId: string }> {
    const userId = await newOwner();
    const made = await create();
    if (!made.ok) throw new Error(made.error);
    walletCalls.length = 0;
    budgetCalls.length = 0;
    return { id: made.data.id, userId };
  }

  const chainsOf = async (agentId: string) =>
    (await db.select().from(schema.wallets).where(eq(schema.wallets.agentId, agentId))).map((w) => w.chain).sort();
  const savedChains = async (agentId: string) =>
    (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]?.config.chains;
  const withChains = (chains: Chain[]) => ({ ...DEFAULT_AGENT_CONFIG, chains });

  it("makes that chain's wallet, and only that one, before the config is saved", async () => {
    const agent = await solanaOnly();
    expect(await chainsOf(agent.id)).toEqual(["solana"]);

    const result = await updateAgent(agent.id, { config: withChains(["solana", "base"]) });

    expect(result.ok).toBe(true);
    expect(walletCalls).toEqual([{ agentId: agent.id, chains: ["base"], existingAgent: true }]);
    expect(await chainsOf(agent.id)).toEqual(["base", "solana"]);
    expect(await savedChains(agent.id)).toEqual(["solana", "base"]);
    // The wallet rows belong to the owner, like the ones made at creation.
    const rows = await db.select().from(schema.wallets).where(eq(schema.wallets.agentId, agent.id));
    expect(rows.every((w) => w.userId === agent.userId && w.kind === "agent_server")).toBe(true);
  });

  it("puts the wallet budget on the new wallet too", async () => {
    const agent = await solanaOnly();
    await updateAgent(agent.id, { config: withChains(["solana", "base"]) });
    expect(budgetCalls).toEqual([{ agentId: agent.id, perTxUsd: DEFAULT_AGENT_CONFIG.risk.maxTradeUsd }]);
  });

  it("does not save the chain when its wallet could not be made, and says what to do", async () => {
    const agent = await solanaOnly();
    walletOutage = true;

    const result = await quietly(() => updateAgent(agent.id, { name: "Renamed", config: withChains(["solana", "base"]) }));

    expect(result).toEqual({
      ok: false,
      error: "Could not create the Base wallet, so the change was not saved. Try again in a minute.",
    });
    expect(await savedChains(agent.id)).toEqual(["solana"]);
    expect(await chainsOf(agent.id)).toEqual(["solana"]);
    // Nothing else in the same save landed either: it is one change or none.
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(row?.name).not.toBe("Renamed");
  });

  it("makes one wallet per chain however the save is repeated or the chain toggled", async () => {
    const agent = await solanaOnly();
    // A list that names the chain twice is still one wallet.
    expect((await updateAgent(agent.id, { config: withChains(["solana", "base", "base"]) })).ok).toBe(true);
    expect(walletCalls).toEqual([{ agentId: agent.id, chains: ["base"], existingAgent: true }]);

    // Off, on again, and saved again: the wallet is there, so nothing is made.
    expect((await updateAgent(agent.id, { config: withChains(["solana"]) })).ok).toBe(true);
    expect((await updateAgent(agent.id, { config: withChains(["solana", "base"]) })).ok).toBe(true);
    expect((await updateAgent(agent.id, { config: withChains(["solana", "base"]) })).ok).toBe(true);
    expect(walletCalls).toHaveLength(1);
    expect(await chainsOf(agent.id)).toEqual(["base", "solana"]);
  });

  it("allows one attempt a minute per agent, so a burst of saves is not a burst of wallets", async () => {
    const agent = await solanaOnly();
    walletOutage = true;
    await quietly(() => updateAgent(agent.id, { config: withChains(["solana", "base"]) }));
    walletOutage = false;

    // Inside the same minute the provider is not asked again.
    const again = await updateAgent(agent.id, { config: withChains(["solana", "base"]) });
    expect(again).toEqual({
      ok: false,
      error: "Could not create the Base wallet, so the change was not saved. Try again in a minute.",
    });
    expect(walletCalls).toHaveLength(1);

    // A minute later it goes through.
    limiter.reset(`agent:wallet-add:${agent.id}`);
    expect((await updateAgent(agent.id, { config: withChains(["solana", "base"]) })).ok).toBe(true);
    expect(await chainsOf(agent.id)).toEqual(["base", "solana"]);
  });

  it("mends an agent that already has the chain on and no wallet for it", async () => {
    const agent = await solanaOnly();
    // The state the old code left behind: Base saved in the config, no Base wallet.
    await db.update(schema.agents).set({ config: withChains(["solana", "base"]) }).where(eq(schema.agents.id, agent.id));

    // Any save of its settings, the chains untouched.
    expect((await updateAgent(agent.id, { config: withChains(["solana", "base"]) })).ok).toBe(true);
    expect(await chainsOf(agent.id)).toEqual(["base", "solana"]);
  });

  it("makes nothing for someone else's agent, or for a save that does not touch the config", async () => {
    const agent = await solanaOnly();
    expect((await updateAgent(agent.id, { tagline: "No config in this one" })).ok).toBe(true);
    expect(walletCalls).toHaveLength(0);

    await newOwner();
    expect(await updateAgent(agent.id, { config: withChains(["solana", "base"]) })).toEqual({
      ok: false,
      error: "You do not own this agent",
    });
    expect(walletCalls).toHaveLength(0);
    expect(await chainsOf(agent.id)).toEqual(["solana"]);
  });
});

describe("triggerRun: while the owner has paused all trading", () => {
  it("starts nothing and says how to resume", async () => {
    const seeded = await seedAgent(db);
    await attachLlmKey(db, seeded);
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    await setTradingPaused(seeded.userId, true);

    const refused = await triggerRun(seeded.agentId);

    expect(refused).toEqual({ ok: false, error: RUN_REFUSED_WHILE_PAUSED });
    expect(RUN_REFUSED_WHILE_PAUSED).toBe("All trading is paused. Resume it in Settings → Security to run this agent.");
    expect(startRun).not.toHaveBeenCalled();
    expect(await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, seeded.agentId))).toHaveLength(0);
  });

  it("starts the run again as soon as trading is resumed", async () => {
    const seeded = await seedAgent(db);
    await attachLlmKey(db, seeded);
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    await setTradingPaused(seeded.userId, true);
    await setTradingPaused(seeded.userId, false);

    const before = Date.now();
    expect(await triggerRun(seeded.agentId)).toEqual({ ok: true, data: { runId: "run_test" } });
    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] ?? [];
    expect(input).toMatchObject({ agentId: seeded.agentId, trigger: "manual" });
    // The run is told when this invocation began, taken before anything else was done.
    expect(input?.invocationStartedAt).toBeGreaterThanOrEqual(before);
    expect(input?.invocationStartedAt).toBeLessThanOrEqual(Date.now());
  });

  it("is one owner's switch: another account's agents still run", async () => {
    const paused = await seedAgent(db);
    await setTradingPaused(paused.userId, true);
    const other = await seedAgent(db);
    await attachLlmKey(db, other);
    session = { userId: other.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };

    expect((await triggerRun(other.agentId)).ok).toBe(true);
  });
});

/**
 * Where an agent's thinking comes from. The mode is the config's own word
 * (`llm.source`); the server never reads it off a missing key, and an account that may
 * not use pay-per-use cannot save an agent into it.
 */
describe("how an agent thinks: its own key, or pay per use", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type Usdc = NonNullable<schema.AgentConfig["llm"]["usdc"]>;
  const payPerUse = (usdc: Partial<Usdc> = {}, config: Partial<schema.AgentConfig> = {}): schema.AgentConfig => ({
    ...DEFAULT_AGENT_CONFIG,
    ...config,
    llm: {
      ...DEFAULT_AGENT_CONFIG.llm,
      source: "usdc",
      usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3, ...usdc },
    },
  });
  const createWith = (config: schema.AgentConfig, llmKeyId: string | null = null) =>
    createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId, config: config as never });
  async function rowOf(agentId: string) {
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    if (!row) throw new Error("agent row missing");
    return row;
  }
  async function keyOf(userId: string): Promise<string> {
    const id = `key_${nanoid(10)}`;
    await db.insert(schema.llmKeys).values({ id, userId, provider: "anthropic", encryptedKey: "not-a-real-ciphertext", last4: "0000" });
    return id;
  }
  /** A pay-per-use agent that already exists, whatever the switch says now. */
  async function payingAgent() {
    const seeded = await seedAgent(db, { config: { chains: ["solana"], llm: payPerUse().llm } });
    session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    return seeded;
  }

  describe("createAgent", () => {
    it("refuses pay-per-use while the switch is off, which is the default, and makes nothing", async () => {
      const userId = await newOwner();
      for (const value of [undefined, "", "off", "true"]) {
        if (value === undefined) vi.stubEnv("INFERENCE_USDC", "");
        else vi.stubEnv("INFERENCE_USDC", value);
        expect(await createWith(payPerUse())).toEqual({ ok: false, error: USDC_NOT_AVAILABLE });
      }
      expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);
      expect(walletCalls).toHaveLength(0);
    });

    it("creates a key agent exactly as before, whatever the switch says", async () => {
      const userId = await newOwner();
      const key = await keyOf(userId);
      for (const value of ["", "on"]) {
        vi.stubEnv("INFERENCE_USDC", value);
        const made = await createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId: key, config: DEFAULT_AGENT_CONFIG });
        expect(made.ok).toBe(true);
        if (!made.ok) return;
        const row = await rowOf(made.data.id);
        expect(row.llmKeyId).toBe(key);
        // Nothing about the mode is written into a key agent's config.
        expect(row.config.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
        expect("source" in row.config.llm).toBe(false);
        expect(row).toMatchObject({ inferenceHold: null, inferenceStrikes: 0 });
      }
    });

    it("creates a pay-per-use agent with no key once the switch is on, even when a key is sent along", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const userId = await newOwner();
      const key = await keyOf(userId);

      const made = await createWith(payPerUse({ model: "openai/gpt-4o-mini", maxUsdPerRun: 0.5, maxUsdPerDay: 4 }), key);
      expect(made.ok).toBe(true);
      if (!made.ok) return;
      const row = await rowOf(made.data.id);
      expect(row.llmKeyId).toBeNull();
      expect(row.config.llm.source).toBe("usdc");
      expect(row.config.llm.usdc).toEqual({ model: "openai/gpt-4o-mini", maxUsdPerRun: 0.5, maxUsdPerDay: 4 });
    });

    it("at the owner stage, admits an admin and a listed account and nobody else", async () => {
      vi.stubEnv("INFERENCE_USDC", "owner");
      const outsider = await newOwner();
      expect(await createWith(payPerUse())).toEqual({ ok: false, error: USDC_NOT_AVAILABLE });

      vi.stubEnv("INFERENCE_USDC_USER_IDS", `someone, ${outsider}`);
      expect((await createWith(payPerUse())).ok).toBe(true);
      vi.stubEnv("INFERENCE_USDC_USER_IDS", "");

      const admin = await newOwner();
      session = { userId: admin, handle: "owner", displayName: null, avatarUrl: null, email: "Admin@Example.test" };
      expect(await createWith(payPerUse())).toEqual({ ok: false, error: USDC_NOT_AVAILABLE });
      vi.stubEnv("ADMIN_EMAILS", "ops@example.test, admin@example.test");
      expect((await createWith(payPerUse())).ok).toBe(true);
    });

    it("refuses a choice that is incomplete or could never run, with a sentence", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const userId = await newOwner();

      const noBlock = { ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" as const } };
      expect(await createWith(noBlock)).toMatchObject({ ok: false, error: expect.stringMatching(/needs a model/) });
      expect(await createWith(payPerUse({ model: "openai/gpt-5.5" }))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer offered/) });
      expect(await createWith(payPerUse({ maxUsdPerRun: 2, maxUsdPerDay: 1 }))).toMatchObject({ ok: false, error: expect.stringMatching(/daily thinking limit/) });
      // The payment leaves the agent's Solana wallet, and a Base-only agent has none.
      expect(await createWith(payPerUse({}, { chains: ["base"] }))).toEqual({ ok: false, error: describeInferenceStop("no_wallet").detail });
      // Limits outside what the product offers are the schema's to refuse.
      expect((await createWith(payPerUse({ maxUsdPerRun: 50 }))).ok).toBe(false);
      expect((await createWith(payPerUse({ maxUsdPerDay: 0.01 }))).ok).toBe(false);

      expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);
    });
  });

  describe("updateAgent", () => {
    it("refuses to turn pay-per-use on for an account that may not use it, and saves nothing", async () => {
      const userId = await newOwner();
      const key = await keyOf(userId);
      const made = await createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId: key, config: DEFAULT_AGENT_CONFIG });
      if (!made.ok) throw new Error(made.error);

      expect(await updateAgent(made.data.id, { config: payPerUse() })).toEqual({ ok: false, error: USDC_NOT_AVAILABLE });
      const row = await rowOf(made.data.id);
      expect(row.config.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
      expect(row.llmKeyId).toBe(key);
    });

    it("turns it on when the account may, by the config's word alone, and keeps the key for the way back", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const userId = await newOwner();
      const key = await keyOf(userId);
      const made = await createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId: key, config: DEFAULT_AGENT_CONFIG });
      if (!made.ok) throw new Error(made.error);

      // The settings form sends the key it has along with the config: the config decides.
      expect((await updateAgent(made.data.id, { llmKeyId: key, config: payPerUse() })).ok).toBe(true);
      const row = await rowOf(made.data.id);
      expect(row.config.llm.source).toBe("usdc");
      expect(row.llmKeyId).toBe(key);
    });

    it("refuses an incomplete choice on a save too", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const agent = await payingAgent();
      expect(await updateAgent(agent.agentId, { config: payPerUse({ model: "not/offered" }) })).toMatchObject({ ok: false });
      expect(await updateAgent(agent.agentId, { config: payPerUse({}, { chains: ["base"] }) })).toEqual({
        ok: false,
        error: describeInferenceStop("no_wallet").detail,
      });
      expect((await rowOf(agent.agentId)).config.llm.usdc?.model).toBe(DEFAULT_PAY_PER_USE_MODEL);
    });

    it("puts a pay-per-use agent back on a key, in as many words, when a key is set on it", async () => {
      const agent = await payingAgent();
      const key = await keyOf(agent.userId);
      // Held and struck, as an agent whose wallet ran dry would be.
      await db
        .update(schema.agents)
        .set({ inferenceHold: "needs_funds", inferenceHoldSince: new Date(), inferenceHoldUntil: new Date(Date.now() + 3_600_000), inferenceStrikes: 3, inferenceNotifiedAt: new Date() })
        .where(eq(schema.agents.id, agent.agentId));

      // "Use my own key": the key and nothing else. No switch is needed to leave pay-per-use.
      expect((await updateAgent(agent.agentId, { llmKeyId: key })).ok).toBe(true);

      const row = await rowOf(agent.agentId);
      expect(row.llmKeyId).toBe(key);
      expect(row.config.llm.source).toBe("key");
      // Everything else about its config is as it was.
      expect(row.config.strategyPrompt).toBe(DEFAULT_AGENT_CONFIG.strategyPrompt);
      expect(row.config.llm.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
      // And what was holding its paid thinking no longer applies.
      expect(row).toMatchObject({ inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
      // Setting a key is not saving the agent's settings: no wallet was made, no policy applied.
      expect(walletCalls).toHaveLength(0);
      expect(budgetCalls).toHaveLength(0);
    });

    it("goes back to a key even while wallets cannot be made", async () => {
      const agent = await payingAgent();
      const key = await keyOf(agent.userId);
      // A chain with no wallet behind it, and the wallet provider down: a settings save
      // would be refused here. Leaving pay-per-use must not be.
      await db.delete(schema.wallets).where(eq(schema.wallets.agentId, agent.agentId));
      walletOutage = true;

      expect((await updateAgent(agent.agentId, { llmKeyId: key })).ok).toBe(true);
      expect((await rowOf(agent.agentId)).config.llm.source).toBe("key");
    });

    it("does not let a key that is someone else's move it", async () => {
      const agent = await payingAgent();
      const stranger = await newOwner();
      const theirs = await keyOf(stranger);
      session = { userId: agent.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };

      expect(await updateAgent(agent.agentId, { llmKeyId: theirs })).toEqual({ ok: false, error: "That LLM key does not belong to you" });
      const row = await rowOf(agent.agentId);
      expect(row.config.llm.source).toBe("usdc");
      expect(row.llmKeyId).toBeNull();
    });

    it("leaves the mode alone on a save that says nothing about it", async () => {
      const agent = await payingAgent();
      expect((await updateAgent(agent.agentId, { tagline: "Pays its own way" })).ok).toBe(true);
      // Taking a key off changes nothing either: it had none to use.
      expect((await updateAgent(agent.agentId, { llmKeyId: null })).ok).toBe(true);
      expect((await rowOf(agent.agentId)).config.llm.source).toBe("usdc");
    });

    it("lets an agent already on pay-per-use be edited while the switch is off", async () => {
      const agent = await payingAgent();
      const result = await updateAgent(agent.agentId, { config: payPerUse({ maxUsdPerRun: 0.5 }, { chains: ["solana"] }) });
      expect(result.ok).toBe(true);
      expect((await rowOf(agent.agentId)).config.llm.usdc?.maxUsdPerRun).toBe(0.5);
    });

    it("has a held agent looked at again at once when its settings are saved", async () => {
      const agent = await payingAgent();
      const until = new Date(Date.now() + 6 * 3_600_000);
      await db
        .update(schema.agents)
        .set({ inferenceHold: "model_unavailable", inferenceHoldSince: new Date(), inferenceHoldUntil: until, inferenceStrikes: 5, inferenceNotifiedAt: new Date() })
        .where(eq(schema.agents.id, agent.agentId));

      expect((await updateAgent(agent.agentId, { config: payPerUse({ model: "openai/gpt-4.1-mini" }, { chains: ["solana"] }) })).ok).toBe(true);
      const row = await rowOf(agent.agentId);
      // Still held, with its strikes: only a check that passes lifts a hold. But due a look now.
      expect(row.inferenceHold).toBe("model_unavailable");
      expect(row.inferenceStrikes).toBe(5);
      expect((row.inferenceHoldUntil as Date).getTime()).toBeLessThanOrEqual(Date.now());

      // A save that does not touch the config leaves the hold's time alone.
      await db.update(schema.agents).set({ inferenceHoldUntil: until }).where(eq(schema.agents.id, agent.agentId));
      expect((await updateAgent(agent.agentId, { tagline: "Nothing to see" })).ok).toBe(true);
      expect((await rowOf(agent.agentId)).inferenceHoldUntil).toEqual(until);
    });

    it("writes nothing about the mode onto a key agent", async () => {
      const userId = await newOwner();
      const key = await keyOf(userId);
      const other = await keyOf(userId);
      const made = await createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId: key, config: DEFAULT_AGENT_CONFIG });
      if (!made.ok) throw new Error(made.error);

      expect((await updateAgent(made.data.id, { llmKeyId: other })).ok).toBe(true);
      expect((await updateAgent(made.data.id, { tagline: "Still on a key" })).ok).toBe(true);
      const row = await rowOf(made.data.id);
      expect(row.llmKeyId).toBe(other);
      expect(row.config.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
      expect("source" in row.config.llm).toBe(false);
    });
  });

  describe("triggerRun", () => {
    it("still refuses a key agent that has no key, with the sentence it always had", async () => {
      const seeded = await seedAgent(db);
      session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
      expect(await triggerRun(seeded.agentId)).toEqual({ ok: false, error: RUN_REFUSED_WITHOUT_KEY });
      expect(RUN_REFUSED_WITHOUT_KEY).toBe("Attach an LLM key before running this agent");
      expect(startRun).not.toHaveBeenCalled();
    });

    it("starts an agent that pays per use without a key", async () => {
      const agent = await payingAgent();
      expect(await triggerRun(agent.agentId)).toEqual({ ok: true, data: { runId: "run_test" } });
      expect(startRun).toHaveBeenCalledTimes(1);
    });

    it("says the sentence when the run loop will not start it, and writes no run", async () => {
      const agent = await payingAgent();
      const said = describeInferenceStop("needs_funds").detail;
      startRun.mockRejectedValueOnce(new RunRefusedError(said, "needs_funds"));

      expect(await triggerRun(agent.agentId)).toEqual({ ok: false, error: said });
      expect(await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agent.agentId))).toHaveLength(0);
    });

    it("keeps anything else that goes wrong out of the answer", async () => {
      const agent = await payingAgent();
      startRun.mockRejectedValueOnce(new Error(`connect ECONNREFUSED postgres://tocker:${nanoid(24)}@db.internal/tocker`));
      expect(await quietly(() => triggerRun(agent.agentId))).toEqual({ ok: false, error: "The agent runtime is unavailable" });
    });
  });
});

/**
 * An agent's key and the provider its config names.
 *
 * A run is sent to the provider of the key, with the model the config names: the config
 * never chooses the host. Where the two disagree every run fails (OpenAI is asked for a
 * Claude model) and the cost estimate is read off the wrong provider's prices. The forms
 * only offer keys of the chosen provider; these are the same rule on the server, for a
 * stale page or a direct call.
 */
describe("an agent's key and its provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  type Provider = schema.AgentConfig["llm"]["provider"];
  const MODEL: Record<"anthropic" | "openai" | "openrouter", string> = {
    anthropic: DEFAULT_AGENT_CONFIG.llm.model,
    openai: "gpt-5",
    openrouter: "anthropic/claude-sonnet-5.5",
  };
  const on = (provider: keyof typeof MODEL): schema.AgentConfig => ({
    ...DEFAULT_AGENT_CONFIG,
    llm: { ...DEFAULT_AGENT_CONFIG.llm, provider, model: MODEL[provider] },
  });
  async function keyFor(userId: string, provider: Provider): Promise<string> {
    const id = `key_${nanoid(10)}`;
    await db.insert(schema.llmKeys).values({ id, userId, provider, encryptedKey: "not-a-real-ciphertext", last4: "0000" });
    return id;
  }
  async function rowOf(agentId: string) {
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
    if (!row) throw new Error("agent row missing");
    return row;
  }
  const make = (config: schema.AgentConfig, llmKeyId: string | null) =>
    createAgent({ name: `Agent ${nanoid(4)}`, isPublic: true, llmKeyId, config });
  const MISMATCH = {
    openaiKeyOnAnthropic:
      "That is an OpenAI key, and this agent is set to think on Anthropic. Pick an Anthropic key, or change the agent's provider to OpenAI.",
    anthropicKeyOnOpenAi:
      "That is an Anthropic key, and this agent is set to think on OpenAI. Pick an OpenAI key, or change the agent's provider to Anthropic.",
  };

  describe("createAgent", () => {
    it("creates an agent whose key is its provider's, for each provider", async () => {
      const userId = await newOwner();
      for (const provider of ["anthropic", "openai", "openrouter"] as const) {
        const key = await keyFor(userId, provider);
        const made = await make(on(provider), key);
        expect(made.ok, provider).toBe(true);
        if (made.ok) expect((await rowOf(made.data.id)).llmKeyId).toBe(key);
      }
    });

    it("refuses a key that belongs to another provider than the config names, with a sentence, and makes nothing", async () => {
      const userId = await newOwner();
      const openai = await keyFor(userId, "openai");
      const anthropic = await keyFor(userId, "anthropic");

      expect(await make(on("anthropic"), openai)).toEqual({ ok: false, error: MISMATCH.openaiKeyOnAnthropic });
      expect(await make(on("openai"), anthropic)).toEqual({ ok: false, error: MISMATCH.anthropicKeyOnOpenAi });
      const openrouter = await make(on("openrouter"), anthropic);
      expect(openrouter.ok ? "" : openrouter.error).toBe(
        "That is an Anthropic key, and this agent is set to think on OpenRouter. Pick an OpenRouter key, or change the agent's provider to Anthropic.",
      );

      // More refusals than the hour allows: the hourly allowance is for requests that
      // are about to make wallets, and this one is refused before it.
      for (let i = 0; i < RATE_LIMITS.agentCreate.limit + 3; i += 1) {
        expect(await make(on("anthropic"), openai)).toEqual({ ok: false, error: MISMATCH.openaiKeyOnAnthropic });
      }
      expect(await db.select().from(schema.agents).where(eq(schema.agents.ownerId, userId))).toHaveLength(0);
      expect(walletCalls).toHaveLength(0);
      expect((await make(on("anthropic"), anthropic)).ok).toBe(true);
    });

    /** The column is plain text now: a key saved for a provider that has since been dropped. */
    it("refuses a key whose provider is no longer one, in words", async () => {
      const userId = await newOwner();
      const stale = await keyFor(userId, "cohere" as never);
      expect(await make(on("anthropic"), stale)).toEqual({ ok: false, error: PROVIDER_UNSUPPORTED });
    });

    it("does not look at a key's provider for an agent that pays per use, which gets no key at all", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const userId = await newOwner();
      const openai = await keyFor(userId, "openai");
      const made = await make(
        { ...on("anthropic"), llm: { ...on("anthropic").llm, source: "usdc", usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } },
        openai,
      );
      expect(made.ok).toBe(true);
      if (made.ok) expect((await rowOf(made.data.id)).llmKeyId).toBeNull();
    });
  });

  describe("updateAgent", () => {
    /** An Anthropic agent on an Anthropic key, and the keys its owner also holds. */
    async function anthropicAgent() {
      const userId = await newOwner();
      const anthropic = await keyFor(userId, "anthropic");
      const made = await make(on("anthropic"), anthropic);
      if (!made.ok) throw new Error(made.error);
      return { userId, agentId: made.data.id, anthropic, openai: await keyFor(userId, "openai") };
    }

    it("refuses to put another provider's key on the agent, and saves nothing", async () => {
      const mine = await anthropicAgent();

      expect(await updateAgent(mine.agentId, { llmKeyId: mine.openai })).toEqual({ ok: false, error: MISMATCH.openaiKeyOnAnthropic });
      // The settings form sends the config with the key.
      expect(await updateAgent(mine.agentId, { llmKeyId: mine.openai, config: on("anthropic"), name: "Renamed" })).toEqual({
        ok: false,
        error: MISMATCH.openaiKeyOnAnthropic,
      });

      const row = await rowOf(mine.agentId);
      expect(row.llmKeyId).toBe(mine.anthropic);
      expect(row.name).not.toBe("Renamed");
    });

    it("refuses to move the agent to another provider while it keeps the old provider's key", async () => {
      const mine = await anthropicAgent();

      expect(await updateAgent(mine.agentId, { config: on("openai") })).toEqual({ ok: false, error: MISMATCH.anthropicKeyOnOpenAi });
      expect(await updateAgent(mine.agentId, { config: on("openai"), llmKeyId: mine.anthropic })).toEqual({
        ok: false,
        error: MISMATCH.anthropicKeyOnOpenAi,
      });

      expect((await rowOf(mine.agentId)).config.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
    });

    it("moves the agent to another provider when the key moves with it", async () => {
      const mine = await anthropicAgent();

      expect((await updateAgent(mine.agentId, { config: on("openai"), llmKeyId: mine.openai })).ok).toBe(true);

      const row = await rowOf(mine.agentId);
      expect(row.llmKeyId).toBe(mine.openai);
      expect(row.config.llm).toMatchObject({ provider: "openai", model: "gpt-5" });
    });

    it("lets the provider change when the key is taken off in the same save", async () => {
      const mine = await anthropicAgent();
      expect((await updateAgent(mine.agentId, { config: on("openai"), llmKeyId: null })).ok).toBe(true);
      expect((await rowOf(mine.agentId)).llmKeyId).toBeNull();
    });

    it("saves everything it always saved for an agent whose key and provider agree", async () => {
      const mine = await anthropicAgent();
      const other = await keyFor(mine.userId, "anthropic");

      const larger = { ...on("anthropic"), risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 250 } };

      expect((await updateAgent(mine.agentId, { name: "Renamed", tagline: "New line" })).ok).toBe(true);
      expect((await updateAgent(mine.agentId, { config: larger })).ok).toBe(true);
      expect((await updateAgent(mine.agentId, { llmKeyId: other })).ok).toBe(true);
      // What the settings form sends: the key and the config together.
      expect((await updateAgent(mine.agentId, { llmKeyId: other, config: larger })).ok).toBe(true);

      const row = await rowOf(mine.agentId);
      expect(row).toMatchObject({ name: "Renamed", tagline: "New line", llmKeyId: other });
      expect(row.config.risk.maxTradeUsd).toBe(250);
    });

    /**
     * Before this rule the server did not check, so such an agent can exist. A save that
     * leaves the pair as it was makes nothing worse, and refusing it would stop its owner
     * changing anything else until that was fixed.
     */
    it("does not refuse a save that leaves an older mismatch exactly as it was, and refuses one that makes a new one", async () => {
      const mine = await anthropicAgent();
      await db.update(schema.agents).set({ llmKeyId: mine.openai }).where(eq(schema.agents.id, mine.agentId));

      expect((await updateAgent(mine.agentId, { name: "Still editable" })).ok).toBe(true);
      expect((await updateAgent(mine.agentId, { llmKeyId: mine.openai, config: { ...on("anthropic"), risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 50 } } })).ok).toBe(true);
      expect((await rowOf(mine.agentId)).config.risk.maxTradeUsd).toBe(50);

      // Changing either half is checked, and one more wrong pair is refused.
      const openrouter = await keyFor(mine.userId, "openrouter");
      expect((await updateAgent(mine.agentId, { llmKeyId: openrouter })).ok).toBe(false);
      // Putting it right is a change like any other.
      expect((await updateAgent(mine.agentId, { llmKeyId: mine.anthropic })).ok).toBe(true);
    });

    it("checks the key when a pay-per-use agent is put back on one, and not while it pays per use", async () => {
      vi.stubEnv("INFERENCE_USDC", "on");
      const mine = await anthropicAgent();
      const usdc = { ...on("anthropic").llm, source: "usdc" as const, usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3 } };

      // While it pays per use the key on its row is not used, whoever's it is.
      expect((await updateAgent(mine.agentId, { llmKeyId: mine.openai, config: { ...on("anthropic"), llm: usdc } })).ok).toBe(true);
      expect((await rowOf(mine.agentId)).llmKeyId).toBe(mine.openai);

      // "Use my own key" with that same key: now it would be used, and it is the wrong provider's.
      expect(await updateAgent(mine.agentId, { llmKeyId: mine.openai })).toEqual({ ok: false, error: MISMATCH.openaiKeyOnAnthropic });
      expect(await updateAgent(mine.agentId, { config: on("anthropic") })).toEqual({ ok: false, error: MISMATCH.openaiKeyOnAnthropic });
      expect((await rowOf(mine.agentId)).config.llm.source).toBe("usdc");

      expect((await updateAgent(mine.agentId, { llmKeyId: mine.anthropic })).ok).toBe(true);
      const row = await rowOf(mine.agentId);
      expect(row.config.llm.source).toBe("key");
      expect(row.llmKeyId).toBe(mine.anthropic);
    });
  });
});
