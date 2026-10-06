/**
 * `createAgentWallets`: how many wallets an agent ends up with.
 *
 * Privy is a stand-in that hands out a new wallet per create and, like the real one,
 * the same wallet again for a create that repeats an idempotency key. The token-account
 * helper is a stand-in that records what it was asked to open. The wallet rows are the
 * real inserts against in-memory PGlite. No network.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";

interface CreateParams {
  chain_type: "ethereum" | "solana";
  display_name: string;
  idempotency_key?: string;
}

const creates: CreateParams[] = [];
const remembered = new Map<string, { id: string; address: string }>();
const openedUsdcAccounts: Array<{ agentId: string; address: string }> = [];

vi.mock("@/lib/privy", () => ({
  isPrivyConfigured: () => true,
  authorizationPublicKey: () => "test-public-key",
  authorizationContext: () => ({ authorization_private_keys: [] }),
  privy: () => ({
    wallets: () => ({
      create: async (params: CreateParams) => {
        creates.push(params);
        const again = params.idempotency_key ? remembered.get(params.idempotency_key) : undefined;
        if (again) return again;
        const wallet = { id: `wallet_${nanoid(10)}`, address: `${params.chain_type}_${nanoid(16)}` };
        if (params.idempotency_key) remembered.set(params.idempotency_key, wallet);
        return wallet;
      },
    }),
  }),
}));
vi.mock("./gas", () => ({
  ensureAgentUsdcAta: async (input: { agentId: string; address: string }) => {
    openedUsdcAccounts.push(input);
    return true;
  },
}));

const { agentWalletIdempotencyKey, createAgentWallets, getAgentWallets } = await import("./index");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  creates.length = 0;
  remembered.clear();
  openedUsdcAccounts.length = 0;
});

async function newOwner(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `t${nanoid(6)}`, displayName: "Test" });
  return userId;
}

describe("createAgentWallets", () => {
  it("makes one wallet per chain, however many times the list names it", async () => {
    const userId = await newOwner();
    const agentId = nanoid();

    const made = await createAgentWallets({
      agentId,
      userId,
      name: "Twice",
      chains: ["solana", "solana", "base", "solana", "base"],
    });

    expect(made.map((w) => w.chain)).toEqual(["solana", "base"]);
    expect(creates.map((c) => c.chain_type)).toEqual(["solana", "ethereum"]);
    expect((await getAgentWallets(agentId)).map((w) => w.chain).sort()).toEqual(["base", "solana"]);
  });

  it("sends a new agent's creates as it always has: no idempotency key", async () => {
    const userId = await newOwner();
    await createAgentWallets({ agentId: nanoid(), userId, name: "Fresh", chains: ["solana", "base"] });

    expect(creates).toHaveLength(2);
    expect(creates.every((c) => !("idempotency_key" in c))).toBe(true);
    expect(creates.map((c) => c.display_name)).toEqual(["Fresh · solana", "Fresh · base"]);
  });

  /**
   * Still done at creation, paper agents included. The Solana address is shown with a
   * copy button in Settings, and a transfer sent to it from outside Tocker opens nothing
   * itself: unless the account is already there, whether that transfer lands is up to
   * whoever sends it.
   */
  it("opens the USDC account for the Solana wallet it just made, and for nothing else", async () => {
    const userId = await newOwner();
    const agentId = nanoid();
    const made = await createAgentWallets({ agentId, userId, name: "Both", chains: ["base", "solana"] });

    const solana = made.find((w) => w.chain === "solana");
    expect(openedUsdcAccounts).toEqual([{ agentId, address: solana?.address }]);

    openedUsdcAccounts.length = 0;
    await createAgentWallets({ agentId: nanoid(), userId, name: "Base only", chains: ["base"] });
    expect(openedUsdcAccounts).toEqual([]);
  });

  it("gives two saves that race to add the same chain one wallet between them", async () => {
    const userId = await newOwner();
    const agentId = nanoid();
    const add = () => createAgentWallets({ agentId, userId, name: "Racer", chains: ["base"], existingAgent: true });

    // Both got past "this agent has no Base wallet" before either had written one.
    const [first, second] = await Promise.all([add(), add()]);

    expect(creates).toHaveLength(2);
    expect(creates[0]?.idempotency_key).toBeTruthy();
    expect(creates[0]?.idempotency_key).toBe(creates[1]?.idempotency_key);
    expect(first[0]?.id).toBe(second[0]?.id);
    const rows = await db.select().from(schema.wallets).where(eq(schema.wallets.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chain).toBe("base");
  });
});

describe("agentWalletIdempotencyKey", () => {
  const at = Date.UTC(2026, 9, 6, 12, 0, 0);

  it("is the same for the same agent, chain and name inside the window", () => {
    const key = agentWalletIdempotencyKey("agent_1", "base", "Mike · base", at);
    expect(agentWalletIdempotencyKey("agent_1", "base", "Mike · base", at + 4_000)).toBe(key);
    expect(key).toContain("agent_1");
    expect(key.length).toBeLessThan(128);
  });

  it("differs by agent, by chain and by name, so one request is never answered with another's wallet", () => {
    const key = agentWalletIdempotencyKey("agent_1", "base", "Mike · base", at);
    expect(agentWalletIdempotencyKey("agent_2", "base", "Mike · base", at)).not.toBe(key);
    expect(agentWalletIdempotencyKey("agent_1", "solana", "Mike · base", at)).not.toBe(key);
    expect(agentWalletIdempotencyKey("agent_1", "base", "Renamed · base", at)).not.toBe(key);
  });

  /** A create that went wrong is not replayed at a retry for the rest of the day. */
  it("moves on after the window", () => {
    const key = agentWalletIdempotencyKey("agent_1", "base", "Mike · base", at);
    expect(agentWalletIdempotencyKey("agent_1", "base", "Mike · base", at + 5 * 60_000)).not.toBe(key);
  });
});
