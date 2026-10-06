import { beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import {
  EQUITY_BUCKET_MS,
  MODEL_PRICES,
  combineEquity,
  estimateModelSpendUsd,
  getMoney,
  pnlByDay,
  resolveModelPrice,
  utcDayKey,
  type SnapshotPoint,
} from "./money";

// A live book reads the wallet through `getPortfolio`; with no network in tests, make it
// fail the way an RPC outage does so `getMoney` takes its snapshot fallback.
vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async () => {
    throw new Error("offline in tests");
  },
}));

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
    // b's $500 opening book is money in, not a $500 day.
    expect(days[1]).toMatchObject({ equityUsd: 600, pnlUsd: 0, pnlPct: 0, flowUsd: 500, agents: 2 });
  });

  it("takes a deposit out of the day's P&L and measures the percentage against what came in", () => {
    // a: 100 → deposit 500 at 14:00 → closes at 630. 30 of that is a gain, 500 is money moved.
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("a", 1, 20, 630)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "a", at: DAY0 + DAY + 14 * 3_600_000, amountUsd: 500 }],
    });
    expect(days[1]).toMatchObject({ equityUsd: 630, pnlUsd: 30, flowUsd: 500 });
    expect(days[1].pnlPct).toBeCloseTo(5, 10); // 30 on 100 + 500
  });

  it("takes a withdrawal out of the day's P&L, so money taken out is not a loss", () => {
    const days = pnlByDay([point("a", 0, 12, 600), point("a", 1, 20, 110)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "a", at: DAY0 + DAY + 9 * 3_600_000, amountUsd: -500 }],
    });
    expect(days[1]).toMatchObject({ equityUsd: 110, pnlUsd: 10, flowUsd: -500 });
    expect(days[1].pnlPct).toBeCloseTo((10 / 600) * 100, 10);
  });

  it("does not count a deposit twice when it is already inside the agent's opening book", () => {
    // b is funded at 11:50 and first marked at 12:00: the 500 is its opening book.
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 100), point("b", 1, 12, 500), point("b", 1, 20, 520)], {
      now: DAY0 + DAY + 21 * 3_600_000,
      flows: [{ agentId: "b", at: DAY0 + DAY + 11 * 3_600_000 + 50 * 60_000, amountUsd: 500 }],
      resolutionMs: EQUITY_BUCKET_MS,
    });
    expect(days[1]).toMatchObject({ equityUsd: 620, pnlUsd: 20, flowUsd: 500 });
  });

  it("ignores flows for agents it has no book for", () => {
    const days = pnlByDay([point("a", 0, 12, 100), point("a", 1, 12, 110)], {
      now: DAY0 + DAY + 13 * 3_600_000,
      flows: [{ agentId: "ghost", at: DAY0 + DAY, amountUsd: 900 }],
    });
    expect(days[1]).toMatchObject({ pnlUsd: 10, flowUsd: 0 });
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
    expect(days).toEqual([{ day: "2026-09-20", equityUsd: 100, pnlUsd: null, pnlPct: null, flowUsd: 0, agents: 1 }]);
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
    expect(resolveModelPrice("claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("claude-opus-5")?.outputPerMTok).toBe(25);
    expect(resolveModelPrice("gpt-5")?.inputPerMTok).toBe(1.25);
  });

  /** One version is not another at a different price: the old prefix match read 5.5 as 5. */
  it("prices each version as itself", () => {
    expect(resolveModelPrice("claude-opus-5-5")).toMatchObject({ label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 });
    expect(resolveModelPrice("claude-sonnet-5-5")).toMatchObject({ label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("anthropic/claude-opus-5.5")?.inputPerMTok).toBe(4);
    expect(resolveModelPrice("gpt-5-mini")?.inputPerMTok).toBe(0.25);
    expect(resolveModelPrice("claude-opus-5-9")).toBeNull();
  });

  it("looks through an OpenRouter vendor prefix", () => {
    // OpenRouter resells at the same list price; only the label says where it came from.
    expect(resolveModelPrice("anthropic/claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveModelPrice("openai/gpt-5")).toEqual(MODEL_PRICES["gpt-5"]);
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
    // 2M in at $2, 0.5M out at $10 → $4 + $5.
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: 2_000_000, outputTokens: 500_000 })).toBeCloseTo(
      9,
      10,
    );
    expect(estimateModelSpendUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("never turns a negative count into a credit", () => {
    expect(estimateModelSpendUsd("claude-sonnet-5", { inputTokens: -5_000_000, outputTokens: 1_000_000 })).toBe(10);
  });
});

describe("getMoney", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 120_000);

  async function snapshot(agentId: string, at: number, equityUsd: number, mode: "paper" | "live") {
    await db.insert(schema.equitySnapshots).values({
      id: nanoid(),
      agentId,
      equityUsd: toNumeric(equityUsd, 6),
      cashUsd: toNumeric(equityUsd, 6),
      at: new Date(at),
      mode,
    });
  }

  it("runs the bucketed snapshot query against a real Postgres", async () => {
    // The bucket expression sits in both SELECT and GROUP BY. Bound as a parameter, each
    // use is its own `$n` and Postgres rejects the query — the whole page 500'd on it.
    const { userId, agentId } = await seedAgent(db, { mode: "live" });
    const bucket = Math.floor(Date.now() / EQUITY_BUCKET_MS) * EQUITY_BUCKET_MS - EQUITY_BUCKET_MS;
    await snapshot(agentId, bucket + 60_000, 100, "live");
    await snapshot(agentId, bucket + 10 * 60_000, 112, "live");

    const money = await getMoney(userId);

    expect(money.equity).toHaveLength(1);
    expect(money.equity[0].equityUsd).toBe(112);
    expect(money.live[0]).toMatchObject({ equityUsd: 112, stale: true });
  });

  it("reads deposits and withdrawals as flows, not as the day's P&L", async () => {
    const { userId, agentId } = await seedAgent(db, { mode: "live" });
    const today = Math.floor(Date.now() / DAY) * DAY;
    const yesterday = today - DAY;
    await snapshot(agentId, yesterday + 12 * 3_600_000, 100, "live");
    // Today: $500 funded, $40 withdrawn, and the book closes at 575 — a $15 day.
    const at = Math.min(Date.now() - 60_000, today + 60_000);
    await db.insert(schema.agentFundingIntents).values({
      id: nanoid(),
      agentId,
      userId,
      chain: "base",
      asset: "usdc",
      amount: "500",
      status: "sent",
      toAddress: "0x0000000000000000000000000000000000000001",
      createdAt: new Date(at),
      settledAt: new Date(at),
    });
    await db.insert(schema.auditEvents).values([
      {
        id: nanoid(),
        userId,
        kind: "withdraw",
        agentId,
        summary: "Withdrew 40 USDC.",
        metadata: { chain: "base", asset: "usdc", amount: 40, to: "0x1", txHash: "0x2" },
        createdAt: new Date(at),
      },
      {
        // Fee settlement shares the kind, but it is a cost, not the owner taking money out.
        id: nanoid(),
        userId,
        kind: "withdraw",
        agentId,
        summary: "Settled fees.",
        metadata: { reason: "platform_fee_settlement", chain: "base", amountUsd: 0.3 },
        createdAt: new Date(at),
      },
    ]);
    await snapshot(agentId, Math.min(Date.now() - 30_000, today + 120_000), 575, "live");

    const money = await getMoney(userId);

    expect(money.today.flowUsd).toBeCloseTo(460, 6);
    expect(money.today.pnlUsd).toBeCloseTo(15, 6);
    // Postgres prints a timestamptz as "… +00", which `Date` cannot parse.
    expect(money.live[0].firstFundedAt).toBe(new Date(at).toISOString());
  });
});
