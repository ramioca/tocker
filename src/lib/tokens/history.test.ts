import { beforeAll, describe, expect, it } from "vitest";
import { setupTestDb } from "@/lib/agent/test-support";
import type { TokenScore } from "@/server/types";
import { DEDUPE_WINDOW_MS, getScoreHistory, recordScore, shouldRecord } from "./history";

const TOKEN = "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function score(over: Partial<TokenScore> = {}): TokenScore {
  return {
    tokenId: TOKEN,
    chain: "solana",
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    symbol: "BONK",
    name: "Bonk",
    total: 72,
    verdict: "candidate",
    components: { safety: 80, liquidity: 70, organic: 65, distribution: 60, momentum: 55, gecko: null, sentiment: null, smartMoney: null },
    blockers: [],
    warnings: [],
    priceUsd: 0.0000318,
    liquidityUsd: 1_250_000,
    volume24hUsd: 9_000_000,
    marketCapUsd: 2_100_000_000,
    holderCount: 812_000,
    ageHours: 9_000,
    priceChange24hPct: 4.2,
    sources: ["jupiter", "rugcheck"],
    scoredAt: new Date("2026-09-13T12:00:00.000Z").toISOString(),
    ...over,
  };
}

describe("shouldRecord", () => {
  const base = score();

  it("records the first point for a token", () => {
    expect(shouldRecord(base, null)).toBe(true);
  });

  it("skips a rescore inside the window that says the same thing", () => {
    const last = { total: 72, scoredAt: new Date(Date.parse(base.scoredAt) - 30_000) };
    expect(shouldRecord(base, last)).toBe(false);
  });

  it("records a rescore inside the window when the total moved", () => {
    const last = { total: 66, scoredAt: new Date(Date.parse(base.scoredAt) - 30_000) };
    expect(shouldRecord(base, last)).toBe(true);
  });

  it("records an unchanged total once the window has passed — a flat line is information", () => {
    const last = { total: 72, scoredAt: new Date(Date.parse(base.scoredAt) - DEDUPE_WINDOW_MS - 1) };
    expect(shouldRecord(base, last)).toBe(true);
  });

  it("treats the window boundary as recordable", () => {
    const last = { total: 72, scoredAt: new Date(Date.parse(base.scoredAt) - DEDUPE_WINDOW_MS) };
    expect(shouldRecord(base, last)).toBe(true);
  });

  it("ignores sub-hundredth noise in the total", () => {
    const last = { total: 72.001, scoredAt: new Date(Date.parse(base.scoredAt) - 10_000) };
    expect(shouldRecord(base, last)).toBe(false);
  });

  it("records a row that arrives out of order rather than dropping it", () => {
    const last = { total: 72, scoredAt: new Date(Date.parse(base.scoredAt) + 60_000) };
    expect(shouldRecord(base, last)).toBe(true);
  });

  it("honours a caller-supplied window", () => {
    const last = { total: 72, scoredAt: new Date(Date.parse(base.scoredAt) - 5_000) };
    expect(shouldRecord(base, last, 1_000)).toBe(true);
    expect(shouldRecord(base, last, 60_000)).toBe(false);
  });
});

describe("recordScore + getScoreHistory", () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  it("appends, dedupes against the database, and reads back oldest first", async () => {
    const t0 = Date.parse("2026-09-13T12:00:00.000Z");

    await recordScore(score({ total: 72, scoredAt: new Date(t0).toISOString() }));
    // same total, 30s later → skipped
    await recordScore(score({ total: 72, scoredAt: new Date(t0 + 30_000).toISOString() }));
    // moved, 60s later → kept
    await recordScore(score({ total: 64, verdict: "candidate", scoredAt: new Date(t0 + 90_000).toISOString() }));
    // same total as the last one but well past the window → kept
    await recordScore(score({ total: 64, scoredAt: new Date(t0 + 10 * 60_000).toISOString() }));

    const history = await getScoreHistory(TOKEN, { days: 3_650 });
    expect(history.map((p) => p.total)).toEqual([72, 64, 64]);
    expect(history.map((p) => p.at)).toEqual([
      new Date(t0).toISOString(),
      new Date(t0 + 90_000).toISOString(),
      new Date(t0 + 10 * 60_000).toISOString(),
    ]);
    expect(history[0]).toMatchObject({ verdict: "candidate", holderCount: 812_000 });
    expect(history[0].liquidityUsd).toBeCloseTo(1_250_000, 2);
  });

  it("skips a reading no provider answered", async () => {
    const empty = "solana:NODATA";
    const at = new Date(Date.now() - 60_000).toISOString();
    await recordScore(score({ tokenId: empty, sources: [], scoredAt: at }));
    await recordScore(
      score({ tokenId: empty, priceUsd: null, liquidityUsd: null, holderCount: null, scoredAt: at }),
    );
    expect(await getScoreHistory(empty, { days: 30 })).toEqual([]);
  });

  it("returns nothing for a token nobody ever scored", async () => {
    expect(await getScoreHistory("base:0xdeadbeef", { days: 30 })).toEqual([]);
  });

  it("respects the day window", async () => {
    const old = "solana:OLD";
    await recordScore(score({ tokenId: old, total: 50, scoredAt: new Date(Date.now() - 90 * 86_400_000).toISOString() }));
    await recordScore(score({ tokenId: old, total: 55, scoredAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }));
    expect((await getScoreHistory(old, { days: 30 })).map((p) => p.total)).toEqual([55]);
    expect((await getScoreHistory(old, { days: 365 })).map((p) => p.total)).toEqual([50, 55]);
  });
});
