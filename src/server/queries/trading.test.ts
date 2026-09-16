/**
 * The two read-side rules that are not obvious from the call sites.
 *
 * 1. **Chart markers are owner-only in SQL.** The token page hands `myTokenMarkers` a
 *    viewer id and renders whatever comes back, so the filter has to live in the query
 *    — a component prop can be passed the wrong array, a `WHERE` clause cannot. This
 *    file is the proof that another user's fills never come back, including when they
 *    are on a *public* agent, which is the case that looks safe and is not.
 * 2. **The daily digest is once a day.** It is triggered from the guardian, which runs
 *    twelve times an hour. Every pass after the first has to be a no-op.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { toNumeric } from "@/lib/money";
import { sendDailyDigest, utcDay } from "@/lib/notifications";
import { myTokenMarkers, tokenActivityCount } from "./trading";

let db: Db;

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

async function seedFill(input: {
  agentId: string;
  ownerId: string;
  side: "buy" | "sell";
  priceUsd: number;
  amountUsd: number;
  at?: Date;
  origin?: "agent" | "guardian" | "manual";
  exitReason?: string | null;
  status?: "filled" | "failed";
}): Promise<string> {
  const id = nanoid();
  const at = input.at ?? new Date();
  await db.insert(schema.trades).values({
    id,
    agentId: input.agentId,
    ownerId: input.ownerId,
    chain: "solana",
    side: input.side,
    tokenId: BONK_ID,
    quoteTokenId: tokenId("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    amountToken: toNumeric(input.amountUsd / input.priceUsd, 12),
    amountUsd: toNumeric(input.amountUsd, 6),
    priceUsd: toNumeric(input.priceUsd, 12),
    feeUsd: toNumeric(0.3, 6),
    status: input.status ?? "filled",
    isPaper: true,
    origin: input.origin ?? "agent",
    exitReason: input.exitReason ?? null,
    createdAt: at,
    filledAt: at,
  });
  return id;
}

describe("myTokenMarkers", () => {
  it("returns the viewer's own fills, oldest first", async () => {
    const mine = await seedAgent(db, { config: { chains: ["solana"] } });
    const older = new Date(Date.now() - 2 * 86_400_000);
    const newer = new Date(Date.now() - 86_400_000);
    await seedFill({ agentId: mine.agentId, ownerId: mine.userId, side: "sell", priceUsd: 0.000004, amountUsd: 140, at: newer, origin: "guardian", exitReason: "take_profit" });
    await seedFill({ agentId: mine.agentId, ownerId: mine.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100, at: older });

    const markers = await myTokenMarkers(BONK_ID, mine.userId);
    expect(markers).toHaveLength(2);
    expect(markers[0]?.side).toBe("buy");
    expect(markers[1]?.side).toBe("sell");
    expect(markers[1]?.exitReason).toBe("take_profit");
    expect(markers[1]?.origin).toBe("guardian");
    expect(markers[0]?.priceUsd).toBeCloseTo(0.000003, 12);
    expect(markers[0]?.agentName).toBe("Test Agent");
  });

  it("never returns someone else's fills — not even on a public agent", async () => {
    const mine = await seedAgent(db, { config: { chains: ["solana"] } });
    const theirs = await seedAgent(db, { config: { chains: ["solana"] } });
    await db.update(schema.agents).set({ isPublic: true }).where(eq(schema.agents.id, theirs.agentId));
    await seedFill({ agentId: theirs.agentId, ownerId: theirs.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });

    expect(await myTokenMarkers(BONK_ID, mine.userId)).toHaveLength(0);
  });

  it("returns nothing at all for an anonymous viewer", async () => {
    const mine = await seedAgent(db, { config: { chains: ["solana"] } });
    await seedFill({ agentId: mine.agentId, ownerId: mine.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });
    expect(await myTokenMarkers(BONK_ID, null)).toEqual([]);
    expect(await myTokenMarkers(BONK_ID, undefined)).toEqual([]);
    expect(await myTokenMarkers(BONK_ID, "")).toEqual([]);
  });

  it("skips a fill with no usable price rather than drawing it at zero", async () => {
    const mine = await seedAgent(db, { config: { chains: ["solana"] } });
    await seedFill({ agentId: mine.agentId, ownerId: mine.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });
    const broken = await seedFill({ agentId: mine.agentId, ownerId: mine.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });
    await db.update(schema.trades).set({ priceUsd: "0" }).where(eq(schema.trades.id, broken));

    const markers = await myTokenMarkers(BONK_ID, mine.userId);
    expect(markers.every((m) => m.priceUsd > 0)).toBe(true);
    expect(markers.some((m) => m.tradeId === broken)).toBe(false);
  });
});

describe("tokenActivityCount", () => {
  it("counts distinct public agents, which is all the public page may say", async () => {
    const a = await seedAgent(db, { config: { chains: ["solana"] } });
    const b = await seedAgent(db, { config: { chains: ["solana"] } });
    const before = await tokenActivityCount(BONK_ID);
    await seedFill({ agentId: a.agentId, ownerId: a.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });
    await seedFill({ agentId: a.agentId, ownerId: a.userId, side: "sell", priceUsd: 0.000004, amountUsd: 100 });
    await seedFill({ agentId: b.agentId, ownerId: b.userId, side: "buy", priceUsd: 0.000003, amountUsd: 100 });
    // Two fills from one agent is still one agent.
    expect(await tokenActivityCount(BONK_ID)).toBe(before + 2);
  });
});

describe("sendDailyDigest", () => {
  it("sends once per agent per day, however many times it is called", async () => {
    const { agentId, userId, slug } = await seedAgent(db, { config: { chains: ["solana"] } });
    const day = utcDay(new Date(Date.now() - 86_400_000));
    const at = new Date(`${day}T12:00:00.000Z`);
    await seedFill({ agentId, ownerId: userId, side: "buy", priceUsd: 0.000003, amountUsd: 100, at });
    await seedFill({ agentId, ownerId: userId, side: "sell", priceUsd: 0.000004, amountUsd: 133, at, origin: "guardian", exitReason: "take_profit" });

    const input = {
      agentId,
      ownerId: userId,
      agentName: "Test Agent",
      agentSlug: slug,
      day,
      equityUsd: 10_032,
      openingEquityUsd: 10_000,
    };

    const first = await sendDailyDigest(input);
    expect(first).not.toBeNull();
    expect(first!.body).toContain("1 buy, 1 sell");
    expect(first!.body).toContain("take profit × 1 (BONK)");
    expect(first!.body).toContain("+0.32% on the day");

    // Every later pass that day is a no-op.
    expect(await sendDailyDigest(input)).toBeNull();
    expect(await sendDailyDigest(input)).toBeNull();

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    expect(rows.filter((r) => r.kind === "digest")).toHaveLength(1);
  });

  it("says nothing on a day with no fills, no failures and no failed runs", async () => {
    const { agentId, userId, slug } = await seedAgent(db, { config: { chains: ["solana"] } });
    const day = utcDay(new Date(Date.now() - 86_400_000));
    const digest = await sendDailyDigest({
      agentId,
      ownerId: userId,
      agentName: "Test Agent",
      agentSlug: slug,
      day,
      equityUsd: 10_000,
      openingEquityUsd: 10_000,
    });
    expect(digest).toBeNull();
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(rows.filter((r) => r.kind === "digest")).toHaveLength(0);
  });

  it("only counts the day it was asked about", async () => {
    const { agentId, userId, slug } = await seedAgent(db, { config: { chains: ["solana"] } });
    const day = utcDay(new Date(Date.now() - 86_400_000));
    // A fill two days ago must not appear in yesterday's digest.
    await seedFill({
      agentId,
      ownerId: userId,
      side: "buy",
      priceUsd: 0.000003,
      amountUsd: 100,
      at: new Date(`${utcDay(new Date(Date.now() - 2 * 86_400_000))}T12:00:00.000Z`),
    });
    const digest = await sendDailyDigest({
      agentId,
      ownerId: userId,
      agentName: "Test Agent",
      agentSlug: slug,
      day,
      equityUsd: 10_000,
      openingEquityUsd: 10_000,
    });
    expect(digest).toBeNull();
  });
});
