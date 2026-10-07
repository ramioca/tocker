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
 *  - a clear is a clear of the reason the admin's page showed: one whose reason has grown
 *    since is refused, and nothing in it is acknowledged;
 *  - the signature test signs only with a wallet the server looked up, and nothing a
 *    probe says reaches the browser unredacted.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { limiter } from "@/lib/security/rate-limit";
import { controlStop } from "@/lib/x402/inference-budget";
import { MAX_HALT_REASON, createInferenceLedger, haltInferenceOnce, pauseInferenceUntil, readInferenceControl } from "@/lib/x402/inference-ledger";
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
// The query the admin page is drawn from: a clear sends back what it returned.
const { getAdminInference } = await import("@/server/queries/admin");

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

/** The halt's reason exactly as the admin page is given it, at this moment. */
async function reasonOnThePage(): Promise<string | null> {
  return (await getAdminInference(ADMIN.userId)).control.haltReason;
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

    // No reason is needed to clear; a note is kept when one is given. What is needed is
    // the reason the page showed, sent back as the page was given it.
    expect(await reasonOnThePage()).toBe("checking one wallet");
    expect(await setInferenceHaltAction({ halted: false, reason: "audit script: ledger equals chain", seenReason: await reasonOnThePage() })).toEqual({
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
    expect(await setInferenceHaltAction({ halted: false, seenReason: "looking at it" })).toMatchObject({ ok: true });

    expect(controlStop(await readInferenceControl(), new Date())).toBe("paused");
    expect(await reserveOne()).toEqual({ ok: false, reason: "paused" });
  });
});

