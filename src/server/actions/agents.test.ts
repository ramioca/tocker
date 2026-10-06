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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { RUN_REFUSED_WHILE_PAUSED } from "@/lib/agent/run-gate";
import { attachLlmKey, seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { setTradingPaused } from "@/lib/security/kill-switch";
import { MAX_NEW_AGENTS_PER_DAY, RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { DATA_SPEND_CARRYOVER, realDataSpend24h } from "@/lib/x402/daily-budget";
import { uniqueSlug } from "@/server/queries/_shared";
import type { Chain, Session } from "@/server/types";

let session: Session | null = null;
let db: Db;

/** What the wallet stand-in was asked for, and whether the next call should fail like an outage. */
const walletCalls: Array<{ agentId: string; chains: Chain[]; existingAgent: boolean }> = [];
const budgetCalls: Array<{ agentId: string; perTxUsd: number }> = [];
let walletOutage = false;
const startRun = vi.fn<(input: { agentId: string; trigger: string }) => Promise<{ runId: string }>>(async () => ({
  runId: "run_test",
}));

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
  startRun: (input: { agentId: string; trigger: string }) => startRun(input),
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

    expect(await triggerRun(seeded.agentId)).toEqual({ ok: true, data: { runId: "run_test" } });
    expect(startRun).toHaveBeenCalledWith({ agentId: seeded.agentId, trigger: "manual" });
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
