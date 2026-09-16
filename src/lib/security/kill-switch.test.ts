import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { findDueAgents, findGuardableAgents } from "@/lib/agent/scheduler";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { countPausedDueAgents, getKillSwitch, isTradingPaused, setTradingPaused } from "./kill-switch";

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

/** Make an agent due right now, the way the scheduler recognises it. */
async function makeDue(agentId: string) {
  await db
    .update(schema.agents)
    .set({ status: "active", nextRunAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.agents.id, agentId));
}

describe("the kill switch", () => {
  it("defaults to off for a user who has never touched it", async () => {
    const { userId } = await seedAgent(db);
    expect(await isTradingPaused(userId)).toBe(false);
    expect(await getKillSwitch(userId)).toEqual({ paused: false, pausedAt: null });
  });

  it("creates the row on first flip and records when", async () => {
    const { userId } = await seedAgent(db);
    await setTradingPaused(userId, true);

    const state = await getKillSwitch(userId);
    expect(state.paused).toBe(true);
    expect(state.pausedAt).not.toBeNull();
  });

  it("clears the timestamp when trading resumes", async () => {
    const { userId } = await seedAgent(db);
    await setTradingPaused(userId, true);
    await setTradingPaused(userId, false);

    expect(await getKillSwitch(userId)).toEqual({ paused: false, pausedAt: null });
  });

  /**
   * The point of the whole feature: a due agent whose owner pulled the switch is
   * not selected for a run, and one whose owner has not is still selected. An
   * agent with no `user_security` row at all must behave as "not paused" — that is
   * every user who has never opened the security page.
   */
  it("removes a paused owner's due agents from the tick, and only theirs", async () => {
    const paused = await seedAgent(db);
    const running = await seedAgent(db);
    await makeDue(paused.agentId);
    await makeDue(running.agentId);

    const before = await findDueAgents(50);
    expect(before).toContain(paused.agentId);
    expect(before).toContain(running.agentId);

    await setTradingPaused(paused.userId, true);

    const after = await findDueAgents(50);
    expect(after).not.toContain(paused.agentId);
    expect(after).toContain(running.agentId);
  });

  it("puts them back the moment the switch goes off", async () => {
    const agent = await seedAgent(db);
    await makeDue(agent.agentId);
    await setTradingPaused(agent.userId, true);
    expect(await findDueAgents(50)).not.toContain(agent.agentId);

    await setTradingPaused(agent.userId, false);
    expect(await findDueAgents(50)).toContain(agent.agentId);
  });

  /**
   * THE invariant. A kill switch that also froze the exit engine would trap the
   * operator in every open position at exactly the moment they decided something
   * was wrong. `findGuardableAgents` — what `/api/cron/marks` runs — must keep
   * returning a paused user's agents.
   */
  it("never stops the exit engine", async () => {
    const agent = await seedAgent(db);
    await makeDue(agent.agentId);
    await setTradingPaused(agent.userId, true);

    const { holding, flat } = await findGuardableAgents(200);
    expect([...holding, ...flat]).toContain(agent.agentId);
  });

  it("counts the agents it skipped, so a paused account is visible in the cron log", async () => {
    const agent = await seedAgent(db);
    await makeDue(agent.agentId);

    const before = await countPausedDueAgents();
    await setTradingPaused(agent.userId, true);
    expect(await countPausedDueAgents()).toBe(before + 1);
  });

  /** A paused owner's agent that is not due yet was never going to run: do not count it. */
  it("does not count agents that are not due", async () => {
    const agent = await seedAgent(db);
    await db
      .update(schema.agents)
      .set({ status: "active", nextRunAt: new Date(Date.now() + 60 * 60_000) })
      .where(eq(schema.agents.id, agent.agentId));

    const before = await countPausedDueAgents();
    await setTradingPaused(agent.userId, true);
    expect(await countPausedDueAgents()).toBe(before);
  });
});
