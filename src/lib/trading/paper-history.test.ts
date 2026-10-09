/**
 * What counts as paper history, what else closes the paper starting balance, and what
 * changing it does to the rows around the agent. The real code on in-memory PGlite;
 * nothing is mocked.
 *
 * The rule under test is one sentence: the balance may change only while the agent has no
 * paper trade, no paper position and no real-money order, and a change takes the book's
 * paper marks with it and nothing else. `src/server/actions/agents.test.ts` holds the
 * same rule through the server action an owner's save goes through.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { getPaperCash } from "./paper";
import { changePaperBalance, hasPaperHistory, paperBalanceLock, readPaperBalanceLock } from "./paper-history";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "./tokens";

const BONK_ID = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const WIF_ID = tokenId("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");
const USDC_ID = tokenId("solana", USDC_SOLANA);

type TradeStatus = (typeof schema.tradeStatusEnum.enumValues)[number];

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
  await db
    .insert(schema.tokens)
    .values({ id: WIF_ID, chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", decimals: 6 })
    .onConflictDoNothing();
}, 120_000);

async function trade(
  agent: { agentId: string; userId: string },
  over: { isPaper: boolean; status: TradeStatus; token?: string; side?: "buy" | "sell"; amountUsd?: string },
): Promise<string> {
  const id = nanoid();
  await db.insert(schema.trades).values({
    id,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: over.side ?? "buy",
    tokenId: over.token ?? BONK_ID,
    quoteTokenId: USDC_ID,
    amountToken: "100",
    amountUsd: over.amountUsd ?? "25",
    priceUsd: "0.25",
    status: over.status,
    isPaper: over.isPaper,
  });
  return id;
}

async function position(agentId: string, token: string, amountToken: string): Promise<void> {
  await db.insert(schema.positions).values({ agentId, tokenId: token, amountToken, avgCostUsd: "0.25", realizedPnlUsd: "1.5" });
}

async function mark(agentId: string, mode: "paper" | "live" | null, equityUsd = "10000"): Promise<string> {
  const id = nanoid();
  await db.insert(schema.equitySnapshots).values({ id, agentId, equityUsd, cashUsd: equityUsd, mode });
  return id;
}

const marksOf = async (agentId: string) =>
  (
    await db
      .select({ id: schema.equitySnapshots.id, mode: schema.equitySnapshots.mode })
      .from(schema.equitySnapshots)
      .where(eq(schema.equitySnapshots.agentId, agentId))
      .orderBy(asc(schema.equitySnapshots.id))
  ).map((row) => row.mode);

const balanceOf = async (agentId: string) =>
  (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]?.paperStartingUsd;

describe("hasPaperHistory", () => {
  it("is false for an agent that has never traded, on paper or live", async () => {
    for (const mode of ["paper", "live"] as const) {
      const agent = await seedAgent(db, { mode });
      expect(await hasPaperHistory(db, agent.agentId), mode).toBe(false);
      expect(await readPaperBalanceLock(agent.agentId), mode).toBeNull();
    }
  });

  it("is not made by a run that bought nothing, a flat mark or a post", async () => {
    const agent = await seedAgent(db);
    await db.insert(schema.agentRuns).values({ id: nanoid(), agentId: agent.agentId, trigger: "schedule", status: "succeeded" });
    await mark(agent.agentId, "paper");
    await mark(agent.agentId, null);
    await db.insert(schema.posts).values({ id: nanoid(), authorId: agent.userId, agentId: agent.agentId, kind: "note", body: "Nothing cleared the bar." });
    expect(await hasPaperHistory(db, agent.agentId)).toBe(false);
  });

  /** Every status a trade row can be in: each was sized against the balance. */
  it.each(schema.tradeStatusEnum.enumValues.map((status) => [status]))(
    "is made by a paper trade that is %s, on a paper agent and on one that has since gone live",
    async (status) => {
      for (const mode of ["paper", "live"] as const) {
        const agent = await seedAgent(db, { mode });
        await trade(agent, { isPaper: true, status });
        expect(await hasPaperHistory(db, agent.agentId), mode).toBe(true);
        expect(await readPaperBalanceLock(agent.agentId), mode).toBe("paper");
      }
    },
  );

  it("is made by a paper sell as much as a buy", async () => {
    const agent = await seedAgent(db);
    await trade(agent, { isPaper: true, status: "filled", side: "sell" });
    expect(await hasPaperHistory(db, agent.agentId)).toBe(true);
  });

  it("is not made by real-money trades, in any status", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    for (const status of schema.tradeStatusEnum.enumValues) await trade(agent, { isPaper: false, status });
    expect(await hasPaperHistory(db, agent.agentId)).toBe(false);
  });

  it("is made by a position in a token the agent never filled a real-money order in, held or closed", async () => {
    for (const amountToken of ["40", "0"]) {
      const agent = await seedAgent(db, { mode: "live" });
      await position(agent.agentId, BONK_ID, amountToken);
      expect(await hasPaperHistory(db, agent.agentId), amountToken).toBe(true);
      // A real-money order that did not fill does not make the position a real one.
      await trade(agent, { isPaper: false, status: "failed" });
      expect(await hasPaperHistory(db, agent.agentId), amountToken).toBe(true);
    }
  });

  it("is not made by a live agent's real positions, held or closed", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await trade(agent, { isPaper: false, status: "filled", token: BONK_ID });
    await trade(agent, { isPaper: false, status: "filled", token: WIF_ID });
    await position(agent.agentId, BONK_ID, "40");
    await position(agent.agentId, WIF_ID, "0");
    expect(await hasPaperHistory(db, agent.agentId)).toBe(false);
    // One more position, in a token it only ever held on paper, is.
    const other = tokenId("solana", USDC_SOLANA);
    await position(agent.agentId, other, "0");
    expect(await hasPaperHistory(db, agent.agentId)).toBe(true);
  });

  it("is one agent's own: another agent's paper trades are nothing to it", async () => {
    const traded = await seedAgent(db);
    await trade(traded, { isPaper: true, status: "filled" });
    await position(traded.agentId, BONK_ID, "40");
    const untouched = await seedAgent(db);
    expect(await hasPaperHistory(db, untouched.agentId)).toBe(false);
  });
});

