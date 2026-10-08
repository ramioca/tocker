import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { buyCostUsd, feeForFill, maxBuyUsd } from "@/lib/platform/fee";
import type { AgentConfig } from "@/db/schema";
import type { ScoreComponents, TokenScore } from "@/server/types";
import { isBlocklisted, riskGuard, universeGate, type OrderIntent, type RiskAgent, type RiskPortfolio } from "./risk";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

function agentWith(config: Partial<AgentConfig> = {}): RiskAgent {
  return {
    id: "agent-1",
    mode: "paper",
    config: {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
      universe: { ...DEFAULT_AGENT_CONFIG.universe, ...config.universe },
      risk: { ...DEFAULT_AGENT_CONFIG.risk, ...config.risk },
    },
  };
}

function portfolio(overrides: Partial<RiskPortfolio> = {}): RiskPortfolio {
  return {
    cashUsd: 10_000,
    equityUsd: 10_000,
    positions: [],
    tradesToday: 0,
    ...overrides,
  };
}

const buy: OrderIntent = {
  chain: "solana",
  side: "buy",
  tokenId: `solana:${BONK}`,
  tokenAddress: BONK,
  symbol: "BONK",
  amountUsd: 50,
};

/** A clean score comfortably above the default `minScore` of 62. */
function scoreWith(overrides: Partial<TokenScore> = {}): TokenScore {
  const components: ScoreComponents = {
    safety: 90,
    liquidity: 95,
    organic: 80,
    distribution: 85,
    momentum: 60,
    gecko: null,
    sentiment: null,
    smartMoney: null,
    ...overrides.components,
  };
  return {
    tokenId: `solana:${BONK}`,
    chain: "solana",
    address: BONK,
    symbol: "BONK",
    name: "Bonk",
    total: 84,
    verdict: "strong",
    blockers: [],
    warnings: [],
    priceUsd: 0.0000027,
    liquidityUsd: 996_795,
    volume24hUsd: 2_100_000,
    marketCapUsd: 242_000_000,
    holderCount: 1_015_279,
    ageHours: 20_000,
    priceChange24hPct: 3.6,
    sources: ["jupiter", "rugcheck"],
    scoredAt: new Date().toISOString(),
    ...overrides,
    components,
  };
}

describe("riskGuard", () => {
  it("allows a normal buy inside every limit with a clean score", () => {
    expect(riskGuard(agentWith(), portfolio(), buy, scoreWith())).toEqual({ ok: true });
  });

  it("rejects a non-positive size", () => {
    const verdict = riskGuard(agentWith(), portfolio(), { ...buy, amountUsd: 0 }, scoreWith());
    expect(verdict.ok).toBe(false);
  });

  it("rejects a chain the agent has not enabled", () => {
    const verdict = riskGuard(
      agentWith({ chains: ["solana"] }),
      portfolio(),
      { ...buy, chain: "base", tokenId: `base:${BRETT}`, tokenAddress: BRETT, symbol: "BRETT" },
      scoreWith({ chain: "base", address: BRETT, symbol: "BRETT" }),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("not enabled");
  });

  it("rejects a trade above maxTradeUsd", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 25 } }),
      portfolio(),
      buy,
      scoreWith(),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("maxTradeUsd");
  });

  it("rejects once the daily trade count is used up", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxDailyTrades: 3 } }),
      portfolio({ tradesToday: 3 }),
      buy,
      scoreWith(),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("Daily buy limit");
  });

  it("rejects a buy larger than available cash", () => {
    const verdict = riskGuard(agentWith(), portfolio({ cashUsd: 20, equityUsd: 20 }), buy, scoreWith());
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("Insufficient cash");
  });

  it("rejects a buy that would breach maxPositionPct", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 10 } }),
      portfolio({
        cashUsd: 1_000,
        equityUsd: 1_000,
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 1, valueUsd: 80 },
        ],
      }),
      buy,
      scoreWith(),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("maxPositionPct");
  });

  it("allows a buy exactly at maxPositionPct", () => {
    const verdict = riskGuard(
      agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 10 } }),
      portfolio({ cashUsd: 1_000, equityUsd: 1_000 }),
      { ...buy, amountUsd: 100 },
      scoreWith(),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects a sell with no position", () => {
    const verdict = riskGuard(agentWith(), portfolio(), { ...buy, side: "sell" }, scoreWith());
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("No BONK position");
  });

  it("rejects a sell larger than the position value", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 20 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 50 },
      scoreWith(),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("exceeds");
  });

  it("refuses to sell an unpriced position", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: null },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 5 },
      scoreWith(),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain("price");
  });

  it("allows a sell inside the position value", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 50 },
      scoreWith(),
    );
    expect(verdict).toEqual({ ok: true });
  });
});

