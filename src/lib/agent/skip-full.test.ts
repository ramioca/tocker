/**
 * Skipping a scheduled run when the agent has no room to buy: the decision and its words.
 * What the run loop then does with the decision (no run row, no payment, the next run
 * time) is in `run-skip.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@/db/schema";
import { DUST_POSITION_USD } from "@/lib/trading/dust";
import type { RiskPortfolio, RiskPosition } from "@/lib/trading/risk";
import { MIN_ACCOUNT_OPENING_BUY_USD } from "@/lib/wallets/gas";
import { DEFAULT_AGENT_CONFIG } from "./config";
import {
  SKIPPING_RUNS_STILL,
  exitRulesOn,
  fullRunSkip,
  noRoomWords,
  skippingRunsSentence,
  skippingRunsTitle,
  smallestBuyUsd,
  type NoRoom,
} from "./skip-full";

beforeEach(() => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
});
afterEach(() => vi.unstubAllEnvs());

function configWith(
  risk: Partial<AgentConfig["risk"]> = {},
  schedule: AgentConfig["schedule"] = { intervalMinutes: 15, skipWhenFull: true },
  chains: AgentConfig["chains"] = ["solana"],
): AgentConfig {
  return { ...DEFAULT_AGENT_CONFIG, chains, schedule, risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 5, maxPositionPct: 100, ...risk } };
}

function held(symbol: string, valueUsd = 5): RiskPosition {
  return { tokenId: `solana:${symbol}`, chain: "solana", address: symbol, symbol, amountToken: 10, valueUsd };
}

function bookOf(overrides: Partial<RiskPortfolio> = {}, cashReadFailed = false) {
  return { portfolio: { cashUsd: 20, equityUsd: 20, positions: [], tradesToday: 0, ...overrides }, cashReadFailed };
}

const live = (config: AgentConfig) => ({ mode: "live" as const, config });
const paper = (config: AgentConfig) => ({ mode: "paper" as const, config });

describe("the smallest buy worth placing", () => {
  it("is the first-buy minimum for real money on Solana, and the dust floor everywhere else", () => {
    expect(MIN_ACCOUNT_OPENING_BUY_USD).toBe(2);
    expect(DUST_POSITION_USD).toBe(0.25);
    expect(smallestBuyUsd(live(configWith()))).toBe(2);
    // A paper fill opens no account, and Base has none to open.
    expect(smallestBuyUsd(paper(configWith()))).toBe(0.25);
    expect(smallestBuyUsd(live(configWith({}, undefined, ["base"])))).toBe(0.25);
    // One cash figure covers both chains, so the lower floor is the one that counts.
    expect(smallestBuyUsd(live(configWith({}, undefined, ["solana", "base"])))).toBe(0.25);
    expect(smallestBuyUsd(live({ ...configWith(), chains: [] }))).toBe(0.25);
  });
});

describe("fullRunSkip", () => {
  const three = [held("AAA"), held("BBB"), held("CCC")];
  const full = bookOf({ cashUsd: 20, equityUsd: 35, positions: three });

  it("is off by default: an agent that never turned it on is never skipped, however full", () => {
    const risk = { maxOpenPositions: 3, cashReserveUsd: 50, maxDailyTrades: 1 };
    const starved = bookOf({ cashUsd: 0, equityUsd: 15, positions: three, tradesToday: 9 });
    expect(fullRunSkip(live(configWith(risk, { intervalMinutes: 15 })), starved)).toBeNull();
    expect(fullRunSkip(live(configWith(risk, { intervalMinutes: 15, skipWhenFull: false })), starved)).toBeNull();
    expect(fullRunSkip(live(DEFAULT_AGENT_CONFIG as AgentConfig), starved)).toBeNull();
    // Turned on, the same book is skipped.
    expect(fullRunSkip(live(configWith(risk)), starved)).not.toBeNull();
  });

  it("skips an agent at its position limit", () => {
    const room = fullRunSkip(live(configWith({ maxOpenPositions: 3 })), full);
    expect(room).toEqual({ ok: false, code: "position_limit", positions: { limit: 3, open: 3, held: 3, waiting: 0, full: true } });
    expect(skippingRunsSentence(room as NoRoom, true)).toBe(
      "Skipping scheduled runs: no room to buy (3 of 3 positions). Automatic exits still run.",
    );
    // One short of the limit, it runs.
    expect(fullRunSkip(live(configWith({ maxOpenPositions: 4 })), full)).toBeNull();
  });

  it("counts a buy waiting for approval towards the limit, and says so", () => {
    const room = fullRunSkip(
      live(configWith({ maxOpenPositions: 3 })),
      bookOf({ equityUsd: 30, positions: three.slice(0, 2), pendingBuyTokenIds: ["solana:CCC"] }),
    );
    expect(skippingRunsTitle(room as NoRoom)).toBe(
      "Skipping scheduled runs: no room to buy (3 of 3 positions, one of them a buy waiting for your approval)",
    );
    const two = fullRunSkip(
      live(configWith({ maxOpenPositions: 3 })),
      bookOf({ equityUsd: 25, positions: three.slice(0, 1), pendingBuyTokenIds: ["solana:BBB", "solana:CCC"] }),
    );
    expect(noRoomWords(two as NoRoom)).toBe("3 of 3 positions, 2 of them buys waiting for your approval");
  });

  it("skips an agent with no cash for its smallest order after the reserve", () => {
    // The owner's agent: $6.29 in the wallet, $5 kept, so $1.28 buys and the venue's
    // first-buy minimum is $2. This is the run that used to be paid for and place nothing.
    const config = configWith({ cashReserveUsd: 5 });
    const room = fullRunSkip(live(config), bookOf({ cashUsd: 6.29, equityUsd: 16.29, positions: three.slice(0, 2) }));
    expect(room).toEqual({ ok: false, code: "ticket", ticketUsd: 1.28, bound: "cash", smallestUsd: 2, reserveUsd: 5 });
    expect(skippingRunsSentence(room as NoRoom, true)).toBe(
      "Skipping scheduled runs: no room to buy ($1.28 to spend after its $5.00 reserve, under the $2.00 smallest order). Automatic exits still run.",
    );
    // With the cash for a $2 order after the reserve, it runs.
    expect(fullRunSkip(live(config), bookOf({ cashUsd: 7.02, equityUsd: 17.02 }))).toBeNull();
    // A paper agent's floor is the dust floor, so the same $1.28 is room.
    expect(fullRunSkip(paper(config), bookOf({ cashUsd: 6.29, equityUsd: 16.29 }))).toBeNull();
    expect(fullRunSkip(paper(config), bookOf({ cashUsd: 5.2, equityUsd: 15.2 }))).toMatchObject({ code: "ticket", smallestUsd: 0.25 });
  });

  it("says the same without a reserve, and names another ceiling when that is what left no ticket", () => {
    const noReserve = fullRunSkip(live(configWith()), bookOf({ cashUsd: 0.8, equityUsd: 20 }));
    expect(noRoomWords(noReserve as NoRoom)).toBe("$0.79 to spend, under the $2.00 smallest order");
    const tinyTicket = fullRunSkip(live(configWith({ maxTradeUsd: 1 })), bookOf());
    expect(noRoomWords(tinyTicket as NoRoom)).toBe("its largest allowed buy is $1.00, under the $2.00 smallest order");
  });

  it("skips an agent that has used the day's buys", () => {
    const room = fullRunSkip(live(configWith({ maxDailyTrades: 4 })), bookOf({ tradesToday: 4 }));
    expect(room).toEqual({ ok: false, code: "daily_limit", tradesToday: 4, maxDailyTrades: 4 });
    expect(skippingRunsSentence(room as NoRoom, true)).toBe(
      "Skipping scheduled runs: no room to buy (4 of 4 buys used today). Automatic exits still run.",
    );
    expect(fullRunSkip(live(configWith({ maxDailyTrades: 4 })), bookOf({ tradesToday: 3 }))).toBeNull();
  });

  it("does not skip when the book could not be read: the run goes ahead as it always did", () => {
    const config = configWith({ maxOpenPositions: 3 });
    expect(fullRunSkip(live(config), null)).toBeNull();
    // A wallet that did not answer makes the cash too low, which is not a reason to skip.
    expect(fullRunSkip(live(config), { ...full, cashReadFailed: true })).toBeNull();
    expect(fullRunSkip(live(configWith({ cashReserveUsd: 5 })), bookOf({ cashUsd: 0 }, true))).toBeNull();
  });

  it("does not skip an agent that has room", () => {
    const config = configWith({ maxOpenPositions: 3, cashReserveUsd: 5 });
    expect(fullRunSkip(live(config), bookOf({ cashUsd: 20, equityUsd: 30, positions: three.slice(0, 2) }))).toBeNull();
  });

  /**
   * The switch's promise is that exits still fire. With every exit rule off there is no
   * exit to fire: the model is the only seller, and a full agent whose runs were skipped
   * would stay full, and so stay skipped, for good.
   */
  describe("an agent with every exit rule off", () => {
    const NO_EXITS = {
      stopLossPct: null,
      takeProfitPct: null,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
    };

    it("is not skipped while it holds a position, whichever way it is full", () => {
      expect(exitRulesOn(configWith(NO_EXITS))).toBe(false);
      expect(exitRulesOn(configWith())).toBe(true);
      // At its position limit.
      expect(fullRunSkip(live(configWith({ ...NO_EXITS, maxOpenPositions: 3 })), full)).toBeNull();
      // Out of cash after the reserve.
      const noCash = bookOf({ cashUsd: 5.2, equityUsd: 10.2, positions: three.slice(0, 1) });
      expect(fullRunSkip(live(configWith({ ...NO_EXITS, cashReserveUsd: 5 })), noCash)).toBeNull();
      // The day's buys spent.
      const spent = bookOf({ positions: three.slice(0, 1), equityUsd: 25, tradesToday: 4 });
      expect(fullRunSkip(live(configWith({ ...NO_EXITS, maxDailyTrades: 4 })), spent)).toBeNull();
      // The same three books are skipped once any one rule is on.
      const stop = { ...NO_EXITS, stopLossPct: 15 };
      expect(fullRunSkip(live(configWith({ ...stop, maxOpenPositions: 3 })), full)).toMatchObject({ code: "position_limit" });
      expect(fullRunSkip(live(configWith({ ...stop, cashReserveUsd: 5 })), noCash)).toMatchObject({ code: "ticket" });
      expect(fullRunSkip(live(configWith({ ...stop, maxDailyTrades: 4 })), spent)).toMatchObject({ code: "daily_limit" });
    });

    it("is skipped while it holds nothing, and is not told that exits still run", () => {
      // Nothing to sell: a run could only buy, and it has no room to.
      const room = fullRunSkip(live(configWith({ ...NO_EXITS, cashReserveUsd: 5 })), bookOf({ cashUsd: 5.2, equityUsd: 5.2 }));
      expect(room).toMatchObject({ code: "ticket" });
      expect(skippingRunsSentence(room as NoRoom, exitRulesOn(configWith(NO_EXITS)))).toBe(
        "Skipping scheduled runs: no room to buy ($0.19 to spend after its $5.00 reserve, under the $2.00 smallest order).",
      );
      // A position that has been sold down to nothing is not one it holds.
      const sold = bookOf({ cashUsd: 5.2, equityUsd: 5.2, positions: [{ ...held("AAA", 0), amountToken: 0 }] });
      expect(fullRunSkip(live(configWith({ ...NO_EXITS, cashReserveUsd: 5 })), sold)).toMatchObject({ code: "ticket" });
    });
  });

  it("says the two figures apart when the limit was lowered under what it already has", () => {
    const five = [...three, held("DDD"), held("EEE")];
    const over = fullRunSkip(live(configWith({ maxOpenPositions: 3 })), bookOf({ equityUsd: 45, positions: five }));
    expect(noRoomWords(over as NoRoom)).toBe("5 held, limit 3");
    expect(skippingRunsSentence(over as NoRoom, true)).toBe(
      "Skipping scheduled runs: no room to buy (5 held, limit 3). Automatic exits still run.",
    );
    const waiting = fullRunSkip(
      live(configWith({ maxOpenPositions: 3 })),
      bookOf({ equityUsd: 35, positions: three, pendingBuyTokenIds: ["solana:DDD"] }),
    );
    expect(noRoomWords(waiting as NoRoom)).toBe("4 counted, limit 3, one of them a buy waiting for your approval");
    // At the limit exactly, the words are the ones they were.
    expect(noRoomWords(fullRunSkip(live(configWith({ maxOpenPositions: 3 })), full) as NoRoom)).toBe("3 of 3 positions");
  });

  it("says what still happens in the same words wherever it is said", () => {
    expect(SKIPPING_RUNS_STILL).toBe("Automatic exits still run.");
    const room: NoRoom = { ok: false, code: "position_limit", positions: { limit: 1, open: 1, held: 1, waiting: 0, full: true } };
    expect(skippingRunsSentence(room, true)).toBe("Skipping scheduled runs: no room to buy (1 of 1 position). Automatic exits still run.");
  });
});
