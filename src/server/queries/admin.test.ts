/**
 * The admin aggregations, against a real (in-memory) Postgres.
 *
 * These are the numbers an operator makes decisions on, and every one of them is a
 * `sum` or a `count` over a table three other workstreams write to, so what is worth
 * pinning down is the exclusions rather than the arithmetic:
 *
 *  - volume counts **filled** trades only, so a proposal and a rejected trade are not
 *    volume;
 *  - live and paper are split, and the split adds back up to the total;
 *  - fees are split accrued vs collected, matching the two statuses the guardian moves
 *    rows between;
 *  - data spend counts real payments only — a `simulated` row is a fixture nobody paid
 *    for, and counting it would invent a cost;
 *  - a funded wallet is one with USDC above zero, and a paper wallet reads zero
 *    **without a Privy call** — asserted on the call count, not just the number,
 *    because the cost of getting that wrong is hundreds of network calls per page view.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import type { Chain } from "@/server/types";
import {
  getAdminBalances,
  getAdminHeadline,
  getAdminSeries,
  listAdminAgents,
  listAdminAuditEvents,
  listAdminTrades,
  listAdminUsers,
} from "./admin";

let db: Db;
let paperAgent: { userId: string; agentId: string };
let liveAgent: { userId: string; agentId: string };

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TOKEN_ID = `solana:${BONK}`;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_ID = `solana:${USDC}`;

const DAY = 86_400_000;

async function insertTrade(input: {
  agentId: string;
  ownerId: string;
  amountUsd: number;
  isPaper: boolean;
  status?: "filled" | "proposed" | "rejected";
  at?: Date;
  fee?: { amountUsd: number; status: "accrued" | "settled" };
}): Promise<string> {
  const id = nanoid();
  const at = input.at ?? new Date();
  await db.insert(schema.trades).values({
    id,
    agentId: input.agentId,
    ownerId: input.ownerId,
    chain: "solana",
    side: "buy",
    tokenId: TOKEN_ID,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(1000, 12),
    amountUsd: toNumeric(input.amountUsd, 6),
    priceUsd: toNumeric(0.01, 12),
    status: input.status ?? "filled",
    isPaper: input.isPaper,
    createdAt: at,
    filledAt: at,
  });
  if (input.fee) {
    await db.insert(schema.platformFees).values({
      id: nanoid(),
      agentId: input.agentId,
      tradeId: id,
      chain: "solana",
      amountUsd: toNumeric(input.fee.amountUsd, 6),
      status: input.fee.status,
      createdAt: at,
    });
  }
  return id;
}

beforeAll(async () => {
  db = await setupTestDb();

  await db.insert(schema.tokens).values([
    { id: TOKEN_ID, chain: "solana", address: BONK, symbol: "BONK", decimals: 5 },
    { id: USDC_ID, chain: "solana", address: USDC, symbol: "USDC", decimals: 6 },
  ]);

  paperAgent = await seedAgent(db, { mode: "paper" });
  liveAgent = await seedAgent(db, { mode: "live" });

  // `seedAgent` writes `paper_*` wallet ids for both agents. A live agent in production
  // has real Privy wallets, so swap the live one's for ids that are not placeholders —
  // that is what makes "paper reads zero without a call" a real distinction below.
  await db.delete(schema.wallets).where(eq(schema.wallets.agentId, liveAgent.agentId));
  await db.insert(schema.wallets).values(
    (["base", "solana"] as const).map((chain) => ({
      id: `pw_${chain}_${liveAgent.agentId.slice(0, 8)}`,
      kind: "agent_server" as const,
      chain,
      address: chain === "base" ? "0xLIVE0000000000000000000000000000000000" : "LiveSolanaAddress11111111111111111111111",
      userId: liveAgent.userId,
      agentId: liveAgent.agentId,
    })),
  );
  // One user embedded wallet, so the two wallet kinds cannot be conflated.
  await db.insert(schema.wallets).values({
    id: `emb_${nanoid(6)}`,
    kind: "user_embedded",
    chain: "base",
    address: "0xEMBEDDED000000000000000000000000000000",
    userId: liveAgent.userId,
  });

  const now = Date.now();
  // Paper: $100 + $50 today (both settled fees), $25 twenty days ago, and a proposal
  // nobody decided — which is not volume.
  await insertTrade({ ...paperAgent, ownerId: paperAgent.userId, amountUsd: 100, isPaper: true, fee: { amountUsd: 0.1, status: "settled" } });
  await insertTrade({ ...paperAgent, ownerId: paperAgent.userId, amountUsd: 50, isPaper: true, fee: { amountUsd: 0.1, status: "settled" } });
  await insertTrade({ ...paperAgent, ownerId: paperAgent.userId, amountUsd: 25, isPaper: true, at: new Date(now - 20 * DAY) });
  await insertTrade({ ...paperAgent, ownerId: paperAgent.userId, amountUsd: 999, isPaper: true, status: "proposed" });
  // Live: one $200 fill with an accrued fee, and one the risk guard rejected.
  await insertTrade({ ...liveAgent, ownerId: liveAgent.userId, amountUsd: 200, isPaper: false, fee: { amountUsd: 0.1, status: "accrued" } });
  await insertTrade({ ...liveAgent, ownerId: liveAgent.userId, amountUsd: 500, isPaper: false, status: "rejected" });

  await db.insert(schema.x402Payments).values([
    {
      id: nanoid(),
      agentId: liveAgent.agentId,
      sourceId: "cmc-quotes",
      url: "https://example.test/quotes",
      network: "eip155:8453",
      amountUsd: toNumeric(0.05, 6),
      simulated: false,
    },
    {
      id: nanoid(),
      agentId: paperAgent.agentId,
      sourceId: "otto-pulse",
      url: "https://example.test/pulse",
      network: "eip155:8453",
      amountUsd: toNumeric(0.01, 6),
      simulated: true,
    },
  ]);

  await db.insert(schema.waitlistSignups).values([
    { id: nanoid(), email: "a@example.test", volume: "small", chains: ["solana"] },
    { id: nanoid(), email: "b@example.test", volume: "large", chains: ["base"] },
    { id: nanoid(), email: "c@example.test", volume: "small", chains: [], createdAt: new Date(now - 5 * DAY) },
  ]);

  await db.insert(schema.auditEvents).values([
    { id: nanoid(), userId: liveAgent.userId, kind: "go_live", summary: "Switched an agent to live", ip: "10.0.0.1" },
    { id: nanoid(), userId: paperAgent.userId, kind: "agent_paused", summary: "Paused an agent" },
  ]);
}, 180_000);

describe("getAdminHeadline", () => {
  it("counts users, agents and wallets across every owner", async () => {
    const h = await getAdminHeadline();
    expect(h.users.total).toBe(2);
    expect(h.users.new7d).toBe(2);
    expect(h.users.new30d).toBe(2);
    expect(h.agents.total).toBe(2);
    expect(h.agents.live).toBe(1);
    expect(h.agents.paper).toBe(1);
    expect(h.agents.active).toBe(2);
    expect(h.agents.paused).toBe(0);
    // 2 paper placeholders for the paper agent + 2 real ones for the live agent.
    expect(h.wallets.agentServer).toBe(4);
    expect(h.wallets.userEmbedded).toBe(1);
  });

  it("counts filled trades only, and the live/paper split adds up", async () => {
    const h = await getAdminHeadline();
    expect(h.volume.allTime.count).toBe(4);
    expect(h.volume.allTime.notionalUsd).toBeCloseTo(375, 6);
    expect(h.volume.allTime.liveNotionalUsd).toBeCloseTo(200, 6);
    expect(h.volume.allTime.paperNotionalUsd).toBeCloseTo(175, 6);
    expect(h.volume.allTime.liveCount + h.volume.allTime.paperCount).toBe(h.volume.allTime.count);

    // The 20-day-old fill is inside 30d and outside 7d.
    expect(h.volume.d30.notionalUsd).toBeCloseTo(375, 6);
    expect(h.volume.d7.notionalUsd).toBeCloseTo(350, 6);
    expect(h.volume.d7.count).toBe(3);
  });

  it("splits fees accrued from collected", async () => {
    const h = await getAdminHeadline();
    expect(h.fees.collectedUsd).toBeCloseTo(0.2, 6);
    expect(h.fees.accruedUsd).toBeCloseTo(0.1, 6);
  });

  it("counts real x402 spend only, and reports fixtures separately", async () => {
    const h = await getAdminHeadline();
    expect(h.dataSpend.usd).toBeCloseTo(0.05, 6);
    expect(h.dataSpend.count).toBe(1);
    expect(h.dataSpend.simulatedCount).toBe(1);
  });

  it("counts waitlist signups", async () => {
    const h = await getAdminHeadline();
    expect(h.waitlistSignups).toBe(3);
  });
});

describe("getAdminSeries", () => {
  it("returns 30 dense daily buckets that sum to the 30-day totals", async () => {
    const series = await getAdminSeries();
    for (const key of ["signups", "volumeUsd", "feesUsd"] as const) {
      expect(series[key]).toHaveLength(30);
    }
    const sum = (points: Array<{ value: number }>) => points.reduce((a, p) => a + p.value, 0);
    expect(sum(series.signups)).toBe(3);
    expect(sum(series.volumeUsd)).toBeCloseTo(375, 6);
    expect(sum(series.feesUsd)).toBeCloseTo(0.3, 6);
    // Ascending, one bucket per UTC day, ending today.
    expect(series.signups[29].day).toBe(new Date().toISOString().slice(0, 10));
    expect(series.signups[0].day < series.signups[29].day).toBe(true);
  });
});

describe("admin tables", () => {
  it("lists users with their agent counts and last run", async () => {
    const rows = await listAdminUsers();
    expect(rows).toHaveLength(2);
    const live = rows.find((r) => r.id === liveAgent.userId);
    expect(live?.agentCount).toBe(1);
    expect(live?.liveAgentCount).toBe(1);
    const paper = rows.find((r) => r.id === paperAgent.userId);
    expect(paper?.agentCount).toBe(1);
    expect(paper?.liveAgentCount).toBe(0);
  });

  it("lists agents as public cards and never carries a config", async () => {
    const rows = await listAdminAgents(null);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.card).not.toHaveProperty("config");
      expect(Object.keys(row.card).join(",")).not.toMatch(/strategy|universe|dataSources|prompt/i);
      expect(row.fundedUsdc).toBeNull();
    }
    expect(rows.map((r) => r.card.mode).sort()).toEqual(["live", "paper"]);
  });

  it("lists the last fills with their platform fee, excluding unfilled trades", async () => {
    const rows = await listAdminTrades();
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.tokenSymbol === "BONK")).toBe(true);
    // Newest first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt >= rows[i].createdAt).toBe(true);
    }
    const withFee = rows.filter((r) => r.platformFeeUsd !== null);
    expect(withFee).toHaveLength(3);
    expect(rows.find((r) => r.notionalUsd === 200)?.isPaper).toBe(false);
    expect(rows.some((r) => r.notionalUsd === 999)).toBe(false);
  });

  it("lists audit events from every user, with the handle and no metadata", async () => {
    const rows = await listAdminAuditEvents();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => typeof r.handle === "string" && r.handle.length > 0)).toBe(true);
    expect(rows[0]).not.toHaveProperty("metadata");
  });
});

describe("getAdminBalances", () => {
  it("reads real wallets only, counts funded ones, and treats paper as zero", async () => {
    const read = vi.fn(async (wallet: { id: string; chain: Chain }) => ({
      balances:
        wallet.chain === "base"
          ? [
              { asset: "usdc", amount: 42 },
              { asset: "eth", amount: 0.01 },
            ]
          : [{ asset: "usdc", amount: 0 }],
    }));

    const snapshot = await getAdminBalances({ read });

    // Two real wallets read; the two `paper_` placeholders never touched Privy.
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.every(([w]) => !w.id.startsWith("paper_"))).toBe(true);

    expect(snapshot.rows).toHaveLength(4);
    expect(snapshot.rows.filter((r) => r.isPaper)).toHaveLength(2);
    expect(snapshot.rows.filter((r) => r.isPaper).every((r) => r.usdc === 0 && r.native === 0)).toBe(true);

    expect(snapshot.fundedCount).toBe(1);
    expect(snapshot.totalUsdc).toBeCloseTo(42, 6);
    expect(snapshot.walletsOnRecord).toBe(4);
    expect(snapshot.capped).toBe(false);
    expect(new Date(snapshot.readAt).getTime()).toBeGreaterThan(0);
  });

  it("feeds the agents table its funded USDC", async () => {
    const snapshot = await getAdminBalances({
      read: async (wallet) => ({
        balances: wallet.chain === "base" ? [{ asset: "usdc", amount: 42 }] : [{ asset: "usdc", amount: 8 }],
      }),
    });
    const rows = await listAdminAgents(snapshot);
    const live = rows.find((r) => r.card.mode === "live");
    const paper = rows.find((r) => r.card.mode === "paper");
    expect(live?.fundedUsdc).toBeCloseTo(50, 6);
    expect(paper?.fundedUsdc).toBe(0);
  });
});
