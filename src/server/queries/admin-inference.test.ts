/**
 * The admin's pay-per-use card, against a real (in-memory) Postgres.
 *
 * It is the page an operator decides from when real money is moving, so each figure is
 * pinned to the row it comes from: today's counters against the caps the environment
 * names, the rows that are not yet final, what the breakers are looking at, and the halt
 * and pause switches as the ledger's own reader returns them.
 *
 * And it is an admin page, so what must not be on it is pinned as well: no strategy (the
 * config is never selected, only one word of it in SQL), no key, and no sentence from
 * outside that was not redacted and cut short on the way.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { pauseInferenceUntil, setInferenceHalt } from "@/lib/x402/inference-ledger";
import { INFERENCE_GATEWAY, utcDay, type InferencePaymentStatus } from "@/lib/x402/inference-types";
import { ADMIN_INFERENCE_WALLET_LIMIT, findAgentSolanaWallet, getAdminInference, isPublicSolanaRpc, listAdminAgents } from "./admin";

let db: Db;

const MINUTE = 60_000;
const NOW = new Date();
const TODAY = utcDay(NOW);
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

/** A strategy no admin surface may ever carry. Unmistakable, so a leak is a string match. */
const STRATEGY = "BUY-THE-SECRET-RECIPE-AT-DAWN";

type Seeded = { agentId: string; userId: string; slug: string };

const USDC_LLM = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc" as const,
  usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

let payer: Seeded;
let keyed: Seeded;
let paperOnly: Seeded;

async function payment(
  agent: { agentId: string | null; userId: string },
  status: InferencePaymentStatus,
  usd: number,
  at: Date,
  extra: Partial<typeof schema.inferencePayments.$inferInsert> = {},
) {
  const signed = !["reserved", "released", "simulated"].includes(status);
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
    payerWalletId: "wallet",
    payerAddress: "Payer",
    payTo: INFERENCE_GATEWAY.solana.payTo[0],
    asset: INFERENCE_GATEWAY.solana.asset,
    quotedUsd: toNumeric(usd, 6),
    settledUsd: status === "settled" ? toNumeric(usd, 6) : null,
    // A settled row carries its transaction id, as the ledger leaves it once the
    // gateway's receipt or the reconciler has named it. Put together here, so no file
    // holds a real one.
    txHash: status === "settled" ? "3".repeat(88) : null,
    status,
    budgetDay: utcDay(at),
    createdAt: at,
    signedAt: signed ? at : null,
    ...extra,
  });
}

async function realSolanaWallet(agent: Seeded, address: string): Promise<string> {
  const id = `pw_sol_${agent.agentId.slice(0, 8)}`;
  await db.delete(schema.wallets).where(eq(schema.wallets.id, `paper_${agent.agentId}_solana`));
  await db.insert(schema.wallets).values({ id, kind: "agent_server", chain: "solana", address, userId: agent.userId, agentId: agent.agentId });
  return id;
}

/** One more agent for an owner who already has one. */
async function addAgent(ownerId: string, options: { llm?: typeof USDC_LLM; lastRunAt?: Date } = {}): Promise<Seeded> {
  const agentId = nanoid();
  const slug = `test-${nanoid(6)}`;
  await db.insert(schema.agents).values({
    id: agentId,
    ownerId,
    slug,
    name: "Another Agent",
    mode: "live",
    status: "active",
    isPublic: true,
    config: options.llm ? { ...DEFAULT_AGENT_CONFIG, llm: options.llm } : DEFAULT_AGENT_CONFIG,
    lastRunAt: options.lastRunAt ?? null,
  });
  return { agentId, userId: ownerId, slug };
}

let payerWalletId: string;
let keyedWalletId: string;

