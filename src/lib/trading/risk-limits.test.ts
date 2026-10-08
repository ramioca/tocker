/**
 * The two limits an owner may switch on: `risk.maxOpenPositions` and `risk.cashReserveUsd`.
 *
 * Three things are held here. Each limit refuses exactly the buys it is meant to, to the
 * micro-dollar and with the words the owner and the model read. Neither ever touches a
 * sell. And an agent with neither set gets the answer it always got: `risk.test.ts` is
 * left as it was and still passes, and the last block here runs a grid of orders through
 * the guard with the fields absent, with them written out as off, and with the extra
 * portfolio fields present, and asks for the same verdict every time.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { buyCostUsd, floorToCents, maxBuyUsd } from "@/lib/platform/fee";
import type { AgentConfig, AgentRiskWithSizing } from "@/db/schema";
import type { ScoreComponents, TokenScore } from "@/server/types";
import { DUST_POSITION_USD } from "./dust";
import { readCashReserveUsd, readMaxOpenPositions, readSkipWhenFull } from "./hard-limits";
import {
  buyingCashUsd,
  opensPosition,
  positionRoom,
  riskGuard,
  roomToBuy,
  sizeCeiling,
  ticketCeiling,
  withoutWaitingBuys,
  type OrderIntent,
  type RiskAgent,
  type RiskPortfolio,
  type RiskPosition,
} from "./risk";
import { ownerRiskMessage } from "./risk-copy";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

type Risk = AgentConfig["risk"];

function agentWith(risk: Partial<Risk> = {}, config: Partial<AgentConfig> = {}): RiskAgent {
  return {
    id: "agent-1",
    mode: "paper",
    config: { ...DEFAULT_AGENT_CONFIG, ...config, risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 100, ...risk } },
  };
}

function portfolio(overrides: Partial<RiskPortfolio> = {}): RiskPortfolio {
  return { cashUsd: 10_000, equityUsd: 10_000, positions: [], tradesToday: 0, ...overrides };
}

function held(symbol: string, valueUsd: number | null = 100, amountToken = 10): RiskPosition {
  return { tokenId: `solana:${symbol}`, chain: "solana", address: symbol, symbol, amountToken, valueUsd };
}

function buyOf(symbol: string, amountUsd = 50): OrderIntent {
  return { chain: "solana", side: "buy", tokenId: `solana:${symbol}`, tokenAddress: symbol, symbol, amountUsd };
}

/** A clean score comfortably above the default `minScore`. */
function score(overrides: Partial<TokenScore> = {}): TokenScore {
  const components: ScoreComponents = {
    safety: 90,
    liquidity: 95,
    organic: 80,
    distribution: 85,
    momentum: 60,
    gecko: null,
    sentiment: null,
    smartMoney: null,
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
    scoredAt: "2026-10-08T00:00:00.000Z",
    components,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("reading the three settings off a stored config", () => {
  it("reads a config written before they existed as no limit, no reserve and no skipping", () => {
    const old = { ...DEFAULT_AGENT_CONFIG.risk } as Risk;
    delete old.maxOpenPositions;
    delete old.cashReserveUsd;
    expect(readMaxOpenPositions(old)).toBeNull();
    expect(readCashReserveUsd(old)).toBe(0);
    expect(readSkipWhenFull({ intervalMinutes: 15 })).toBe(false);
    expect(readMaxOpenPositions(null)).toBeNull();
    expect(readCashReserveUsd(undefined)).toBe(0);
    expect(readSkipWhenFull(undefined)).toBe(false);
  });

  it("reads what was set", () => {
    expect(readMaxOpenPositions({ ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: 3 })).toBe(3);
    expect(readMaxOpenPositions({ ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: null })).toBeNull();
    expect(readCashReserveUsd({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: 5 })).toBe(5);
    expect(readCashReserveUsd({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: 0 })).toBe(0);
    expect(readSkipWhenFull({ intervalMinutes: 15, skipWhenFull: true })).toBe(true);
    expect(readSkipWhenFull({ intervalMinutes: 15, skipWhenFull: false })).toBe(false);
  });

  /** The schema refuses these on a save, so only a row written some other way holds one. */
  it("never reads a number that should not be there as looser than it says", () => {
    const withLimit = (value: unknown) => ({ ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: value as number });
    expect(readMaxOpenPositions(withLimit(2.9))).toBe(2);
    expect(readMaxOpenPositions(withLimit(0))).toBe(0);
    expect(readMaxOpenPositions(withLimit(-4))).toBe(0);
    // Not a number at all is the field being absent.
    expect(readMaxOpenPositions(withLimit("3"))).toBeNull();
    expect(readMaxOpenPositions(withLimit(Number.NaN))).toBeNull();

    const withReserve = (value: unknown) => ({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: value as number });
    expect(readCashReserveUsd(withReserve(-5))).toBe(0);
    expect(readCashReserveUsd(withReserve("5"))).toBe(0);
    expect(readCashReserveUsd(withReserve(Number.NaN))).toBe(0);
    // Kept to the ledger's six decimals.
    expect(readCashReserveUsd(withReserve(5.0000004))).toBe(5);
    // Only `true` switches the skip on.
    expect(readSkipWhenFull({ intervalMinutes: 15, skipWhenFull: "yes" as unknown as boolean })).toBe(false);
  });
});

describe("riskGuard: the position limit", () => {
  const three = agentWith({ maxOpenPositions: 3 });
  const full = portfolio({ positions: [held("AAA"), held("BBB"), held("CCC")] });

  it("refuses the fourth position at a limit of three, in words for the model and for the owner", () => {
    const verdict = riskGuard(three, full, buyOf("DDD"), score());
    expect(verdict).toEqual({
      ok: false,
      reason:
        "Position limit reached: this agent may hold at most 3 positions and holds 3 (maxOpenPositions). DDD would be a new one. Sell a position first, or add to a token it already holds. Sells and exits are never blocked by this.",
      code: "position_limit",
      params: { symbol: "DDD", maxOpenPositions: 3, openPositions: 3, heldPositions: 3, waitingBuys: 0 },
    });
    if (verdict.ok) throw new Error("unreachable");
    expect(ownerRiskMessage(verdict)).toBe(
      "This agent may hold at most 3 positions and holds 3. Sell one first, or raise Max open positions in Settings.",
    );
  });

  /**
   * The limit set under what the agent already holds (a save that tightens asks nothing).
   * One sale does not make room then, so neither sentence may say that it does: the
   * owner who sold one was refused again in the same words.
   */
  it("says how many have to go when the agent holds more than the limit", () => {
    const five = portfolio({ positions: [held("AAA"), held("BBB"), held("CCC"), held("DDD"), held("EEE")] });
    const verdict = riskGuard(three, five, buyOf("FFF"), score());
    if (verdict.ok) throw new Error("expected a refusal");
    expect(verdict.reason).toBe(
      "Position limit reached: this agent may hold at most 3 positions and holds 5 (maxOpenPositions). FFF would be a new one. 3 of them have to go before a new one can be opened; until then it may only add to a token it already holds. Sells and exits are never blocked by this.",
    );
    expect(ownerRiskMessage(verdict)).toBe(
      "This agent may hold at most 3 positions and holds 5. Sell 3 first, or raise Max open positions in Settings.",
    );
    // One over: two have to go.
    const four = riskGuard(three, portfolio({ positions: five.positions.slice(0, 4) }), buyOf("FFF"), score());
    if (four.ok) throw new Error("expected a refusal");
    expect(ownerRiskMessage(four)).toBe(
      "This agent may hold at most 3 positions and holds 4. Sell 2 first, or raise Max open positions in Settings.",
    );
    // Some of what counts is only waiting: declining one frees a slot as selling one does.
    const waiting = riskGuard(
      three,
      portfolio({ positions: five.positions.slice(0, 3), pendingBuyTokenIds: ["solana:DDD"] }),
      buyOf("FFF"),
      score(),
    );
    if (waiting.ok) throw new Error("expected a refusal");
    expect(ownerRiskMessage(waiting)).toBe(
      "This agent may hold at most 3 positions and holds 3, with 1 more buy waiting for your approval. Sell or decline 2 first, or raise Max open positions in Settings.",
    );
    expect(waiting.reason).toContain("2 of them have to go before a new one can be opened");
    // Adding to one it holds is still allowed over the limit, and so is every sell.
    expect(riskGuard(three, five, buyOf("BBB"), score())).toEqual({ ok: true });
    expect(riskGuard(three, five, { ...buyOf("AAA", 100), side: "sell" })).toEqual({ ok: true });
  });

  it("allows the third", () => {
    const two = portfolio({ positions: [held("AAA"), held("BBB")] });
    expect(riskGuard(three, two, buyOf("CCC"), score())).toEqual({ ok: true });
  });

  it("allows adding to a token already held, and leaves the size of it to the concentration cap", () => {
    expect(riskGuard(three, full, buyOf("BBB"), score())).toEqual({ ok: true });
    // The add is still under `maxPositionPct`, which is the rule that governs it.
    const capped = agentWith({ maxOpenPositions: 3, maxPositionPct: 25 });
    const book = portfolio({ cashUsd: 1_000, equityUsd: 1_300, positions: [held("AAA"), held("BBB", 300), held("CCC")] });
    expect(riskGuard(capped, book, buyOf("BBB", 100), score())).toMatchObject({ ok: false, code: "concentration" });
    expect(riskGuard(capped, book, buyOf("BBB", 20), score())).toEqual({ ok: true });
  });

  it("counts a buy waiting for approval as a position", () => {
    const book = portfolio({ positions: [held("AAA"), held("BBB")], pendingBuyTokenIds: ["solana:CCC"] });
    const verdict = riskGuard(three, book, buyOf("DDD"), score());
    expect(verdict).toMatchObject({
      ok: false,
      code: "position_limit",
      params: { maxOpenPositions: 3, openPositions: 3, heldPositions: 2, waitingBuys: 1 },
    });
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toContain("holds 2 with 1 more buy waiting for its owner's approval (maxOpenPositions)");
    expect(ownerRiskMessage(verdict)).toBe(
      "This agent may hold at most 3 positions and holds 2, with 1 more buy waiting for your approval. Sell one first, or raise Max open positions in Settings.",
    );
    // The token that is waiting is already counted, so buying it opens nothing.
    expect(riskGuard(three, book, buyOf("CCC"), score())).toEqual({ ok: true });
    // A waiting buy of a token that is also held is one position, not two.
    const same = portfolio({ positions: [held("AAA"), held("BBB")], pendingBuyTokenIds: ["solana:BBB", "solana:BBB"] });
    expect(positionRoom(three.config.risk, same)).toEqual({ limit: 3, open: 2, held: 2, waiting: 0, full: false });
    expect(riskGuard(three, same, buyOf("DDD"), score())).toEqual({ ok: true });
  });

  it("judges an approval on what is held, not on the other proposals still waiting", () => {
    // Two held, two waiting under a limit of three (the limit was lowered after they
    // were proposed). The one being approved has been claimed and no longer waits.
    const book = portfolio({ positions: [held("AAA"), held("BBB")], pendingBuyTokenIds: ["solana:DDD"] });
    expect(riskGuard(three, book, buyOf("CCC"), score())).toMatchObject({ ok: false, code: "position_limit" });
    expect(riskGuard(three, withoutWaitingBuys(book), buyOf("CCC"), score())).toEqual({ ok: true });
    // Once it has filled there are three, and the next approval is refused.
    const after = portfolio({ positions: [held("AAA"), held("BBB"), held("CCC")], pendingBuyTokenIds: [] });
    expect(riskGuard(three, withoutWaitingBuys(after), buyOf("DDD"), score())).toMatchObject({ ok: false, code: "position_limit" });
    // A portfolio with no such list is handed back as it is.
    const plain = portfolio();
    expect(withoutWaitingBuys(plain)).toBe(plain);
  });

  it("does not count dust or a closed row, and does count a position it cannot price", () => {
    const dusty = portfolio({
      positions: [held("AAA"), held("BBB"), held("DUST", DUST_POSITION_USD - 0.01), held("GONE", 0, 0)],
    });
    expect(positionRoom(three.config.risk, dusty)).toMatchObject({ open: 2, full: false });
    expect(riskGuard(three, dusty, buyOf("CCC"), score())).toEqual({ ok: true });
    // Buying back a dust remainder opens a position again.
    expect(opensPosition(dusty, "solana:DUST")).toBe(true);
    expect(opensPosition(dusty, "solana:AAA")).toBe(false);

    const unpriced = portfolio({ positions: [held("AAA"), held("BBB"), held("DARK", null)] });
    expect(positionRoom(three.config.risk, unpriced)).toMatchObject({ open: 3, full: true });
    expect(riskGuard(three, unpriced, buyOf("CCC"), score())).toMatchObject({ ok: false, code: "position_limit" });
    // Exactly at the dust floor is a position.
    expect(positionRoom(three.config.risk, portfolio({ positions: [held("EDGE", DUST_POSITION_USD)] })).open).toBe(1);
  });

  it("says one position in the singular", () => {
    const one = agentWith({ maxOpenPositions: 1 });
    const verdict = riskGuard(one, portfolio({ positions: [held("AAA")] }), buyOf("BBB"), score());
    if (verdict.ok) throw new Error("expected a refusal");
    expect(verdict.reason).toContain("may hold at most 1 position and holds 1 (maxOpenPositions)");
    expect(ownerRiskMessage(verdict)).toContain("at most 1 position and holds 1.");
  });

  it("is checked after the daily limit and before the token is judged", () => {
    const spent = portfolio({ positions: full.positions, tradesToday: DEFAULT_AGENT_CONFIG.risk.maxDailyTrades });
    expect(riskGuard(three, spent, buyOf("DDD"), score())).toMatchObject({ ok: false, code: "daily_limit" });
    // At the limit a token that would also fail its score is told about the limit: the
    // model cannot buy it either way, and the limit is the answer that does not change.
    expect(riskGuard(three, full, buyOf("DDD"), null)).toMatchObject({ ok: false, code: "position_limit" });
  });

  it("never applies with no limit, however many are held", () => {
    const many = portfolio({ positions: Array.from({ length: 60 }, (_, i) => held(`T${i}`)) });
    for (const maxOpenPositions of [null, undefined]) {
      expect(riskGuard(agentWith({ maxOpenPositions }), many, buyOf("NEW"), score())).toEqual({ ok: true });
    }
  });
});

describe("riskGuard: the cash reserve", () => {
  /** A buy of `amountUsd` with `cashUsd` in the book and `reserveUsd` kept back. */
  const tryBuy = (cashUsd: number, reserveUsd: number, amountUsd: number, extra: Partial<RiskPortfolio> = {}) =>
    riskGuard(
      // A ticket cap and an equity figure far above every amount tried, so nothing but
      // the cash and the reserve can be what refuses.
      agentWith({ cashReserveUsd: reserveUsd, maxTradeUsd: 100_000 }),
      portfolio({ cashUsd, equityUsd: 100_000, ...extra }),
      { ...buyOf("BONK"), amountUsd },
      score(),
    );

  it.each([
    ["on", "50"],
    ["on at a quarter of a percent", "25"],
    ["off", "0"],
  ])("with the fee %s: a buy that leaves exactly the reserve passes, and a micro-dollar more is refused", (_name, bps) => {
    vi.stubEnv("PLATFORM_FEE_BPS", bps);
    const rate = Number(bps);
    for (const [cash, reserve] of [
      [20, 5],
      [20.8, 5],
      [10.3, 5],
      [1_234.56, 100],
      [5.01, 5],
    ] as const) {
      const most = maxBuyUsd(Math.round((cash - reserve) * 1e6) / 1e6, rate);
      // The most that fits leaves the reserve, to the micro-dollar the fee is rounded at.
      expect(buyCostUsd(most, rate)).toBeLessThanOrEqual(cash - reserve + 1e-9);
      expect(tryBuy(cash, reserve, most), `${cash}/${reserve} at ${most}`).toEqual({ ok: true });
      const over = tryBuy(cash, reserve, Math.round((most + 0.000001) * 1e6) / 1e6);
      expect(over, `${cash}/${reserve} over ${most}`).toMatchObject({ ok: false, code: "cash_reserve" });
    }
  });

  it("leaves exactly the reserve, fee off: $15 of $20 with $5 kept", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    expect(tryBuy(20, 5, 15)).toEqual({ ok: true });
    expect(tryBuy(20, 5, 15.000001)).toMatchObject({ ok: false, code: "cash_reserve", params: { leftUsd: 4.999999, reserveUsd: 5 } });
  });

  it("says what the buy would leave and what is kept, to the owner and to the model", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    // $10 and its 5 cent fee out of $12.15 leaves $2.10.
    const verdict = tryBuy(12.15, 5, 10);
    expect(verdict).toEqual({
      ok: false,
      reason:
        "Cash reserve: this buy and its Tocker fee would leave $2.10 in cash, and this agent keeps $5.00 in reserve (cashReserveUsd). The most it can buy right now is $7.11. Sells and exits are never blocked by this.",
      code: "cash_reserve",
      params: { symbol: "BONK", amountUsd: 10, cashUsd: 12.15, feeUsd: 0.05, feeBps: 50, maxBuyUsd: 7.11, reserveUsd: 5, leftUsd: 2.1 },
    });
    if (verdict.ok) throw new Error("unreachable");
    expect(ownerRiskMessage(verdict)).toBe(
      "This buy would leave $2.10 in cash; the agent keeps $5.00 in reserve. The most you can buy is $7.11.",
    );
    // The figure it is told is one the guard passes.
    expect(tryBuy(12.15, 5, 7.11)).toEqual({ ok: true });

    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    const plain = tryBuy(12.1, 5, 10);
    expect(plain.ok ? "" : plain.reason).toBe(
      "Cash reserve: this buy would leave $2.10 in cash, and this agent keeps $5.00 in reserve (cashReserveUsd). The most it can buy right now is $7.10. Sells and exits are never blocked by this.",
    );
  });

  it("prints a miss of a fraction of a cent exactly, so it does not read as fitting", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    const verdict = tryBuy(20, 5, 15.004);
    if (verdict.ok) throw new Error("expected a refusal");
    expect(verdict.reason).toContain("would leave $4.996 in cash, and this agent keeps $5.00 in reserve");
    expect(ownerRiskMessage(verdict)).toContain("This buy would leave $4.996 in cash; the agent keeps $5.00 in reserve.");
  });

  it("refuses every buy while the cash is at or under the reserve", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    for (const cash of [5, 4.2, 0.8]) {
      const verdict = tryBuy(cash, 5, 0.25);
      expect(verdict, `cash ${cash}`).toMatchObject({ ok: false, code: "cash_reserve", params: { maxBuyUsd: 0 } });
      if (verdict.ok) throw new Error("unreachable");
      expect(verdict.reason).toContain("It cannot buy until it holds more cash.");
      expect(ownerRiskMessage(verdict)).toContain("Add funds, or lower Cash reserve in Settings.");
    }
  });

  it("still says not enough cash for a buy the cash does not cover at all, with the most the reserve leaves", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const verdict = tryBuy(20, 5, 25);
    expect(verdict).toMatchObject({ ok: false, code: "cash", params: { cashUsd: 20, maxBuyUsd: 14.92, reserveUsd: 5 } });
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe(
      "Insufficient cash: $20.00 available, $25.00 requested plus the $0.125 Tocker fee (0.5% of the fill). With $5.00 kept in reserve (cashReserveUsd), the most this agent can buy is $14.92.",
    );
    expect(ownerRiskMessage(verdict)).toBe(
      "Not enough cash: $20.00 available, and a $25.00 buy needs $25.125 with the 0.5% Tocker fee. The most you can buy is $14.92, with $5.00 kept in reserve.",
    );
    expect(tryBuy(20, 5, 14.92)).toEqual({ ok: true });
    // Nothing fits at all.
    const none = tryBuy(4, 5, 25);
    expect(none.ok ? "" : none.reason).toContain("Its $5.00 cash reserve (cashReserveUsd) leaves nothing to buy with.");
  });

  it("is a floor under all of the agent's cash: what is kept for thinking counts towards it", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    // $20 in the wallet, $0.85 already left out of the guard's cash for thinking, $5 reserve.
    const withThinking = { cashHeldBackUsd: 0.85 };
    expect(buyingCashUsd({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: 5 }, { cashUsd: 19.15, ...withThinking })).toBe(15);
    expect(tryBuy(19.15, 5, 15, withThinking)).toEqual({ ok: true });
    const over = tryBuy(19.15, 5, 15.01, withThinking);
    // What is left is all of the cash, thinking money included: $20 less $15.01.
    expect(over).toMatchObject({ ok: false, code: "cash_reserve", params: { leftUsd: 4.99 } });
    // A reserve smaller than what is already held back changes nothing.
    expect(buyingCashUsd({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: 0.5 }, { cashUsd: 19.15, ...withThinking })).toBe(19.15);
    expect(tryBuy(19.15, 0.5, 19.15, withThinking)).toEqual({ ok: true });
  });

  it("refuses rather than passes when the cash is not a number", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    expect(tryBuy(Number.NaN, 5, 1)).toMatchObject({ ok: false, code: "cash_reserve" });
  });

  it("is the buying cash itself, untouched, with no reserve", () => {
    for (const cash of [0, 0.1 + 0.2, 19.999999, 10_000]) {
      expect(buyingCashUsd(DEFAULT_AGENT_CONFIG.risk, { cashUsd: cash })).toBe(cash);
      expect(buyingCashUsd({ ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd: 0 }, { cashUsd: cash, cashHeldBackUsd: 1 })).toBe(cash);
    }
  });
});

