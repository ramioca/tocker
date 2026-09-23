/**
 * Deleting an agent must not strand what is in its wallet.
 *
 * The bug this pins: `deleteAgent` summed `usd ?? 0` over the wallet card's balance read.
 * That read reports SOL with `usd: null` on Solana and never looks at tokens, so an agent
 * holding 5 SOL, or a memecoin it bought, read as empty and could be deleted — with no
 * way back to the wallet afterwards.
 *
 * Real code path against in-memory PGlite; only the Solana RPC and the price feed are
 * stubbed, dispatched on the JSON-RPC method the way the real endpoint would answer.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { resetPriceCache } from "@/lib/trading/prices";
import type { Session } from "@/server/types";
import { AGENT_SOL_KEPT } from "./funding";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { readStrandedHoldings, STRANDED_READ_FAILED } = await import("./stranded");
const { deleteAgent } = await import("@/server/actions/agents");

const AGENT_ADDRESS = "3XiU5e1cwsHB4V9tAeRvtsu4NSKN8pf5jW1t9aswohnY";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const SPAM = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const LEGACY = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

interface ChainState {
  lamports: number;
  accounts: Array<{ mint: string; amount: string }>;
  failTokenRead?: boolean;
}

let chain: ChainState;
let rpcCalls: string[];
let bonkPrice = 0.0000027;

/** One `getTokenAccountsByOwner` jsonParsed row, shaped like mainnet's. */
function tokenRow(mint: string, amount: string, i: number) {
  return {
    pubkey: `Acct${i}${"1".repeat(40)}`.slice(0, 44),
    account: {
      lamports: 2_039_280,
      owner: LEGACY,
      executable: false,
      space: 165,
      data: {
        program: "spl-token",
        space: 165,
        parsed: {
          type: "account",
          info: {
            isNative: false,
            mint,
            owner: AGENT_ADDRESS,
            state: "initialized",
            tokenAmount: { amount, decimals: 6, uiAmount: 0, uiAmountString: "0" },
          },
        },
      },
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubNetwork(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/price/v3")) return json({ [BONK]: { usdPrice: bonkPrice } });
    if (url.includes("dexscreener")) return json([]);
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
    rpcCalls.push(body.method ?? "?");
    if (body.method === "getBalance") return json({ jsonrpc: "2.0", id: 1, result: { value: chain.lamports } });
    if (body.method === "getTokenAccountsByOwner") {
      if (chain.failTokenRead) return new Response("upstream down", { status: 503 });
      const program = (body.params?.[1] as { programId?: string } | undefined)?.programId;
      const rows = program === LEGACY ? chain.accounts.map((a, i) => tokenRow(a.mint, a.amount, i)) : [];
      return json({ jsonrpc: "2.0", id: 1, result: { value: rows } });
    }
    return json({ jsonrpc: "2.0", id: 1, error: { message: `unexpected ${body.method}` } });
  }) as typeof fetch;
}

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  chain = { lamports: 0, accounts: [] };
  rpcCalls = [];
  bonkPrice = 0.0000027;
  resetPriceCache();
  stubNetwork();
  session = null;
});

/** A seeded agent whose Solana wallet (and optionally Base wallet) is a real one rather than a paper placeholder. */
async function agentWithRealWallets(chains: Array<"solana" | "base"> = ["solana"]) {
  const seeded = await seedAgent(db, { mode: "live", config: { chains: ["solana", "base"] } });
  for (const c of chains) {
    await db
      .update(schema.wallets)
      .set({
        id: `privy_${c}_${nanoid(8)}`,
        // Unique per agent (wallets are unique on chain + address); the stubbed RPC
        // answers for whichever address it is asked about.
        address: c === "solana" ? `Agent${nanoid(12)}` : `0x${nanoid(12)}`,
      })
      .where(eq(schema.wallets.id, `paper_${seeded.agentId}_${c}`));
  }
  session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return seeded;
}

async function trade(agentId: string, ownerId: string, c: "solana" | "base", address: string, isPaper: boolean) {
  await db.insert(schema.trades).values({
    id: nanoid(),
    agentId,
    ownerId,
    chain: c,
    side: "buy",
    tokenId: `${c}:${address}`,
    quoteTokenId: c === "solana" ? `solana:${USDC}` : "base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amountToken: "1000000",
    amountUsd: "10",
    priceUsd: "0.00001",
    status: "filled",
    isPaper,
  });
}

