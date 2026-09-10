import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { paidFetch, parsePaymentOptions, selectPaymentOption } from "./paidFetch";
import { newBudget, X402BudgetError, type AgentWalletRef, type X402Context } from "./types";

let db: Db;
let agentId: string;

const walletRefs: AgentWalletRef[] = [
  { chain: "solana", walletId: "paper_x_solana", address: "PaperSolAddress" },
  { chain: "base", walletId: "paper_x_base", address: "0xpaper" },
];

function ctx(maxUsd = 0.25): X402Context {
  return { agentId, runId: null, mode: "paper", wallets: walletRefs, budget: newBudget(maxUsd) };
}

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
});

beforeEach(async () => {
  const seeded = await seedAgent(db);
  agentId = seeded.agentId;
});

describe("parsePaymentOptions", () => {
  it("reads an x402 v1 body (`maxAmountRequired`)", async () => {
    // Verbatim shape returned live by sentimentalpha.ai at build time.
    const res = new Response(
      JSON.stringify({
        x402Version: 1,
        error: "X-PAYMENT header is required",
        accepts: [
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: "10000",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            payTo: "0x1F08FB45D8ED4Ed84C7eeE91F0158c06A90B995E",
          },
        ],
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
    const options = await parsePaymentOptions(res);
    expect(options).toHaveLength(1);
    expect(options[0]?.amountUsd).toBeCloseTo(0.01, 9);
    expect(options[0]?.network).toBe("base");
  });

  it("reads an x402 v2 body (`amount`) on Solana", async () => {
    // Verbatim shape returned live by api.deepnets.ai at build time.
    const res = new Response(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            amount: "10000",
            asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            payTo: "Bn7sLNmcL9ru5kt9gNwVn8e8Sx912dBTxiUBNiwjbiY8",
          },
        ],
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
    const options = await parsePaymentOptions(res);
    expect(options[0]?.amountUsd).toBeCloseTo(0.01, 9);
  });

  it("returns nothing for a body with no accepts", async () => {
    const res = new Response(JSON.stringify({ error: "nope" }), { status: 402 });
    expect(await parsePaymentOptions(res)).toEqual([]);
  });
});

describe("selectPaymentOption", () => {
  const base = {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x1",
    amount: "10000",
    amountUsd: 0.01,
  };
  const bsc = { ...base, network: "eip155:56", amountUsd: 0.02 };
  const sol = { ...base, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amountUsd: 0.005 };

  it("prefers the network the registry expects", () => {
    expect(selectPaymentOption([sol, base], "eip155:8453", walletRefs)?.network).toBe("eip155:8453");
  });

  it("falls back to the cheapest payable option", () => {
    expect(selectPaymentOption([bsc, sol], "eip155:999", walletRefs)?.amountUsd).toBe(0.005);
  });

  it("returns null when there is nothing to choose from", () => {
    expect(selectPaymentOption([], "eip155:8453", walletRefs)).toBeNull();
  });
});

describe("paidFetch in mock mode", () => {
  it("returns the fixture without touching the network", async () => {
    const c = ctx();
    const fixture = { hello: "world" };
    const res = await paidFetch(c, {
      sourceId: "sentimentalpha",
      url: "https://sentimentalpha.ai/v1/narrative-alpha",
      method: "POST",
      body: { query: "solana memecoins" },
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture,
    });

    expect(res.data).toEqual(fixture);
    expect(res.simulated).toBe(true);
    expect(res.free).toBe(false);
    expect(res.amountUsd).toBeCloseTo(0.01, 9);
  });

  it("writes a simulated x402_payments row at the registry price", async () => {
    const c = ctx();
    await paidFetch(c, {
      sourceId: "cmc-quotes",
      url: "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=SOL",
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture: {},
    });

    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.simulated).toBe(true);
    expect(rows[0]?.settled).toBe(true);
    expect(Number(rows[0]?.amountUsd)).toBeCloseTo(0.01, 9);
    expect(rows[0]?.sourceId).toBe("cmc-quotes");
  });

  it("accumulates spend against the run budget", async () => {
    const c = ctx(0.25);
    for (let i = 0; i < 3; i += 1) {
      await paidFetch(c, {
        sourceId: "cmc-quotes",
        url: "https://example.test/quote",
        network: "eip155:8453",
        priceUsd: 0.01,
        fixture: {},
      });
    }
    expect(c.budget.spentUsd).toBeCloseTo(0.03, 9);
  });

  it("throws X402BudgetError once the per-run cap is hit and writes no row", async () => {
    const c = ctx(0.015);
    await paidFetch(c, {
      sourceId: "cmc-quotes",
      url: "https://example.test/quote",
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture: {},
    });

    await expect(
      paidFetch(c, {
        sourceId: "cmc-quotes",
        url: "https://example.test/quote",
        network: "eip155:8453",
        priceUsd: 0.01,
        fixture: {},
      }),
    ).rejects.toBeInstanceOf(X402BudgetError);

    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(c.budget.spentUsd).toBeCloseTo(0.01, 9);
  });

  it("charges nothing for a source with no registry price", async () => {
    const c = ctx();
    const res = await paidFetch(c, {
      sourceId: "bazaar:https://example.test/thing",
      url: "https://example.test/thing",
      network: "eip155:8453",
      priceUsd: null,
      fixture: { ok: true },
    });
    expect(res.amountUsd).toBe(0);
    expect(c.budget.spentUsd).toBe(0);
  });
});
