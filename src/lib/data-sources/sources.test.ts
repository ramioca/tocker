/**
 * Normalization tests for the six x402 sources added in the SOURCES workstream.
 *
 * Every one runs in `X402_MOCK=1`, so `paidFetch` returns the registry fixture and
 * writes a simulated payment row instead of touching the network or a wallet — which
 * means these assert exactly one thing: that the vendor payload we captured turns into
 * the normalized `{ summary, data, signals }` the model and the scorer consume.
 *
 * The fixtures are not invented shapes. Each mirrors what the service's own live 402
 * (`extensions.bazaar.info.output.example`), OpenAPI document or `llms.txt` says it
 * returns — see the header of each source file for which.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { newBudget, type AgentWalletRef, type X402Context } from "@/lib/x402/types";
import { DATA_SOURCES, getDataSource } from "./registry";
import { smartMoneyReading } from "@/lib/tokens/smart-money";
import emptyFlowFixture from "./fixtures/nansen-flow-intelligence-empty.json";
import flowFixture from "./fixtures/nansen-flow-intelligence.json";
import { parseGate402Launches } from "./gate402";
import { parseFlowIntelligence, parseNetflowBoard, smartMoneyEndpoint } from "./nansen";
import { parseSolEnrichLaunches } from "./solenrich";
import type { DataSource, NormalizedResult } from "./normalize";

const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

let db: Db;
let agentId: string;

const wallets: AgentWalletRef[] = [
  { chain: "solana", walletId: "paper_x_solana", address: "PaperSolAddress" },
  { chain: "base", walletId: "paper_x_base", address: "0xpaper" },
];

function ctx(maxUsd = 5): X402Context {
  return { agentId, runId: null, mode: "paper", wallets, budget: newBudget(maxUsd) };
}

function source(id: string): DataSource {
  const found = getDataSource(id);
  if (!found) throw new Error(`registry is missing ${id}`);
  return found;
}

async function query(id: string, input: unknown, c = ctx()): Promise<NormalizedResult> {
  return source(id).query(c, input);
}

/** The newest simulated payment this test's agent made: its URL is the one really called. */
async function lastPayment() {
  const rows = await db
    .select()
    .from(schema.x402Payments)
    .where(eq(schema.x402Payments.agentId, agentId))
    .orderBy(desc(schema.x402Payments.createdAt))
    .limit(1);
  if (!rows[0]) throw new Error("no payment was recorded");
  return rows[0];
}

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
});

beforeEach(async () => {
  agentId = (await seedAgent(db)).agentId;
});