beforeAll(async () => {
  db = await setupTestDb();

  payer = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM, strategy: STRATEGY } as never });
  keyed = await seedAgent(db, { mode: "live", config: { strategy: STRATEGY } as never });
  paperOnly = await seedAgent(db, { config: { llm: USDC_LLM } });

  // Real wallets for two of them; the third keeps its `paper_` placeholders.
  keyedWalletId = await realSolanaWallet(keyed, "KeyedSolanaAddress1111111111111111111111111");
  payerWalletId = await realSolanaWallet(payer, "PayerSolanaAddress1111111111111111111111111");
  // A real wallet on the other chain as well. It can never pay for thinking, which is
  // Solana only, so it must never be offered for a signature.
  await db.insert(schema.wallets).values({
    id: `pw_base_${payer.agentId.slice(0, 8)}`,
    kind: "agent_server",
    chain: "base",
    address: "0xREALBASE0000000000000000000000000000000",
    userId: payer.userId,
    agentId: payer.agentId,
  });
  await db.update(schema.agents).set({ lastRunAt: ago(1) }).where(eq(schema.agents.id, keyed.agentId));
  await db.update(schema.agents).set({ lastRunAt: ago(600) }).where(eq(schema.agents.id, payer.agentId));

  // Today's counters, as `reserve` leaves them.
  await db.insert(schema.inferenceBudgetDays).values([
    { scope: "platform", scopeId: "all", day: TODAY, usd: "1.250000", requests: 41 },
    { scope: "owner", scopeId: payer.userId, day: TODAY, usd: "1.000000", requests: 30, manualRuns: 2 },
    { scope: "owner", scopeId: paperOnly.userId, day: TODAY, usd: "0.250000", requests: 11, manualRuns: 1 },
    { scope: "agent", scopeId: payer.agentId, day: TODAY, usd: "1.000000", requests: 30 },
    { scope: "agent", scopeId: paperOnly.agentId, day: TODAY, usd: "0.250000", requests: 11 },
    // Yesterday's rows are yesterday's.
    { scope: "platform", scopeId: "all", day: utcDay(ago(60 * 30)), usd: "99.000000", requests: 999 },
  ]);

  // Today's ledger. Times are minutes ago, all today unless the test runs in the first
  // minutes after 00:00 UTC, which `budgetDay` (not the clock) settles anyway.
  await payment(payer, "settled", 0.4, ago(50), { budgetDay: TODAY });
  await payment(payer, "settled", 0.3, ago(40), { budgetDay: TODAY });
  await payment(payer, "released", 0.2, ago(35), { budgetDay: TODAY });
  await payment(paperOnly, "simulated", 0.25, ago(30), { budgetDay: TODAY });
  // Open, oldest first: an orphaned signature, an unconfirmed one, a fresh reservation.
  await payment(payer, "signed", 0.05, ago(20), { budgetDay: TODAY });
  await payment(payer, "unconfirmed", 0.07, ago(8), {
    budgetDay: TODAY,
    httpStatus: 502,
    // What a gateway might send back. The key is assembled here so no file holds one.
    detail: `upstream refused key ${"sk-"}${"aB3".repeat(16)} ${"x".repeat(400)}`,
  });
  await payment(paperOnly, "unconfirmed", 0.06, ago(6), { budgetDay: TODAY });
  await payment({ agentId: `gone_${nanoid(6)}`, userId: "did:privy:gone" }, "reserved", 0.02, ago(1), { budgetDay: TODAY });
  // Resolved badly a few minutes ago: evidence for the breaker, not an open row.
  await payment(payer, "paid_no_answer", 0.03, ago(5), { budgetDay: TODAY });

  // Runs that stopped before any payment: what the other three breakers read.
  const stopped = (reason: string, minutes: number) =>
    db.insert(schema.agentRuns).values({
      id: nanoid(),
      agentId: payer.agentId,
      trigger: "schedule",
      status: "failed",
      stopReason: reason,
      createdAt: ago(minutes),
      finishedAt: ago(minutes),
    });
  await stopped("quote_failed", 3);
  await stopped("gateway_error", 4);
  await stopped("quote_failed", 25); // outside the gateway rule's ten minutes
  await stopped("signature_failed", 2);
  await stopped("needs_funds", 2); // not a breaker's business

  await db
    .update(schema.agents)
    .set({ inferenceHold: "needs_funds", inferenceHoldSince: ago(30), inferenceHoldUntil: ago(-15), inferenceStrikes: 1 })
    .where(eq(schema.agents.id, payer.agentId));
}, 180_000);

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdminInference", () => {
  it("reads the switches and caps from the environment, and off when nothing is set", async () => {
    vi.stubEnv("INFERENCE_USDC", undefined);
    vi.stubEnv("INFERENCE_USDC_USER_IDS", undefined);
    vi.stubEnv("INFERENCE_MAX_STEP_USD", undefined);
    vi.stubEnv("INFERENCE_OWNER_DAILY_USD", undefined);
    vi.stubEnv("INFERENCE_PLATFORM_DAILY_USD", undefined);
    vi.stubEnv("SOLANA_RPC_URL", "");
    vi.stubEnv("X402_MOCK", "0");
    expect((await getAdminInference(payer.userId, NOW)).switches).toEqual({
      stage: "off",
      invitedUsers: 0,
      stepUsd: 0.25,
      ownerDayUsd: 25,
      platformDayUsd: 2,
      agentDayRequests: 600,
      rpcConfigured: false,
      rpcPublic: false,
      mock: false,
    });

    vi.stubEnv("INFERENCE_USDC", "owner");
    vi.stubEnv("INFERENCE_USDC_USER_IDS", "did:privy:a, did:privy:b");
    vi.stubEnv("INFERENCE_MAX_STEP_USD", "0.05");
    vi.stubEnv("INFERENCE_OWNER_DAILY_USD", "10");
    vi.stubEnv("INFERENCE_PLATFORM_DAILY_USD", "25");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    vi.stubEnv("X402_MOCK", "1");
    expect((await getAdminInference(payer.userId, NOW)).switches).toMatchObject({
      stage: "owner",
      invitedUsers: 2,
      stepUsd: 0.05,
      ownerDayUsd: 10,
      platformDayUsd: 25,
      rpcConfigured: true,
      rpcPublic: false,
      mock: true,
    });
  });

  it("says when the RPC is the public endpoint, which the pay path accepts, and never returns the URL", async () => {
    // The value `.env.example` ships. It is not empty, so nothing in the pay path refuses it.
    vi.stubEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
    expect((await getAdminInference(payer.userId, NOW)).switches).toMatchObject({ rpcConfigured: true, rpcPublic: true });

    // A provider's URL carries its key in the query. The key is put together here.
    const providerKey = `${"k".repeat(8)}-${"z".repeat(8)}`;
    vi.stubEnv("SOLANA_RPC_URL", `https://mainnet.rpc-provider.example/?api-key=${providerKey}`);
    const data = await getAdminInference(payer.userId, NOW);
    expect(data.switches).toMatchObject({ rpcConfigured: true, rpcPublic: false });
    expect(JSON.stringify(data)).not.toContain(providerKey);
    expect(JSON.stringify(data)).not.toContain("rpc-provider.example");

    expect(isPublicSolanaRpc(" https://API.mainnet-beta.solana.com/ ")).toBe(true);
    expect(isPublicSolanaRpc("not a url")).toBe(false);
    expect(isPublicSolanaRpc("")).toBe(false);
    expect(isPublicSolanaRpc(undefined)).toBe(false);
  });

  it("reports today's counters, and only today's", async () => {
    const { day, today } = await getAdminInference(payer.userId, NOW);
    expect(day).toBe(TODAY);
    expect(today.platformUsd).toBeCloseTo(1.25, 9);
    expect(today.platformRequests).toBe(41);
    expect(today.owners).toBe(2);
    expect(today.agents).toBe(2);
    expect(today.largestOwnerUsd).toBeCloseTo(1, 9);
    expect(today.manualRuns).toBe(3);
  });

  it("breaks today's ledger down by status", async () => {
    const byStatus = Object.fromEntries((await getAdminInference(payer.userId, NOW)).today.byStatus.map((row) => [row.status, row]));
    expect(byStatus.settled).toMatchObject({ count: 2 });
    expect(byStatus.settled.usd).toBeCloseTo(0.7, 9);
    expect(byStatus.released).toMatchObject({ count: 1 });
    expect(byStatus.simulated).toMatchObject({ count: 1 });
    expect(byStatus.unconfirmed).toMatchObject({ count: 2 });
    expect(byStatus.unconfirmed.usd).toBeCloseTo(0.13, 9);
    expect(byStatus.paid_no_answer).toMatchObject({ count: 1 });
  });

  it("lists the rows that are not final, oldest first, and counts each kind", async () => {
    const data = await getAdminInference(payer.userId, NOW);
    expect(data.openCounts).toEqual({ reserved: 1, signed: 1, unconfirmed: 2, answered_unproven: 0 });
    expect(data.open.map((row) => row.status)).toEqual(["signed", "unconfirmed", "unconfirmed", "reserved"]);
    // All written within the hour: the reconciler is still looking at every one.
    expect(data.noVerdictInTime).toBe(0);
    expect(data.open.every((row) => row.noVerdictInTime === false)).toBe(true);
    expect(data.checkedForHours).toBe(6);
    expect(data.lateLookDays).toBe(7);
    expect(data.open[0]).toMatchObject({ agentName: "Test Agent", agentSlug: payer.slug, model: "google/gemini-2.5-flash", quotedUsd: 0.05 });
    expect(data.open[0].ownerHandle).toMatch(/^t/);
    expect(data.open[1]).toMatchObject({ httpStatus: 502 });
    // A row whose agent and account are gone keeps its place and loses the names.
    expect(data.open[3]).toMatchObject({ agentName: null, agentSlug: null, ownerHandle: null, quotedUsd: 0.02 });
  });

  it("shows a provider's words only redacted and cut short", async () => {
    const detail = (await getAdminInference(payer.userId, NOW)).open[1].detail!;
    expect(detail).toContain("upstream refused key");
    expect(detail).not.toContain("aB3aB3aB3");
    expect(detail.length).toBeLessThanOrEqual(240);
  });

  it("shows what each breaker is looking at, and whether the ledger's own rule has tripped", async () => {
    const breakers = Object.fromEntries((await getAdminInference(payer.userId, NOW)).breakers.map((row) => [row.rule, row]));
    // Two unconfirmed and one paid_no_answer inside 15 minutes, from two accounts.
    expect(breakers.unanswered).toMatchObject({ count: 3, accounts: 2, accountsThreshold: 2, threshold: 3, windowMinutes: 15, tripped: true });
    expect(breakers.gateway).toMatchObject({ count: 2, threshold: 5, windowMinutes: 10, tripped: false });
    expect(breakers.signature).toMatchObject({ count: 1, threshold: 5, tripped: false });
    expect(breakers.pin_mismatch).toMatchObject({ count: 0, threshold: 1, tripped: false });
  });

  it("counts accounts, not agents, toward the unanswered breaker, as the ledger's own rule does", async () => {
    // Three unanswered steps inside the window, from two agents of ONE owner. The ledger
    // does not pause everyone over one account's trouble, so the card must not say it would.
    const owner = await seedAgent(db, { config: { llm: USDC_LLM } });
    const sibling = await addAgent(owner.userId, { llm: USDC_LLM });
    const later = new Date(NOW.getTime() + 60 * MINUTE);
    const at = (minutes: number) => new Date(later.getTime() - minutes * MINUTE);
    await payment(owner, "unconfirmed", 0.01, at(3));
    await payment(owner, "paid_no_answer", 0.01, at(2));
    await payment(sibling, "unconfirmed", 0.01, at(1));

    // Read an hour on, when this file's other unanswered rows have left the window.
    const unanswered = (await getAdminInference(owner.userId, later)).breakers.find((row) => row.rule === "unanswered")!;
    expect(unanswered).toMatchObject({ count: 3, accounts: 1, accountsThreshold: 2, tripped: false });
  });

  it("counts the agents that are held, by reason", async () => {
    expect((await getAdminInference(payer.userId, NOW)).holds).toEqual([{ reason: "needs_funds", agents: 1 }]);
  });

  it("offers the admin's own real Solana agent wallets for the signature test, and nobody else's", async () => {
    // The payer's owner is the admin looking. Their one real Solana wallet is offered.
    const mine = (await getAdminInference(payer.userId, NOW)).wallets;
    expect(mine).toEqual([
      { walletId: payerWalletId, address: "PayerSolanaAddress1111111111111111111111111", agentName: "Test Agent", agentSlug: payer.slug, payPerUse: true },
    ]);
    // Another account's wallet is real, on Solana and ran more recently: it is not theirs.
    expect(mine.some((wallet) => wallet.walletId === keyedWalletId)).toBe(false);

    // The same page for the other account's owner offers that one, and not this one.
    const theirs = (await getAdminInference(keyed.userId, NOW)).wallets;
    expect(theirs.map((wallet) => wallet.walletId)).toEqual([keyedWalletId]);
    expect(theirs[0]).toMatchObject({ payPerUse: false });

    // An admin whose only agent has paper placeholders is offered nothing, and so is an
    // admin with no agent at all.
    expect((await getAdminInference(paperOnly.userId, NOW)).wallets).toEqual([]);
    expect((await getAdminInference("did:privy:admin-with-no-agents", NOW)).wallets).toEqual([]);
    // Never a paper placeholder, and never a Base wallet.
    for (const wallet of [...mine, ...theirs]) {
      expect(wallet.walletId.startsWith("paper_")).toBe(false);
      expect(wallet.address.startsWith("0x")).toBe(false);
    }
  });

  it("lists the admin's own pay-per-use agents first, then by how recently each ran", async () => {
    const admin = await seedAgent(db, { mode: "live" });
    await db.update(schema.agents).set({ lastRunAt: ago(30) }).where(eq(schema.agents.id, admin.agentId));
    const recentKeyed = await addAgent(admin.userId, { lastRunAt: ago(1) });
    const olderPayer = await addAgent(admin.userId, { llm: USDC_LLM, lastRunAt: ago(900) });
    const first = await realSolanaWallet(admin, "AdminSolanaAddress111111111111111111111111");
    const second = await realSolanaWallet(recentKeyed, "AdminSolanaAddress222222222222222222222222");
    const third = await realSolanaWallet(olderPayer, "AdminSolanaAddress333333333333333333333333");

    const { wallets } = await getAdminInference(admin.userId, NOW);
    // The one that pays per use leads though it ran longest ago; then the keyed two, most recent first.
    expect(wallets.map((wallet) => wallet.walletId)).toEqual([third, second, first]);
    expect(wallets.map((wallet) => wallet.payPerUse)).toEqual([true, false, false]);
  });

  it("still offers the admin's own wallet when hundreds of other accounts' wallets are more recent", async () => {
    const admin = await seedAgent(db, { mode: "live" });
    const adminWalletId = await realSolanaWallet(admin, "AdminOwnSolanaAddress1111111111111111111111");
    // Idle for a long time: every wallet below would sort ahead of it.
    await db.update(schema.agents).set({ lastRunAt: ago(60 * 24 * 30) }).where(eq(schema.agents.id, admin.agentId));

    // More real Solana wallets, on other accounts' pay-per-use agents that ran a minute
    // ago, than the list is ever cut to. One owner holds them all: the count is what matters.
    const crowd = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    const others = Array.from({ length: ADMIN_INFERENCE_WALLET_LIMIT + 5 }, (_, i) => ({ agentId: nanoid(), n: i }));
    await db.insert(schema.agents).values(
      others.map(({ agentId, n }) => ({
        id: agentId,
        ownerId: crowd.userId,
        slug: `crowd-${nanoid(8)}`,
        name: `Crowd ${n}`,
        mode: "live" as const,
        status: "active" as const,
        isPublic: true,
        config: { ...DEFAULT_AGENT_CONFIG, llm: USDC_LLM },
        lastRunAt: ago(1),
        // Created long ago, so the newest-first agent table further down still shows
        // this file's own fixtures. The wallet list orders by the last run, not by this.
        createdAt: ago(60 * 24 * 365),
      })),
    );
    await db.insert(schema.wallets).values(
      others.map(({ agentId, n }) => ({
        id: `pw_crowd_${agentId}`,
        kind: "agent_server" as const,
        chain: "solana" as const,
        address: `CrowdSolanaAddress${String(n).padStart(4, "0")}`,
        userId: crowd.userId,
        agentId,
      })),
    );

    // Cut to the limit across every account and narrowed afterwards, the admin's own
    // wallet was never in the list, and the card said no wallet existed.
    const { wallets } = await getAdminInference(admin.userId, NOW);
    expect(wallets.map((wallet) => wallet.walletId)).toEqual([adminWalletId]);
    // And it is the wallet the action will agree to sign with.
    expect(await findAgentSolanaWallet(adminWalletId, admin.userId)).toMatchObject({ walletId: adminWalletId });
    // The crowd's owner is offered their own, up to the limit, and never the admin's.
    const crowded = (await getAdminInference(crowd.userId, NOW)).wallets;
    expect(crowded).toHaveLength(ADMIN_INFERENCE_WALLET_LIMIT);
    expect(crowded.some((wallet) => wallet.walletId === adminWalletId)).toBe(false);
  });

  it("names an answered step whose payment is unproven as open, and a row no verdict was reached on in time", async () => {
    const owner = await seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });
    const before = await getAdminInference(owner.userId, NOW);
    // Answered, with no transaction named for the payment: not final.
    await payment(owner, "settled", 0.09, ago(12), { txHash: null });
    // Unconfirmed for longer than the reconciler looks back: nothing will settle it.
    await payment(owner, "unconfirmed", 0.2, ago(7 * 60));
    // A reservation as old is released, not looked up: it is not one the chain was given up on.
    await payment(owner, "reserved", 0.01, ago(7 * 60 + 1));

    const data = await getAdminInference(owner.userId, NOW);
    expect(data.openCounts.answered_unproven).toBe(before.openCounts.answered_unproven + 1);
    expect(data.openCounts.unconfirmed).toBe(before.openCounts.unconfirmed + 1);
    expect(data.openCounts.reserved).toBe(before.openCounts.reserved + 1);
    expect(data.noVerdictInTime).toBe(before.noVerdictInTime + 1);
    // Oldest first, so the two old rows lead.
    expect(data.open.slice(0, 2).map((row) => ({ status: row.status, quotedUsd: row.quotedUsd, noVerdictInTime: row.noVerdictInTime }))).toEqual([
      { status: "reserved", quotedUsd: 0.01, noVerdictInTime: false },
      { status: "unconfirmed", quotedUsd: 0.2, noVerdictInTime: true },
    ]);
    expect(data.open.find((row) => row.status === "answered_unproven")).toMatchObject({ quotedUsd: 0.09, noVerdictInTime: false });
    // A settled row that carries its transaction is final and is not listed.
    expect(data.open.filter((row) => row.status === "answered_unproven")).toHaveLength(1);
  });

  it("carries no strategy, and no ledger field an admin has no use for", async () => {
    const text = JSON.stringify(await getAdminInference(payer.userId, NOW));
    expect(text).not.toContain(STRATEGY);
    expect(text).not.toContain("maxUsdPerRun");
    // The request hash, the payer's signature and the memo stay in the ledger.
    expect(text).not.toContain("0".repeat(64));
    expect(text).not.toContain("requestHash");
    expect(text).not.toContain("payerSignature");
  });

  it("reads the halt and the pause as the ledger's own reader does", async () => {
    const clear = (await getAdminInference(payer.userId, NOW)).control;
    expect(clear).toMatchObject({ halted: false, haltReason: null, pausedUntil: null, stops: null });

    await pauseInferenceUntil(new Date(NOW.getTime() + 20 * MINUTE), "3 paid steps from 2 agents got no answer within 15 minutes");
    const paused = (await getAdminInference(payer.userId, NOW)).control;
    expect(paused).toMatchObject({ halted: false, stops: "paused", pauseReason: "3 paid steps from 2 agents got no answer within 15 minutes" });
    expect(new Date(paused.pausedUntil!).getTime()).toBe(NOW.getTime() + 20 * MINUTE);

    await setInferenceHalt({ halted: true, reason: "ledger and chain disagree on one wallet", by: "@admin" });
    const halted = (await getAdminInference(payer.userId, NOW)).control;
    // The halt outranks the pause.
    expect(halted).toMatchObject({ halted: true, stops: "halted", haltReason: "ledger and chain disagree on one wallet", updatedBy: "@admin" });

    await setInferenceHalt({ halted: false, reason: null, by: "@admin" });
    const cleared = (await getAdminInference(payer.userId, NOW)).control;
    expect(cleared).toMatchObject({ halted: false, haltReason: null, stops: "paused" });
    expect(cleared.haltClearedAt).not.toBeNull();
    // A pause that has run out stops nothing.
    expect((await getAdminInference(payer.userId, new Date(NOW.getTime() + 21 * MINUTE))).control.stops).toBeNull();
  });
});

