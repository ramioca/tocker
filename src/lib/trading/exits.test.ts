import { describe, expect, it } from "vitest";
import {
  DUST_VALUE_USD,
  EXIT_PRIORITY,
  evaluateExits,
  describeExit,
  describeExits,
  hasAnyExitRule,
  heldHours,
  liquidityText,
  needsRescore,
  priceText,
  publicExitText,
  stopPrice,
  takeProfitPrice,
  toExitRules,
  trailingStopPrice,
  type ExitPosition,
  type ExitRules,
} from "./exits";

const NOW = new Date("2026-09-13T12:00:00.000Z");

const OFF: ExitRules = {
  stopLossPct: null,
  takeProfitPct: null,
  trailingStopPct: null,
  maxHoldHours: null,
  exitScoreBelow: null,
  exitOnLiquidityDropPct: null,
};

function position(overrides: Partial<ExitPosition> = {}): ExitPosition {
  return {
    tokenId: "solana:BONKMINT",
    chain: "solana",
    address: "BONKMINT",
    symbol: "BONK",
    amountToken: 1_000_000,
    avgCostUsd: 0.0000323,
    markPriceUsd: 0.0000323,
    peakPriceUsd: 0.0000323,
    openedAt: new Date(NOW.getTime() - 3 * 3_600_000),
    entryScore: 74,
    entryLiquidityUsd: 310_000,
    ...overrides,
  };
}

function run(rules: Partial<ExitRules>, positions: ExitPosition[], now = NOW) {
  return evaluateExits({ rules: { ...OFF, ...rules }, positions, now });
}

describe("evaluateExits — stop loss", () => {
  it("fires at exactly the stop price and reads as a human sentence", () => {
    const p = position({ avgCostUsd: 0.0000323, markPriceUsd: 0.0000323 * 0.85 });
    const [decision, ...rest] = run({ stopLossPct: 15 }, [p]);
    expect(rest).toHaveLength(0);
    expect(decision?.reason).toBe("stop_loss");
    expect(decision?.priority).toBe(1);
    expect(decision?.rationale).toMatch(/^Stop loss: BONK at \$0\.0000275\d*, −15\.0% from entry \(\$0\.0000323\)/);
    expect(decision?.rationale).toContain("15% stop");
    expect(decision?.rationale).toContain("out.");
  });

  it("fires below the stop and exits the whole position at the mark", () => {
    const p = position({ amountToken: 1_500_000, avgCostUsd: 0.00002, markPriceUsd: 0.0000162 });
    const [decision] = run({ stopLossPct: 15 }, [p]);
    expect(decision?.reason).toBe("stop_loss");
    expect(decision?.amountToken).toBe(1_500_000);
    expect(decision?.amountUsd).toBeCloseTo(1_500_000 * 0.0000162, 10);
    expect(decision?.unrealizedPnlPct).toBeCloseTo(-19, 6);
    expect(decision?.rationale).toContain("−19.0%");
  });

  it("does not fire one tick above the stop", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.8501 });
    expect(run({ stopLossPct: 15 }, [p])).toHaveLength(0);
  });

  it("is off when stopLossPct is null", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.1 });
    expect(run({}, [p])).toHaveLength(0);
  });
});

describe("evaluateExits — take profit", () => {
  it("fires at or above the target", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 1.4 });
    const [decision] = run({ takeProfitPct: 40 }, [p]);
    expect(decision?.reason).toBe("take_profit");
    expect(decision?.priority).toBe(2);
    expect(decision?.rationale).toMatch(/^Take profit: BONK at \$[\d.]+, \+40\.0% from entry \(\$[\d.]+\)/);
    expect(decision?.rationale).toContain("40% target");
  });

  it("does not fire below the target", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 1.3999 });
    expect(run({ takeProfitPct: 40 }, [p])).toHaveLength(0);
  });
});