describe("the universe gate (what replaced the allowlist)", () => {
  it("refuses a buy with no score at all — no score means no buy", () => {
    const verdict = riskGuard(agentWith(), portfolio(), buy, null);
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) {
      expect(verdict.reason).toContain("No score for BONK");
      expect(verdict.reason).toContain("score_token");
    }
  });

  it("refuses a buy when any hard gate fired, however high the total", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio(),
      buy,
      scoreWith({ total: 91, verdict: "avoid", blockers: ["mint_authority_active"] }),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) {
      expect(verdict.reason).toContain("mint_authority_active");
      // Blockers are explained in prose because this reaches the model and the UI.
      expect(verdict.reason).toContain("mint authority is still live");
    }
  });

  it("lists every blocker when several fired", () => {
    const verdict = universeGate(agentWith().config, buy, scoreWith({
      total: 12,
      verdict: "avoid",
      blockers: ["mint_authority_active", "top10_holders_90pct", "liquidity_below_floor"],
    }));
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) {
      expect(verdict.reason).toContain("top 10 holders control 90% of supply");
      expect(verdict.reason).toContain("liquidity is under the agent's floor");
    }
  });

  it("refuses a buy on verdict avoid even with no blockers", () => {
    const verdict = riskGuard(agentWith(), portfolio(), buy, scoreWith({ total: 31, verdict: "avoid" }));
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain('verdict "avoid"');
  });

  it("refuses a buy below the agent's minScore and shows the components", () => {
    const verdict = riskGuard(
      agentWith({ universe: { ...DEFAULT_AGENT_CONFIG.universe, minScore: 80 } }),
      portfolio(),
      buy,
      scoreWith({ total: 72.4, verdict: "candidate" }),
    );
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) {
      expect(verdict.reason).toContain("72.4/100");
      expect(verdict.reason).toContain("minScore of 80");
      expect(verdict.reason).toContain("safety 90");
    }
  });

  it("allows a buy exactly at minScore", () => {
    const verdict = riskGuard(
      agentWith({ universe: { ...DEFAULT_AGENT_CONFIG.universe, minScore: 62 } }),
      portfolio(),
      buy,
      scoreWith({ total: 62, verdict: "candidate" }),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("refuses to buy a blocklisted token but still lets the agent sell one it holds", () => {
    const blocked = agentWith({
      universe: {
        ...DEFAULT_AGENT_CONFIG.universe,
        blocklist: [{ chain: "solana", address: BONK, symbol: "BONK" }],
      },
    });
    const onBuy = riskGuard(blocked, portfolio(), buy, scoreWith());
    expect(onBuy).toMatchObject({ ok: false });
    if (!onBuy.ok) expect(onBuy.reason).toContain("blocklist");

    // Blocklisting a held token is how an operator says "get out" — it must not trap the position.
    const onSell = riskGuard(blocked, portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }), { ...buy, side: "sell", amountUsd: 20 }, scoreWith());
    expect(onSell).toEqual({ ok: true });
  });

  it("lets a full exit through even when it exceeds maxTradeUsd", () => {
    const verdict = riskGuard(agentWith(), portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }), { ...buy, side: "sell", amountUsd: 200 }, scoreWith());
    expect(verdict).toEqual({ ok: true });
  });

  it("lets the agent exit after the daily trade quota is used up, but not buy", () => {
    const busy = { tradesToday: DEFAULT_AGENT_CONFIG.risk.maxDailyTrades };
    const sell = riskGuard(agentWith(), portfolio({ ...busy, positions: portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }).positions }), { ...buy, side: "sell", amountUsd: 50 }, scoreWith());
    expect(sell).toEqual({ ok: true });
    const again = riskGuard(agentWith(), portfolio(busy), buy, scoreWith());
    expect(again).toMatchObject({ ok: false });
  });

  it("lets the agent exit a position on a chain that was switched off after buying", () => {
    const baseOnly = agentWith({ chains: ["base"] });
    const verdict = riskGuard(baseOnly, portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }), { ...buy, side: "sell", amountUsd: 50 }, scoreWith());
    expect(verdict).toEqual({ ok: true });
  });

  it("matches the blocklist case-insensitively on address", () => {
    const config = agentWith({
      universe: {
        ...DEFAULT_AGENT_CONFIG.universe,
        blocklist: [{ chain: "base", address: BRETT.toLowerCase(), symbol: "BRETT" }],
      },
    }).config;
    expect(isBlocklisted(config, "base", BRETT.toUpperCase(), "BRETT")).toBe(true);
    expect(isBlocklisted(config, "solana", BONK, "BONK")).toBe(false);
  });

  it("treats an empty blocklist as permissive — any token may be bought", () => {
    expect(isBlocklisted(agentWith().config, "solana", BONK, "BONK")).toBe(false);
  });

  it("does not score-gate sells, so a deteriorating token can always be exited", () => {
    const rugged = scoreWith({ total: 8, verdict: "avoid", blockers: ["liquidity_below_floor", "top10_holders_91pct"] });
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 200 },
      rugged,
    );
    expect(verdict).toEqual({ ok: true });
  });

  it("does not require a score to sell at all", () => {
    const verdict = riskGuard(
      agentWith(),
      portfolio({
        positions: [
          { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 200 },
        ],
      }),
      { ...buy, side: "sell", amountUsd: 50 },
      null,
    );
    expect(verdict).toEqual({ ok: true });
  });
});

