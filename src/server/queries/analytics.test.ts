/**
 * The Performance tab's max drawdown, worked out where the rows are.
 *
 * The tab is rendered with every agent page view, and it used to fetch every equity
 * snapshot the agent had ever written (one every five minutes: about 8,600 a month) to
 * produce one number per window. The database now walks them and sends the answer back.
 *
 * It must be the same number. The pure `maxDrawdownPct` over the raw marks, windowed
 * the way the tab used to window them, is the oracle here, and the comparison is exact:
 * the same subtraction, division and multiplication on the same doubles.
 *
 * One thing is taken out of it: what a pay-per-use agent paid for its own thinking. Its
 * P&L, on the same tab, has those payments netted, so a drawdown read off raw equity
 * contradicted the figure beside it. For an agent that never paid per use (every agent
 * while the feature is switched off) nothing is taken out, and the exact comparison
 * above is what proves the number did not move.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { agents, equitySnapshots } from "@/db";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { maxDrawdownPct } from "@/lib/analytics";
import { toNum, toNumeric } from "@/lib/money";
import { INFERENCE_GATEWAY, utcDay, type InferencePaymentStatus } from "@/lib/x402/inference-types";
import type { LeaderboardWindow } from "@/server/types";
import { snapshotInCurrentMode } from "./_shared";
import { getAgentAnalytics, getAgentAnalyticsWindows } from "./analytics";

const DAY = 86_400_000;
const WINDOW_DAYS: Record<LeaderboardWindow, number | null> = { "7d": 7, "30d": 30, all: null };

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

/** What the tab did before: every snapshot of the current book, then the window's slice of it. */
async function previousDrawdown(agentId: string, window: LeaderboardWindow, now: number): Promise<number | null> {
  const rows = await db
    .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(and(eq(equitySnapshots.agentId, agentId), snapshotInCurrentMode()))
    .orderBy(asc(equitySnapshots.at));
  const equity = rows.map((r) => ({ at: r.at, equityUsd: toNum(r.equityUsd) }));
  const days = WINDOW_DAYS[window];
  const cutoff = days === null ? null : now - days * DAY;
  // One extra day of equity so the peak that precedes the window still counts.
  return maxDrawdownPct(cutoff === null ? equity : equity.filter((p) => p.at.getTime() >= cutoff - DAY));
}

async function marks(agentId: string, mode: "paper" | "live", points: Array<{ daysAgo: number; equityUsd: number }>) {
  const now = Date.now();
  const rows = points.map((p) => ({
    id: nanoid(),
    agentId,
    equityUsd: toNumeric(p.equityUsd, 6),
    cashUsd: toNumeric(p.equityUsd / 3, 6),
    at: new Date(now - p.daysAgo * DAY),
    mode,
  }));
  for (let i = 0; i < rows.length; i += 250) await db.insert(schema.equitySnapshots).values(rows.slice(i, i + 250));
}

/**
 * A book that climbs, falls and recovers more than once, at awkward decimals. Marks sit
 * 0.37 of a day past whole days (and fractions after that), hours clear of the 8 and 31
 * day lines the windows are cut on.
 */
function wanderingBook(days: number, perDay: number, base: number) {
  const points: Array<{ daysAgo: number; equityUsd: number }> = [];
  for (let day = days; day >= 0; day -= 1) {
    for (let i = 0; i < perDay; i += 1) {
      const daysAgo = day + 0.37 + (i * 0.55) / perDay;
      const t = days - daysAgo;
      const equityUsd =
        base + t * 0.731 + Math.sin(t * 0.9) * base * 0.11 + Math.cos(t * 3.3 + i) * base * 0.037 - (t > days * 0.6 ? base * 0.19 : 0);
      points.push({ daysAgo, equityUsd });
    }
  }
  return points;
}

