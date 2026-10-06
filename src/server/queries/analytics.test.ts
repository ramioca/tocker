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
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { agents, equitySnapshots } from "@/db";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { maxDrawdownPct } from "@/lib/analytics";
import { toNum, toNumeric } from "@/lib/money";
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