/**
 * Sizing modes in the guard. The invariant under every case here is the same one the
 * module doc states: a mode can only ever *tighten* what `maxTradeUsd` already allows,
 * and none of it touches a sell.
 */
describe("position sizing", () => {
  function sizedAgent(sizing: Record<string, unknown>, maxTradeUsd = 1_000): RiskAgent {
    const agent = agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd } });
    // `sizing` is the additive W4 block on `risk`; see AgentRiskWithSizing in the schema.
    (agent.config.risk as unknown as Record<string, unknown>).sizing = sizing;
    return agent;
  }

  it("leaves an agent with no sizing block exactly where it was", () => {
    const agent = agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 100 } });
    expect(riskGuard(agent, portfolio(), { ...buy, amountUsd: 100 }, scoreWith())).toEqual({ ok: true });
    expect(riskGuard(agent, portfolio(), { ...buy, amountUsd: 100.01 }, scoreWith()).ok).toBe(false);
  });

  it("refuses a ticket above the percent-of-equity allowance, and explains the number", () => {
    const agent = sizedAgent({ mode: "percent_equity", percentOfEquity: 5, referenceRangePct: 25, minTradeUsd: 5 });
    const book = portfolio({ cashUsd: 10_000, equityUsd: 10_000 });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 500 }, scoreWith())).toEqual({ ok: true });
    const refused = riskGuard(agent, book, { ...buy, amountUsd: 501 }, scoreWith());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("percent equity");
      expect(refused.reason).toContain("$500.00");
    }
  });

  it("keeps maxTradeUsd as the hard cap when the percentage would allow more", () => {
    const agent = sizedAgent(
      { mode: "percent_equity", percentOfEquity: 90, referenceRangePct: 25, minTradeUsd: 5 },
      100,
    );
    const book = portfolio({ cashUsd: 1_000_000, equityUsd: 1_000_000 });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 100 }, scoreWith())).toEqual({ ok: true });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 150 }, scoreWith()).ok).toBe(false);
  });

  it("shrinks the allowance for a wide-ranging token under volatility scaling", () => {
    const agent = sizedAgent({ mode: "volatility_scaled", percentOfEquity: 10, referenceRangePct: 25, minTradeUsd: 5 });
    const book = portfolio({ cashUsd: 10_000, equityUsd: 10_000 });
    // 100% range against a 25% reference = quarter size: $1,000 → $250.
    expect(riskGuard(agent, book, { ...buy, amountUsd: 250, rangePct: 100 }, scoreWith())).toEqual({ ok: true });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 260, rangePct: 100 }, scoreWith()).ok).toBe(false);
    // A calm token keeps the full percent-of-equity clip.
    expect(riskGuard(agent, book, { ...buy, amountUsd: 1_000, rangePct: 10 }, scoreWith())).toEqual({ ok: true });
  });

  it("falls back to the 24h move when the caller measured no range", () => {
    const agent = sizedAgent({ mode: "volatility_scaled", percentOfEquity: 10, referenceRangePct: 25, minTradeUsd: 5 });
    const book = portfolio({ cashUsd: 10_000, equityUsd: 10_000 });
    const violent = scoreWith({ priceChange24hPct: -100 });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 250 }, violent)).toEqual({ ok: true });
    expect(riskGuard(agent, book, { ...buy, amountUsd: 400 }, violent).ok).toBe(false);
  });

  it("never lets a sizing mode block an exit", () => {
    const agent = sizedAgent({ mode: "percent_equity", percentOfEquity: 1, referenceRangePct: 25, minTradeUsd: 5 }, 10);
    const book = portfolio({
      cashUsd: 0,
      equityUsd: 5_000,
      tradesToday: 99,
      positions: [
        { tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 5_000 },
      ],
    });
    // $5,000 is five hundred times the sizing allowance. It is still a legal exit.
    expect(riskGuard(agent, book, { ...buy, side: "sell", amountUsd: 5_000 }, null)).toEqual({ ok: true });
  });
});