describe("clearing a halt whose reason the page did not show", () => {
  /** A transaction id of the real length, made at run time from public halves. */
  const txId = () => `${Keypair.generate().publicKey.toBase58()}${Keypair.generate().publicKey.toBase58()}`.slice(0, 87);
  const finding = (id: string) => `USDC went from an agent wallet to the gateway with no ledger row. Transaction ${id}, wallet ${Keypair.generate().publicKey.toBase58()}.`;
  const CHANGED = "The reason changed since this page was loaded. Reload and read it before clearing.";

  it("refuses when a finding was added after the page was drawn, and acknowledges neither", async () => {
    const [first, second] = [txId(), txId()];
    // 12:00. The reconciler halts, naming one transaction.
    await haltInferenceOnce(finding(first), "reconciler", first);
    // 12:03. The admin opens the page, reads it, and goes to check the transaction on chain.
    const page = await reasonOnThePage();
    expect(page).toContain(first);
    // 12:06. The next pass finds a second unexplained transfer and adds it to the stored reason.
    await haltInferenceOnce(finding(second), "reconciler", second);
    // 12:10. The admin presses the two buttons on the page drawn at 12:03.
    const res = await setInferenceHaltAction({ halted: false, reason: "checked it on chain", seenReason: page });

    expect(res).toEqual({ ok: false, error: CHANGED });
    const control = await readInferenceControl();
    expect(control).toMatchObject({ halted: true, updatedBy: "reconciler", haltAcknowledged: [] });
    expect(control.haltReason).toContain(second);
    // Money still does not move, and nothing says a halt was cleared.
    expect(await reserveOne()).toEqual({ ok: false, reason: "halted" });
    expect(await auditRows()).toEqual([]);

    // Reloaded, the page shows both. That clear is accepted, and acknowledges both.
    const reloaded = await reasonOnThePage();
    expect(reloaded).toContain(first);
    expect(reloaded).toContain(second);
    expect(await setInferenceHaltAction({ halted: false, reason: "checked both", seenReason: reloaded })).toEqual({ ok: true, data: { halted: false } });
    expect(await readInferenceControl()).toMatchObject({ halted: false, haltAcknowledged: [first, second] });
    expect((await auditRows()).map((row) => row.kind)).toEqual(["kill_switch_off"]);
  });

  it("refuses a clear that does not say what the page showed, whatever is sent in its place", async () => {
    const id = txId();
    await haltInferenceOnce(finding(id), "reconciler", id);
    for (const seenReason of [undefined, 42, true, {}, ["a reason"]]) {
      const res = await setInferenceHaltAction({ halted: false, seenReason } as unknown as { halted: boolean });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("Reload and read it before clearing.");
    }
    // "The page showed no reason" is a claim like any other, and it is not what is stored.
    expect(await setInferenceHaltAction({ halted: false, seenReason: null })).toEqual({ ok: false, error: CHANGED });
    expect(await setInferenceHaltAction({ halted: false, seenReason: "" })).toEqual({ ok: false, error: CHANGED });
    expect(await readInferenceControl()).toMatchObject({ halted: true, haltAcknowledged: [] });
    expect(await auditRows()).toEqual([]);
  });

  it("refuses a page that is stale the other way: the halt it shows was cleared, or cleared and thrown again", async () => {
    const [first, second] = [txId(), txId()];
    await haltInferenceOnce(finding(first), "reconciler", first);
    const page = await reasonOnThePage();
    // Another admin clears it from their own page.
    expect((await setInferenceHaltAction({ halted: false, seenReason: page })).ok).toBe(true);
    await db.delete(schema.auditEvents);
    expect(await setInferenceHaltAction({ halted: false, seenReason: page })).toEqual({ ok: false, error: CHANGED });

    await haltInferenceOnce(finding(second), "reconciler", second);
    expect(await setInferenceHaltAction({ halted: false, seenReason: page })).toEqual({ ok: false, error: CHANGED });
    expect(await readInferenceControl()).toMatchObject({ halted: true, haltAcknowledged: [first] });
    expect(await auditRows()).toEqual([]);
  });

  it("accepts exactly what the page was given, for a reason grown to its full length", async () => {
    // The query that draws the page and the ledger that checks the clear must agree on
    // every character, or no halt with a long reason could ever be cleared.
    const ids = Array.from({ length: 24 }, txId);
    await haltInferenceOnce(finding(ids[0]), "reconciler", ids[0]);
    for (const id of ids.slice(1)) await haltInferenceOnce(`${finding(id)} ${"-".repeat(120)}`, "reconciler", id);
    const page = await reasonOnThePage();
    expect(page!.length).toBeGreaterThan(3000);
    expect(page!.length).toBeLessThanOrEqual(MAX_HALT_REASON);

    expect(await setInferenceHaltAction({ halted: false, seenReason: page })).toEqual({ ok: true, data: { halted: false } });
    const named = page!.match(/[1-9A-HJ-NP-Za-km-z]{64,90}/g) ?? [];
    expect(named.length).toBeGreaterThan(5);
    expect((await readInferenceControl()).haltAcknowledged).toEqual(named);
  });

  it("is refused for a reason that changed and for nothing else: a breaker's pause written since the page was drawn does not refuse it", async () => {
    const id = txId();
    await haltInferenceOnce(finding(id), "reconciler", id);
    const page = await reasonOnThePage();
    const before = (await db.select().from(schema.inferenceControl))[0];
    // The breakers write to the same row, every five minutes while they are tripped. That
    // moves the row's time and changes nothing an admin has to read before clearing.
    await pauseInferenceUntil(new Date(Date.now() + 20 * 60_000), "5 runs from 2 accounts stopped because the gateway did not answer within 10 minutes");
    expect((await db.select().from(schema.inferenceControl))[0].updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());

    expect(await setInferenceHaltAction({ halted: false, seenReason: page })).toEqual({ ok: true, data: { halted: false } });
    expect((await readInferenceControl()).haltAcknowledged).toEqual([id]);
    // The pause is the breakers' own and still stands.
    expect(controlStop(await readInferenceControl(), new Date())).toBe("paused");
  });

  it("only ever compares what is sent back: it is not stored, not logged and not in the audit log", async () => {
    const logged: string[] = [];
    for (const method of ["error", "warn", "info", "log"] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.join(" ")));
    const id = txId();
    await haltInferenceOnce(finding(id), "reconciler", id);
    const MARK = "TEXT-ONLY-THE-BROWSER-SENT";

    expect((await setInferenceHaltAction({ halted: false, seenReason: `${await reasonOnThePage()} ${MARK}` })).ok).toBe(false);
    // Longer than any reason a page can print: refused as it stands.
    expect(await setInferenceHaltAction({ halted: false, seenReason: `${MARK}${"x".repeat(MAX_HALT_REASON)}` })).toEqual({ ok: false, error: CHANGED });
    expect((await setInferenceHaltAction({ halted: false, reason: "all read", seenReason: await reasonOnThePage() })).ok).toBe(true);

    expect(JSON.stringify(await db.select().from(schema.inferenceControl))).not.toContain(MARK);
    expect(JSON.stringify(await db.select().from(schema.auditEvents))).not.toContain(MARK);
    expect(logged.join("\n")).not.toContain(MARK);
    // And the audit entry for the clear carries the admin's note, never the reason sent back.
    const [audit] = await auditRows();
    expect(audit.summary).toBe("Cleared the halt on pay-per-use thinking: all read");
    expect(JSON.stringify(audit)).not.toContain(id);
  });

  it("has nothing to compare when no halt is on: saying it was looked at is still recorded", async () => {
    expect(await setInferenceHaltAction({ halted: false })).toEqual({ ok: true, data: { halted: false } });
    expect((await readInferenceControl()).haltClearedAt).not.toBeNull();
  });

  it("asks nothing of a halt: stopping never needs to say what was shown", async () => {
    const id = txId();
    await haltInferenceOnce(finding(id), "reconciler", id);
    // An admin halting over a halt that is already on, from a page that showed something else.
    expect(await setInferenceHaltAction({ halted: true, reason: "halting by hand as well", seenReason: "something else" })).toEqual({ ok: true, data: { halted: true } });
    expect((await readInferenceControl()).halted).toBe(true);
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