/**
 * A buy that has passed the guard and has not settled is neither a position nor spent
 * cash. A second buy from another request in those seconds (the owner's beside a run's,
 * a buy by hand beside an approval) was judged on a book that showed neither, and both
 * went through a limit with room for one.
 */
describe("riskGuard: the agent's buys in flight", () => {
  const three = agentWith({ maxOpenPositions: 3 });

  it("counts a token that is being bought as held, so the limit holds while the first buy fills", () => {
    const book = portfolio({ positions: [held("AAA"), held("BBB")], inFlightBuyTokenIds: ["solana:CCC"] });
    expect(positionRoom(three.config.risk, book)).toEqual({ limit: 3, open: 3, held: 2, waiting: 0, placing: 1, full: true });
    const verdict = riskGuard(three, book, buyOf("DDD"), score());
    expect(verdict).toEqual({
      ok: false,
      reason:
        "Position limit reached: this agent may hold at most 3 positions and holds 2 with 1 more being bought right now (maxOpenPositions). DDD would be a new one. Wait until the order being placed has settled, or add to a token it already holds. Sells and exits are never blocked by this.",
      code: "position_limit",
      params: { symbol: "DDD", maxOpenPositions: 3, openPositions: 3, heldPositions: 2, waitingBuys: 0, placingBuys: 1 },
    });
    if (verdict.ok) throw new Error("unreachable");
    // It is not said to hold what it does not hold yet.
    expect(ownerRiskMessage(verdict)).toBe(
      "This agent may hold at most 3 positions and holds 2, with 1 more being bought right now. Try again when that buy has settled, or raise Max open positions in Settings.",
    );
    // With nothing being bought, the room and the words carry no such part.
    expect(positionRoom(three.config.risk, portfolio({ positions: [held("AAA")] }))).toEqual({ limit: 3, open: 1, held: 1, waiting: 0, full: false });
    // Without the buy in flight the same order has room.
    expect(riskGuard(three, portfolio({ positions: [held("AAA"), held("BBB")] }), buyOf("DDD"), score())).toEqual({ ok: true });
    // One slot short of the limit, a buy in flight leaves room for one more.
    expect(riskGuard(agentWith({ maxOpenPositions: 4 }), book, buyOf("DDD"), score())).toEqual({ ok: true });
  });

  it("counts each token once, however it is counted", () => {
    // Being bought and already held, being bought twice, being bought and also waiting.
    const book = portfolio({
      positions: [held("AAA")],
      inFlightBuyTokenIds: ["solana:AAA", "solana:BBB", "solana:BBB"],
      pendingBuyTokenIds: ["solana:BBB", "solana:CCC"],
    });
    expect(positionRoom(three.config.risk, book)).toEqual({ limit: 3, open: 3, held: 1, waiting: 1, placing: 1, full: true });
    const all = riskGuard(three, book, buyOf("DDD"), score());
    if (all.ok) throw new Error("expected a refusal");
    expect(all.reason).toContain("holds 1 with 1 more being bought right now and 1 more buy waiting for its owner's approval (maxOpenPositions)");
    expect(ownerRiskMessage(all)).toBe(
      "This agent may hold at most 3 positions and holds 1, with 1 more being bought right now and 1 more buy waiting for your approval. Try again when that buy has settled, or raise Max open positions in Settings.",
    );
    // A token with a buy waiting, or one it holds, is counted already: buying it opens nothing.
    expect(opensPosition(book, "solana:BBB")).toBe(false);
    expect(opensPosition(book, "solana:AAA")).toBe(false);
    expect(opensPosition(book, "solana:DDD")).toBe(true);
  });

  it("does not take a token that is only being bought for one it holds", () => {
    // The order in flight may fail. A second buy of the same token, let through at the
    // limit as an add, would then be the buy that opened a position over it.
    const book = portfolio({ positions: [held("AAA"), held("BBB")], inFlightBuyTokenIds: ["solana:CCC"] });
    expect(opensPosition(book, "solana:CCC")).toBe(true);
    expect(riskGuard(three, book, buyOf("CCC"), score())).toMatchObject({ ok: false, code: "position_limit" });
    // Under the limit there is room for it either way.
    expect(riskGuard(agentWith({ maxOpenPositions: 4 }), book, buyOf("CCC"), score())).toEqual({ ok: true });
    // Once it has landed it is held, and adding to it is an add.
    const landed = portfolio({ positions: [held("AAA"), held("BBB"), held("CCC")] });
    expect(riskGuard(three, landed, buyOf("CCC"), score())).toEqual({ ok: true });
  });

  it("stays in the count an approval is judged on, where the buys still waiting do not", () => {
    const book = portfolio({ positions: [held("AAA"), held("BBB")], inFlightBuyTokenIds: ["solana:CCC"], pendingBuyTokenIds: ["solana:EEE"] });
    const judged = withoutWaitingBuys(book);
    expect(judged.inFlightBuyTokenIds).toEqual(["solana:CCC"]);
    expect(riskGuard(three, judged, buyOf("DDD"), score())).toMatchObject({ ok: false, code: "position_limit" });
  });

  it("takes what they will cost off the cash the reserve is measured against", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const reserved = agentWith({ cashReserveUsd: 5, maxTradeUsd: 100_000 });
    // $12 in the wallet, $5 kept, and a $5 buy with its fee already on its way out.
    const book = portfolio({ cashUsd: 12, equityUsd: 100_000, cashSpokenForUsd: 5.025 });
    expect(buyingCashUsd(reserved.config.risk, book)).toBe(1.975);
    const verdict = riskGuard(reserved, book, buyOf("DDD", 5), score());
    expect(verdict).toMatchObject({
      ok: false,
      code: "cash_reserve",
      params: { leftUsd: 1.95, reserveUsd: 5, settlingUsd: 5.025, maxBuyUsd: 1.96 },
    });
    if (verdict.ok) throw new Error("unreachable");
    expect(verdict.reason).toBe(
      "Cash reserve: this buy and its Tocker fee would leave $1.95 in cash once the $5.03 of buys it has already placed have settled, and this agent keeps $5.00 in reserve (cashReserveUsd). The most it can buy right now is $1.96. Sells and exits are never blocked by this.",
    );
    expect(ownerRiskMessage(verdict)).toBe(
      "This buy would leave $1.95 in cash once the $5.03 of buys already placed have settled; the agent keeps $5.00 in reserve. The most you can buy is $1.96.",
    );
    // A buy the settling ones leave no cash for at all is not given a negative figure.
    const none = riskGuard(reserved, book, buyOf("DDD", 9), score());
    if (none.ok) throw new Error("unreachable");
    expect(none.reason).toContain("would leave nothing in cash once the $5.03 of buys it has already placed have settled");
    expect(ownerRiskMessage(none)).toBe(
      "This buy would leave nothing in cash once the $5.03 of buys already placed have settled; the agent keeps $5.00 in reserve. The most you can buy is $1.96.",
    );
    // What still fits beside it goes through, and the ticket the model is told agrees.
    expect(riskGuard(reserved, book, buyOf("DDD", 1.96), score())).toEqual({ ok: true });
    expect(ticketCeiling(reserved.config, book).cashUsd).toBe(1.96);
    // With nothing in flight the same $5 buy leaves the reserve standing.
    expect(riskGuard(reserved, portfolio({ cashUsd: 12, equityUsd: 100_000 }), buyOf("DDD", 5), score())).toEqual({ ok: true });
  });

  it("is not set against plain cash: with no reserve the cash rule is the one it was", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const plain = agentWith({ maxTradeUsd: 100_000 });
    const book = portfolio({ cashUsd: 12, equityUsd: 100_000, cashSpokenForUsd: 5.025 });
    expect(buyingCashUsd(plain.config.risk, book)).toBe(12);
    expect(riskGuard(plain, book, buyOf("DDD", 11.9), score())).toEqual({ ok: true });
  });

  it("never touches a sell", () => {
    const locked = agentWith({ maxOpenPositions: 1, cashReserveUsd: 1_000_000 });
    const book = portfolio({ positions: [held("AAA")], inFlightBuyTokenIds: ["solana:BBB", "solana:CCC"], cashSpokenForUsd: 1_000_000 });
    expect(riskGuard(locked, book, { ...buyOf("AAA", 100), side: "sell" })).toEqual({ ok: true });
  });
});