describe("max drawdown, read in the database", () => {
  it("is the number the pure function gives over every raw mark, in each window", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await marks(agent.agentId, "live", wanderingBook(45, 24, 137.25));

    const now = Date.now();
    const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);

    for (const window of ["7d", "30d", "all"] as const) {
      const before = await previousDrawdown(agent.agentId, window, now);
      expect(before, window).not.toBeNull();
      expect(before!, window).toBeGreaterThan(1);
      expect(windows![window].maxDrawdownPct, window).toBe(before);
      // The single-window read is the same read.
      expect((await getAgentAnalytics(agent.agentId, window, agent.userId))!.maxDrawdownPct, window).toBe(before);
    }
    // The windows are not all the same slice of one fall.
    expect(new Set(Object.values(windows!).map((w) => w.maxDrawdownPct)).size).toBeGreaterThan(1);
  });

  it("matches on a paper book in the thousands, and on one that only ever rose", async () => {
    const paper = await seedAgent(db);
    await marks(paper.agentId, "paper", wanderingBook(20, 12, 10_000));
    const rising = await seedAgent(db, { mode: "live" });
    await marks(
      rising.agentId,
      "live",
      Array.from({ length: 40 }, (_, i) => ({ daysAgo: 10 - i * 0.25 + 0.11, equityUsd: 20 + i * 0.13 })),
    );

    const now = Date.now();
    for (const agent of [paper, rising]) {
      const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);
      for (const window of ["7d", "30d", "all"] as const) {
        expect(windows![window].maxDrawdownPct, window).toBe(await previousDrawdown(agent.agentId, window, now));
      }
    }
    // Never below its running peak: a drawdown of exactly zero, not null.
    expect((await getAgentAnalyticsWindows(rising.agentId, rising.userId))!.all.maxDrawdownPct).toBe(0);
  });

  it("reads only the current book: going live is not a 99.9% drawdown", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await marks(agent.agentId, "paper", [
      { daysAgo: 6.4, equityUsd: 10_000 },
      { daysAgo: 5.4, equityUsd: 10_420 },
    ]);
    await marks(agent.agentId, "live", [
      { daysAgo: 2.4, equityUsd: 10 },
      { daysAgo: 1.4, equityUsd: 9.2 },
      { daysAgo: 0.4, equityUsd: 10.4 },
    ]);

    const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);

    expect(windows!.all.maxDrawdownPct).toBe(await previousDrawdown(agent.agentId, "all", Date.now()));
    expect(windows!.all.maxDrawdownPct).toBeCloseTo(8, 9);
  });

  it("is null where the pure function is: under two marks, or no peak above zero", async () => {
    const none = await seedAgent(db, { mode: "live" });
    const one = await seedAgent(db, { mode: "live" });
    await marks(one.agentId, "live", [{ daysAgo: 0.4, equityUsd: 50 }]);
    const empty = await seedAgent(db, { mode: "live" });
    await marks(empty.agentId, "live", [
      { daysAgo: 2.4, equityUsd: 0 },
      { daysAgo: 1.4, equityUsd: 0 },
    ]);
    // Two marks ever, one of them inside the week's slice.
    const thin = await seedAgent(db, { mode: "live" });
    await marks(thin.agentId, "live", [
      { daysAgo: 20.4, equityUsd: 80 },
      { daysAgo: 3.4, equityUsd: 60 },
    ]);

    const now = Date.now();
    for (const agent of [none, one, empty, thin]) {
      const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);
      for (const window of ["7d", "30d", "all"] as const) {
        expect(windows![window].maxDrawdownPct, window).toBe(await previousDrawdown(agent.agentId, window, now));
      }
    }
    expect((await getAgentAnalyticsWindows(none.agentId, none.userId))!.all.maxDrawdownPct).toBeNull();
    expect((await getAgentAnalyticsWindows(one.agentId, one.userId))!.all.maxDrawdownPct).toBeNull();
    expect((await getAgentAnalyticsWindows(empty.agentId, empty.userId))!.all.maxDrawdownPct).toBeNull();
    const thinWindows = await getAgentAnalyticsWindows(thin.agentId, thin.userId);
    expect(thinWindows!["7d"].maxDrawdownPct).toBeNull();
    expect(thinWindows!.all.maxDrawdownPct).toBe(25);
  });
});

// ---------- net of what a pay-per-use agent paid for its own thinking ----------