describe("findAgentSolanaWallet", () => {
  it("finds a real Solana agent wallet by id, with the address the database holds", async () => {
    expect(await findAgentSolanaWallet(payerWalletId)).toEqual({
      walletId: payerWalletId,
      address: "PayerSolanaAddress1111111111111111111111111",
      agentName: "Test Agent",
    });
  });

  it("finds nothing for a placeholder, another chain, a user's own wallet or an id that is not one", async () => {
    expect(await findAgentSolanaWallet(`paper_${paperOnly.agentId}_solana`)).toBeNull();
    expect(await findAgentSolanaWallet(`paper_${payer.agentId}_base`)).toBeNull();

    const baseId = `pw_base_${nanoid(6)}`;
    await db.insert(schema.wallets).values({ id: baseId, kind: "agent_server", chain: "base", address: "0xBASE", userId: payer.userId, agentId: payer.agentId });
    expect(await findAgentSolanaWallet(baseId)).toBeNull();

    const embeddedId = `emb_${nanoid(6)}`;
    await db.insert(schema.wallets).values({ id: embeddedId, kind: "user_embedded", chain: "solana", address: "UserSolana", userId: payer.userId });
    expect(await findAgentSolanaWallet(embeddedId)).toBeNull();

    expect(await findAgentSolanaWallet("")).toBeNull();
    expect(await findAgentSolanaWallet("no-such-wallet")).toBeNull();
    expect(await findAgentSolanaWallet("x".repeat(500))).toBeNull();
    expect(await findAgentSolanaWallet(undefined as unknown as string)).toBeNull();
  });
});