describe("a sell is never refused, shrunk or delayed by either limit", () => {
  const holding = [held("AAA", 80), held("BBB", 80), held("CCC", 80)];

  it("passes at every setting, at the limit, with no cash at all", () => {
    for (const bps of ["0", "50"]) {
      vi.stubEnv("PLATFORM_FEE_BPS", bps);
      for (const maxOpenPositions of [undefined, null, 0, 1, 3, 50]) {
        for (const cashReserveUsd of [undefined, 0, 5, 1_000_000]) {
          for (const cashUsd of [0, 0.8, 5, 10_000]) {
            const agent = agentWith({ maxOpenPositions, cashReserveUsd });
            const book = portfolio({
              cashUsd,
              equityUsd: cashUsd + 240,
              positions: holding,
              tradesToday: 999,
              pendingBuyTokenIds: ["solana:DDD", "solana:EEE"],
              cashHeldBackUsd: 0.85,
            });
            const label = `limit ${String(maxOpenPositions)}, reserve ${String(cashReserveUsd)}, cash ${cashUsd}`;
            // The whole position, and a slice of it, with and without a score.
            expect(riskGuard(agent, book, { ...buyOf("AAA"), side: "sell", amountUsd: 80 }, null), label).toEqual({ ok: true });
            expect(riskGuard(agent, book, { ...buyOf("BBB"), side: "sell", amountUsd: 0.01 }, score()), label).toEqual({ ok: true });
          }
        }
      }
    }
  });

  it("leaves the sell-side refusals exactly as they were", () => {
    const limited = agentWith({ maxOpenPositions: 1, cashReserveUsd: 1_000 });
    const plain = agentWith();
    const book = portfolio({ cashUsd: 0, equityUsd: 160, positions: [held("AAA", 80), held("DARK", null)] });
    for (const order of [
      { ...buyOf("NONE"), side: "sell" as const, amountUsd: 10 },
      { ...buyOf("DARK"), side: "sell" as const, amountUsd: 10 },
      { ...buyOf("AAA"), side: "sell" as const, amountUsd: 80.5 },
      { ...buyOf("AAA"), side: "sell" as const, amountUsd: 0 },
    ]) {
      const verdict = riskGuard(limited, book, order, null);
      expect(verdict.ok).toBe(false);
      expect(verdict).toEqual(riskGuard(plain, book, order, null));
    }
  });
});

