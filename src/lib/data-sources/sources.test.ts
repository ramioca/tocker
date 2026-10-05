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
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { newBudget, type AgentWalletRef, type X402Context } from "@/lib/x402/types";
import { DATA_SOURCES, getDataSource } from "./registry";
import { parseGate402Launches } from "./gate402";
import { parseSolEnrichLaunches } from "./solenrich";
import type { DataSource, NormalizedResult } from "./normalize";

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
    ["nansen-smart-money", "eip155:8453", 0.05, false],
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

describe("nansen-smart-money", () => {
  it("picks the agent's token out of the board and reports its netflow in dollars", async () => {
    const result = await query("nansen-smart-money", {
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

  it("reports a token nobody tracked touched as absent, never as a netflow of zero", async () => {
    const result = await query("nansen-smart-money", { chains: ["solana"], tokenAddress: "NotOnTheBoard1111111" });
    expect(result.signals).toBeUndefined();
    expect(result.summary).toContain("No tracked smart-money");
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
