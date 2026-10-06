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
import { findAgentSolanaWallet, getAdminInference, listAdminAgents } from "./admin";

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
    expect((await getAdminInference(NOW)).switches).toEqual({
      stage: "off",
      invitedUsers: 0,
      stepUsd: 0.25,
      ownerDayUsd: 25,
      platformDayUsd: 2,
      agentDayRequests: 600,
      rpcConfigured: false,
      mock: false,
    });

    vi.stubEnv("INFERENCE_USDC", "owner");
    vi.stubEnv("INFERENCE_USDC_USER_IDS", "did:privy:a, did:privy:b");
    vi.stubEnv("INFERENCE_MAX_STEP_USD", "0.05");
    vi.stubEnv("INFERENCE_OWNER_DAILY_USD", "10");
    vi.stubEnv("INFERENCE_PLATFORM_DAILY_USD", "25");
    vi.stubEnv("SOLANA_RPC_URL", "https://rpc.example.test");
    vi.stubEnv("X402_MOCK", "1");
    expect((await getAdminInference(NOW)).switches).toMatchObject({
      stage: "owner",
      invitedUsers: 2,
      stepUsd: 0.05,
      ownerDayUsd: 10,
      platformDayUsd: 25,
      rpcConfigured: true,
      mock: true,
    });
  });

  it("reports today's counters, and only today's", async () => {
    const { day, today } = await getAdminInference(NOW);
    expect(day).toBe(TODAY);
    expect(today.platformUsd).toBeCloseTo(1.25, 9);
    expect(today.platformRequests).toBe(41);
    expect(today.owners).toBe(2);
    expect(today.agents).toBe(2);
    expect(today.largestOwnerUsd).toBeCloseTo(1, 9);
    expect(today.manualRuns).toBe(3);
  });

  it("breaks today's ledger down by status", async () => {
    const byStatus = Object.fromEntries((await getAdminInference(NOW)).today.byStatus.map((row) => [row.status, row]));
    expect(byStatus.settled).toMatchObject({ count: 2 });
    expect(byStatus.settled.usd).toBeCloseTo(0.7, 9);
    expect(byStatus.released).toMatchObject({ count: 1 });
    expect(byStatus.simulated).toMatchObject({ count: 1 });
    expect(byStatus.unconfirmed).toMatchObject({ count: 2 });
    expect(byStatus.unconfirmed.usd).toBeCloseTo(0.13, 9);
    expect(byStatus.paid_no_answer).toMatchObject({ count: 1 });
  });

  it("lists the rows that are not final, oldest first, and counts each kind", async () => {
    const data = await getAdminInference(NOW);
    expect(data.openCounts).toEqual({ reserved: 1, signed: 1, unconfirmed: 2 });
    expect(data.open.map((row) => row.status)).toEqual(["signed", "unconfirmed", "unconfirmed", "reserved"]);
    expect(data.open[0]).toMatchObject({ agentName: "Test Agent", agentSlug: payer.slug, model: "google/gemini-2.5-flash", quotedUsd: 0.05 });
    expect(data.open[0].ownerHandle).toMatch(/^t/);
    expect(data.open[1]).toMatchObject({ httpStatus: 502 });
    // A row whose agent and account are gone keeps its place and loses the names.
    expect(data.open[3]).toMatchObject({ agentName: null, agentSlug: null, ownerHandle: null, quotedUsd: 0.02 });
  });

  it("shows a provider's words only redacted and cut short", async () => {
    const detail = (await getAdminInference(NOW)).open[1].detail!;
    expect(detail).toContain("upstream refused key");
    expect(detail).not.toContain("aB3aB3aB3");
    expect(detail.length).toBeLessThanOrEqual(240);
  });

  it("shows what each breaker is looking at, and whether the ledger's own rule has tripped", async () => {
    const breakers = Object.fromEntries((await getAdminInference(NOW)).breakers.map((row) => [row.rule, row]));
    // Two unconfirmed and one paid_no_answer inside 15 minutes, from two agents.
    expect(breakers.unanswered).toMatchObject({ count: 3, agents: 2, threshold: 3, windowMinutes: 15, tripped: true });
    expect(breakers.gateway).toMatchObject({ count: 2, threshold: 5, windowMinutes: 10, tripped: false });
    expect(breakers.signature).toMatchObject({ count: 1, threshold: 5, tripped: false });
    expect(breakers.pin_mismatch).toMatchObject({ count: 0, threshold: 1, tripped: false });
  });

  it("counts the agents that are held, by reason", async () => {
    expect((await getAdminInference(NOW)).holds).toEqual([{ reason: "needs_funds", agents: 1 }]);
  });

  it("offers only real Solana agent wallets for the signature test, pay-per-use agents first", async () => {
    const { wallets } = await getAdminInference(NOW);
    // The keyed agent ran more recently, and still comes second.
    expect(wallets.map((wallet) => wallet.walletId)).toEqual([payerWalletId, keyedWalletId]);
    expect(wallets[0]).toMatchObject({ address: "PayerSolanaAddress1111111111111111111111111", agentSlug: payer.slug, payPerUse: true });
    expect(wallets[1]).toMatchObject({ payPerUse: false });
    // No paper placeholder, and no Base wallet.
    expect(wallets.some((wallet) => wallet.walletId.startsWith("paper_"))).toBe(false);
    expect(wallets.some((wallet) => wallet.address.startsWith("0x"))).toBe(false);
  });

  it("carries no strategy, and no ledger field an admin has no use for", async () => {
    const text = JSON.stringify(await getAdminInference(NOW));
    expect(text).not.toContain(STRATEGY);
    expect(text).not.toContain("maxUsdPerRun");
    // The request hash, the payer's signature and the memo stay in the ledger.
    expect(text).not.toContain("0".repeat(64));
    expect(text).not.toContain("requestHash");
    expect(text).not.toContain("payerSignature");
  });

  it("reads the halt and the pause as the ledger's own reader does", async () => {
    const clear = (await getAdminInference(NOW)).control;
    expect(clear).toMatchObject({ halted: false, haltReason: null, pausedUntil: null, stops: null });

    await pauseInferenceUntil(new Date(NOW.getTime() + 20 * MINUTE), "3 paid steps from 2 agents got no answer within 15 minutes");
    const paused = (await getAdminInference(NOW)).control;
    expect(paused).toMatchObject({ halted: false, stops: "paused", pauseReason: "3 paid steps from 2 agents got no answer within 15 minutes" });
    expect(new Date(paused.pausedUntil!).getTime()).toBe(NOW.getTime() + 20 * MINUTE);

    await setInferenceHalt({ halted: true, reason: "ledger and chain disagree on one wallet", by: "@admin" });
    const halted = (await getAdminInference(NOW)).control;
    // The halt outranks the pause.
    expect(halted).toMatchObject({ halted: true, stops: "halted", haltReason: "ledger and chain disagree on one wallet", updatedBy: "@admin" });

    await setInferenceHalt({ halted: false, reason: null, by: "@admin" });
    const cleared = (await getAdminInference(NOW)).control;
    expect(cleared).toMatchObject({ halted: false, haltReason: null, stops: "paused" });
    expect(cleared.haltClearedAt).not.toBeNull();
    // A pause that has run out stops nothing.
    expect((await getAdminInference(new Date(NOW.getTime() + 21 * MINUTE))).control.stops).toBeNull();
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