describe("registry entries", () => {
  /**
   * Price and network per source, as returned by a live 402 probe (no payment header)
   * on 2026-09-21. These are not decorative: `priceUsd` is what mock mode bills against
   * the run budget, and `network` is what picks the platform wallet that pays.
   */
  const expected = [
    ["dripmetrics-summary", "eip155:8453", 0.25, false],
    ["dripmetrics-metric", "eip155:8453", 0.05, false],
    // The headline price is the per-token read's (probed 2026-10-08: `amount: "10000"`).
    // Its boards still cost $0.05, charged per call like execution-impact below.
    ["nansen-smart-money", "eip155:8453", 0.01, false],
    ["gate402-base-radar", "eip155:8453", 0.02, false],
    ["plexa-pretrade", "eip155:8453", 0.05, false],
    ["solenrich-launches", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", 0.012, true],
    ["otto-pulse", "eip155:8453", 0.001, true],
    // W7: the vendor raised this from $0.005; the 402 says `amount: "6000"`.
    ["x-search", "eip155:8453", 0.006, false],
    ["deepnets-token-safety", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", 0.01, false],
    // Experimental until one payment to it settles — its 402 advertises the wrong
    // EIP-712 domain name and `paidFetch`'s correction is unproven against the facilitator.
    ["sentimentalpha", "eip155:8453", 0.01, true],
  ] as const;

  it.each(expected)("registers %s on %s at $%s", (id, network, priceUsd, experimental) => {
    const s = source(id);
    expect(s.network).toBe(network);
    expect(s.priceUsd).toBe(priceUsd);
    expect(s.experimental).toBe(experimental);
  });

  /**
   * Three entries shipped a fixture against an endpoint that no longer answers, which is
   * indistinguishable from data once `X402_MOCK` is off. Re-probed 2026-09-21:
   * token-intel-sol 503, rugmunch 404, xquik-search 404.
   */
  it.each(["token-intel-sol", "rugmunch", "xquik-search"])("no longer registers %s", (id) => {
    expect(getDataSource(id)).toBeUndefined();
  });

  /** Nothing may claim to return a fixture: that is only true under X402_MOCK=1. */
  it("does not describe any source as returning a fixture", () => {
    for (const s of DATA_SOURCES) expect(s.description.toLowerCase()).not.toContain("fixture");
  });
});

describe("dripmetrics-summary", () => {
  it("maps buy/sell imbalance onto sentiment and excess VPIN onto risk", async () => {
    const result = await query("dripmetrics-summary", { pair: "BTC-USD", window: "30m" });
    // Fixture: buySellImbalance -0.14, momentumLogReturn -0.0021, vpinExcess 0.24.
    expect(result.signals?.sentiment).toBeCloseTo(-0.14, 9);
    expect(result.signals?.velocity).toBeCloseTo(-0.105, 9);
    expect(result.signals?.risk).toBeCloseTo(0.24, 9);
    expect(result.summary).toContain("sell-leaning");
  });
});

describe("dripmetrics-metric", () => {
  it("turns a bounded metric into the axis it actually measures", async () => {
    const result = await query("dripmetrics-metric", { metric: "buy-sell-volume-imbalance", pair: "SOLUSDT" });
    expect(result.signals?.sentiment).toBeCloseTo(0.18, 9);
    expect(result.summary).toContain("buy-sell-volume-imbalance");
  });

  it("leaves cvd as data, because its units are unbounded and pair-relative", async () => {
    const result = await query("dripmetrics-metric", { metric: "cvd", pair: "SOLUSDT" });
    expect(result.signals).toBeUndefined();
  });

  it("charges the real $0.25 for execution-impact, not the registry's headline $0.05", async () => {
    const c = ctx();
    await query("dripmetrics-metric", { metric: "orderbook/execution-impact", pair: "SOLUSDT", side: "buy" }, c);
    expect(c.budget.spentUsd).toBeCloseTo(0.25, 9);
  });

  it("refuses execution-impact without a side", async () => {
    await expect(query("dripmetrics-metric", { metric: "orderbook/execution-impact" })).rejects.toThrow();
  });
});

describe("nansen-smart-money: the boards", () => {
  it("picks a token out of the board and reports its netflow in dollars", async () => {
    const result = await query("nansen-smart-money", {
      endpoint: "netflow",
      chains: ["solana"],
      tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    });
    expect(result.signals?.smartMoneyNetflowUsd).toBeCloseTo(1_284_310.22, 6);
    expect(result.signals?.sentiment ?? 0).toBeGreaterThan(0.9);
    expect(result.summary).toContain("accumulated");
  });

  it("reads the window the caller asked for", async () => {
    const result = await query("nansen-smart-money", { chains: ["solana"], symbol: "WIF", window: "1h" });
    expect(result.signals?.smartMoneyNetflowUsd).toBeCloseTo(-12_044.1, 6);
    expect(result.signals?.sentiment ?? 0).toBeLessThan(0);
    expect(result.summary).toContain("distributed");
  });

  it("reports a token that is not on the board as absent, never as a netflow of zero", async () => {
    const result = await query("nansen-smart-money", {
      endpoint: "netflow",
      chains: ["solana"],
      tokenAddress: "NotOnTheBoard1111111",
    });
    expect(result.signals).toBeUndefined();
    expect(result.summary).toContain("No tracked smart-money");
  });

  it("still costs five cents, and is what a call with no token address buys", async () => {
    for (const input of [{ chains: ["solana"] }, { endpoint: "netflow", chains: ["base"] }, { chains: ["solana", "base"], symbol: "BONK" }]) {
      const c = ctx();
      await query("nansen-smart-money", input, c);
      expect(c.budget.spentUsd, JSON.stringify(input)).toBeCloseTo(0.05, 9);
      expect((await lastPayment()).url, JSON.stringify(input)).toBe("https://api.nansen.ai/api/v1/smart-money/netflow");
    }
  });

  /**
   * The retired read was a board bought to look one token up. A token address with no
   * endpoint named is the per-token read or nothing: where that read cannot answer
   * (several chains, a thirty-day window) the call is refused, and no board is bought
   * in its place.
   */
  it("is never what a token address falls back to", async () => {
    const c = ctx();
    await expect(query("nansen-smart-money", { chains: ["solana", "base"], tokenAddress: BONK_MINT }, c)).rejects.toThrow(
      "nansen-smart-money: the per-token read (endpoint 'token') needs tokenAddress and exactly one chain, the one the token is on",
    );
    await expect(query("nansen-smart-money", { chains: ["solana"], tokenAddress: BONK_MINT, window: "30d" }, c)).rejects.toThrow(
      "nansen-smart-money: the per-token read (endpoint 'token') covers window 1h, 24h or 7d, not 30d",
    );
    expect(c.budget.spentUsd).toBe(0);

    // Asked for by name, the board lookup is still there, thirty days included.
    const named = await query("nansen-smart-money", { endpoint: "netflow", chains: ["solana"], tokenAddress: BONK_MINT, window: "30d" }, c);
    expect(named.summary).toContain("over 30d");
    expect(c.budget.spentUsd).toBeCloseTo(0.05, 9);
  });

  it("says which endpoint a model's parameters would buy, before anything is paid", () => {
    expect(smartMoneyEndpoint({ chains: ["solana"], tokenAddress: BONK_MINT })).toBe("token");
    expect(smartMoneyEndpoint({ chains: ["solana", "base"], tokenAddress: BONK_MINT })).toBe("token");
    expect(smartMoneyEndpoint({ chains: ["solana"], tokenAddress: BONK_MINT, window: "30d" })).toBe("token");
    expect(smartMoneyEndpoint({ endpoint: "token", chains: ["solana"] })).toBe("token");
    expect(smartMoneyEndpoint({ chains: ["solana"] })).toBe("netflow");
    expect(smartMoneyEndpoint({ chains: ["solana"], symbol: "STONK" })).toBe("netflow");
    expect(smartMoneyEndpoint({ endpoint: "netflow", chains: ["solana"], tokenAddress: BONK_MINT })).toBe("netflow");
    expect(smartMoneyEndpoint({ endpoint: "holdings", chains: ["base"] })).toBe("holdings");
    expect(smartMoneyEndpoint({ endpoint: "dex-trades", chains: ["base"] })).toBe("dex-trades");
    // Not this source's parameters: no endpoint, and the query refuses them unpaid.
    for (const junk of [null, undefined, "netflow", {}, { chains: [] }, { endpoint: "board", chains: ["solana"] }, { chains: ["tron"] }]) {
      expect(smartMoneyEndpoint(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it("turns the board into rows the smart money feed can use", async () => {
    const result = await query("nansen-smart-money", { endpoint: "netflow", chains: ["solana"] });
    const rows = parseNetflowBoard(result.data);
    expect(rows.map((row) => `${row.symbol} ${row.chain} ${row.netflow24hUsd}`)).toEqual([
      "BONK solana 1284310.22",
      "KNOTS solana 412650.4",
      "WIF solana -318200.75",
      "BRETT base 96410.8",
    ]);
    // A row on a chain the platform does not trade, or with no address or no flow, is not a row.
    expect(
      parseNetflowBoard({
        data: [
          { token_address: "0xabc", token_symbol: "PEPE", chain: "ethereum", net_flow_24h_usd: 5 },
          { token_symbol: "NOADDR", chain: "solana", net_flow_24h_usd: 5 },
          { token_address: "Mint1", token_symbol: "NOFLOW", chain: "solana" },
          "not a row",
        ],
      }),
    ).toEqual([]);
    for (const junk of [null, undefined, "text", 7, [], {}, { data: "nope" }]) expect(parseNetflowBoard(junk)).toEqual([]);
  });
});

describe("nansen-smart-money: the per-token read", () => {
  const TOKEN_URL = "https://api.nansen.ai/api/v1/tgm/flow-intelligence";

  /** The request `paidFetch` is handed, captured from a real call in mock mode. */
  async function requestFor(input: unknown) {
    const paidFetchModule = await import("@/lib/x402/paidFetch");
    const spy = vi.spyOn(paidFetchModule, "paidFetch");
    try {
      const c = ctx();
      const result = await query("nansen-smart-money", input, c);
      const request = spy.mock.calls.at(-1)?.[1];
      if (!request) throw new Error("the source never reached paidFetch");
      return { request, result, spentUsd: c.budget.spentUsd, payment: await lastPayment() };
    } finally {
      spy.mockRestore();
    }
  }

  it("names the token in the request, for a Solana token and a Base one, at one cent", async () => {
    const solana = await requestFor({ endpoint: "token", chains: ["solana"], tokenAddress: BONK_MINT });
    expect(solana.request).toMatchObject({ url: TOKEN_URL, method: "POST", priceUsd: 0.01 });
    expect(solana.request.body).toEqual({ chain: "solana", token_address: BONK_MINT, timeframe: "1d" });
    expect(solana.spentUsd).toBeCloseTo(0.01, 9);
    expect(solana.payment).toMatchObject({ url: TOKEN_URL, amountUsd: "0.010000", sourceId: "nansen-smart-money" });

    const base = await requestFor({ endpoint: "token", chains: ["base"], tokenAddress: BRETT });
    expect(base.request).toMatchObject({ url: TOKEN_URL, method: "POST", priceUsd: 0.01 });
    expect(base.request.body).toEqual({ chain: "base", token_address: BRETT, timeframe: "1d" });
    expect(base.spentUsd).toBeCloseTo(0.01, 9);
    expect(base.payment).toMatchObject({ url: TOKEN_URL, amountUsd: "0.010000" });
  });

  it("is what a call with a token and its one chain buys, without being asked for by name", async () => {
    const { request, spentUsd } = await requestFor({ chains: ["solana"], tokenAddress: BONK_MINT });
    expect(request.url).toBe(TOKEN_URL);
    expect(spentUsd).toBeCloseTo(0.01, 9);
  });

  it("reports smart traders plus top-PnL wallets as the net flow, and says the read in one line", async () => {
    const result = await query("nansen-smart-money", { endpoint: "token", chains: ["solana"], tokenAddress: BONK_MINT });
    // Fixture: smart_trader 9260.1 + top_pnl 3150.4.
    expect(result.signals?.smartMoneyNetflowUsd).toBeCloseTo(12_410.5, 6);
    expect(result.signals?.sentiment ?? 0).toBeGreaterThan(0);
    expect(result.summary).toBe(
      "Smart money, last 24h: 3 smart traders and 1 top-PnL wallet net bought $12.4k. Whales net sold $2.1k; fresh wallets net bought $40.2k; exchange net flow -$18.4k.",
    );
  });

  it("answers a token nobody tracked has traded with no signal, never a netflow of zero", async () => {
    const result = await query("nansen-smart-money", { endpoint: "token", chains: ["solana"], tokenAddress: "NobodyTradedThis1111" });
    expect(result.signals).toBeUndefined();
    expect(result.summary).toBe("Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it.");
  });

  it("asks for the window it was given, and refuses the one the read does not have", async () => {
    const hour = await requestFor({ endpoint: "token", chains: ["base"], tokenAddress: BRETT, window: "1h" });
    expect(hour.request.body).toEqual({ chain: "base", token_address: BRETT, timeframe: "1h" });
    expect(hour.result.summary).toContain("Smart money, last 1h:");
    const week = await requestFor({ endpoint: "token", chains: ["base"], tokenAddress: BRETT, window: "7d" });
    expect(week.request.body).toEqual({ chain: "base", token_address: BRETT, timeframe: "7d" });

    const c = ctx();
    await expect(query("nansen-smart-money", { endpoint: "token", chains: ["solana"], tokenAddress: BONK_MINT, window: "30d" }, c)).rejects.toThrow(/not 30d/);
    await expect(query("nansen-smart-money", { endpoint: "token", chains: ["solana"] }, c)).rejects.toThrow(/tokenAddress and exactly one chain/);
    await expect(query("nansen-smart-money", { endpoint: "token", chains: ["solana", "base"], tokenAddress: BONK_MINT }, c)).rejects.toThrow(/exactly one chain/);
    // Refused before anything was paid.
    expect(c.budget.spentUsd).toBe(0);
  });
});

describe("parseFlowIntelligence", () => {
  const NONE = { netFlowUsd: null, wallets: null };

  it("reads a full row, group by group", () => {
    expect(parseFlowIntelligence(flowFixture)).toEqual({
      smartTraders: { netFlowUsd: 9260.1, wallets: 3 },
      topPnl: { netFlowUsd: 3150.4, wallets: 1 },
      whales: { netFlowUsd: -2104.75, wallets: 2 },
      freshWallets: { netFlowUsd: 40210.6, wallets: 0 },
      publicFigures: { netFlowUsd: 0, wallets: 0 },
      exchanges: { netFlowUsd: -18400, wallets: 0 },
    });
  });

  it("reads an empty answer as a read with nothing in it", () => {
    const read = parseFlowIntelligence(emptyFlowFixture);
    expect(read).toEqual({ smartTraders: NONE, topPnl: NONE, whales: NONE, freshWallets: NONE, publicFigures: NONE, exchanges: NONE });
    expect(read && smartMoneyReading(read)).toBeNull();
    expect(parseFlowIntelligence({ data: [], warnings: ["fresh_wallets fields are null for this timeframe"] })).toEqual(read);
  });

  it("keeps a null as a null, and still reads the numbers beside it", () => {
    const read = parseFlowIntelligence({
      data: [
        {
          smart_trader_net_flow_usd: 5000,
          smart_trader_wallet_count: 2,
          top_pnl_net_flow_usd: null,
          top_pnl_wallet_count: null,
          whale_net_flow_usd: null,
          whale_wallet_count: null,
          fresh_wallets_net_flow_usd: null,
          fresh_wallets_wallet_count: null,
          public_figure_net_flow_usd: null,
          exchange_net_flow_usd: "-250.5",
        },
      ],
    });
    expect(read).toEqual({
      smartTraders: { netFlowUsd: 5000, wallets: 2 },
      topPnl: NONE,
      whales: NONE,
      freshWallets: NONE,
      publicFigures: NONE,
      // A number sent as a string is still that number.
      exchanges: { netFlowUsd: -250.5, wallets: null },
    });
    expect(read && smartMoneyReading(read)).toEqual({ netflowUsd: 5000, wallets: 2 });

    // Every field null: the documented row, with nothing in it.
    const blank = parseFlowIntelligence({ data: [{ smart_trader_net_flow_usd: null, top_pnl_net_flow_usd: null, whale_net_flow_usd: null }] });
    expect(blank).not.toBeNull();
    expect(blank && smartMoneyReading(blank)).toBeNull();
  });

  it("reads zero counts and zero flows as no reading, not as a flow of zero", () => {
    const read = parseFlowIntelligence({
      data: [
        {
          smart_trader_net_flow_usd: 0,
          smart_trader_wallet_count: 0,
          top_pnl_net_flow_usd: 0,
          top_pnl_wallet_count: 0,
          whale_net_flow_usd: -900,
          whale_wallet_count: 1,
        },
      ],
    });
    expect(read?.smartTraders).toEqual({ netFlowUsd: 0, wallets: 0 });
    expect(read?.whales).toEqual({ netFlowUsd: -900, wallets: 1 });
    expect(read && smartMoneyReading(read)).toBeNull();
  });

  it("returns null, and never throws, for an answer that is not the documented shape", () => {
    const unreadable: unknown[] = [
      null,
      undefined,
      "Payment required",
      42,
      [],
      {},
      { text: "<html>502 Bad Gateway</html>" },
      { error: "invalid_field_value", message: "chain" },
      { data: null },
      { data: "none" },
      { data: { smart_trader_net_flow_usd: 5 } },
      { data: [null] },
      { data: ["row"] },
      { data: [[1, 2, 3]] },
      { data: [{ token_address: "x", net_flow_24h_usd: 5 }] },
      // Wallets counted and no flow beside them: there is no number, and "nobody" would be false.
      { data: [{ smart_trader_wallet_count: 3, top_pnl_wallet_count: 1 }] },
    ];
    for (const answer of unreadable) {
      expect(() => parseFlowIntelligence(answer), JSON.stringify(answer)).not.toThrow();
      expect(parseFlowIntelligence(answer), JSON.stringify(answer)).toBeNull();
    }
  });

  /**
   * Nobody has seen a paid answer. If the documented fields arrive holding something that
   * is not a number, "no number" beside a zero count would be said to the model as "no
   * tracked wallet traded it", which nothing in such an answer supports.
   */
  it("returns null when a smart trader or top-PnL field is there and is not a number", () => {
    const row = { smart_trader_net_flow_usd: 0, smart_trader_wallet_count: 0, top_pnl_net_flow_usd: 0, top_pnl_wallet_count: 0 };
    const notNumbers: unknown[] = ["", "   ", "$5,210", "n/a", "NaN", "Infinity", true, false, [5], {}, { value: 5 }, Number.NaN, Number.POSITIVE_INFINITY];
    for (const field of Object.keys(row)) {
      for (const value of notNumbers) {
        const answer = { data: [{ ...row, [field]: value }] };
        expect(() => parseFlowIntelligence(answer), `${field} = ${String(value)}`).not.toThrow();
        expect(parseFlowIntelligence(answer), `${field} = ${String(value)}`).toBeNull();
      }
    }
    // The two answers a reviewer was told "no tracked wallet traded it" for.
    expect(
      parseFlowIntelligence({ data: [{ smart_trader_net_flow_usd: "", smart_trader_wallet_count: "", top_pnl_net_flow_usd: "", top_pnl_wallet_count: "" }] }),
    ).toBeNull();
    expect(
      parseFlowIntelligence({ data: [{ smart_trader_net_flow_usd: true, smart_trader_wallet_count: [2], top_pnl_net_flow_usd: [5], top_pnl_wallet_count: {} }] }),
    ).toBeNull();

    // A number written out is still that number, and null or absent is still "no number".
    const written = parseFlowIntelligence({ data: [{ ...row, smart_trader_net_flow_usd: "5210.5", smart_trader_wallet_count: "2" }] });
    expect(written?.smartTraders).toEqual({ netFlowUsd: 5210.5, wallets: 2 });
    expect(parseFlowIntelligence({ data: [{ smart_trader_net_flow_usd: null, top_pnl_wallet_count: null, whale_net_flow_usd: 12 }] })).not.toBeNull();
    // Only those four are held to it: a context field this cannot read is left out, no more.
    const context = parseFlowIntelligence({ data: [{ ...row, smart_trader_net_flow_usd: 700, smart_trader_wallet_count: 1, whale_net_flow_usd: "n/a" }] });
    expect(context?.whales.netFlowUsd).toBeNull();
    expect(context && smartMoneyReading(context)).toEqual({ netflowUsd: 700, wallets: 1 });
  });
});

describe("gate402-base-radar", () => {
  it("normalizes the launch radar into PaidLaunch rows", async () => {
    const result = await query("gate402-base-radar", { mode: "launches", minLiquidityUsd: 5_000 });
    const launches = parseGate402Launches(result.data);
    expect(launches).toHaveLength(3);
    const first = launches[0];
    expect(first?.chain).toBe("base");
    expect(first?.symbol).toBe("NEWCOIN");
    // gate402 prints prices as strings; they must arrive as numbers.
    expect(first?.priceUsd).toBeCloseTo(0.0004, 9);
    expect(first?.ageHours).toBeCloseTo(0.3, 9);
    expect(first?.volume24hUsd).toBe(6_200);
  });

  it("reads buy pressure as sentiment and a passed honeypot check as sellable", async () => {
    const result = await query("gate402-base-radar", {
      mode: "momentum",
      address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
    });
    // 74% of 1h trades were buys → (74-50)/50.
    expect(result.signals?.sentiment).toBeCloseTo(0.48, 9);
    expect(result.signals?.velocity).toBeCloseTo(0.6, 9);
    expect(result.signals?.sellable).toBe(true);
    expect(result.summary).toContain("Honeypot check: passed");
  });

  it("refuses momentum without an address", async () => {
    await expect(query("gate402-base-radar", { mode: "momentum" })).rejects.toThrow();
  });
});

describe("plexa-pretrade", () => {
  it("reads a concluded clear verdict as sellable", async () => {
    const result = await query("plexa-pretrade", {
      token: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed",
      sizeUsd: 100,
    });
    expect(result.signals?.sellable).toBe(true);
    expect(result.signals?.risk).toBeCloseTo(0.35, 9); // clear 0.3 + medium confidence 0.05
    expect(result.summary).toContain("Exit liquidity reachable");
  });

  it("rejects an address that is not an EVM contract", async () => {
    await expect(query("plexa-pretrade", { token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" })).rejects.toThrow();
  });
});

describe("solenrich-launches", () => {
  it("normalizes new-tokens into PaidLaunch rows on Solana", async () => {
    const result = await query("solenrich-launches", { mode: "launches", minLiquidityUsd: 15_000 });
    const launches = parseSolEnrichLaunches(result.data);
    expect(launches).toHaveLength(3);
    expect(launches[0]?.chain).toBe("solana");
    expect(launches[0]?.symbol).toBe("PLNK");
    expect(launches[0]?.liquidityUsd).toBe(82_400);
    expect(launches[0]?.ageHours).toBeCloseTo(1.6, 9);
    // The mean of the fixture's 0.18 / 0.32 / 0.47 risk scores.
    expect(result.signals?.risk).toBeCloseTo(0.3233, 3);
  });

  it("prefers the service's own prose when `format: both` returns it", async () => {
    const result = await query("solenrich-launches", { mode: "launches" });
    expect(result.summary).toContain("Three Solana launches");
  });

  it("refuses mode 'token' without a mint", async () => {
    await expect(query("solenrich-launches", { mode: "token" })).rejects.toThrow();
  });
});

describe("otto-pulse", () => {
  it("reads sentiment through the { status, data } envelope", async () => {
    const result = await query("otto-pulse", { mode: "pulse" });
    expect(result.signals?.sentiment).toBeCloseTo(0.42, 9);
    expect(result.summary).toContain("solana memecoin rotation");
  });

  it("falls back to the sentiment word when no score is present", async () => {
    const result = await query("otto-pulse", { mode: "recap" });
    expect(result.signals?.sentiment).toBe(0); // "neutral"
    expect(result.summary).toContain("Exchange lists three Solana memecoins");
  });

  it("charges $0.003 for the recap and $0.001 for the pulse", async () => {
    const c = ctx();
    await query("otto-pulse", { mode: "pulse" }, c);
    expect(c.budget.spentUsd).toBeCloseTo(0.001, 9);
    await query("otto-pulse", { mode: "recap" }, c);
    expect(c.budget.spentUsd).toBeCloseTo(0.004, 9);
  });
});

describe("payable chains (W7)", () => {
  it("derives every chain a source can be paid on from its probed networks", async () => {
    const { getDataSource, dataChainsFor, unpayableSources, sourcesPayableOn } = await import("./registry");
    expect(getDataSource("deepnets-token-safety")?.chains).toEqual(["solana"]);
    expect(getDataSource("x-search")?.chains).toEqual(["base"]);
    expect(getDataSource("cmc-quotes")?.chains).toEqual(["base"]);
    for (const id of ["nansen-smart-money", "otto-pulse", "plexa-pretrade", "solenrich-launches"]) {
      expect(getDataSource(id)?.chains, id).toEqual(["base", "solana"]);
    }

    // A Solana-only agent with a Base-and-Solana source needs only the Solana wallet.
    expect(dataChainsFor(["plexa-pretrade", "deepnets-token-safety"], ["solana"])).toEqual(["solana"]);
    // A Base-only source stays a Base wallet requirement whatever the agent trades.
    expect(dataChainsFor(["x-search"], ["solana"])).toEqual(["base"]);
    // Without agent chains, every chain a source could be paid on counts.
    expect(dataChainsFor(["plexa-pretrade"])).toEqual(["base", "solana"]);

    expect(unpayableSources(["x-search", "deepnets-token-safety"], ["solana"]).map((s) => s.id)).toEqual([
      "x-search",
    ]);
    expect(unpayableSources(["x-search"], ["base", "solana"])).toEqual([]);

    const solanaOnly = sourcesPayableOn(["solana"]).map((s) => s.id);
    expect(solanaOnly).toContain("deepnets-token-safety");
    expect(solanaOnly).toContain("plexa-pretrade");
    expect(solanaOnly).not.toContain("x-search");
    expect(solanaOnly).not.toContain("cmc-quotes");
  });
});

describe("no open-ended source", () => {
  it("has no source whose URL the model chooses, and drops a config that still names one", async () => {
    const { DATA_SOURCES, getDataSource, resolveDataSources, dataChainsFor } = await import("./registry");
    expect(getDataSource("bazaar")).toBeUndefined();
    expect(resolveDataSources(["bazaar", "x-search"]).map((s) => s.id)).toEqual(["x-search"]);
    expect(dataChainsFor(["bazaar"])).toEqual([]);
    // No input schema asks the model for a URL or a host.
    for (const source of DATA_SOURCES) {
      const fields = Object.keys((source.inputSchema as { shape?: Record<string, unknown> }).shape ?? {});
      expect(fields.filter((f) => /url|host|endpointurl|resource/i.test(f)), source.id).toEqual([]);
    }
  });

  /**
   * One minimal valid input per source and per mode. The registry `url` is a display
   * field; this is what each `query()` really fetches, so a source that calls a host
   * other than its own, or a new mode nobody listed here, fails this test rather than
   * failing closed in production.
   */
  const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
  const ERC20 = `0x${"1".repeat(40)}`;
  const CALLS: Array<[id: string, input: unknown]> = [
    ["x-search", { query: "BONK" }],
    ["sentimentalpha", { query: "BONK" }],
    ["cmc-quotes", { symbols: ["SOL"] }],
    ["cmc-dex-search", { query: "bonk" }],
    ["deepnets-token-safety", { mint: BONK }],
    ...["market-overview", "funding-rates", "volatility", "prices", "correlation", "liquidation-levels"].map(
      (endpoint): [string, unknown] => ["agentdata", { endpoint }],
    ),
    ...["netflow", "holdings", "dex-trades"].map((endpoint): [string, unknown] => ["nansen-smart-money", { endpoint, chains: ["solana"] }]),
    ["nansen-smart-money", { endpoint: "token", chains: ["solana"], tokenAddress: BONK }],
    ["nansen-smart-money", { endpoint: "token", chains: ["base"], tokenAddress: ERC20 }],
    ["plexa-pretrade", { token: ERC20 }],
    ["gate402-base-radar", { mode: "launches" }],
    ["gate402-base-radar", { mode: "momentum", address: ERC20 }],
    ["solenrich-launches", { mode: "launches" }],
    ["solenrich-launches", { mode: "token", mint: BONK }],
    ["solenrich-launches", { mode: "ask", question: "what launched today?" }],
    ["dripmetrics-summary", {}],
    ...["buy-sell-volume-imbalance", "cvd", "amihud-illiquidity", "realized-vol", "momentum"].map(
      (metric): [string, unknown] => ["dripmetrics-metric", { metric }],
    ),
    ["dripmetrics-metric", { metric: "orderbook/execution-impact", side: "buy" }],
    ["otto-pulse", { mode: "pulse" }],
    ["otto-pulse", { mode: "recap" }],
  ];

  it("every source, in every mode, fetches a host on the paid-URL allowlist", async () => {
    const { DATA_SOURCES } = await import("./registry");
    const { PAID_HOSTS, checkPaidUrl } = await import("@/lib/x402/url-policy");
    const paid = () => db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));

    const hostsCalled = new Set<string>();
    const seen = new Set<string>();
    for (const [id, input] of CALLS) {
      const before = (await paid()).length;
      // What the normalizer makes of the fixture is other tests' business; this one is
      // about the request, and the simulated payment row carries its URL.
      await query(id, input).catch(() => undefined);
      const rows = await paid();
      expect(rows.length, `${id} ${JSON.stringify(input)} never reached paidFetch`).toBe(before + 1);
      const row = rows.find((r) => !seen.has(r.id));
      for (const r of rows) seen.add(r.id);
      expect(row?.sourceId, JSON.stringify(input)).toBe(id);
      expect(checkPaidUrl(row?.url ?? ""), `${id} ${row?.url}`).toBeNull();
      hostsCalled.add(new URL(row?.url ?? "").hostname);
    }

    // Every registry source was driven, and the list names exactly the hosts they call.
    expect([...new Set(CALLS.map(([id]) => id))].sort()).toEqual(DATA_SOURCES.map((s) => s.id).sort());
    expect([...hostsCalled].sort()).toEqual([...PAID_HOSTS].sort());
  });

  it("keeps the paid-URL allowlist in step with the registry", async () => {
    const { DATA_SOURCES } = await import("./registry");
    const { PAID_HOSTS, checkPaidUrl } = await import("@/lib/x402/url-policy");
    const registryHosts = new Set(DATA_SOURCES.map((source) => new URL(source.url).hostname));
    for (const source of DATA_SOURCES) expect(checkPaidUrl(source.url), source.id).toBeNull();
    // Nothing on the list that no source uses: a retired vendor's host comes off it.
    expect([...PAID_HOSTS].sort()).toEqual([...registryHosts].sort());
  });
});
