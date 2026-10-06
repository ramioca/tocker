/**
 * Agent cards built from aggregates the caller already holds.
 *
 * The agent page, Home and the leaderboard each loaded an agent's aggregates and then
 * asked for its card, which loaded the same aggregates again. `buildAgentCards` now
 * takes them when they are in hand. The card must be the same card either way.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { buildAgentCards, loadAgentAggregates, loadBookMarks } from "./_shared";

const DAY = 86_400_000;

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

async function mark(agentId: string, daysAgo: number, equityUsd: number, mode: "paper" | "live") {
  await db.insert(schema.equitySnapshots).values({
    id: nanoid(),
    agentId,
    equityUsd: toNumeric(equityUsd, 6),
    cashUsd: toNumeric(equityUsd / 2, 6),
    at: new Date(Date.now() - daysAgo * DAY),
    mode,
  });
}

describe("buildAgentCards with aggregates in hand", () => {
  it("builds the same cards as when it loads them itself", async () => {
    const live = await seedAgent(db, { mode: "live" });
    const paper = await seedAgent(db);
    const unmarked = await seedAgent(db, { mode: "live" });
    for (let day = 40; day >= 0; day -= 1) {
      await mark(live.agentId, day + 0.2, 25 + day * 0.37, "live");
      if (day % 3 === 0) await mark(live.agentId, day + 0.6, 24.1 + day * 0.4, "live");
      await mark(paper.agentId, day + 0.3, 10_000 - day * 12.5, "paper");
    }
    await db.insert(schema.follows).values({ followerId: paper.userId, targetType: "agent", targetId: live.agentId });

    const ids = [live.agentId, paper.agentId, unmarked.agentId];
    const rows = await db.select().from(schema.agents).where(inArray(schema.agents.id, ids));

    const loadedForIt = await buildAgentCards(db, rows);
    const handedOver = await buildAgentCards(db, rows, await loadAgentAggregates(db, ids));

    expect(handedOver).toEqual(loadedForIt);
    // And they are cards with something on them.
    const card = handedOver.find((c) => c.id === live.agentId)!;
    expect(card.sparkline.length).toBeGreaterThan(20);
    expect(card.followerCount).toBe(1);
    expect(card.pnlUsd).not.toBeNull();
    expect(handedOver.find((c) => c.id === unmarked.agentId)).toMatchObject({ pnlUsd: null, equityUsd: null });
  });
});

describe("loadBookMarks", () => {
  it("is the first and latest mark of the current book, and nothing for a book never marked", async () => {
    const flipped = await seedAgent(db, { mode: "live" });
    await mark(flipped.agentId, 9, 10_000, "paper");
    await mark(flipped.agentId, 3, 40, "live");
    await mark(flipped.agentId, 1, 46, "live");
    const single = await seedAgent(db, { mode: "live" });
    await mark(single.agentId, 1, 12, "live");
    const never = await seedAgent(db, { mode: "live" });

    const marks = await loadBookMarks(db, [flipped.agentId, single.agentId, never.agentId]);

    expect(marks.get(flipped.agentId)).toMatchObject({
      mode: "live",
      equityUsd: 46,
      cashUsd: 23,
      hasWindow: true,
      startEquityUsd: 40,
      capitalUsd: 40,
      pnlUsd: 6,
      pnlPct: 15,
      flowSinceMarkUsd: 0,
    });
    // One mark is a basis and no window.
    expect(marks.get(single.agentId)).toMatchObject({ hasWindow: false, startEquityUsd: 12, pnlUsd: null, pnlPct: null });
    expect(marks.has(never.agentId)).toBe(false);
    // The mode is the agent's, so a later flip changes which marks count.
    await db.update(schema.agents).set({ mode: "paper" }).where(eq(schema.agents.id, flipped.agentId));
    expect((await loadBookMarks(db, [flipped.agentId])).get(flipped.agentId)).toMatchObject({ mode: "paper", equityUsd: 10_000 });
  });
});
