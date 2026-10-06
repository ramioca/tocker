/**
 * Home's overview, read without the snapshot history.
 *
 * `getHomeOverview` used to pull every equity snapshot its agents had ever written (one
 * per agent every five minutes) to print six numbers and draw one line, and then kept
 * only the newest sixty timestamps of that line: a few hours, captioned as the curve.
 *
 * It now takes the figures from the two marks the cards already read, and draws one
 * close per day for sixty days. This file holds it to two promises:
 *
 *  - **No figure moved.** `previousOverview` below is the read it replaced, line for
 *    line, kept as the oracle. Every number on the page is compared against it on
 *    seeded data, exactly.
 *  - **The line is the old curve, a point a day.** Each point is what the old curve read
 *    at that UTC day's last mark.
 *
 * And one about cash: a wallet that could not be read is unavailable, not $0.00.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { agents, equitySnapshots, positions } from "@/db";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { splitPnl, toNum, toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import type { WalletBalance } from "@/server/types";
import { snapshotInCurrentMode } from "./_shared";

const ownWallets = vi.hoisted(() => ({ balances: [] as unknown[] }));

vi.mock("@/lib/wallets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/wallets")>()),
  getUserWalletBalances: async () => ownWallets.balances,
}));

const { combineDailyCloses, getHomeOverview } = await import("./home");

const BONK_ID = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const WIF_ID = tokenId("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");

const DAY = 86_400_000;
const HOUR = 3_600_000;

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  ownWallets.balances = [];
});

// ------------------------------------------------------------------ the oracle

type Point = { at: number; equityUsd: number };

/** The curve as it was summed: every agent forward-filled at every stamp any agent reported. */
function previousCurve(byAgent: Map<string, Point[]>): Array<{ at: number; equityUsd: number }> {
  const stamps = [...new Set([...byAgent.values()].flatMap((s) => s.map((p) => p.at)))].sort((a, b) => a - b);
  const cursors = new Map<string, number>();
  return stamps.map((at) => {
    let total = 0;
    for (const [agentId, series] of byAgent) {
      let i = cursors.get(agentId) ?? 0;
      while (i + 1 < series.length && series[i + 1].at <= at) i += 1;
      cursors.set(agentId, i);
      const point = series[i];
      if (point && point.at <= at) total += point.equityUsd;
    }
    return { at, equityUsd: total };
  });
}

/**
 * `getHomeOverview` as it was before it stopped reading the snapshot history: one raw
 * read of every snapshot, the latest row for equity and cash, the first row for a live
 * book's basis. The seeded data here has no deposits or withdrawals, which is the only
 * thing the basis is now adjusted for.
 */