describe("evaluateExits — trailing stop", () => {
  it("fires once price retraces past the trail from the peak", () => {
    const p = position({ avgCostUsd: 1, peakPriceUsd: 2, markPriceUsd: 1.6 });
    const [decision] = run({ trailingStopPct: 20 }, [p]);
    expect(decision?.reason).toBe("trailing_stop");
    expect(decision?.priority).toBe(3);
    expect(decision?.rationale).toContain("fell 20.0% from its $2.00 peak");
    expect(decision?.rationale).toContain("Still +60.0%");
  });

  it("does not fire while the retrace is shallower than the trail", () => {
    const p = position({ avgCostUsd: 1, peakPriceUsd: 2, markPriceUsd: 1.61 });
    expect(run({ trailingStopPct: 20 }, [p])).toHaveLength(0);
  });

  it("stays disarmed when the position has never been above entry", () => {
    // Peak equals entry: a position that only ever went down is the fixed stop's job.
    const p = position({ avgCostUsd: 1, peakPriceUsd: 1, markPriceUsd: 0.5 });
    expect(run({ trailingStopPct: 20 }, [p])).toHaveLength(0);
  });

  it("never fires underwater, even after a big round trip", () => {
    // Peaked at 2 (from 1), now 0.95: the trail would fire at 1.6, but firing here would
    // realise a loss the fixed stop never authorised.
    const p = position({ avgCostUsd: 1, peakPriceUsd: 2, markPriceUsd: 0.95 });
    expect(run({ trailingStopPct: 20 }, [p])).toHaveLength(0);
    // With a stop loss configured, the stop — not the trail — is what closes it.
    const [decision] = run({ trailingStopPct: 20, stopLossPct: 4 }, [p]);
    expect(decision?.reason).toBe("stop_loss");
  });

  it("is skipped when no peak has been recorded yet", () => {
    const p = position({ avgCostUsd: 1, peakPriceUsd: null, markPriceUsd: 1.2 });
    expect(run({ trailingStopPct: 5 }, [p])).toHaveLength(0);
  });
});

describe("evaluateExits — max hold", () => {
  it("fires once the position is older than the limit", () => {
    const p = position({ openedAt: new Date(NOW.getTime() - 26.3 * 3_600_000), avgCostUsd: 1, markPriceUsd: 1.03 });
    const [decision] = run({ maxHoldHours: 24 }, [p]);
    expect(decision?.reason).toBe("max_hold");
    expect(decision?.priority).toBe(4);
    expect(decision?.rationale).toContain("open 26.3h");
    expect(decision?.rationale).toContain("past my 24.0h limit");
  });

  it("does not fire on a position opened this tick", () => {
    const p = position({ openedAt: NOW, avgCostUsd: 1, markPriceUsd: 1 });
    expect(run({ maxHoldHours: 0.25 }, [p])).toHaveLength(0);
  });

  it("does not fire when openedAt is unknown", () => {
    const p = position({ openedAt: null, avgCostUsd: 1, markPriceUsd: 1 });
    expect(run({ maxHoldHours: 1 }, [p])).toHaveLength(0);
  });

  it("renders sub-hour and multi-day limits readably", () => {
    const p = position({ openedAt: new Date(NOW.getTime() - 80 * 3_600_000), avgCostUsd: 1, markPriceUsd: 1 });
    const [decision] = run({ maxHoldHours: 72 }, [p]);
    expect(decision?.rationale).toContain("open 3.3d");
    expect(decision?.rationale).toContain("past my 3.0d limit");
  });
});