/**
 * The cash a buy needs is the ticket plus the fee on that ticket, and the fee is a share
 * of it. So the most cash C can buy is the largest A with A + fee(A) <= C: the figure the
 * model is told, the figure the guard holds it to and the figure the ledger then charges
 * all come from one sum, and they have to agree to the millionth of a dollar.
 */
describe("riskGuard: cash for the ticket and its fee", () => {
  afterEach(() => vi.unstubAllEnvs());

  // Nothing but cash can bind: no trade cap or concentration cap in the way.
  const agent = agentWith({ risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 10_000_000, maxPositionPct: 100 } });
  const withCash = (cashUsd: number) => portfolio({ cashUsd, equityUsd: Math.max(cashUsd, 10_000_000) });
  const tryBuy = (cashUsd: number, amountUsd: number) => riskGuard(agent, withCash(cashUsd), { ...buy, amountUsd }, scoreWith());

  it("passes a buy that, with its fee, empties the wallet exactly, and refuses a micro-dollar more", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    // $4.975125 pays $0.024875: $5.000000 in all.
    expect(buyCostUsd(4.975125, 50)).toBe(5);
    expect(tryBuy(5, 4.975125)).toEqual({ ok: true });
    expect(tryBuy(5, 4.975126)).toMatchObject({ ok: false, code: "cash" });
    // And the round figures: a $2.00 buy needs $2.01, a $100 buy needs $100.50.
    expect(tryBuy(2.01, 2)).toEqual({ ok: true });
    expect(tryBuy(2, 2)).toMatchObject({ ok: false, code: "cash" });
    expect(tryBuy(100.5, 100)).toEqual({ ok: true });
    expect(tryBuy(100.49, 100)).toMatchObject({ ok: false, code: "cash" });
  });

  it("agrees with the largest buy the cash covers, at every balance and rate tried", () => {
    let state = 7;
    const next = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    for (const bps of [25, 50, 100, 1000]) {
      vi.stubEnv("PLATFORM_FEE_BPS", String(bps));
      for (let i = 0; i < 400; i += 1) {
        const cash = (Math.floor(next() * (i % 2 === 0 ? 30_000_000 : 900_000_000_000)) + 1_000) / 1e6;
        const most = maxBuyUsd(cash, bps);
        expect(tryBuy(cash, most), `$${cash} at ${bps} bps`).toEqual({ ok: true });
        expect(tryBuy(cash, most + 0.000001), `$${cash} at ${bps} bps`).toMatchObject({ ok: false, code: "cash" });
      }
    }
  });

  it("holds a buy to the fee the ledger will charge on that fill", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    // Whatever passes leaves at least the fee behind: the fill is then charged
    // `feeForFill` of the same size, and the wallet covers it.
    for (const [cash, amount] of [[5, 4.97], [10, 9.95], [1, 0.99], [0.02, 0.01], [12_345.67, 12_284.24]] as const) {
      expect(tryBuy(cash, amount), `$${amount} of $${cash}`).toEqual({ ok: true });
      expect(amount + feeForFill(amount, 50)).toBeLessThanOrEqual(cash + 1e-9);
    }
  });

  it("tells the model the fee on this order, the rate, and the most that fits", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    // To the cent $4.98 against $5.00 reads as fitting. It needs $5.0049.
    expect(tryBuy(5, 4.98)).toEqual({
      ok: false,
      reason:
        "Insufficient cash: $5.00 available, $4.98 requested plus the $0.0249 Tocker fee (0.5% of the fill). The most this cash covers is a $4.97 buy.",
      code: "cash",
      params: { symbol: "BONK", amountUsd: 4.98, cashUsd: 5, feeUsd: 0.0249, feeBps: 50, maxBuyUsd: 4.97 },
    });
    // The figure it is told is one the guard passes.
    expect(tryBuy(5, 4.97)).toEqual({ ok: true });
    // Buying with all of one's cash, the commonest way to meet this refusal.
    const all = tryBuy(1, 1);
    expect(all.ok ? "" : all.reason).toBe(
      "Insufficient cash: $1.00 available, $1.00 requested plus the $0.005 Tocker fee (0.5% of the fill). The most this cash covers is a $0.99 buy.",
    );
    // Cash that is not whole cents is printed as it is, not rounded up to look like enough.
    const short = tryBuy(4.996, 4.98);
    expect(short.ok ? "" : short.reason).toContain("Insufficient cash: $4.996 available, $4.98 requested plus the $0.0249 Tocker fee");
  });

  it("says no most-that-fits when the cash does not come to a cent", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const verdict = tryBuy(0.004, 1);
    expect(verdict.ok ? "" : verdict.reason).toBe(
      "Insufficient cash: $0.004 available, $1.00 requested plus the $0.005 Tocker fee (0.5% of the fill).",
    );
  });

  it("follows the rate that is set", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "100");
    expect(tryBuy(101, 100)).toEqual({ ok: true });
    const refused = tryBuy(100.99, 100);
    expect(refused).toMatchObject({ ok: false, code: "cash", params: { feeUsd: 1, feeBps: 100, maxBuyUsd: 99.99 } });
    expect(refused.ok ? "" : refused.reason).toContain("plus the $1.00 Tocker fee (1% of the fill)");
  });

  it("asks for the ticket alone, in the words it always used, when the fee is off", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    expect(tryBuy(5, 5)).toEqual({ ok: true });
    expect(tryBuy(5, 5.01)).toEqual({
      ok: false,
      reason: "Insufficient cash: $5.00 available, $5.01 requested.",
      code: "cash",
      params: { symbol: "BONK", amountUsd: 5.01, cashUsd: 5, feeUsd: 0, feeBps: 0, maxBuyUsd: 5 },
    });
  });

  it("never refuses a sell for cash or for the fee, at any rate, with no cash at all", () => {
    const holding = portfolio({
      cashUsd: 0,
      equityUsd: 80,
      positions: [{ tokenId: `solana:${BONK}`, chain: "solana", address: BONK, symbol: "BONK", amountToken: 10, valueUsd: 80 }],
    });
    for (const bps of ["0", "50", "1000"]) {
      vi.stubEnv("PLATFORM_FEE_BPS", bps);
      // The whole position, and a slice of it: the fee is charged after the sale and
      // is never taken off the size that may be sold.
      expect(riskGuard(agent, holding, { ...buy, side: "sell", amountUsd: 80 }, null)).toEqual({ ok: true });
      expect(riskGuard(agent, holding, { ...buy, side: "sell", amountUsd: 0.01 }, null)).toEqual({ ok: true });
    }
  });
});