async function stillThere(agentId: string): Promise<boolean> {
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.id, agentId));
  return rows.length === 1;
}

describe("readStrandedHoldings / deleteAgent", () => {
  it("refuses an agent holding SOL — counted from the chain by amount, not by a dollar quote", async () => {
    const { agentId } = await agentWithRealWallets();
    chain.lamports = 5_000_000_000;

    const read = await readStrandedHoldings(agentId);
    expect(read).toEqual({
      ok: true,
      holdings: [{ kind: "native", chain: "solana", symbol: "SOL", amount: 5 - AGENT_SOL_KEPT }],
    });

    const result = await deleteAgent(agentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/4\.9840 SOL/);
    expect(await stillThere(agentId)).toBe(true);
  });

  it("refuses an agent holding a token it bought live, and ignores one it was only sent", async () => {
    const { agentId, userId } = await agentWithRealWallets();
    await trade(agentId, userId, "solana", BONK, false);
    // WIF was only ever paper-traded; SPAM was never traded at all. Both sit in the wallet.
    await trade(agentId, userId, "solana", WIF, true);
    chain.lamports = 12_000_000; // under Tocker's fee reserve: not the owner's to withdraw
    chain.accounts = [
      { mint: USDC, amount: "0" },
      { mint: BONK, amount: "100000000000" }, // 1,000,000 BONK at 5 decimals ≈ $2.70
      { mint: WIF, amount: "5000000" },
      { mint: SPAM, amount: "999999999999" },
    ];

    const read = await readStrandedHoldings(agentId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.holdings).toHaveLength(1);
    expect(read.holdings[0]).toMatchObject({ kind: "token", symbol: "BONK", amount: 1_000_000 });

    const result = await deleteAgent(agentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/BONK \(about \$2\.70\)\. Sell it first/);
    expect(await stillThere(agentId)).toBe(true);
  });

  it("lets a live-bought token that is now dust go", async () => {
    const { agentId, userId } = await agentWithRealWallets();
    await trade(agentId, userId, "solana", BONK, false);
    chain.accounts = [{ mint: BONK, amount: "100000" }]; // 1 BONK
    expect(await readStrandedHoldings(agentId)).toEqual({ ok: true, holdings: [] });
  });

  it("refuses USDC in the agent's token account", async () => {
    const { agentId } = await agentWithRealWallets();
    chain.accounts = [{ mint: USDC, amount: "12300000" }];
    const result = await deleteAgent(agentId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/12\.30 USDC\. Withdraw it first/);
  });

  it("fails closed when the wallet cannot be read", async () => {
    const { agentId } = await agentWithRealWallets();
    chain.failTokenRead = true;
    expect(await readStrandedHoldings(agentId)).toEqual({ ok: false, error: STRANDED_READ_FAILED });

    const result = await deleteAgent(agentId);
    expect(result).toEqual({ ok: false, error: STRANDED_READ_FAILED });
    expect(await stillThere(agentId)).toBe(true);
  });

  it("refuses a Base token the book holds from a live buy", async () => {
    const { agentId, userId } = await agentWithRealWallets(["solana", "base"]);
    await trade(agentId, userId, "base", BRETT, false);
    await db.insert(schema.positions).values({
      agentId,
      tokenId: `base:${BRETT}`,
      amountToken: "1000",
      avgCostUsd: "0.005",
    });
    const read = await readStrandedHoldings(agentId);
    expect(read.ok && read.holdings.map((h) => (h.kind === "token" ? h.symbol : h.kind))).toEqual(["BRETT"]);
  });

  it("deletes an agent left with only Tocker's fee reserve and an empty USDC account", async () => {
    const { agentId } = await agentWithRealWallets();
    chain.lamports = 12_000_000;
    chain.accounts = [{ mint: USDC, amount: "0" }];
    expect(await deleteAgent(agentId)).toEqual({ ok: true, data: undefined });
    expect(await stillThere(agentId)).toBe(false);
  });

  it("does not touch the network for an agent whose wallets are all paper", async () => {
    const { agentId, userId } = await seedAgent(db);
    session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
    expect(await readStrandedHoldings(agentId)).toEqual({ ok: true, holdings: [] });
    expect(rpcCalls).toEqual([]);
  });
});