describe("evaluateExits — score collapse", () => {
  const collapsed = { total: 31, verdict: "avoid" as const, blockers: [], liquidityUsd: 280_000 };

  it("fires when a fresh total falls under the floor", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.95, score: collapsed });
    const [decision] = run({ exitScoreBelow: 40 }, [p]);
    expect(decision?.reason).toBe("score_collapse");
    expect(decision?.priority).toBe(5);
    expect(decision?.rationale).toContain("now scores 31.0/100 (avoid)");
    expect(decision?.rationale).toContain("against 74 at entry");
    expect(decision?.rationale).toContain("exit floor of 40");
  });

  it("fires on verdict avoid with blockers even when the total is above the floor", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 1.1,
      score: { total: 66, verdict: "avoid", blockers: ["honeypot", "mint_authority_active"], liquidityUsd: 90_000 },
    });
    const [decision] = run({ exitScoreBelow: 40 }, [p]);
    expect(decision?.reason).toBe("score_collapse");
    // The authority was already active at entry (it cannot be re-enabled), so only the honeypot counts.
    expect(decision?.rationale).toContain("Blockers: honeypot.");
  });

  it("ignores entry-shape gates: an old token under a fresh-launch posture is not a collapse", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 1.2,
      score: { total: 71, verdict: "avoid", blockers: ["age_above_max"], liquidityUsd: 2_000_000 },
    });
    expect(run({ exitScoreBelow: 40 }, [p])).toEqual([]);
  });

  it("ignores permanent facts that were true at entry: authorities and concentration", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 0.92,
      score: { total: 63, verdict: "avoid", blockers: ["mint_authority_active", "top10_holders_67pct"], liquidityUsd: 900_000 },
    });
    expect(run({ exitScoreBelow: 40 }, [p])).toEqual([]);
  });

  it("ignores provider gaps: an unknown authority is a missing answer, not a rug", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 0.97,
      score: { total: 58, verdict: "avoid", blockers: ["mint_authority_unknown", "liquidity_unknown"], liquidityUsd: null },
    });
    expect(run({ exitScoreBelow: 40 }, [p])).toEqual([]);
  });

  it("still fires on real deterioration among entry-shape noise, and reports only the real part", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 0.9,
      score: { total: 61, verdict: "avoid", blockers: ["age_above_max", "liquidity_below_floor"], liquidityUsd: 3_000 },
    });
    const [decision] = run({ exitScoreBelow: 40 }, [p]);
    expect(decision?.reason).toBe("score_collapse");
    expect(decision?.rationale).toContain("Blockers: liquidity_below_floor.");
    expect(decision?.rationale).not.toContain("age_above_max");
  });

  it("gives a low-confidence score no vote: a provider outage must not liquidate the book", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 1.05,
      entryLiquidityUsd: 1_000_000,
      score: { total: 12, verdict: "avoid", blockers: ["liquidity_below_floor"], liquidityUsd: 0, warnings: ["low_confidence"] },
    });
    expect(run({ exitScoreBelow: 40, exitOnLiquidityDropPct: 50 }, [p])).toEqual([]);
  });

  it("does nothing without a fresh score — no score means no opinion", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.95 });
    expect(run({ exitScoreBelow: 40 }, [p])).toHaveLength(0);
    const stale = position({ avgCostUsd: 1, markPriceUsd: 0.95, score: null });
    expect(run({ exitScoreBelow: 40 }, [stale])).toHaveLength(0);
  });

  it("does nothing when the rule is off, however bad the score", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.95, score: { ...collapsed, total: 2 } });
    expect(run({}, [p])).toHaveLength(0);
  });

  it("omits the entry comparison when the position has no entry score", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.95, entryScore: null, score: collapsed });
    const [decision] = run({ exitScoreBelow: 40 }, [p]);
    expect(decision?.rationale).not.toContain("at entry");
  });
});

describe("evaluateExits — liquidity collapse", () => {
  it("fires when the pool has drained past the limit", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 1.02,
      entryLiquidityUsd: 310_000,
      score: { total: 70, verdict: "candidate", blockers: [], liquidityUsd: 115_000 },
    });
    const [decision] = run({ exitOnLiquidityDropPct: 50 }, [p]);
    expect(decision?.reason).toBe("liquidity_collapse");
    expect(decision?.priority).toBe(6);
    expect(decision?.rationale).toContain("down 63% since I bought ($310k → $115k)");
    expect(decision?.rationale).toContain("past my 50% limit");
  });

  it("does not fire on a shallower drain", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 1,
      entryLiquidityUsd: 310_000,
      score: { total: 70, verdict: "candidate", blockers: [], liquidityUsd: 160_000 },
    });
    expect(run({ exitOnLiquidityDropPct: 50 }, [p])).toHaveLength(0);
  });

  it("needs both an entry liquidity and a fresh reading", () => {
    const noEntry = position({
      avgCostUsd: 1,
      markPriceUsd: 1,
      entryLiquidityUsd: null,
      score: { total: 70, verdict: "candidate", blockers: [], liquidityUsd: 10 },
    });
    expect(run({ exitOnLiquidityDropPct: 50 }, [noEntry])).toHaveLength(0);

    const noFresh = position({
      avgCostUsd: 1,
      markPriceUsd: 1,
      entryLiquidityUsd: 310_000,
      score: { total: 70, verdict: "candidate", blockers: [], liquidityUsd: null },
    });
    expect(run({ exitOnLiquidityDropPct: 50 }, [noFresh])).toHaveLength(0);
  });
});