describe("ticketCeiling and roomToBuy", () => {
  it("takes the reserve off the cash a ticket may use, and nothing off the other two ceilings", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const config = agentWith({ maxTradeUsd: 100, maxPositionPct: 50, cashReserveUsd: 5 }).config;
    const book = { cashUsd: 20, equityUsd: 20 };
    const ceiling = ticketCeiling(config, book);
    // $15 of buying cash covers a $14.92 buy and its fee.
    expect(ceiling.cashUsd).toBe(floorToCents(maxBuyUsd(15, 50)));
    expect(ceiling.cashUsd).toBe(14.92);
    // The concentration cap is a share of all the equity: the reserve is still the agent's money.
    expect(ceiling.concentrationUsd).toBe(10);
    expect(ceiling.sizing).toEqual(sizeCeiling(config, book, {}));
    expect(ceiling).toMatchObject({ amountUsd: 10, bound: "concentration" });
    // With the cap out of the way the cash binds.
    const open = agentWith({ maxTradeUsd: 100, cashReserveUsd: 5 }).config;
    expect(ticketCeiling(open, book)).toMatchObject({ amountUsd: 14.92, bound: "cash" });
    expect(ticketCeiling(open, { cashUsd: 4, equityUsd: 4 })).toMatchObject({ amountUsd: 0, bound: "cash" });
  });

  it("is the ticket the guard passes: one cent more is refused", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    for (const reserve of [0, 5, 12.34]) {
      const agent = agentWith({ maxTradeUsd: 1_000, cashReserveUsd: reserve });
      const book = portfolio({ cashUsd: 20.8, equityUsd: 20.8 });
      const ticket = ticketCeiling(agent.config, book).amountUsd;
      expect(riskGuard(agent, book, buyOf("BONK", ticket), score()), `reserve ${reserve}`).toEqual({ ok: true });
      expect(riskGuard(agent, book, buyOf("BONK", Math.round((ticket + 0.01) * 100) / 100), score()).ok).toBe(false);
    }
  });

  it("says no room at the position limit, for want of a ticket, and when the day's buys are spent, in that order", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const agent = agentWith({ maxOpenPositions: 3, cashReserveUsd: 5, maxTradeUsd: 5, maxDailyTrades: 4 });
    const three = [held("AAA"), held("BBB"), held("CCC")];
    const options = { smallestUsd: 2 };

    expect(roomToBuy(agent, portfolio({ cashUsd: 20, equityUsd: 320, positions: three }), options)).toEqual({
      ok: false,
      code: "position_limit",
      positions: { limit: 3, open: 3, held: 3, waiting: 0, full: true },
    });
    // Two held and one waiting is three as well.
    expect(
      roomToBuy(agent, portfolio({ cashUsd: 20, equityUsd: 220, positions: three.slice(0, 2), pendingBuyTokenIds: ["solana:CCC"] }), options),
    ).toMatchObject({ ok: false, code: "position_limit", positions: { open: 3, held: 2, waiting: 1 } });

    // Room for a position, $6.29 of cash, $5 of it reserved: $1.28 fits, under the $2 floor.
    expect(roomToBuy(agent, portfolio({ cashUsd: 6.29, equityUsd: 206.29, positions: three.slice(0, 2) }), options)).toEqual({
      ok: false,
      code: "ticket",
      ticketUsd: 1.28,
      bound: "cash",
      smallestUsd: 2,
      reserveUsd: 5,
    });
    // The same book with a lower floor has room.
    expect(roomToBuy(agent, portfolio({ cashUsd: 6.29, equityUsd: 206.29, positions: three.slice(0, 2) }), { smallestUsd: 0.25 })).toEqual({
      ok: true,
      ticketUsd: 1.28,
    });

    expect(roomToBuy(agent, portfolio({ cashUsd: 20, equityUsd: 220, positions: three.slice(0, 2), tradesToday: 4 }), options)).toEqual({
      ok: false,
      code: "daily_limit",
      tradesToday: 4,
      maxDailyTrades: 4,
    });
    expect(roomToBuy(agent, portfolio({ cashUsd: 20, equityUsd: 220, positions: three.slice(0, 2) }), options)).toEqual({
      ok: true,
      ticketUsd: 5,
    });
    // The first that applies is the one named.
    expect(roomToBuy(agent, portfolio({ cashUsd: 0, equityUsd: 300, positions: three, tradesToday: 4 }), options)).toMatchObject({
      code: "position_limit",
    });
    expect(roomToBuy(agent, portfolio({ cashUsd: 0, equityUsd: 200, positions: three.slice(0, 2), tradesToday: 4 }), options)).toMatchObject({
      code: "ticket",
    });
  });

  it("names the ceiling that left no ticket when it is not the cash", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const tiny = agentWith({ maxTradeUsd: 1 });
    expect(roomToBuy(tiny, portfolio(), { smallestUsd: 2 })).toMatchObject({ ok: false, code: "ticket", ticketUsd: 1, bound: "sizing" });
    const capped = agentWith({ maxTradeUsd: 100, maxPositionPct: 5 });
    expect(roomToBuy(capped, portfolio({ cashUsd: 20, equityUsd: 20 }), { smallestUsd: 2 })).toMatchObject({
      ok: false,
      code: "ticket",
      ticketUsd: 1,
      bound: "concentration",
    });
  });

  /**
   * `canStillBuy` in the agent's tools used to be these three lines. With no limit and no
   * reserve, `roomToBuy` at the dust floor has to give the same answer for every book.
   */
  it("answers, with neither limit set, exactly as the tools' own check did", () => {
    const before = (config: AgentConfig, book: RiskPortfolio, feeBps: number): boolean => {
      if (book.tradesToday >= config.risk.maxDailyTrades) return false;
      const equity = book.equityUsd > 0 ? book.equityUsd : book.cashUsd;
      const limits = [sizeCeiling(config, book, {}).amountUsd, floorToCents(maxBuyUsd(book.cashUsd, feeBps))];
      if (equity > 0) limits.push((config.risk.maxPositionPct / 100) * equity);
      return Math.max(0, Math.min(...limits)) >= DUST_POSITION_USD;
    };
    let compared = 0;
    for (const bps of [0, 50]) {
      vi.stubEnv("PLATFORM_FEE_BPS", String(bps));
      for (const maxTradeUsd of [0.2, 2, 100]) {
        for (const maxPositionPct of [1, 25, 100]) {
          for (const cashUsd of [0, 0.2, 0.25, 0.26, 0.8, 5, 20, 10_000]) {
            for (const positionsUsd of [0, 15]) {
              for (const tradesToday of [0, 9, 10, 11]) {
                const config = agentWith({ maxTradeUsd, maxPositionPct }).config;
                const book = portfolio({
                  cashUsd,
                  equityUsd: cashUsd + positionsUsd,
                  positions: positionsUsd > 0 ? [held("AAA", positionsUsd)] : [],
                  tradesToday,
                });
                expect(roomToBuy({ config }, book, { smallestUsd: DUST_POSITION_USD }).ok).toBe(before(config, book, bps));
                compared += 1;
              }
            }
          }
        }
      }
    }
    expect(compared).toBe(2 * 3 * 3 * 8 * 2 * 4);
  });
});

