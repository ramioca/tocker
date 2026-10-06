/**
 * The public leaderboard, read without every public agent's snapshot history.
 *
 * Discover asked for the 7-day, 30-day and all-time boards separately. Each call
 * selected every public agent, built a card for each, and pulled every raw equity
 * snapshot in its window (all of history, for all time): three times over, one mark per
 * agent every five minutes, to show twelve rows. An unauthenticated page view cost more
 * with every sign-up.
 *
 * `getLeaderboards` reads the three marks per agent that a window's PnL is measured
 * between, ranks on those, and reads a series only for the rows it shows.
 *
 * It must not move a number. `previousLeaderboard` below is the query it replaced, kept
 * line for line as the oracle, and every row of every window is compared against it on
 * seeded data: rank, agent, PnL in dollars and percent, trade count, and the line drawn
 * beside it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { agents, equitySnapshots, trades } from "@/db";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNum, toNumeric } from "@/lib/money";
import { pnlOverWindow, windowSparkline, WINDOW_DAYS } from "@/lib/pnl";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import type { LeaderboardRow, LeaderboardWindow } from "@/server/types";
import { buildAgentCards, snapshotInCurrentMode } from "./_shared";
import { getLeaderboard, getLeaderboards } from "./discover";

const BONK_ID = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const USDC_ID = tokenId("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const DAY = 86_400_000;

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

// ------------------------------------------------------------------ the oracle

/** `getLeaderboard` as it was: every agent's raw snapshots in the window, one window per call. */
async function previousLeaderboard(window: LeaderboardWindow, limit = 25): Promise<LeaderboardRow[]> {
  const agentRows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.isPublic, true), eq(agents.status, "active")));
  if (agentRows.length === 0) return [];

  const ids = agentRows.map((a) => a.id);
  const days = WINDOW_DAYS[window];
  const since = days === null ? null : new Date(Date.now() - (days + 2) * 86_400_000);
  const snapshots = await db
    .select({ agentId: equitySnapshots.agentId, at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(and(inArray(equitySnapshots.agentId, ids), snapshotInCurrentMode(), since ? gte(equitySnapshots.at, since) : undefined))
    .orderBy(asc(equitySnapshots.at));

  const series = new Map<string, Array<{ at: Date; equityUsd: number }>>();
  for (const s of snapshots) {
    const list = series.get(s.agentId) ?? [];
    list.push({ at: s.at, equityUsd: toNum(s.equityUsd) });
    series.set(s.agentId, list);
  }

  const [cards, windowTrades] = await Promise.all([
    buildAgentCards(db, agentRows),
    days === null
      ? Promise.resolve([])
      : db
          .select({ agentId: trades.agentId, n: sql<number>`count(*)::int` })
          .from(trades)
          .where(
            and(
              inArray(trades.agentId, ids),
              eq(trades.status, "filled"),
              sql`coalesce(${trades.filledAt}, ${trades.createdAt}) >= ${new Date(Date.now() - days * 86_400_000).toISOString()}`,
            ),
          )
          .groupBy(trades.agentId),
  ]);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const windowCount = new Map(windowTrades.map((r) => [r.agentId, Number(r.n ?? 0)]));

  const scored = agentRows.flatMap((a) => {
    const points = series.get(a.id) ?? [];
    const pnl = pnlOverWindow(points, window);
    const card = cardById.get(a.id);
    if (!pnl || !card) return [];
    const sparkline = windowSparkline(points, window);
    if (days === null) {
      return [
        { card, pnlPct: card.pnlPct ?? pnl.pnlPct, pnlUsd: card.pnlUsd ?? pnl.pnlUsd, tradeCount: card.tradeCount, sparkline },
      ];
    }
    return [{ card, pnlPct: pnl.pnlPct, pnlUsd: pnl.pnlUsd, tradeCount: windowCount.get(a.id) ?? 0, sparkline }];
  });

  scored.sort((a, b) => b.pnlPct - a.pnlPct || b.tradeCount - a.tradeCount);

  return scored.slice(0, limit).map((row, i) => ({
    rank: i + 1,
    agent: row.card,
    pnlPct: row.pnlPct,
    pnlUsd: row.pnlUsd,
    tradeCount: row.tradeCount,
    sparkline: row.sparkline,
  }));
}

// ------------------------------------------------------------------ seeding

/**
 * Marks for one agent: `perDay` a day from `fromDaysAgo` to `toDaysAgo`, at times that
 * never sit on a window's edge (every mark is 0.31 of a day past a whole number of days
 * or more, hours clear of the 7, 9, 30 and 32 day lines the two reads draw a moment apart).
 */
async function marks(
  agentId: string,
  mode: "paper" | "live",
  fromDaysAgo: number,
  toDaysAgo: number,
  perDay: number,
  equityAt: (daysAgo: number) => number,
) {
  const now = Date.now();
  const rows = [];
  for (let day = fromDaysAgo; day >= toDaysAgo; day -= 1) {
    for (let i = 0; i < perDay; i += 1) {
      const daysAgo = day + 0.31 + (i * 0.6) / perDay;
      const equityUsd = equityAt(daysAgo);
      rows.push({
        id: nanoid(),
        agentId,
        equityUsd: toNumeric(equityUsd, 6),
        cashUsd: toNumeric(equityUsd * 0.4, 6),
        at: new Date(now - daysAgo * DAY),
        mode,
      });
    }
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(schema.equitySnapshots).values(rows.slice(i, i + 200));
}

async function fills(agent: { agentId: string; userId: string }, daysAgo: number[], isPaper: boolean) {
  for (const d of daysAgo) {
    const at = new Date(Date.now() - (d + 0.4) * DAY);
    await db.insert(schema.trades).values({
      id: nanoid(),
      agentId: agent.agentId,
      ownerId: agent.userId,
      chain: "solana",
      side: "buy",
      tokenId: BONK_ID,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(1, 12),
      amountUsd: toNumeric(2, 6),
      priceUsd: toNumeric(0.000021, 12),
      feeUsd: toNumeric(0.01, 6),
      status: "filled",
      isPaper,
      origin: "agent",
      createdAt: at,
      // Some filled a while after they were created, some carry no fill time at all.
      filledAt: d % 2 === 0 ? at : null,
    });
  }
}

/** A wobble with a drift, so no two marks of a book are equal and rankings are not ties. */
const curve = (base: number, drift: number, wobble: number) => (daysAgo: number) =>
  base + (60 - daysAgo) * drift + Math.sin(daysAgo * 1.7) * wobble;

async function seedBoard() {
  const made: Record<string, { agentId: string; userId: string; slug: string }> = {};

  // A live book with six weeks of marks, eight a day.
  made.veteran = await seedAgent(db, { mode: "live" });
  await marks(made.veteran.agentId, "live", 44, 0, 8, curve(120, 0.9, 6.3));
  await fills(made.veteran, [40, 25, 12, 6, 5, 3, 1, 0], false);

  // A paper book, measured from its notional on the all-time board.
  made.paper = await seedAgent(db);
  await marks(made.paper.agentId, "paper", 33, 0, 5, curve(10_000, 11.7, 140));
  await fills(made.paper, [31, 20, 8, 4, 2], true);

  // Twelve days old: inside 30 days with no baseline before it, inside 7 with one.
  made.recent = await seedAgent(db, { mode: "live" });
  await marks(made.recent.agentId, "live", 12, 0, 6, curve(48, -0.35, 2.2));
  await fills(made.recent, [9, 6, 2], false);

  // Eight and a half days old: its first marks fall in the week's two baseline days.
  made.baseline = await seedAgent(db, { mode: "live" });
  await marks(made.baseline.agentId, "live", 8, 0, 3, curve(75, 1.4, 1.1));

  // Five days old: no baseline for either window, so each starts at its first mark.
  made.newcomer = await seedAgent(db);
  await marks(made.newcomer.agentId, "paper", 5, 0, 12, curve(10_000, -22.5, 60));
  await fills(made.newcomer, [3, 1], true);

  // Went live 9 days ago after three weeks on paper: only the live marks are its book.
  made.flipped = await seedAgent(db, { mode: "live" });
  await marks(made.flipped.agentId, "paper", 30, 10, 2, curve(10_000, 4, 30));
  await marks(made.flipped.agentId, "live", 9, 0, 4, curve(30, 0.5, 0.8));
  await fills(made.flipped, [8, 2], false);

  // Last marked 20 days ago: on the month and all-time boards, not on the week's.
  made.dormant = await seedAgent(db, { mode: "live" });
  await marks(made.dormant.agentId, "live", 40, 20, 2, curve(64, 0.25, 0.9));
  await fills(made.dormant, [35, 22], false);

  // One mark inside the week and nothing else there: a baseline, and a single point.
  made.sparse = await seedAgent(db, { mode: "live" });
  await marks(made.sparse.agentId, "live", 8, 8, 1, () => 200);
  await marks(made.sparse.agentId, "live", 2, 2, 1, () => 214.5);

  // One mark ever: no window to rank on any board.
  made.single = await seedAgent(db, { mode: "live" });
  await marks(made.single.agentId, "live", 1, 1, 1, () => 90);

  // Never marked.
  made.unmarked = await seedAgent(db);

  // Not on any board: one is private, one is paused.
  made.private = await seedAgent(db, { mode: "live" });
  await marks(made.private.agentId, "live", 20, 0, 2, curve(500, 9, 3));
  await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, made.private.agentId));
  made.paused = await seedAgent(db, { mode: "live" });
  await marks(made.paused.agentId, "live", 20, 0, 2, curve(700, 9, 3));
  await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, made.paused.agentId));

  return made;
}