describe("evaluateExits — priority and guards", () => {
  it("returns the highest-priority reason when several rules fire", () => {
    // Underwater past the stop, 40 hours old, score in the gutter, pool drained.
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 0.5,
      peakPriceUsd: 1.4,
      openedAt: new Date(NOW.getTime() - 40 * 3_600_000),
      entryLiquidityUsd: 300_000,
      score: { total: 10, verdict: "avoid", blockers: ["honeypot"], liquidityUsd: 1_000 },
    });
    const decisions = run(
      { stopLossPct: 15, takeProfitPct: 40, trailingStopPct: 20, maxHoldHours: 24, exitScoreBelow: 40, exitOnLiquidityDropPct: 50 },
      [p],
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe("stop_loss");
  });

  it("falls through to the next rule when the higher one is off", () => {
    const p = position({
      avgCostUsd: 1,
      markPriceUsd: 0.5,
      openedAt: new Date(NOW.getTime() - 40 * 3_600_000),
      score: { total: 10, verdict: "avoid", blockers: [], liquidityUsd: 1_000 },
    });
    expect(run({ maxHoldHours: 24, exitScoreBelow: 40 }, [p])[0]?.reason).toBe("max_hold");
    expect(run({ exitScoreBelow: 40 }, [p])[0]?.reason).toBe("score_collapse");
  });

  it("never exits a position it cannot price", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: null });
    expect(run({ stopLossPct: 1, maxHoldHours: 0.5, takeProfitPct: 1 }, [p])).toHaveLength(0);
  });

  it("leaves dust below $1 alone", () => {
    const dust = position({ amountToken: 10, avgCostUsd: 1, markPriceUsd: 0.05 }); // $0.50
    expect(run({ stopLossPct: 15 }, [dust])).toHaveLength(0);
    // Same position, one cent over the threshold, does fire.
    const worth = position({ amountToken: 30, avgCostUsd: 1, markPriceUsd: 0.05 }); // $1.50
    expect(run({ stopLossPct: 15 }, [worth])).toHaveLength(1);
    expect(DUST_VALUE_USD).toBe(1);
  });

  it("respects a caller-supplied dust floor", () => {
    const p = position({ amountToken: 30, avgCostUsd: 1, markPriceUsd: 0.05 });
    expect(evaluateExits({ rules: { ...OFF, stopLossPct: 15 }, positions: [p], now: NOW, minValueUsd: 5 })).toHaveLength(0);
  });

  it("skips a flat or negative position row", () => {
    const flat = position({ amountToken: 0, avgCostUsd: 1, markPriceUsd: 0.1 });
    expect(run({ stopLossPct: 15 }, [flat])).toHaveLength(0);
  });

  it("returns nothing when every rule is off", () => {
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.01, score: { total: 0, verdict: "avoid", blockers: ["x"], liquidityUsd: 1 } });
    expect(run({}, [p])).toHaveLength(0);
  });

  it("evaluates every position independently and keeps input order", () => {
    const a = position({ tokenId: "solana:A", symbol: "AAA", avgCostUsd: 1, markPriceUsd: 0.5 });
    const b = position({ tokenId: "solana:B", symbol: "BBB", avgCostUsd: 1, markPriceUsd: 1.0 });
    const c = position({ tokenId: "solana:C", symbol: "CCC", avgCostUsd: 1, markPriceUsd: 1.5 });
    const decisions = run({ stopLossPct: 15, takeProfitPct: 40 }, [a, b, c]);
    expect(decisions.map((d) => d.symbol)).toEqual(["AAA", "CCC"]);
    expect(decisions.map((d) => d.reason)).toEqual(["stop_loss", "take_profit"]);
  });

  it("tolerates a zero cost basis without producing NaN text", () => {
    const p = position({ avgCostUsd: 0, markPriceUsd: 1, openedAt: new Date(NOW.getTime() - 10 * 3_600_000) });
    const [decision] = run({ stopLossPct: 15, maxHoldHours: 1 }, [p]);
    expect(decision?.reason).toBe("max_hold");
    expect(decision?.unrealizedPnlPct).toBeNull();
    expect(decision?.rationale).not.toMatch(/NaN/);
  });

  it("defaults `now` to the wall clock", () => {
    const p = position({ openedAt: new Date(Date.now() - 5 * 3_600_000), avgCostUsd: 1, markPriceUsd: 1 });
    const decisions = evaluateExits({ rules: { ...OFF, maxHoldHours: 1 }, positions: [p] });
    expect(decisions[0]?.reason).toBe("max_hold");
  });
});

