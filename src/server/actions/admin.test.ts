/**
 * The admin's three pay-per-use actions: the halt, ending a pause, and the signature test.
 *
 * `getSession` and `next/cache` are mocked because these are server actions, and the
 * signature probe is mocked because the real one reaches the gateway and Privy. The
 * ledger, the audit log, the wallet lookup and the rate limiter are the real code
 * against in-memory PGlite, so "halted" here means what it means in production: the
 * ledger's own `reserve` refuses the next payment.
 *
 * What is pinned, in the order it matters:
 *
 *  - nobody but an admin can touch any of it, and a refusal looks like nothing is there;
 *  - a halt cannot be thrown without a reason, and stops the very next reservation;
 *  - clearing it is what lets money move again, and is recorded;
 *  - the signature test signs only with a wallet the server looked up, and nothing a
 *    probe says reaches the browser unredacted.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { limiter } from "@/lib/security/rate-limit";
import { controlStop } from "@/lib/x402/inference-budget";
import { createInferenceLedger, pauseInferenceUntil, readInferenceControl } from "@/lib/x402/inference-ledger";
import { INFERENCE_GATEWAY, type InferenceCaps } from "@/lib/x402/inference-types";
import type { Session } from "@/server/types";

let session: Session | null = null;

type ProbeResult = { ok: true; checks: string[] } | { ok: false; reason: string };
const probe = vi.fn<(payer: { walletId: string; address: string }) => Promise<ProbeResult>>();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
// The real module builds x402 and Privy clients. Only the probe is used by these actions.
vi.mock("@/lib/x402/paidFetch", () => ({
  probeInferenceSignature: (payer: { walletId: string; address: string }) => probe(payer),
}));

const { clearInferencePauseAction, refreshAdminBalancesAction, setInferenceHaltAction, testInferenceSignatureAction } = await import("./admin");

let db: Db;
let agent: { userId: string; agentId: string; slug: string };
let walletId: string;
const WALLET_ADDRESS = "AgentSolanaAddress11111111111111111111111111";

const ADMIN: Session = { userId: "did:privy:admin", handle: "boss", displayName: null, avatarUrl: null, email: "admin@example.com" };
const STRANGER: Session = { ...ADMIN, userId: "did:privy:someone", handle: "someone", email: "someone@example.com" };

const CAPS: InferenceCaps = {
  stepUsd: 0.25,
  runUsd: 1,
  agentDayUsd: 5,
  ownerDayUsd: 25,
  platformDayUsd: 100,
  agentDayRequests: 600,
  maxRequestsPerRun: 21,
};

/** Ask the real ledger for one reservation, as a run's next step would. */
function reserveOne() {
  return createInferenceLedger().reserve({
    ownerId: agent.userId,
    agentId: agent.agentId,
    runId: `run_${nanoid(8)}`,
    seq: 0,
    requestHash: "0".repeat(64),
    chain: "solana",
    network: INFERENCE_GATEWAY.solana.network,
    host: INFERENCE_GATEWAY.solana.host,
    model: "google/gemini-2.5-flash",
    payerWalletId: walletId,
    payerAddress: WALLET_ADDRESS,
    payTo: INFERENCE_GATEWAY.solana.payTo[0],
    asset: INFERENCE_GATEWAY.solana.asset,
    quotedUsd: 0.01,
    caps: CAPS,
    runSpentUsd: 0,
    now: new Date(),
  });
}

async function auditRows() {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, ADMIN.userId)).orderBy(desc(schema.auditEvents.createdAt));
}

