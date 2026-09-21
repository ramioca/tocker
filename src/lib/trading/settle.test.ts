import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { seedKnownTokens } from "@/lib/trading/tokens";
import type { Fill, Quote, TradeExecutor, TradeRequest } from "./executor";
import { executeTrade, isOverAskError, signatureFromHandle, sweepSubmittedTrades } from "./settle";

let db: Db;

const BONK = "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC = "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

beforeAll(async () => {
  process.env.TOKENS_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

beforeEach(() => {
  delete process.env.SOLANA_RPC_URL;
});

/** A scripted executor: each call shifts one outcome off the queue. */
class ScriptedExecutor implements TradeExecutor {
  readonly venue = "jupiter" as const;
  readonly isPaper = false;
  readonly requests: TradeRequest[] = [];

  constructor(private readonly outcomes: Array<Fill | Error>) {}

  async quote(req: TradeRequest): Promise<Quote> {
    this.requests.push(req);
    return {
      request: req,
      venue: this.venue,
      priceUsd: 0.0001,
      amountToken: req.amountToken ?? req.amountUsd / 0.0001,
      amountUsd: req.amountUsd,
      feeUsd: 0,
      handle: { requestId: "req-1", signedTransactionSignature: "5".repeat(87) },
    };
  }

  async execute(): Promise<Fill> {
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error("scripted executor ran out of outcomes");
    if (next instanceof Error) throw next;
    return next;
  }
}

async function seedTradeRow(agentId: string, ownerId: string, side: "buy" | "sell"): Promise<string> {
  const tradeId = nanoid();
  await db.insert(schema.trades).values({
    id: tradeId,
    agentId,
    ownerId,
    chain: "solana",
    side,
    tokenId: BONK,
    quoteTokenId: USDC,
    amountToken: "0",
    amountUsd: "10",
    priceUsd: "0",
    feeUsd: "0",
    status: "pending",
    isPaper: false,
  });
  return tradeId;
}

const filled: Fill = {
  status: "filled",
  txHash: "tx-hash",
  priceUsd: 0.0001,
  amountToken: 100_000,
  amountUsd: 10,
  feeUsd: 0.03,
};

describe("isOverAskError", () => {
  it("recognises Jupiter's over-ask codes and insufficient-balance wording", () => {
    expect(isOverAskError("Jupiter: swap failed (code 1)")).toBe(true);
    expect(isOverAskError("errorCode: 1 — could not fill")).toBe(true);
    expect(isOverAskError("insufficient token balance for the transfer")).toBe(true);
    expect(isOverAskError("amount exceeds the wallet balance")).toBe(true);
  });

  it("does not retry failures a retry cannot fix", () => {
    expect(isOverAskError("no route for this pair")).toBe(false);
    expect(isOverAskError("Privy policy denied this transaction")).toBe(false);
    expect(isOverAskError("errorCode: 1003 — missing signature")).toBe(false);
    expect(isOverAskError(null)).toBe(false);
  });
});

describe("signatureFromHandle", () => {
  it("finds a signature wherever the executor hung it", () => {
    const sig = "3".repeat(88);
    expect(signatureFromHandle({ signature: sig })).toBe(sig);
    expect(signatureFromHandle({ signed: { txSignature: sig } })).toBe(sig);
    expect(signatureFromHandle({ a: { b: { transactionSignature: sig } } })).toBe(sig);
  });

  it("returns null rather than guessing at a short id", () => {
    expect(signatureFromHandle({ requestId: "req-1" })).toBeNull();
    expect(signatureFromHandle(null)).toBeNull();
    expect(signatureFromHandle("just a string")).toBeNull();
  });
});

describe("executeTrade", () => {
  it("persists the signed transaction's signature before execute is called", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "buy");
    const signature = "5".repeat(87);

    // The signature has to be on the row *at execute time*, not after the fill: an
    // invocation that dies in between must still leave a thread to pull.
    let signatureAtExecute: string | null = null;
    const executor = new ScriptedExecutor([]);
    executor.execute = async () => {
      const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
      signatureAtExecute = row?.txHash ?? null;
      return filled;
    };

    const request: TradeRequest = {
      chain: "solana",
      side: "buy",
      tokenId: BONK,
      tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      decimals: 5,
      amountUsd: 10,
      slippageBps: 100,
    };
    const quote = await executor.quote(request);
    const result = await executeTrade({ tradeId, executor, request, quote });

    expect(result.status).toBe("filled");
    expect(signatureAtExecute).toBe(signature);
  });

  it("writes failed + the error when execute throws instead of letting it escape", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "buy");
    const executor = new ScriptedExecutor([new Error("Privy policy denied this transaction")]);
    const request: TradeRequest = {
      chain: "base",
      side: "buy",
      tokenId: BONK,
      tokenAddress: "0xabc",
      symbol: "BONK",
      decimals: 5,
      amountUsd: 10,
      slippageBps: 100,
    };
    const quote = await executor.quote(request);

    const result = await executeTrade({ tradeId, executor, request, quote });

    expect(result.status).toBe("failed");
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    // Before H2 this row stayed on `submitted` forever.
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("Privy policy denied");
  });

  it("retries a sell once against the wallet's real balance after an over-ask", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "sell");
    const executor = new ScriptedExecutor([
      { status: "failed", txHash: null, priceUsd: 0, amountToken: 0, amountUsd: 0, feeUsd: 0, error: "swap failed (code 1)" },
      filled,
    ]);
    const request: TradeRequest = {
      chain: "solana",
      side: "sell",
      tokenId: BONK,
      tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      decimals: 5,
      // What the mark said we held.
      amountToken: 1_000_000,
      amountUsd: 100,
      slippageBps: 100,
    };
    const quote = await executor.quote(request);

    const result = await executeTrade({
      tradeId,
      executor,
      request,
      quote,
      // What the wallet actually holds.
      refreshSellAmount: async () => 999_000,
    });

    expect(result.status).toBe("filled");
    // Two quotes: the caller's, then the retry sized from the real balance.
    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[1]?.amountToken).toBe(999_000);
  });

  it("does not retry a buy, or a failure a retry cannot fix", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "sell");
    const executor = new ScriptedExecutor([
      { status: "failed", txHash: null, priceUsd: 0, amountToken: 0, amountUsd: 0, feeUsd: 0, error: "no route" },
    ]);
    const request: TradeRequest = {
      chain: "solana",
      side: "sell",
      tokenId: BONK,
      tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      symbol: "BONK",
      decimals: 5,
      amountToken: 1_000_000,
      amountUsd: 100,
      slippageBps: 100,
    };
    const quote = await executor.quote(request);

    const result = await executeTrade({ tradeId, executor, request, quote, refreshSellAmount: async () => 500 });

    expect(result.status).toBe("failed");
    expect(executor.requests).toHaveLength(1);
  });
});

describe("sweepSubmittedTrades", () => {
  it("settles a submitted row with no signature as never having reached the chain", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "buy");
    await db
      .update(schema.trades)
      .set({ status: "submitted", createdAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.trades.id, tradeId));

    expect(await sweepSubmittedTrades()).toBe(1);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("no transaction signature");
  });

  it("leaves a row that has only just been submitted alone", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "buy");
    await db.update(schema.trades).set({ status: "submitted" }).where(eq(schema.trades.id, tradeId));

    expect(await sweepSubmittedTrades()).toBe(0);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("submitted");
  });

  it("tells the owner when a signature exists and its outcome is unknown", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTradeRow(agentId, userId, "sell");
    await db
      .update(schema.trades)
      .set({ status: "submitted", txHash: "4".repeat(87), createdAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.trades.id, tradeId));

    // No SOLANA_RPC_URL: the chain cannot be asked, so the answer is "unknown", and the
    // one thing that must not happen is reporting it as a clean failure.
    expect(await sweepSubmittedTrades()).toBe(1);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("no on-chain status");

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    expect(notes.some((n) => n.kind === "trade_unsettled")).toBe(true);
  });
});