describe("listAdminAgents", () => {
  it("says where each agent's thinking comes from, and why a pay-per-use one is held", async () => {
    const rows = await listAdminAgents(null);
    const byId = new Map(rows.map((row) => [row.card.id, row]));

    // No key and none needed: it pays for itself. Held, and the reason is named.
    expect(byId.get(payer.agentId)).toMatchObject({ thinkSource: "usdc", inferenceHold: "needs_funds", hasLlmKey: false });
    expect(byId.get(payer.agentId)!.card.model).toBe("google/gemini-2.5-flash");
    expect(byId.get(paperOnly.agentId)).toMatchObject({ thinkSource: "usdc", inferenceHold: null });
    // An agent on a key is as it was: no key attached is still "no key".
    expect(byId.get(keyed.agentId)).toMatchObject({ thinkSource: "key", inferenceHold: null, hasLlmKey: false });
    expect(JSON.stringify(rows)).not.toContain(STRATEGY);
  });

  it("does not report a hold on an agent that thinks on a key, or a reason that is not one", async () => {
    await db.update(schema.agents).set({ inferenceHold: "needs_funds" }).where(eq(schema.agents.id, keyed.agentId));
    await db.update(schema.agents).set({ inferenceHold: "<b>not a reason</b>" }).where(eq(schema.agents.id, paperOnly.agentId));
    const byId = new Map((await listAdminAgents(null)).map((row) => [row.card.id, row]));
    expect(byId.get(keyed.agentId)!.inferenceHold).toBeNull();
    expect(byId.get(paperOnly.agentId)!.inferenceHold).toBeNull();
  });
});