describe("rule helpers", () => {
  it("exposes the priority order the guardian publishes", () => {
    expect(EXIT_PRIORITY).toEqual([
      "stop_loss",
      "take_profit",
      "trailing_stop",
      "max_hold",
      "score_collapse",
      "liquidity_collapse",
    ]);
  });

  it("computes trigger prices, or null when a rule is off", () => {
    expect(stopPrice(1, 15)).toBeCloseTo(0.85, 12);
    expect(stopPrice(1, null)).toBeNull();
    expect(stopPrice(0, 15)).toBeNull();
    expect(takeProfitPrice(1, 40)).toBeCloseTo(1.4, 12);
    expect(takeProfitPrice(1, null)).toBeNull();
    expect(trailingStopPrice(2, 1, 20)).toBeCloseTo(1.6, 12);
    expect(trailingStopPrice(2, 1, null)).toBeNull();
    expect(trailingStopPrice(null, 1, 20)).toBeNull();
    expect(trailingStopPrice(1, 1, 20)).toBeNull(); // peak never beat entry
  });

  it("measures held hours defensively", () => {
    expect(heldHours(null, NOW)).toBeNull();
    expect(heldHours(new Date(NOW.getTime() - 7_200_000), NOW)).toBeCloseTo(2, 9);
    // A clock skew that puts the entry in the future clamps to zero rather than going negative.
    expect(heldHours(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });

  it("knows when rules are armed and when a rescore is needed", () => {
    expect(hasAnyExitRule(OFF)).toBe(false);
    expect(hasAnyExitRule({ ...OFF, stopLossPct: 10 })).toBe(true);
    expect(needsRescore({ ...OFF, stopLossPct: 10 })).toBe(false);
    expect(needsRescore({ ...OFF, exitScoreBelow: 40 })).toBe(true);
    expect(needsRescore({ ...OFF, exitOnLiquidityDropPct: 50 })).toBe(true);
  });

  it("narrows a risk config to the exit rules", () => {
    expect(
      toExitRules({
        stopLossPct: 15,
        takeProfitPct: 40,
        trailingStopPct: null,
        maxHoldHours: null,
        exitScoreBelow: 40,
        exitOnLiquidityDropPct: 50,
      }),
    ).toEqual({
      stopLossPct: 15,
      takeProfitPct: 40,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: 40,
      exitOnLiquidityDropPct: 50,
    });
  });

  it("formats memecoin prices without exponents or trailing zeros", () => {
    expect(priceText(0.0000271)).toBe("$0.0000271");
    expect(priceText(0.0000026936)).toBe("$0.00000269");
    expect(priceText(0.5412)).toBe("$0.541");
    expect(priceText(1.5)).toBe("$1.50");
    expect(priceText(3122.8)).toBe("$3123");
    expect(priceText(0)).toBe("$0");
    expect(priceText(Number.NaN)).toBe("$?");
  });

  it("formats pool depth by order of magnitude", () => {
    expect(liquidityText(310_000)).toBe("$310k");
    expect(liquidityText(1_250_000)).toBe("$1.3M");
    expect(liquidityText(420)).toBe("$420");
    expect(liquidityText(null)).toBe("unknown");
  });

  it("names the rule and prints cents", () => {
    expect(describeExit({ reason: "take_profit", symbol: "BONK", amountUsd: 2140.64, unrealizedPnlPct: 91.5 })).toBe(
      "Take profit: sold BONK for $2,140.64 (+91.5%)",
    );
    expect(describeExit({ reason: "max_hold", symbol: "WIF", amountUsd: 12 })).toBe("Max hold: sold WIF for $12.00");
    expect(describeExit({ reason: "not_a_rule", symbol: "WIF", amountUsd: 12 })).toBe("Exit: sold WIF for $12.00");
  });

  it("summarises a pass for the transcript", () => {
    expect(describeExits([])).toBe("No exit rules fired.");
    const p = position({ avgCostUsd: 1, markPriceUsd: 0.8, amountToken: 100 });
    expect(describeExits(run({ stopLossPct: 15 }, [p]))).toBe("Stop loss: sold BONK for $80.00 (−20.0%)");
  });
});

describe("evaluateExits — the public line", () => {
  // The owner's rule values are their strategy. A fill price is public, so any number
  // that names the stop, the target, the trail, the hold limit, the score floor or the
  // liquidity drop would hand a non-owner the setting.
  const cases: Array<{ name: string; rules: Partial<ExitRules>; p: ExitPosition; secret: string; line: string }> = [
    {
      name: "stop loss",
      rules: { stopLossPct: 15 },
      p: position({ avgCostUsd: 1, markPriceUsd: 0.8, amountToken: 100 }),
      secret: "15%",
      line: "Stop loss: closed BONK at −20.0% from entry. $80.00 out.",
    },
    {
      name: "take profit",
      rules: { takeProfitPct: 35 },
      p: position({ avgCostUsd: 1, markPriceUsd: 1.915, amountToken: 100 }),
      secret: "35%",
      line: "Take profit: sold BONK at +91.5% from entry. $191.50 out.",
    },
    {
      name: "trailing stop",
      rules: { trailingStopPct: 20 },
      p: position({ avgCostUsd: 1, peakPriceUsd: 2, markPriceUsd: 1.6, amountToken: 100 }),
      secret: "20",
      line: "Trailing stop: sold BONK off its high at +60.0% from entry. $160.00 out.",
    },
    {
      name: "max hold",
      rules: { maxHoldHours: 24 },
      p: position({ avgCostUsd: 1, markPriceUsd: 1.05, amountToken: 100, openedAt: new Date(NOW.getTime() - 26 * 3_600_000) }),
      secret: "24",
      line: "Max hold: closed BONK at +5.0% from entry. $105.00 out.",
    },
    {
      name: "score collapse",
      rules: { exitScoreBelow: 40 },
      p: position({
        avgCostUsd: 1,
        markPriceUsd: 0.9,
        amountToken: 100,
        score: { total: 31, verdict: "avoid", blockers: ["liquidity_below_floor"], liquidityUsd: 90_000 },
      }),
      secret: "40",
      line: "Score collapse: sold BONK at −10.0% from entry after its score fell. $90.00 out.",
    },
    {
      name: "liquidity collapse",
      rules: { exitOnLiquidityDropPct: 50 },
      p: position({
        avgCostUsd: 1,
        markPriceUsd: 0.9,
        amountToken: 100,
        score: { total: 70, verdict: "watch", blockers: [], liquidityUsd: 115_000 },
      }),
      secret: "50%",
      line: "Liquidity collapse: sold BONK at −10.0% from entry as its pool thinned. $90.00 out.",
    },
  ];

  for (const c of cases) {
    it(`${c.name}: states what happened, never the rule value`, () => {
      const [decision] = run(c.rules, [c.p]);
      expect(decision?.publicRationale).toBe(c.line);
      expect(decision?.publicRationale).not.toContain(c.secret);
      expect(decision?.publicRationale).not.toMatch(/\bmy\b/);
      // The owner's version still names the rule, so they can see why it fired.
      expect(decision?.rationale).toContain("my ");
    });
  }

  it("leaves the percentage out when entry cost is unknown", () => {
    expect(publicExitText("stop_loss", "BONK", null)).toBe("Stop loss: closed BONK.");
  });
});