describe("getLeaderboards against the query it replaced", () => {
  let made: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    made = await seedBoard();
  }, 120_000);

  it.each([
    ["every row", 25],
    ["the twelve Discover shows", 12],
    ["a cut that leaves most agents off", 3],
  ])("gives the same boards, to the last number: %s", async (_label, limit) => {
    const before = {
      "7d": await previousLeaderboard("7d", limit),
      "30d": await previousLeaderboard("30d", limit),
      all: await previousLeaderboard("all", limit),
    };

    const after = await getLeaderboards(limit);

    for (const window of ["7d", "30d", "all"] as const) {
      expect(after[window].map((r) => r.agent.id), window).toEqual(before[window].map((r) => r.agent.id));
      expect(after[window], window).toEqual(before[window]);
    }
  });

  it("is ranking what the test thinks it is", async () => {
    const boards = await getLeaderboards(25);
    const on = (window: LeaderboardWindow) => new Set(boards[window].map((r) => r.agent.id));
    const everyBoard = [made.veteran, made.paper, made.recent, made.baseline, made.newcomer, made.flipped];

    for (const window of ["7d", "30d", "all"] as const) {
      for (const agent of everyBoard) expect(on(window).has(agent.agentId), `${window}`).toBe(true);
      // One mark, no marks, private and paused never rank.
      for (const agent of [made.single, made.unmarked, made.private, made.paused]) {
        expect(on(window).has(agent.agentId), `${window}`).toBe(false);
      }
    }
    // Marked 20 days ago: nothing inside the week to rank.
    expect(on("7d").has(made.dormant.agentId)).toBe(false);
    expect(on("30d").has(made.dormant.agentId)).toBe(true);
    expect(on("all").has(made.dormant.agentId)).toBe(true);
    // A baseline before the week and one point in it is a window.
    const sparse = boards["7d"].find((r) => r.agent.id === made.sparse.agentId)!;
    expect(sparse.pnlUsd).toBeCloseTo(14.5, 6);
    expect(sparse.pnlPct).toBeCloseTo(7.25, 6);
    // The flipped agent's week is its live book, not a fall from a paper notional.
    const flipped = boards["30d"].find((r) => r.agent.id === made.flipped.agentId)!;
    expect(Math.abs(flipped.pnlPct)).toBeLessThan(50);
    // Trade counts follow the window.
    const veteran = (window: LeaderboardWindow) => boards[window].find((r) => r.agent.id === made.veteran.agentId)!;
    expect([veteran("7d").tradeCount, veteran("30d").tradeCount, veteran("all").tradeCount]).toEqual([5, 7, 8]);
  });

  it("answers one window of the same load through getLeaderboard", async () => {
    const boards = await getLeaderboards(12);
    for (const window of ["7d", "30d", "all"] as const) {
      const rows = await getLeaderboard(window, 12);
      expect(rows.map((r) => [r.rank, r.agent.id, r.pnlPct, r.tradeCount])).toEqual(
        boards[window].map((r) => [r.rank, r.agent.id, r.pnlPct, r.tradeCount]),
      );
    }
  });

  it("has nothing to show, and reads no series, when no agent is public and active", async () => {
    await db.update(schema.agents).set({ isPublic: false });
    expect(await getLeaderboards(12)).toEqual({ "7d": [], "30d": [], all: [] });
    expect(await getLeaderboard("7d", 12)).toEqual([]);
  });
});