/**
 * Paper history is not all that closes the balance. Paper cash is worked out from every
 * filled trade, the real-money ones too, so an agent that has traded live has a result
 * its paper book already carries, and the balance is what that result is measured by.
 */
describe("paperBalanceLock", () => {
  it("is null for an agent that has never traded, on paper or live, whatever marks it has", async () => {
    for (const mode of ["paper", "live"] as const) {
      const agent = await seedAgent(db, { mode });
      await mark(agent.agentId, "paper");
      await mark(agent.agentId, "live", "15");
      await mark(agent.agentId, null);
      expect(await paperBalanceLock(db, agent.agentId), mode).toBeNull();
    }
  });

  /** In any status: one on its way may yet fill, and where there is doubt it is history. */
  it.each(schema.tradeStatusEnum.enumValues.map((status) => [status]))(
    "is live for a real-money order that is %s and no paper history, on a live agent and on one back on paper",
    async (status) => {
      for (const mode of ["live", "paper"] as const) {
        const agent = await seedAgent(db, { mode });
        await trade(agent, { isPaper: false, status });
        expect(await hasPaperHistory(db, agent.agentId), mode).toBe(false);
        expect(await paperBalanceLock(db, agent.agentId), mode).toBe("live");
        expect(await readPaperBalanceLock(agent.agentId), mode).toBe("live");
      }
    },
  );

  it("is live for a live agent's real positions, held or closed", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await trade(agent, { isPaper: false, status: "filled", token: BONK_ID });
    await trade(agent, { isPaper: false, status: "filled", token: WIF_ID });
    await position(agent.agentId, BONK_ID, "40");
    await position(agent.agentId, WIF_ID, "0");
    expect(await paperBalanceLock(db, agent.agentId)).toBe("live");
  });

  it("is paper for an agent with paper history, whether or not it has traded live as well", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await trade(agent, { isPaper: true, status: "proposed" });
    expect(await paperBalanceLock(db, agent.agentId)).toBe("paper");
    await trade(agent, { isPaper: false, status: "filled" });
    expect(await paperBalanceLock(db, agent.agentId)).toBe("paper");
  });

  it("is one agent's own: another agent's real-money orders are nothing to it", async () => {
    const traded = await seedAgent(db, { mode: "live" });
    await trade(traded, { isPaper: false, status: "filled" });
    const untouched = await seedAgent(db, { mode: "live" });
    expect(await paperBalanceLock(db, untouched.agentId)).toBeNull();
  });
});

