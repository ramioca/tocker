/**
 * Creating and deleting agents, as far as the platform's money is concerned.
 *
 * `getSession` and `next/cache` are mocked because these are server actions, and the
 * wallet library because it would call Privy; its stand-in writes the same wallet rows
 * the real one does, since those rows are what the daily limit counts. The limits, the
 * audit row and the database are the real code against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { MAX_NEW_AGENTS_PER_DAY } from "@/lib/security/rate-limit";
import { DATA_SPEND_CARRYOVER, realDataSpend24h } from "@/lib/x402/daily-budget";
import type { Session } from "@/server/types";

let session: Session | null = null;
let db: Db;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/wallets", () => ({
  createAgentWallets: async (input: { agentId: string; userId: string }) => {
    const id = `paper_${input.agentId}_solana`;
    await db.insert(schema.wallets).values({
      id,
      kind: "agent_server",
      chain: "solana",
      address: `PaperSol${input.agentId}`,
      userId: input.userId,
      agentId: input.agentId,
    });
    return [{ id, chain: "solana", address: `PaperSol${input.agentId}` }];
  },
  applyAgentBudgetPolicy: async () => null,
}));
vi.mock("@/lib/wallets/stranded", () => ({
  readStrandedHoldings: async () => ({ ok: true, holdings: [] }),
}));

const { createAgent, deleteAgent } = await import("./agents");

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
});

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