describe("with both limits off, the guard answers as it always did", () => {
  /** The default risk block with the two fields taken out: a config from before they existed. */
  function legacy(config: AgentConfig): AgentConfig {
    const risk = { ...config.risk };
    delete risk.maxOpenPositions;
    delete risk.cashReserveUsd;
    return { ...config, risk };
  }

  it("gives one verdict whether the fields are absent, written out as off, or the book carries the new fields", () => {
    const positions = [held("AAA", 400), held("BBB", 30), held("DARK", null)];
    const books: RiskPortfolio[] = [
      portfolio(),
      portfolio({ cashUsd: 5, equityUsd: 5 }),
      portfolio({ cashUsd: 0.8, equityUsd: 430.8, positions }),
      portfolio({ cashUsd: 1_000, equityUsd: 1_430, positions, tradesToday: 3 }),
      portfolio({ cashUsd: 1_000, equityUsd: 1_430, positions, tradesToday: 10 }),
      portfolio({ cashUsd: 0, equityUsd: 0 }),
    ];
    const orders: OrderIntent[] = [
      buyOf("BONK", 50),
      buyOf("BONK", 4.98),
      buyOf("BONK", 5),
      buyOf("BONK", 150),
      buyOf("AAA", 50),
      buyOf("BONK", 0),
      { ...buyOf("BONK"), chain: "base" },
      { ...buyOf("AAA"), side: "sell", amountUsd: 400 },
      { ...buyOf("AAA"), side: "sell", amountUsd: 401 },
      { ...buyOf("DARK"), side: "sell", amountUsd: 1 },
      { ...buyOf("NONE"), side: "sell", amountUsd: 1 },
    ];
    const scores = [score(), score({ total: 30, verdict: "avoid" }), score({ blockers: ["mint_authority_active"] }), null];
    const configs: AgentConfig[] = [
      DEFAULT_AGENT_CONFIG as AgentConfig,
      { ...DEFAULT_AGENT_CONFIG, risk: { ...DEFAULT_AGENT_CONFIG.risk, maxPositionPct: 100, maxTradeUsd: 1_000 } },
      {
        ...DEFAULT_AGENT_CONFIG,
        risk: {
          ...DEFAULT_AGENT_CONFIG.risk,
          sizing: { mode: "percent_equity", percentOfEquity: 10, referenceRangePct: 25, minTradeUsd: 5 },
        } satisfies AgentRiskWithSizing,
      },
      {
        ...DEFAULT_AGENT_CONFIG,
        universe: { ...DEFAULT_AGENT_CONFIG.universe, blocklist: [{ chain: "solana", address: "BONK", symbol: "BONK" }] },
      },
    ];

    let compared = 0;
    for (const bps of ["0", "50"]) {
      vi.stubEnv("PLATFORM_FEE_BPS", bps);
      for (const config of configs) {
        const off: AgentConfig = { ...config, risk: { ...config.risk, maxOpenPositions: null, cashReserveUsd: 0 } };
        for (const book of books) {
          // The same book as an agent with a waiting proposal and thinking money has it.
          const carrying: RiskPortfolio = {
            ...book,
            pendingBuyTokenIds: ["solana:ZZZ", "solana:YYY"],
            cashHeldBackUsd: 0.85,
            // And one with buys in flight: none of it is read with both limits off.
            inFlightBuyTokenIds: ["solana:XXX", "solana:AAA"],
            cashSpokenForUsd: 400,
          };
          for (const order of orders) {
            for (const tokenScore of scores) {
              const was = riskGuard({ id: "a", mode: "live", config: legacy(config) }, book, order, tokenScore);
              expect(riskGuard({ id: "a", mode: "live", config: off }, book, order, tokenScore)).toEqual(was);
              expect(riskGuard({ id: "a", mode: "live", config: legacy(config) }, carrying, order, tokenScore)).toEqual(was);
              expect(riskGuard({ id: "a", mode: "live", config: off }, carrying, order, tokenScore)).toEqual(was);
              // And no verdict ever names one of the new rules.
              if (!was.ok) expect(["position_limit", "cash_reserve"]).not.toContain(was.code);
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBe(2 * configs.length * books.length * orders.length * scores.length);
  });

  it("leaves the ticket ceiling and the room to buy where they were", () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    for (const cashUsd of [0, 0.8, 5, 20, 10_000]) {
      const config = DEFAULT_AGENT_CONFIG as AgentConfig;
      const book = portfolio({ cashUsd, equityUsd: cashUsd });
      const was = ticketCeiling(legacy(config), book);
      expect(ticketCeiling({ ...config, risk: { ...config.risk, maxOpenPositions: null, cashReserveUsd: 0 } }, book)).toEqual(was);
      expect(ticketCeiling(legacy(config), { ...book, cashHeldBackUsd: 0.85 })).toEqual(was);
      expect(ticketCeiling(legacy(config), { ...book, cashSpokenForUsd: 400 })).toEqual(was);
      expect(roomToBuy({ config: legacy(config) }, { ...book, pendingBuyTokenIds: ["solana:ZZZ"] }, { smallestUsd: 0.25 })).toEqual(
        roomToBuy({ config: legacy(config) }, book, { smallestUsd: 0.25 }),
      );
      expect(
        roomToBuy({ config: legacy(config) }, { ...book, inFlightBuyTokenIds: ["solana:ZZZ"], cashSpokenForUsd: 400 }, { smallestUsd: 0.25 }),
      ).toEqual(roomToBuy({ config: legacy(config) }, book, { smallestUsd: 0.25 }));
    }
  });
});