describe("changePaperBalance", () => {
  const change = (agent: { agentId: string; userId: string }, paperStartingUsd: number, patch = {}) =>
    changePaperBalance({ agentId: agent.agentId, ownerId: agent.userId, paperStartingUsd, patch });

  it("sets the balance, to the cent, and writes the rest of the save with it", async () => {
    const agent = await seedAgent(db);
    expect(await change(agent, 12_345.67, { tagline: "Starts smaller." })).toBe("changed");
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    expect(row?.paperStartingUsd).toBe("12345.67");
    expect(row?.tagline).toBe("Starts smaller.");
  });

  it("deletes every mark of a book that was only ever on paper: stamped paper, or not stamped", async () => {
    const agent = await seedAgent(db);
    await mark(agent.agentId, "paper");
    await mark(agent.agentId, "paper");
    await mark(agent.agentId, null);
    const other = await seedAgent(db);
    await mark(other.agentId, "paper");

    expect(await change(agent, 20)).toBe("changed");
    expect(await marksOf(agent.agentId)).toEqual([]);
    // Another agent's marks are not this one's to take.
    expect(await marksOf(other.agentId)).toEqual(["paper"]);
  });

  it("deletes a live agent's paper marks and no other: not its live ones, not its unstamped ones", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, "paper");
    const live = await mark(agent.agentId, "live", "15");
    // On a live agent a mark with no stamp is read as a live one.
    const unstamped = await mark(agent.agentId, null, "15");

    expect(await change(agent, 15)).toBe("changed");
    const left = await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agent.agentId));
    expect(left.map((row) => row.id).sort()).toEqual([live, unstamped].sort());
    expect(left.every((row) => row.equityUsd === "15.000000")).toBe(true);
    expect(await balanceOf(agent.agentId)).toBe("15.00");
  });

  /**
   * An unstamped mark is from before marks were stamped. On an agent that is on paper now
   * but was live at some point it may be a live mark, so it is left where it is. (One that
   * placed a real-money order while it was live cannot change its balance at all.)
   */
  it.each([
    ["a live mark", (agent: { agentId: string }) => mark(agent.agentId, "live", "15")],
    [
      "the switch to live on record",
      (agent: { agentId: string; userId: string }) =>
        db.insert(schema.auditEvents).values({ id: nanoid(), userId: agent.userId, kind: "go_live", agentId: agent.agentId, summary: "Switched to live mode." }),
    ],
  ])("keeps the unstamped marks of a paper agent that has %s", async (_what, wasLive) => {
    const agent = await seedAgent(db);
    await wasLive(agent);
    await mark(agent.agentId, "paper");
    await mark(agent.agentId, null);

    expect(await change(agent, 20)).toBe("changed");
    const left = await marksOf(agent.agentId);
    expect(left).not.toContain("paper");
    expect(left).toContain(null);
  });

  it("refuses an agent with paper history, and writes nothing", async () => {
    const agent = await seedAgent(db);
    await trade(agent, { isPaper: true, status: "failed" });
    await mark(agent.agentId, "paper");
    const before = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));

    expect(await change(agent, 20, { tagline: "Not this either." })).toBe("paper");
    expect(await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId))).toEqual(before);
    expect(await marksOf(agent.agentId)).toEqual(["paper"]);
  });

  /**
   * The case this rule exists for. $1,000 of balance, a real-money round trip that made
   * $50, and no paper trade: the paper book is worth $1,050, +5%. A balance of $10 picked
   * now would make the same $50 read as +500% on the card and the leaderboard, and one of
   * $10,000,000 would bury a loss.
   */
  it.each(["live", "paper"] as const)(
    "refuses an agent that is %s and has traded with real money, so what it made is not measured by a balance picked afterwards",
    async (mode) => {
      const agent = await seedAgent(db, { mode, paperStartingUsd: "1000" });
      await trade(agent, { isPaper: false, status: "filled", side: "buy", amountUsd: "1000" });
      await trade(agent, { isPaper: false, status: "filled", side: "sell", amountUsd: "1050" });
      await position(agent.agentId, BONK_ID, "0");
      const live = await mark(agent.agentId, "live", "1050");
      await mark(agent.agentId, "paper", "1000");
      expect(await hasPaperHistory(db, agent.agentId)).toBe(false);
      expect(await getPaperCash(agent.agentId)).toBe(1050);
      const before = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));

      for (const paperStartingUsd of [10, 20, 10_000_000]) {
        expect(await change(agent, paperStartingUsd, { tagline: "Not this either." }), String(paperStartingUsd)).toBe("live");
      }

      expect(await getPaperCash(agent.agentId)).toBe(1050);
      expect(await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId))).toEqual(before);
      // Nothing was taken from its chart either, live or paper.
      const left = await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agent.agentId));
      expect(left).toHaveLength(2);
      expect(left.map((row) => row.id)).toContain(live);
    },
  );

  /** With nothing traded, the book the balance opens is the balance, to the cent. */
  it("leaves an agent it does change worth exactly its new balance on paper", async () => {
    const agent = await seedAgent(db, { paperStartingUsd: "1000" });
    expect(await change(agent, 250)).toBe("changed");
    expect(await getPaperCash(agent.agentId)).toBe(250);
  });

  it("does nothing for an agent that is not this owner's, or is gone", async () => {
    const agent = await seedAgent(db);
    const stranger = await seedAgent(db);
    await mark(agent.agentId, "paper");
    expect(await changePaperBalance({ agentId: agent.agentId, ownerId: stranger.userId, paperStartingUsd: 20, patch: {} })).toBe("gone");
    expect(await changePaperBalance({ agentId: "no-such-agent", ownerId: agent.userId, paperStartingUsd: 20, patch: {} })).toBe("gone");
    expect(await balanceOf(agent.agentId)).toBe("10000.00");
    expect(await marksOf(agent.agentId)).toEqual(["paper"]);
  });

  it("can be changed again and again while the book stays untouched, and never once it is not", async () => {
    const agent = await seedAgent(db);
    expect(await change(agent, 250)).toBe("changed");
    expect(await change(agent, 2_500_000)).toBe("changed");
    expect(await balanceOf(agent.agentId)).toBe("2500000.00");
    await trade(agent, { isPaper: true, status: "proposed" });
    expect(await change(agent, 250)).toBe("paper");
    expect(await balanceOf(agent.agentId)).toBe("2500000.00");
  });
});
