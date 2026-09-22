import { describe, expect, it } from "vitest";
import {
  MODEL_PRICES,
  combineEquity,
  estimateModelSpendUsd,
  pnlByDay,
  resolveModelPrice,
  utcDayKey,
  type SnapshotPoint,
} from "./money";

const DAY = 86_400_000;
/** 2026-09-20T00:00:00Z — a fixed Sunday, so nothing in here depends on the wall clock. */
const DAY0 = Date.UTC(2026, 8, 20);

function point(agentId: string, dayOffset: number, hour: number, equityUsd: number): SnapshotPoint {
  return { agentId, at: DAY0 + dayOffset * DAY + hour * 3_600_000, equityUsd };
}

describe("utcDayKey", () => {
  it("is UTC, never local", () => {
    expect(utcDayKey(Date.UTC(2026, 8, 20, 23, 59, 59))).toBe("2026-09-20");
    expect(utcDayKey(Date.UTC(2026, 8, 21, 0, 0, 1))).toBe("2026-09-21");
  });

  it("takes a Date or an ISO string", () => {
    expect(utcDayKey(new Date(DAY0))).toBe("2026-09-20");
    expect(utcDayKey("2026-09-20T12:00:00.000Z")).toBe("2026-09-20");
  });
});

describe("pnlByDay", () => {
  const now = DAY0 + 2 * DAY + 20 * 3_600_000;

  it("returns nothing when there is nothing", () => {
    expect(pnlByDay([], { now })).toEqual([]);
  });

  it("uses the last snapshot of each UTC day as that day's close", () => {
    const days = pnlByDay(
      [point("a", 0, 1, 100), point("a", 0, 9, 110), point("a", 0, 23, 120), point("a", 1, 12, 150)],
      { now: DAY0 + DAY + 13 * 3_600_000 },
    );
    expect(days.map((d) => [d.day, d.equityUsd])).toEqual([
      ["2026-09-20", 120],
      ["2026-09-21", 150],
    ]);
  });

  it("leaves the first day's delta null and derives the rest day over day", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 125), point("a", 2, 12, 100)], { now });
    expect(days[0].pnlUsd).toBeNull();
    expect(days[0].pnlPct).toBeNull();
    expect(days[1].pnlUsd).toBe(25);
    expect(days[1].pnlPct).toBeCloseTo(25, 10);
    expect(days[2].pnlUsd).toBe(-25);
    expect(days[2].pnlPct).toBeCloseTo(-20, 10);
  });

  it("sums across agents on the same day", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("b", 0, 13, 40), point("a", 1, 12, 110), point("b", 1, 9, 60)], {
      now: DAY0 + DAY + 20 * 3_600_000,
    });
    expect(days.map((d) => d.equityUsd)).toEqual([140, 170]);
    expect(days[1].pnlUsd).toBe(30);
    expect(days[1].agents).toBe(2);
  });

  it("carries a silent agent's close forward instead of reading it as a wipeout", () => {
    // `b` marks on day 0 and then goes quiet. Without the carry, day 1 is −$40 and day 2
    // is +$40, and the operator sees a crash that never happened.
    const days = pnlByDay([point("a", 0, 12, 100), point("b", 0, 12, 40), point("a", 1, 12, 100), point("a", 2, 12, 100), point("b", 2, 12, 40)], {
      now,
    });
    expect(days.map((d) => d.equityUsd)).toEqual([140, 140, 140]);
    expect(days.map((d) => d.pnlUsd)).toEqual([null, 0, 0]);
  });

  it("fills quiet days between snapshots, weekends included", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 3, 12, 130)], { now: DAY0 + 3 * DAY + 20 * 3_600_000 });
    expect(days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(days.map((d) => d.pnlUsd)).toEqual([null, 0, 0, 30]);
  });

  it("counts an agent only from its first snapshot, so a new book is a step not a gain", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("b", 1, 12, 500)], {
      now: DAY0 + DAY + 20 * 3_600_000,
    });
    expect(days[0]).toMatchObject({ equityUsd: 100, agents: 1 });
    expect(days[1]).toMatchObject({ equityUsd: 600, pnlUsd: 500, agents: 2 });
  });

  it("runs the days up to now even when nothing has been marked since", () => {
    const days = pnlByDay([point("a", 0, 12, 100)], { now });
    expect(days.map((d) => d.day)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(days.at(-1)).toMatchObject({ equityUsd: 100, pnlUsd: 0 });
  });

  it("does not truncate the series when the clock is behind the data", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 2, 12, 120)], { now: DAY0 });
    expect(days).toHaveLength(3);
    expect(days.at(-1)?.equityUsd).toBe(120);
  });

  it("keeps only the last `days` rows", () => {
    const points = Array.from({ length: 40 }, (_, i) => point("a", i, 12, 100 + i));
    const days = pnlByDay(points, { days: 30, now: DAY0 + 39 * DAY + 20 * 3_600_000 });
    expect(days).toHaveLength(30);
    expect(days[0].day).toBe(utcDayKey(DAY0 + 10 * DAY));
    // The trimmed-off day before still supplies the first row's delta.
    expect(days[0].pnlUsd).toBe(1);
    expect(days.at(-1)?.equityUsd).toBe(139);
  });

  it("reports no percentage against a zero base", () => {
    const days = pnlByDay([point("a", 0, 12, 0), point("a", 1, 12, 50)], { now: DAY0 + DAY + 20 * 3_600_000 });
    expect(days[1].pnlUsd).toBe(50);
    expect(days[1].pnlPct).toBeNull();
  });

  it("ignores points with an unusable timestamp or equity", () => {
    const days = pnlByDay(
      [
        point("a", 0, 12, 100),
        { agentId: "a", at: "not a date", equityUsd: 9_999 },
        { agentId: "a", at: DAY0 + DAY, equityUsd: Number.NaN },
      ],
      { now: DAY0 + 12 * 3_600_000 },
    );
    expect(days).toEqual([{ day: "2026-09-20", equityUsd: 100, pnlUsd: null, pnlPct: null, agents: 1 }]);
  });
});