beforeAll(async () => {
  db = await setupTestDb();
  agent = await seedAgent(db, { mode: "live" });
  walletId = `pw_sol_${agent.agentId.slice(0, 8)}`;
  await db.insert(schema.wallets).values({
    id: walletId,
    kind: "agent_server",
    chain: "solana",
    address: WALLET_ADDRESS,
    userId: agent.userId,
    agentId: agent.agentId,
  });
  await db.insert(schema.users).values({ id: ADMIN.userId, handle: ADMIN.handle, displayName: "Admin" });
}, 120_000);

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  session = ADMIN;
  probe.mockReset();
  probe.mockResolvedValue({ ok: true, checks: ["quote passed the pins", "nothing was sent"] });
  // A clean switch row and audit log, and a fresh rate-limit window, for every test.
  await db.delete(schema.inferenceControl);
  await db.delete(schema.auditEvents);
  (limiter as unknown as { buckets: Map<string, unknown> }).buckets.clear();
});

describe("nobody but an admin", () => {
  for (const [who, value] of [
    ["an anonymous visitor", null],
    ["a signed-in user who is not on the list", STRANGER],
    ["an account with no email", { ...ADMIN, email: null }],
  ] as const) {
    it(`${who} is told nothing is there, and nothing happens`, async () => {
      session = value;
      await pauseInferenceUntil(new Date(Date.now() + 10 * 60_000), "tripped");

      expect(await setInferenceHaltAction({ halted: true, reason: "because I can" })).toEqual({ ok: false, error: "Not found." });
      expect(await setInferenceHaltAction({ halted: false })).toEqual({ ok: false, error: "Not found." });
      expect(await clearInferencePauseAction()).toEqual({ ok: false, error: "Not found." });
      expect(await testInferenceSignatureAction({ walletId })).toEqual({ ok: false, error: "Not found." });
      expect(await refreshAdminBalancesAction()).toEqual({ ok: false, error: "Not found." });

      const control = await readInferenceControl();
      expect(control.halted).toBe(false);
      // The pause is still in force: it was not ended.
      expect(controlStop(control, new Date())).toBe("paused");
      expect(probe).not.toHaveBeenCalled();
      expect(await db.select().from(schema.auditEvents)).toEqual([]);
    });
  }

  it("is nobody at all when ADMIN_EMAILS is unset", async () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    expect(await setInferenceHaltAction({ halted: true, reason: "testing the gate" })).toEqual({ ok: false, error: "Not found." });
    expect(await testInferenceSignatureAction({ walletId })).toEqual({ ok: false, error: "Not found." });
    expect((await readInferenceControl()).halted).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("setInferenceHaltAction", () => {
  it("halts with a reason, and the ledger refuses the very next reservation", async () => {
    // Before: a payment can be reserved.
    expect(await reserveOne()).toMatchObject({ ok: true });

    expect(await setInferenceHaltAction({ halted: true, reason: "  ledger and chain disagree on one wallet  " })).toEqual({
      ok: true,
      data: { halted: true },
    });

    const control = await readInferenceControl();
    expect(control).toMatchObject({ halted: true, haltReason: "ledger and chain disagree on one wallet", updatedBy: "@boss" });
    // After: nothing may be signed. This is the ledger's own answer, not the page's.
    expect(await reserveOne()).toEqual({ ok: false, reason: "halted" });

    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      kind: "kill_switch_on",
      summary: "Halted pay-per-use thinking for every agent: ledger and chain disagree on one wallet",
      metadata: { scope: "pay_per_use_thinking", halted: true },
    });
  });

  it("will not halt without a reason, or with one too long to read", async () => {
    for (const reason of [undefined, null, "", "   ", "no"]) {
      const res = await setInferenceHaltAction({ halted: true, reason });
      expect(res.ok).toBe(false);
    }
    expect((await setInferenceHaltAction({ halted: true, reason: "x".repeat(301) })).ok).toBe(false);
    expect((await readInferenceControl()).halted).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  it("refuses a reason that carries something shaped like a key, and stores none of it", async () => {
    // Assembled here, so no file in the repository holds anything key-shaped.
    const key = `${"sk-"}${"aB3".repeat(16)}`;
    const res = await setInferenceHaltAction({ halted: true, reason: `gateway echoed ${key}` });
    expect(res.ok).toBe(false);
    expect((await readInferenceControl()).halted).toBe(false);
    expect(JSON.stringify(await db.select().from(schema.inferenceControl))).not.toContain("aB3aB3");
  });

  it("refuses a call that does not say which way to throw the switch", async () => {
    const res = await setInferenceHaltAction({ reason: "ambiguous" } as unknown as { halted: boolean });
    expect(res.ok).toBe(false);
    expect((await readInferenceControl()).halted).toBe(false);
  });

  it("clears the halt, records when, and lets a reservation through again", async () => {
    await setInferenceHaltAction({ halted: true, reason: "checking one wallet" });
    expect(await reserveOne()).toEqual({ ok: false, reason: "halted" });

    // No reason is needed to clear; a note is kept when one is given.
    expect(await setInferenceHaltAction({ halted: false, reason: "audit script: ledger equals chain" })).toEqual({
      ok: true,
      data: { halted: false },
    });

    const control = await readInferenceControl();
    expect(control).toMatchObject({ halted: false, haltReason: null, updatedBy: "@boss" });
    expect(control.haltClearedAt).not.toBeNull();
    expect(await reserveOne()).toMatchObject({ ok: true });

    const [audit] = await auditRows();
    expect(audit).toMatchObject({
      kind: "kill_switch_off",
      summary: "Cleared the halt on pay-per-use thinking: audit script: ledger equals chain",
      metadata: { scope: "pay_per_use_thinking", halted: false },
    });
  });

  it("does not end a breaker's pause by clearing a halt", async () => {
    await pauseInferenceUntil(new Date(Date.now() + 10 * 60_000), "tripped");
    await setInferenceHaltAction({ halted: true, reason: "looking at it" });
    await setInferenceHaltAction({ halted: false });

    expect(controlStop(await readInferenceControl(), new Date())).toBe("paused");
    expect(await reserveOne()).toEqual({ ok: false, reason: "paused" });
  });
});

describe("clearInferencePauseAction", () => {
  it("ends a pause now, so the next reservation goes through, and records it", async () => {
    await pauseInferenceUntil(new Date(Date.now() + 25 * 60_000), "3 paid steps got no answer");
    expect(await reserveOne()).toEqual({ ok: false, reason: "paused" });

    expect(await clearInferencePauseAction()).toEqual({ ok: true, data: { cleared: true } });

    const control = await readInferenceControl();
    expect(controlStop(control, new Date())).toBeNull();
    expect(control.updatedBy).toBe("@boss");
    expect(await reserveOne()).toMatchObject({ ok: true });
    const [audit] = await auditRows();
    expect(audit).toMatchObject({ kind: "kill_switch_off", metadata: { scope: "pay_per_use_thinking", pause: "cleared" } });
  });

  it("does not lift an admin halt", async () => {
    await pauseInferenceUntil(new Date(Date.now() + 25 * 60_000), "tripped");
    await setInferenceHaltAction({ halted: true, reason: "halted on purpose" });
    expect(await clearInferencePauseAction()).toEqual({ ok: true, data: { cleared: true } });
    expect((await readInferenceControl()).halted).toBe(true);
    expect(await reserveOne()).toEqual({ ok: false, reason: "halted" });
  });

  it("has nothing to end when no pause is in force, and records nothing", async () => {
    // Never paused at all, and a pause that has already run out.
    expect((await clearInferencePauseAction()).ok).toBe(false);
    await pauseInferenceUntil(new Date(Date.now() - 60_000), "ran out a minute ago");
    expect((await clearInferencePauseAction()).ok).toBe(false);
    expect(await auditRows()).toEqual([]);
  });
});

describe("testInferenceSignatureAction", () => {
  // The test signs only with a wallet of one of the admin's own agents.
  beforeAll(async () => {
    await db.update(schema.agents).set({ ownerId: ADMIN.userId }).where(eq(schema.agents.id, agent.agentId));
  });

  it("will not make another person's agent wallet sign, admin or not", async () => {
    const theirs = await seedAgent(db, { mode: "live" });
    const theirWallet = `pw_sol_${theirs.agentId.slice(0, 8)}`;
    await db.insert(schema.wallets).values({
      id: theirWallet,
      kind: "agent_server",
      chain: "solana",
      address: "SomebodyElsesSolanaWallet",
      userId: theirs.userId,
      agentId: theirs.agentId,
    });

    const res = await testInferenceSignatureAction({ walletId: theirWallet });

    expect(res).toEqual({ ok: false, error: "That is not the Solana wallet of one of your own agents. Nothing was signed." });
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes the wallet the database holds for that id, and returns the checks", async () => {
    const res = await testInferenceSignatureAction({ walletId });
    expect(res).toEqual({ ok: true, data: { checks: ["quote passed the pins", "nothing was sent"], agentName: "Test Agent" } });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith({ walletId, address: WALLET_ADDRESS });
  });

  it("takes no address from the caller: an extra field is ignored", async () => {
    await testInferenceSignatureAction({ walletId, address: "AttackerAddress" } as unknown as { walletId: string });
    expect(probe).toHaveBeenCalledWith({ walletId, address: WALLET_ADDRESS });
  });

  it("signs nothing for a placeholder, a wallet on another chain, a user's wallet or an unknown id", async () => {
    const baseId = `pw_base_${nanoid(6)}`;
    await db.insert(schema.wallets).values({ id: baseId, kind: "agent_server", chain: "base", address: "0xBASE", userId: agent.userId, agentId: agent.agentId });
    const embeddedId = `emb_${nanoid(6)}`;
    await db.insert(schema.wallets).values({ id: embeddedId, kind: "user_embedded", chain: "solana", address: "UserSolana", userId: agent.userId });

    for (const id of [`paper_${agent.agentId}_solana`, baseId, embeddedId, "no-such-wallet", "", undefined as unknown as string]) {
      const res = await testInferenceSignatureAction({ walletId: id });
      expect(res).toEqual({ ok: false, error: "That is not the Solana wallet of one of your own agents. Nothing was signed." });
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("redacts what the probe says, whether it passed or not", async () => {
    const key = `${"sk-"}${"aB3".repeat(16)}`;
    probe.mockResolvedValueOnce({ ok: true, checks: [`the gateway answered with ${key}`, "x".repeat(900)] });
    const passed = await testInferenceSignatureAction({ walletId });
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(JSON.stringify(passed.data)).not.toContain("aB3aB3");
      expect(passed.data.checks[0]).toContain("the gateway answered with");
      expect(passed.data.checks[1].length).toBeLessThanOrEqual(300);
    }

    probe.mockResolvedValueOnce({ ok: false, reason: `quote_failed: upstream said ${key} ${"y".repeat(900)}` });
    const failed = await testInferenceSignatureAction({ walletId });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toContain("quote_failed");
      expect(failed.error).not.toContain("aB3aB3");
      expect(failed.error.length).toBeLessThanOrEqual(300);
    }
  });

  it("reports a probe that throws as a failed test, redacted, and never as a pass", async () => {
    const key = `${"sk-"}${"aB3".repeat(16)}`;
    probe.mockRejectedValueOnce(new Error(`socket hang up while sending ${key}`));
    const res = await testInferenceSignatureAction({ walletId });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("socket hang up");
      expect(res.error).not.toContain("aB3aB3");
    }
  });

  it("stops after ten presses in a minute: each one is a gateway request and a signature", async () => {
    for (let press = 0; press < 10; press += 1) expect((await testInferenceSignatureAction({ walletId })).ok).toBe(true);
    const eleventh = await testInferenceSignatureAction({ walletId });
    expect(eleventh.ok).toBe(false);
    expect(probe).toHaveBeenCalledTimes(10);
  });

  it("changes nothing on the ledger or the switches", async () => {
    await testInferenceSignatureAction({ walletId });
    expect(await db.select().from(schema.inferenceControl)).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});