const USDC_LLM = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc" as const,
  usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

/** A transaction id as the chain prints one. Put together here, so no file holds a real one. */
const TX = "3".repeat(88);

/** One ledger row. A `settled` one carries its transaction id unless the test takes it away. */
async function paid(
  agent: { agentId: string; userId: string },
  daysAgo: number,
  usd: number,
  status: InferencePaymentStatus = "settled",
  extra: Partial<typeof schema.inferencePayments.$inferInsert> = {},
) {
  const at = new Date(Date.now() - daysAgo * DAY);
  await db.insert(schema.inferencePayments).values({
    id: nanoid(),
    ownerId: agent.userId,
    agentId: agent.agentId,
    runId: `run_${nanoid(8)}`,
    seq: 0,
    requestHash: "0".repeat(64),
    chain: "solana",
    network: INFERENCE_GATEWAY.solana.network,
    host: INFERENCE_GATEWAY.solana.host,
    model: USDC_LLM.usdc.model,
    payerWalletId: `wallet_${agent.agentId}`,
    payerAddress: `Agent${agent.agentId}`,
    payTo: INFERENCE_GATEWAY.solana.payTo[0],
    asset: INFERENCE_GATEWAY.solana.asset,
    quotedUsd: toNumeric(usd, 6),
    settledUsd: status === "settled" ? toNumeric(usd, 6) : null,
    txHash: status === "settled" ? TX : null,
    status,
    budgetDay: utcDay(at),
    createdAt: at,
    signedAt: at,
    ...extra,
  });
}

/**
 * The oracle for a book that paid for thinking: the pure function over the slice's marks,
 * each with the payments made after the slice's first mark and up to it added back.
 */
async function drawdownNetOf(
  agentId: string,
  window: LeaderboardWindow,
  now: number,
  payments: ReadonlyArray<{ daysAgo: number; usd: number }>,
): Promise<number | null> {
  const rows = await db
    .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(and(eq(equitySnapshots.agentId, agentId), snapshotInCurrentMode()))
    .orderBy(asc(equitySnapshots.at));
  const days = WINDOW_DAYS[window];
  const cutoff = days === null ? null : now - days * DAY;
  const slice = rows.map((r) => ({ at: r.at, equityUsd: toNum(r.equityUsd) })).filter((p) => cutoff === null || p.at.getTime() >= cutoff - DAY);
  if (slice.length === 0) return null;
  const first = slice[0].at.getTime();
  return maxDrawdownPct(
    slice.map((point) => ({
      at: point.at,
      equityUsd:
        point.equityUsd +
        payments
          .map((p) => ({ at: now - p.daysAgo * DAY, usd: p.usd }))
          .filter((p) => p.at > first && p.at <= point.at.getTime())
          .reduce((sum, p) => sum + p.usd, 0),
    })),
  );
}