async function previousOverview(userId: string) {
  const rows = await db.select().from(agents).where(eq(agents.ownerId, userId));
  const agentIds = rows.map((r) => r.id);
  const [snapshots, positionRows] = await Promise.all([
    db
      .select({
        agentId: equitySnapshots.agentId,
        equityUsd: equitySnapshots.equityUsd,
        cashUsd: equitySnapshots.cashUsd,
        at: equitySnapshots.at,
      })
      .from(equitySnapshots)
      .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
      .where(and(inArray(equitySnapshots.agentId, agentIds), snapshotInCurrentMode()))
      .orderBy(equitySnapshots.agentId, equitySnapshots.at),
    db
      .select({ agentId: positions.agentId, amountToken: positions.amountToken, avgCostUsd: positions.avgCostUsd })
      .from(positions)
      .where(inArray(positions.agentId, agentIds)),
  ]);

  const seriesByAgent = new Map<string, Point[]>();
  const latestByAgent = new Map<string, { equityUsd: number; cashUsd: number }>();
  for (const snapshot of snapshots) {
    const equityUsd = toNum(snapshot.equityUsd);
    const list = seriesByAgent.get(snapshot.agentId) ?? [];
    list.push({ at: snapshot.at.getTime(), equityUsd });
    seriesByAgent.set(snapshot.agentId, list);
    latestByAgent.set(snapshot.agentId, { equityUsd, cashUsd: toNum(snapshot.cashUsd) });
  }
  const costBasisByAgent = new Map<string, number>();
  for (const position of positionRows) {
    costBasisByAgent.set(
      position.agentId,
      (costBasisByAgent.get(position.agentId) ?? 0) + toNum(position.amountToken) * toNum(position.avgCostUsd),
    );
  }

  const bookFor = (mode: "paper" | "live") => {
    let equityUsd = 0;
    let basisUsd = 0;
    let realizedPnlUsd = 0;
    let unrealizedPnlUsd = 0;
    const series = new Map<string, Point[]>();
    // In the order the page sums them: newest agent first.
    for (const row of [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
      if (row.mode !== mode) continue;
      const latest = latestByAgent.get(row.id);
      const agentSeries = seriesByAgent.get(row.id);
      if (agentSeries) series.set(row.id, agentSeries);
      const agentEquity = latest ? latest.equityUsd : mode === "paper" ? toNum(row.paperStartingUsd) : 0;
      const agentBasis = mode === "paper" ? toNum(row.paperStartingUsd) : Math.abs(agentSeries?.[0]?.equityUsd ?? 0);
      const split = splitPnl({
        equityUsd: agentEquity,
        cashUsd: latest ? latest.cashUsd : null,
        basisUsd: agentBasis,
        costBasisUsd: costBasisByAgent.get(row.id) ?? 0,
      });
      equityUsd += agentEquity;
      basisUsd += agentBasis;
      realizedPnlUsd += split.realizedPnlUsd;
      unrealizedPnlUsd += split.unrealizedPnlUsd;
    }
    const pnlUsd = realizedPnlUsd + unrealizedPnlUsd;
    return {
      equityUsd,
      pnlUsd,
      pnlPct: basisUsd > 0 ? (pnlUsd / basisUsd) * 100 : null,
      realizedPnlUsd,
      unrealizedPnlUsd,
      curve: previousCurve(series),
    };
  };
  return { live: bookFor("live"), paper: bookFor("paper") };
}

/** The old curve read once a day: its value at each UTC day's last stamp, newest sixty of them. */
function dailyCloses(curve: Array<{ at: number; equityUsd: number }>, since: number) {
  const lastOfDay = new Map<number, { at: number; equityUsd: number }>();
  for (const point of curve) {
    if (point.at < since) continue;
    lastOfDay.set(Math.floor(point.at / DAY), point);
  }
  return [...lastOfDay.values()].sort((a, b) => a.at - b.at).slice(-60);
}

// ------------------------------------------------------------------ seeding

async function mark(agentId: string, at: number, equityUsd: number, cashUsd: number, mode: "paper" | "live") {
  await db.insert(schema.equitySnapshots).values({
    id: nanoid(),
    agentId,
    equityUsd: toNumeric(equityUsd, 6),
    cashUsd: toNumeric(cashUsd, 6),
    at: new Date(at),
    mode,
  });
}

/** One user, and agents moved under them: `seedAgent` makes a user per agent. */
async function ownerWith(specs: Array<{ mode: "paper" | "live"; createdDaysAgo: number }>) {
  const first = await seedAgent(db, { mode: specs[0].mode });
  const ids = [first.agentId];
  for (const spec of specs.slice(1)) {
    const next = await seedAgent(db, { mode: spec.mode });
    await db.update(schema.agents).set({ ownerId: first.userId }).where(eq(schema.agents.id, next.agentId));
    ids.push(next.agentId);
  }
  // Distinct creation times, so "newest first" is one order and not a tie.
  for (const [i, spec] of specs.entries()) {
    await db
      .update(schema.agents)
      .set({ createdAt: new Date(Date.now() - spec.createdDaysAgo * DAY) })
      .where(eq(schema.agents.id, ids[i]));
  }
  return { userId: first.userId, ids };
}

/** Every figure the page prints from one book. */
const figures = (book: { equityUsd: number; pnlUsd: number; pnlPct: number | null; realizedPnlUsd: number; unrealizedPnlUsd: number }) => ({
  equityUsd: book.equityUsd,
  pnlUsd: book.pnlUsd,
  pnlPct: book.pnlPct,
  realizedPnlUsd: book.realizedPnlUsd,
  unrealizedPnlUsd: book.unrealizedPnlUsd,
});

describe("getHomeOverview against the read it replaced", () => {
  it("prints the same figures from five-minute-style marks, and draws the old curve a point a day", async () => {
    const now = Date.now();
    const { userId, ids } = await ownerWith([
      { mode: "live", createdDaysAgo: 80 }, // marked for 75 days, several times on some of them
      { mode: "live", createdDaysAgo: 70 }, // went quiet 65 days ago: older than the chart
      { mode: "live", createdDaysAgo: 12 }, // flipped from paper 10 days ago
      { mode: "live", createdDaysAgo: 2 }, // never marked
      { mode: "paper", createdDaysAgo: 30 }, // a paper book with a month of marks
      { mode: "paper", createdDaysAgo: 1 }, // a paper book never marked
    ]);
    const [steady, quiet, flipped, , paper] = ids;

    // Awkward decimals on purpose: the comparison below is exact.
    for (let day = 75; day >= 0; day -= 1) {
      const at = now - day * DAY - 3 * HOUR;
      await mark(steady, at, 100 + day * 0.37 + (day % 7) * 1.13, 40 + (day % 5) * 0.21, "live");
      if (day % 4 === 0) await mark(steady, at - 5 * HOUR, 99.11 + day * 0.41, 38.07, "live");
      if (day % 9 === 0) await mark(steady, at + 2 * HOUR, 101.93 + day * 0.29, 41.5, "live");
    }
    for (let day = 72; day >= 65; day -= 1) await mark(quiet, now - day * DAY - 7 * HOUR, 55.5 + day * 0.03, 55.5, "live");
    for (let day = 12; day >= 11; day -= 1) await mark(flipped, now - day * DAY - 2 * HOUR, 10_000 + day, 10_000, "paper");
    for (let day = 10; day >= 0; day -= 1) await mark(flipped, now - day * DAY - 6 * HOUR, 20.25 + day * 0.19, 7.75, "live");
    for (let day = 29; day >= 0; day -= 1) await mark(paper, now - day * DAY - 4 * HOUR, 10_000 + day * 3.3 - (day % 3) * 17.7, 9_100.4, "paper");

    await db.insert(schema.positions).values([
      { agentId: steady, tokenId: BONK_ID, amountToken: "1500000", avgCostUsd: "0.0000201" },
      { agentId: steady, tokenId: WIF_ID, amountToken: "12.5", avgCostUsd: "1.93" },
      { agentId: flipped, tokenId: BONK_ID, amountToken: "400000", avgCostUsd: "0.0000305" },
      { agentId: paper, tokenId: WIF_ID, amountToken: "480", avgCostUsd: "1.71" },
    ]);

    const before = await previousOverview(userId);
    const after = await getHomeOverview(userId);

    // No figure moved.
    expect(
      figures({
        equityUsd: after.allocatedUsd,
        pnlUsd: after.pnlUsd,
        pnlPct: after.pnlPct,
        realizedPnlUsd: after.realizedPnlUsd,
        unrealizedPnlUsd: after.unrealizedPnlUsd,
      }),
    ).toEqual(figures(before.live));
    expect(figures(after.paper)).toEqual(figures(before.paper));
    expect(after.totalEquityUsd).toBe(before.live.equityUsd);
    expect(after.counts).toEqual({ total: 6, live: 4, paper: 2, active: 6, paused: 0 });

    // The line is the old curve, read once a day over the last sixty days.
    const since = now - 60 * DAY;
    for (const [side, line, curve] of [
      ["live", after.sparkline, before.live.curve],
      ["paper", after.paper.sparkline, before.paper.curve],
    ] as const) {
      const expected = dailyCloses(curve, since);
      expect(line.map((p) => p.equityUsd), side).toEqual(expected.map((p) => p.equityUsd));
      // To the millisecond the mark was written at (the close's time is read back as an epoch).
      for (const [i, p] of line.entries()) expect(Math.abs(new Date(p.at).getTime() - expected[i].at)).toBeLessThanOrEqual(1);
    }
    // Sixty days of it, where the old read drew the newest sixty stamps: about a month and a half
    // of marks collapsed to the last few weeks' stamps, or the last five hours at five-minute marks.
    expect(after.sparkline).toHaveLength(60);
    expect(after.paper.sparkline).toHaveLength(30);
    // The agent that went quiet before the chart begins still counts for what it holds.
    expect(after.sparkline[0].equityUsd).toBeGreaterThan(55.5);
    // And the line ends on the number in the header.
    expect(after.sparkline.at(-1)!.equityUsd).toBeCloseTo(after.allocatedUsd, 9);
  });

  it("draws exactly the old line when there is one mark a day, as the local seed writes them", async () => {
    const now = Date.now();
    const { userId, ids } = await ownerWith([
      { mode: "live", createdDaysAgo: 40 },
      { mode: "live", createdDaysAgo: 20 },
    ]);
    for (let day = 30; day >= 0; day -= 1) {
      const at = now - day * DAY - 2 * HOUR;
      await mark(ids[0], at, 50 + day * 0.61, 20, "live");
      if (day <= 18) await mark(ids[1], at, 12.4 + day * 0.07, 12.4, "live");
    }

    const before = await previousOverview(userId);
    const after = await getHomeOverview(userId);

    // Under sixty stamps the old read truncated nothing, so the two lines are one line.
    expect(before.live.curve).toHaveLength(31);
    expect(after.sparkline.map((p) => p.equityUsd)).toEqual(before.live.curve.map((p) => p.equityUsd));
    expect(figures({ ...after, equityUsd: after.allocatedUsd })).toEqual(figures(before.live));
  });
});

describe("combineDailyCloses", () => {
  const at = (day: number, hour: number) => day * DAY + hour * HOUR;

  it("is a point per day, at the last mark of that day, forward-filled", () => {
    const line = combineDailyCloses(
      new Map([
        ["a", [{ at: at(10, 9), equityUsd: 100 }, { at: at(11, 9), equityUsd: 110 }, { at: at(13, 9), equityUsd: 130 }]],
        ["b", [{ at: at(11, 20), equityUsd: 5 }, { at: at(12, 20), equityUsd: 6 }]],
      ]),
    );
    expect(line).toEqual([
      { at: new Date(at(10, 9)).toISOString(), equityUsd: 100 },
      { at: new Date(at(11, 20)).toISOString(), equityUsd: 115 },
      // `a` was not marked on day 12 and still owns what it owned on day 11.
      { at: new Date(at(12, 20)).toISOString(), equityUsd: 116 },
      { at: new Date(at(13, 9)).toISOString(), equityUsd: 136 },
    ]);
  });

  it("carries what an agent was worth before the series begins", () => {
    const line = combineDailyCloses(
      new Map([["a", [{ at: at(10, 9), equityUsd: 100 }]], ["b", [{ at: at(12, 9), equityUsd: 7 }]], ["c", []]]),
      new Map([["b", 4], ["c", 50]]),
    );
    // `b` is its earlier $4 until its own first close; `c` is never marked again.
    expect(line.map((p) => p.equityUsd)).toEqual([154, 157]);
  });

  it("keeps the newest sixty days", () => {
    const series = Array.from({ length: 90 }, (_, day) => ({ at: at(day, 12), equityUsd: day }));
    const line = combineDailyCloses(new Map([["a", series]]));
    expect(line).toHaveLength(60);
    expect(line[0].equityUsd).toBe(30);
    expect(line.at(-1)!.equityUsd).toBe(89);
  });

  it("is empty with nothing to draw", () => {
    expect(combineDailyCloses(new Map())).toEqual([]);
    expect(combineDailyCloses(new Map([["a", []]]), new Map([["a", 12]]))).toEqual([]);
  });
});

describe("cash that could not be read", () => {
  const wallet = (chain: "base" | "solana", usdc: number, extra: Partial<WalletBalance> = {}): WalletBalance => ({
    chain,
    address: chain === "base" ? "0xuser" : "SoLuser",
    walletId: `w_${chain}`,
    balances: [{ asset: "usdc", amount: usdc, usd: usdc }],
    ...extra,
  });

  it("is flagged, so Home does not print the part it did read as the balance", async () => {
    const { userId } = await seedAgent(db);
    ownWallets.balances = [wallet("base", 0, { readFailed: true }), wallet("solana", 12)];

    const overview = await getHomeOverview(userId);

    expect(overview.cashUnavailable).toBe(true);
    // The sum of what answered: a floor. `cashUnavailable` is what stops it being shown as cash.
    expect(overview.cashUsd).toBe(12);
  });

  it("is not flagged for wallets that answered, empty or not", async () => {
    const { userId } = await seedAgent(db);
    ownWallets.balances = [wallet("base", 0), wallet("solana", 12)];

    const overview = await getHomeOverview(userId);

    expect(overview.cashUnavailable).toBe(false);
    expect(overview.cashUsd).toBe(12);
    expect(overview.totalEquityUsd).toBe(12);
  });
});