describe("combineEquity", () => {
  it("buckets to 15 minutes, keeping the last point in each bucket", () => {
    const base = Date.UTC(2026, 8, 20, 12, 0);
    const series = combineEquity([
      { agentId: "a", at: base + 60_000, equityUsd: 100, cashUsd: 100 },
      { agentId: "a", at: base + 10 * 60_000, equityUsd: 105, cashUsd: 50 },
      { agentId: "a", at: base + 20 * 60_000, equityUsd: 110, cashUsd: 20 },
    ]);
    expect(series).toEqual([
      { at: new Date(base).toISOString(), equityUsd: 105, cashUsd: 50 },
      { at: new Date(base + 15 * 60_000).toISOString(), equityUsd: 110, cashUsd: 20 },
    ]);
  });

  it("sums agents and carries the quiet ones forward", () => {
    const base = Date.UTC(2026, 8, 20, 12, 0);
    const series = combineEquity([
      { agentId: "a", at: base, equityUsd: 100, cashUsd: 10 },
      { agentId: "b", at: base, equityUsd: 40, cashUsd: 40 },
      { agentId: "a", at: base + 15 * 60_000, equityUsd: 120, cashUsd: 10 },
    ]);
    expect(series.map((p) => p.equityUsd)).toEqual([140, 160]);
    expect(series.map((p) => p.cashUsd)).toEqual([50, 50]);
  });

  it("is empty for no input", () => {
    expect(combineEquity([])).toEqual([]);
  });
});

describe("model pricing", () => {
  it("prices the models the builder offers", () => {
    expect(resolveModelPrice("claude-sonnet-5")).toEqual(MODEL_PRICES["claude-sonnet-5"]);
    expect(resolveModelPrice("claude-opus-5")?.outputPerMTok).toBe(75);
    expect(resolveModelPrice("gpt-5")?.inputPerMTok).toBe(1.25);
  });

  it("looks through an OpenRouter vendor prefix", () => {
    expect(resolveModelPrice("anthropic/claude-sonnet-5")).toEqual(MODEL_PRICES["claude-sonnet-5"]);
  });

  it("matches a dated snapshot either way round", () => {
    expect(resolveModelPrice("claude-haiku-4-5")?.inputPerMTok).toBe(1);
    expect(resolveModelPrice("claude-haiku-4-5-20251001")?.inputPerMTok).toBe(1);
  });

  it("says it does not know rather than guessing", () => {
    expect(resolveModelPrice("deepseek/deepseek-v4")).toBeNull();
    expect(resolveModelPrice("")).toBeNull();
    expect(resolveModelPrice(null)).toBeNull();
    expect(estimateModelSpendUsd("nousresearch/hermes-4-405b", { inputTokens: 1e6, outputTokens: 1e6 })).toBeNull();
  });

  it("charges input and output at their own rates, per million tokens", () => {
    // 2M in at $3, 0.5M out at $15 → $6 + $7.50.
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: 2_000_000, outputTokens: 500_000 })).toBeCloseTo(
      13.5,
      10,
    );
    expect(estimateModelSpendUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("never turns a negative count into a credit", () => {
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: -5_000_000, outputTokens: 1_000_000 })).toBe(15);
  });
});