describe("max drawdown of an agent that pays for its own thinking", () => {
  it("is nothing for a live book that held cash and only paid for thinking", async () => {
    const agent = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    // $25, no trade, $1.60 of thinking a day for twelve days: each mark is lower than
    // the last by exactly what was paid since it.
    const points: Array<{ daysAgo: number; equityUsd: number }> = [];
    for (let day = 12; day >= 0; day -= 1) points.push({ daysAgo: day + 0.4, equityUsd: 25 - (12 - day) * 1.6 });
    await marks(agent.agentId, "live", points);
    for (let day = 11; day >= 0; day -= 1) await paid(agent, day + 0.9, 1.6);

    const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);
    // Read off raw equity this was 76.8% all time (25 down to 5.80) beside a P&L of 0%.
    for (const window of ["7d", "30d", "all"] as const) {
      expect(windows![window].maxDrawdownPct, window).toBeCloseTo(0, 9);
    }
    expect(await previousDrawdown(agent.agentId, "all", Date.now())).toBeCloseTo(76.8, 6);
  });

  it("still shows what was lost trading, measured on the book with thinking added back", async () => {
    const agent = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    await marks(agent.agentId, "live", [
      { daysAgo: 20.4, equityUsd: 100 },
      { daysAgo: 15.4, equityUsd: 98 }, // 2 of thinking, nothing lost
      { daysAgo: 10.4, equityUsd: 86 }, // 2 more of thinking, and 10 lost on a trade
      { daysAgo: 5.4, equityUsd: 93 }, // 1 more of thinking, 8 won back
      { daysAgo: 0.4, equityUsd: 92.5 },
    ]);
    const payments = [
      { daysAgo: 18, usd: 2 },
      { daysAgo: 12, usd: 2 },
      { daysAgo: 7, usd: 1 },
      { daysAgo: 2, usd: 0.5 },
    ];
    for (const p of payments) await paid(agent, p.daysAgo, p.usd);

    const now = Date.now();
    const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);
    // The book with thinking added back went 100, 100, 90, 98, 98: a 10% fall.
    expect(windows!.all.maxDrawdownPct).toBeCloseTo(10, 9);
    for (const window of ["7d", "30d", "all"] as const) {
      const expected = await drawdownNetOf(agent.agentId, window, now, payments);
      expect(windows![window].maxDrawdownPct, window).toBeCloseTo(expected!, 9);
      expect((await getAgentAnalytics(agent.agentId, window, agent.userId))!.maxDrawdownPct, window).toBeCloseTo(expected!, 9);
    }
    // The week's slice starts at its own first mark: what was paid before it is already
    // inside that mark, and is not added to anything.
    expect(windows!["7d"].maxDrawdownPct).toBeCloseTo(0, 9);
  });

  it("adds back only payments proven on chain, as the P&L beside it does", async () => {
    const agent = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    await marks(agent.agentId, "live", [
      { daysAgo: 4.4, equityUsd: 50 },
      { daysAgo: 0.4, equityUsd: 46 },
    ]);
    await paid(agent, 3, 1); // proven
    await paid(agent, 3, 1, "paid_no_answer"); // proven
    await paid(agent, 3, 1, "settled", { txHash: null }); // answered, payment still being checked
    await paid(agent, 3, 1, "unconfirmed"); // whether it moved is not known
    await paid(agent, 3, 9, "not_charged"); // never landed
    await paid(agent, 3, 9, "simulated"); // no money at all

    // 50 down to 46 with 2 proven: the book net of thinking fell from 50 to 48.
    expect((await getAgentAnalyticsWindows(agent.agentId, agent.userId))!.all.maxDrawdownPct).toBeCloseTo(4, 9);
  });

  it("leaves a paper book alone: its equity is a notional, not the wallet that paid", async () => {
    const agent = await seedAgent(db, { config: { llm: USDC_LLM } });
    await marks(agent.agentId, "paper", [
      { daysAgo: 4.4, equityUsd: 10_000 },
      { daysAgo: 2.4, equityUsd: 9_500 },
      { daysAgo: 0.4, equityUsd: 9_800 },
    ]);
    await paid(agent, 3, 40);

    const windows = await getAgentAnalyticsWindows(agent.agentId, agent.userId);
    expect(windows!.all.maxDrawdownPct).toBe(await previousDrawdown(agent.agentId, "all", Date.now()));
    expect(windows!.all.maxDrawdownPct).toBeCloseTo(5, 9);
  });

  it("counts a payment made at the instant of a mark inside that mark", async () => {
    const agent = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    const now = Date.now();
    const at = new Date(now - 2 * DAY);
    await marks(agent.agentId, "live", [{ daysAgo: 3, equityUsd: 30 }]);
    await db.insert(schema.equitySnapshots).values({ id: nanoid(), agentId: agent.agentId, equityUsd: "29.000000", cashUsd: "29.000000", at, mode: "live" });
    await paid(agent, 0, 1, "settled", { createdAt: at, signedAt: at });
    await marks(agent.agentId, "live", [{ daysAgo: 1, equityUsd: 29 }]);

    // 30, then 29 with the dollar that left at that same instant: no fall at all.
    expect((await getAgentAnalyticsWindows(agent.agentId, agent.userId))!.all.maxDrawdownPct).toBeCloseTo(0, 9);
  });
});
