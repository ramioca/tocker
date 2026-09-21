import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { correctEip712Domains, paidFetch, parsePaymentOptions, selectPaymentOption } from "./paidFetch";
import { chainForNetwork, newBudget, X402BudgetError, type AgentWalletRef, type X402Context } from "./types";

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

  // W5: the platform signs every payment, so the choice is made against the platform's
  // chains and no agent wallet is consulted at all.
  it("chooses without being handed any wallets — the platform's chains are the default", () => {
    expect(selectPaymentOption([sol, base], "eip155:8453")?.network).toBe("eip155:8453");
    expect(selectPaymentOption([sol, base], "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")?.network).toBe(
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    );
  });

  it("skips a network the platform holds no wallet on, however cheap it is", () => {
    // CoinMarketCap offers BSC; signing there would produce a valid signature against
    // a balance that does not exist.
    const cheapBsc = { ...bsc, amountUsd: 0.001 };
    expect(selectPaymentOption([cheapBsc, base], "eip155:999")?.network).toBe("eip155:8453");
  });

  it("still picks the cheapest payable option when the preferred network is not offered", () => {
    expect(selectPaymentOption([bsc, sol, base], "eip155:999")?.amountUsd).toBe(0.005);
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

  it("bills a Solana-priced source to the Solana wallet's network, not Base", async () => {
    // SolEnrich is the one launch radar priced on Solana. `chainForNetwork` has to
    // recognise the CAIP-2 mainnet id or the call would silently fall through to the
    // Base wallet, which would sign a valid payment against the wrong balance.
    const c = ctx();
    const res = await paidFetch(c, {
      sourceId: "solenrich-launches",
      url: "https://api.solenrich.com/entrypoints/new-tokens/invoke",
      method: "POST",
      body: { min_liquidity_usd: 15_000, limit: 10 },
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      priceUsd: 0.012,
      fixture: { tokens: [] },
    });

    expect(chainForNetwork("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana");
    expect(res.network).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(res.amountUsd).toBeCloseTo(0.012, 9);
    expect(c.budget.spentUsd).toBeCloseTo(0.012, 9);

    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.network).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(Number(rows[0]?.amountUsd)).toBeCloseTo(0.012, 9);
  });

  it("refuses a Solana-priced call the budget cannot cover", async () => {
    const c = ctx(0.01); // one cent, against a $0.012 radar
    await expect(
      paidFetch(c, {
        sourceId: "solenrich-launches",
        url: "https://api.solenrich.com/entrypoints/new-tokens/invoke",
        method: "POST",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        priceUsd: 0.012,
        fixture: {},
      }),
    ).rejects.toBeInstanceOf(X402BudgetError);
    expect(c.budget.spentUsd).toBe(0);

    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(0);
  });

  it("pays for an agent that holds no wallet on the data network", async () => {
    // The old rule was that the agent needed a wallet on the resource's network. It
    // does not any more: the platform pays, and the agent's wallets are for trading.
    const c: X402Context = { agentId, runId: null, mode: "paper", wallets: [], budget: newBudget(0.25) };
    const res = await paidFetch(c, {
      sourceId: "cmc-quotes",
      url: "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest?symbol=SOL",
      network: "eip155:8453",
      priceUsd: 0.01,
      fixture: { ok: true },
    });
    expect(res.amountUsd).toBeCloseTo(0.01, 9);

    // The payment is still recorded against the agent and its run: who paid changed,
    // who it was *for* did not.
    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agentId).toBe(agentId);
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

// ---------------------------------------------------------------- the signing path
//
// Everything below runs with `X402_MOCK` off, which is the only mode where a payment
// can actually fail. The wallet, the Privy client and `wrapFetchWithPayment` are all
// replaced: the point is not to exercise x402 (that is the vendor's test suite) but to
// pin the two decisions this module makes around it — which side of the signature a
// failure fell on, and what the client is configured with before it signs.

describe("correctEip712Domains", () => {
  const base = (extra: Record<string, unknown>, asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") =>
    ({
      scheme: "exact",
      network: "eip155:8453",
      asset,
      amount: "10000",
      payTo: "0xpay",
      maxTimeoutSeconds: 300,
      extra,
    }) as unknown as Parameters<typeof correctEip712Domains>[1][number];

  /** SentimentAlpha's exact 402, re-probed live 2026-09-21. */
  it("rewrites Base USDC's domain name when the server advertises the wrong one", () => {
    const [fixed] = correctEip712Domains(1, [base({ name: "USDC", version: "2" })]);
    expect(fixed?.extra).toEqual({ name: "USD Coin", version: "2" });
  });

  /** x402Atlas already gets it right; a no-op has to stay a no-op, object identity included. */
  it("leaves a server that already agrees with the token untouched", () => {
    const input = [base({ merchant: "x402Atlas", name: "USD Coin", version: "2" })];
    expect(correctEip712Domains(2, input)[0]).toBe(input[0]);
  });

  it("does not touch an asset whose domain nobody has read off the chain", () => {
    const input = [base({ name: "United Stables", version: "1" }, "0xcE24439F2D9C6a2289F741120FE202248B666666")];
    expect(correctEip712Domains(2, input)[0]).toBe(input[0]);
  });

  /** Permit2 signs against the Permit2 contract's domain, not the token's. Hands off. */
  it("does not touch a Permit2 requirement", () => {
    const input = [base({ name: "USDC", version: "2", assetTransferMethod: "permit2-exact" })];
    expect(correctEip712Domains(2, input)[0]).toBe(input[0]);
  });

  it("keeps every other field, and does not mutate the server's object", () => {
    const input = base({ name: "USDC", version: "2", merchant: "someone" });
    const [fixed] = correctEip712Domains(1, [input]);
    expect(fixed).toMatchObject({ payTo: "0xpay", amount: "10000", scheme: "exact" });
    expect(fixed?.extra).toMatchObject({ merchant: "someone" });
    expect(input.extra).toEqual({ name: "USDC", version: "2", merchant: "someone" });
  });
});

describe("paidFetch accounting when a payment fails", () => {
  /** What the fake `wrapFetchWithPayment` should do on the paid retry. */
  let paidBehaviour: () => Promise<Response>;
  /** Whether the fake client signed before that happened. */
  let signBeforeRetry = true;
  let registeredPolicies: Array<(v: number, r: unknown[]) => unknown[]>;
  let spendControls: { maxAmountPerPayment: string } | null;

  beforeEach(() => {
    vi.stubEnv("X402_MOCK", "");
    vi.resetModules();
    registeredPolicies = [];
    spendControls = null;
    signBeforeRetry = true;
    paidBehaviour = async () => new Response("{}", { status: 200 });

    const afterPaymentHooks: Array<() => Promise<void>> = [];
    const fakeClient = {
      setSpendControls(controls: { maxAmountPerPayment: string }) {
        spendControls = controls;
      },
      register() {},
      registerV1() {},
      registerPolicy(policy: (v: number, r: unknown[]) => unknown[]) {
        registeredPolicies.push(policy);
      },
      onAfterPaymentCreation(hook: () => Promise<void>) {
        afterPaymentHooks.push(hook);
      },
    };

    vi.doMock("@/lib/privy", () => ({
      privy: () => ({}),
      authorizationContext: () => ({}),
      authorizationPublicKey: () => "pk",
      isPrivyConfigured: () => true,
    }));
    vi.doMock("@/lib/platform/wallets", () => ({
      ensurePlatformWallet: async (chain: string) => ({ walletId: "platform-wallet", chain, address: "0xplatform" }),
    }));
    vi.doMock("@privy-io/node/x402", () => ({ createX402Client: () => fakeClient }));
    vi.doMock("@x402/fetch", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@x402/fetch")>()),
      wrapFetchWithPayment: () => async () => {
        // The real client fires this the instant a payload is signed, which is the line
        // this module charges against.
        if (signBeforeRetry) for (const hook of afterPaymentHooks) await hook();
        return paidBehaviour();
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/privy");
    vi.doUnmock("@/lib/platform/wallets");
    vi.doUnmock("@privy-io/node/x402");
    vi.doUnmock("@x402/fetch");
    vi.resetModules();
  });

  /** A 402 shaped exactly like the one SentimentAlpha returns, so the option parses. */
  function stubProbe402(): void {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              network: "base",
              maxAmountRequired: "10000",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payTo: "0xpay",
              maxTimeoutSeconds: 300,
              extra: { name: "USDC", version: "2" },
            },
          ],
        },
        { status: 402 },
      ),
    );
  }

  /**
   * A fresh copy of the module, so its dynamic imports resolve to the mocks above.
   * `@/db` is re-imported with it, but `setupTestDb` keeps one process-wide PGlite, so
   * the rows it writes are the rows this file reads.
   */
  async function live() {
    return import("./paidFetch");
  }

  const req = {
    sourceId: "sentimentalpha",
    url: "https://sentimentalpha.ai/v1/narrative-alpha",
    network: "eip155:8453",
    priceUsd: 0.01,
    fixture: {},
  } as const;

  it("charges the run and writes an unsettled row when the resource fails after payment", async () => {
    stubProbe402();
    paidBehaviour = async () => new Response("upstream on fire", { status: 503 });
    const { paidFetch: livePaidFetch } = await live();

    const c = ctx(0.25);
    await expect(livePaidFetch(c, req)).rejects.toThrow(/responded 503 after payment/);

    expect(c.budget.spentUsd).toBeCloseTo(0.01, 9);
    const rows = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.settled).toBe(false);
    expect(rows[0]?.simulated).toBe(false);
    expect(rows[0]?.txHash).toBeNull();
    expect(Number(rows[0]?.amountUsd)).toBeCloseTo(0.01, 9);
  });

  it("charges a still-402 answer too — the money may well have moved", async () => {
    stubProbe402();
    paidBehaviour = async () => new Response("{}", { status: 402 });
    const { paidFetch: livePaidFetch } = await live();

    const c = ctx(0.25);
    await expect(livePaidFetch(c, req)).rejects.toThrow(/Could not pay/);
    expect(c.budget.spentUsd).toBeCloseTo(0.01, 9);
    expect(await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId))).toHaveLength(1);
  });

  it("charges nothing when the client threw before it ever signed", async () => {
    stubProbe402();
    signBeforeRetry = false;
    paidBehaviour = async () => {
      throw new Error("no default asset configured for network");
    };
    const { paidFetch: livePaidFetch } = await live();

    const c = ctx(0.25);
    await expect(livePaidFetch(c, req)).rejects.toThrow(/Could not pay/);
    expect(c.budget.spentUsd).toBe(0);
    expect(await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId))).toHaveLength(0);
  });

  /** The whole point of charging a failure: a retrying model cannot re-pay past the cap. */
  it("lets the per-run cap stop a source that keeps failing", async () => {
    stubProbe402();
    paidBehaviour = async () => new Response("nope", { status: 500 });
    const { paidFetch: livePaidFetch } = await live();

    const c = ctx(0.025);
    await expect(livePaidFetch(c, req)).rejects.toThrow(/responded 500/);
    await expect(livePaidFetch(c, req)).rejects.toThrow(/responded 500/);
    // Matched on the message, not the class: `vi.resetModules()` hands this describe a
    // second copy of `./types`, so the thrown `X402BudgetError` is a different
    // constructor than the one imported at the top of this file.
    await expect(livePaidFetch(c, req)).rejects.toThrow(/Data spend cap reached/);
    expect(c.budget.spentUsd).toBeCloseTo(0.02, 9);
  });

  it("caps the client at the quoted price and installs the domain correction before signing", async () => {
    stubProbe402();
    const { paidFetch: livePaidFetch } = await live();
    await livePaidFetch(ctx(0.25), req);

    // +5% of $0.01, so a resource that reprices upward on the retry is refused.
    expect(spendControls).toEqual({ maxAmountPerPayment: "$0.010500" });
    expect(registeredPolicies).toHaveLength(1);
    const [fixed] = registeredPolicies[0]!(1, [
      { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", extra: { name: "USDC", version: "2" } },
    ]) as Array<{ extra: Record<string, unknown> }>;
    expect(fixed?.extra).toEqual({ name: "USD Coin", version: "2" });
  });
});
