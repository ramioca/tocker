/**
 * A private agent tells its followers nothing.
 *
 * An agent can be followed while it is public and taken private afterwards. Its follows
 * are kept (the owner may open it again), so both places that write a follower's `trade`
 * notification have to ask whether the agent is public first: `notifyAgentFollowers`,
 * which every automatic, approved and manual fill goes through, and the guardian's own
 * list for an automatic exit. The owner's own notification is not affected.
 *
 * Offline: the guardian half stubs pricing exactly as guardian.test.ts does.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { resetTokenCaches } from "@/lib/tokens";
import { runGuardian } from "./guardian";
import * as prices from "./prices";
import { notifyAgentFollowers } from "./proposals";
import { seedKnownTokens, tokenId } from "./tokens";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  prices.resetPriceCache();
  await resetTokenCaches();
  // The price feed knows BONK and nothing else answers, so no request leaves the process.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: 0.0000027 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

async function seedFollower(agentId: string): Promise<string> {
  const follower = `did:privy:f-${nanoid(8)}`;
  await db.insert(schema.users).values({ id: follower, handle: `f${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}` });
  await db.insert(schema.follows).values({ followerId: follower, targetType: "agent", targetId: agentId });
  return follower;
}

function inbox(userId: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
}

async function goPrivate(agentId: string): Promise<void> {
  await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, agentId));
}

describe("notifyAgentFollowers", () => {
  it("notifies the followers of a public agent", async () => {
    const agent = await seedAgent(db);
    const follower = await seedFollower(agent.agentId);

    await notifyAgentFollowers(agent.agentId, "Test Agent bought BONK", "Momentum.", `/agents/${agent.slug}`);

    const notes = await inbox(follower);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("trade");
    expect(notes[0]?.title).toBe("Test Agent bought BONK");
  });

  it("notifies nobody once the agent is private, and keeps the follow", async () => {
    const agent = await seedAgent(db);
    const follower = await seedFollower(agent.agentId);
    await goPrivate(agent.agentId);

    await notifyAgentFollowers(agent.agentId, "Test Agent bought BONK", "Momentum.", `/agents/${agent.slug}`);

    expect(await inbox(follower)).toHaveLength(0);
    expect(await db.select().from(schema.follows).where(eq(schema.follows.followerId, follower))).toHaveLength(1);
  });

  it("notifies again when the owner makes the agent public again", async () => {
    const agent = await seedAgent(db);
    const follower = await seedFollower(agent.agentId);
    await goPrivate(agent.agentId);
    await notifyAgentFollowers(agent.agentId, "Test Agent bought BONK", "Momentum.", `/agents/${agent.slug}`);
    await db.update(schema.agents).set({ isPublic: true }).where(eq(schema.agents.id, agent.agentId));

    await notifyAgentFollowers(agent.agentId, "Test Agent sold BONK", "Target hit.", `/agents/${agent.slug}`);

    const notes = await inbox(follower);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("Test Agent sold BONK");
  });

  it("writes nothing for an agent that does not exist", async () => {
    await expect(notifyAgentFollowers("no-such-agent", "x bought y", "", "/agents/x")).resolves.toBeUndefined();
  });
});

describe("runGuardian: an automatic exit on a private agent", () => {
  it("tells the owner and not the followers", async () => {
    const agent = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    const follower = await seedFollower(agent.agentId);
    await goPrivate(agent.agentId);
    // Entry at 0.0000036, mark 0.0000027: 25% down, through a 15% stop.
    await db.insert(schema.positions).values({
      agentId: agent.agentId,
      tokenId: BONK_ID,
      amountToken: (10_000_000).toFixed(12),
      avgCostUsd: (0.0000036).toFixed(12),
      realizedPnlUsd: "0",
      openedAt: new Date(Date.now() - 3 * 3_600_000),
      peakPriceUsd: (0.0000036).toFixed(12),
      entryScore: "74.00",
      entryLiquidityUsd: "310000.00",
    });

    const result = await runGuardian({ agentId: agent.agentId, trigger: "marks" });

    expect(result.exits).toHaveLength(1);
    expect(result.exits[0]?.status).toBe("filled");
    const owner = await inbox(agent.userId);
    expect(owner).toHaveLength(1);
    expect(owner[0]?.kind).toBe("exit");
    expect(await inbox(follower)).toHaveLength(0);
  });
});
