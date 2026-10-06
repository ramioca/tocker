/**
 * The audited money actions: going live, going back to paper, and withdrawing from an agent.
 *
 * `getSession` and `next/cache` are mocked because these are server actions. So are the
 * four things that would otherwise leave the process: the readiness checklist (RPC and
 * Privy reads), the wallet library that signs a Base withdrawal, the Solana withdrawal
 * planner (chain reads) and the first live equity snapshot. Ownership, the positions and
 * trades the go-live check reads, the audit rows and the rate limiter are the real code
 * against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { USDC_MINT } from "@/lib/wallets/funding";
import { USDC_TOKEN_NOT_A_WALLET } from "@/lib/wallet-address";
import type { Session } from "@/server/types";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const BASE_DESTINATION = "0x8f3c2a9b41d7e6f05a12c3d4e5f60718293a4b5c";

let session: Session | null = null;

const evaluateLiveReadiness = vi.fn();
const secondFactorBlock = vi.fn<(userId: string) => Promise<null>>(async () => null);
const sendWithdrawal = vi.fn();
const planWithdrawal = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/security/live-readiness", () => ({
  evaluateLiveReadiness: (...args: unknown[]) => evaluateLiveReadiness(...args),
  withFirstTradePreset: (config: unknown) => config,
}));
vi.mock("@/lib/security/mfa", () => ({
  secondFactorBlock: (userId: string) => secondFactorBlock(userId),
  getMfaStatus: async () => ({ available: false, appMethods: [], userMethods: [], enrolled: false }),
  rememberMfaStatus: async () => undefined,
  lastKnownMfaMethods: async () => [],
}));
vi.mock("@/lib/wallets", () => ({
  withdrawFromAgent: (...args: unknown[]) => sendWithdrawal(...args),
}));
vi.mock("@/lib/wallets/solana-agent-transfer", async (importOriginal) => ({
  // The limits and their sentences are the real ones; only the planner is stubbed.
  ...(await importOriginal<typeof import("@/lib/wallets/solana-agent-transfer")>()),
  planAgentSolanaWithdrawal: (...args: unknown[]) => planWithdrawal(...args),
}));
vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async () => ({}),
  snapshotEquity: async () => undefined,
}));

const { backToPaperAction, goLiveAction, previewAgentWithdrawalAction, secureWithdrawAction } = await import("./security");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  for (const [address, symbol, decimals] of [
    [BONK, "BONK", 5],
    [WIF, "WIF", 6],
    [USDC_MINT.solana, "USDC", 6],
  ] as const) {
    await db
      .insert(schema.tokens)
      .values({ id: `solana:${address}`, chain: "solana", address, symbol, decimals })
      .onConflictDoNothing();
  }
  // Generous: PGlite + drizzle-kit pushSchema can take well over the 10s default hook
  // timeout on a loaded machine.
}, 120_000);

beforeEach(() => {
  session = null;
  evaluateLiveReadiness.mockReset();
  evaluateLiveReadiness.mockResolvedValue({ ready: true, steps: [] });
  secondFactorBlock.mockClear();
  sendWithdrawal.mockReset();
  sendWithdrawal.mockResolvedValue({ txHash: "0xfeed", actionId: "action_1", status: "succeeded" });
  planWithdrawal.mockReset();
  planWithdrawal.mockResolvedValue({
    route: "sponsored",
    reason: "at or under the wallet policy's cap",
    agentAddress: "AgentWalletAddress",
    feePayer: "PlatformWalletAddress",
    capBaseUnits: BigInt(2_000_000),
    delivered: 24.57,
    accountFeeUsdc: 0.3,
    tradingFeesUsdc: 0.13,
  });
});

function asOwner(userId: string): void {
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
}

/** A paper agent that passes the key check, signed in as its owner. */
async function seedReadyAgent(mode: "paper" | "live" = "paper") {
  const seeded = await seedAgent(db, { mode, config: { chains: ["solana"] } });
  const keyId = `key_${nanoid(8)}`;
  await db.insert(schema.llmKeys).values({
    id: keyId,
    userId: seeded.userId,
    provider: "anthropic",
    encryptedKey: "not-a-real-key",
    last4: "test",
  });
  await db.update(schema.agents).set({ llmKeyId: keyId }).where(eq(schema.agents.id, seeded.agentId));
  asOwner(seeded.userId);
  return seeded;
}

async function hold(agentId: string, address: string, amountToken = "1000"): Promise<void> {
  await db.insert(schema.positions).values({
    agentId,
    tokenId: `solana:${address}`,
    amountToken,
    avgCostUsd: "0.00002",
  });
}

async function recordTrade(
  agent: { agentId: string; userId: string },
  address: string,
  overrides: { isPaper: boolean; status: "filled" | "failed" },
): Promise<void> {
  await db.insert(schema.trades).values({
    id: `trade_${nanoid(8)}`,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: "buy",
    tokenId: `solana:${address}`,
    quoteTokenId: `solana:${USDC_MINT.solana}`,
    amountToken: "1000",
    amountUsd: "20",
    priceUsd: "0.02",
    status: overrides.status,
    isPaper: overrides.isPaper,
  });
}

async function modeOf(agentId: string): Promise<string | undefined> {
  const [row] = await db.select({ mode: schema.agents.mode }).from(schema.agents).where(eq(schema.agents.id, agentId));
  return row?.mode;
}

async function auditSummaries(agentId: string, kind: "go_live" | "go_paper" | "withdraw"): Promise<string[]> {
  const rows = await db
    .select({ summary: schema.auditEvents.summary })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.agentId, agentId), eq(schema.auditEvents.kind, kind)));
  return rows.map((row) => row.summary);
}

describe("goLiveAction", () => {
  it("goes live as before when the agent holds nothing", async () => {
    const { agentId } = await seedReadyAgent();

    const result = await goLiveAction({ agentId, capUsd: 2 });

    expect(result).toEqual({ ok: true, data: { mode: "live" } });
    expect(await modeOf(agentId)).toBe("live");
    // Still on the record, and the readiness list is still what decides.
    expect(secondFactorBlock).toHaveBeenCalledTimes(1);
    expect(evaluateLiveReadiness).toHaveBeenCalledTimes(1);
    expect(await auditSummaries(agentId, "go_live")).toHaveLength(1);
  });

  it("still refuses on the readiness list, in the same words", async () => {
    const { agentId } = await seedReadyAgent();
    evaluateLiveReadiness.mockResolvedValue({
      ready: false,
      steps: [{ id: "funding", title: "The wallet holds USDC", state: "fail" }],
    });

    const result = await goLiveAction({ agentId, capUsd: 2 });

    expect(result).toEqual({ ok: false, error: "Not ready: The wallet holds USDC. Re-check the list." });
    expect(await modeOf(agentId)).toBe("paper");
  });

  it("refuses a paper agent that still holds a paper position, and says how to fix it", async () => {
    const agent = await seedReadyAgent();
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: true, status: "filled" });

    const result = await goLiveAction({ agentId: agent.agentId, capUsd: 2 });

    expect(result).toEqual({
      ok: false,
      error:
        "Sell this agent's 1 paper position before going live. They are simulated, so they can't be sold for real money and would sit in the live book as holdings the wallet doesn't have.",
    });
    expect(await modeOf(agent.agentId)).toBe("paper");
    expect(await auditSummaries(agent.agentId, "go_live")).toHaveLength(0);
  });

  it("counts every paper position, and none once they are sold", async () => {
    const agent = await seedReadyAgent();
    await hold(agent.agentId, BONK);
    await hold(agent.agentId, WIF);

    const refused = await goLiveAction({ agentId: agent.agentId, capUsd: 2 });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/^Sell this agent's 2 paper positions before going live\./);

    // A paper sell leaves the row behind at zero; a closed position is not a holding.
    await db.update(schema.positions).set({ amountToken: "0" }).where(eq(schema.positions.agentId, agent.agentId));

    expect(await goLiveAction({ agentId: agent.agentId, capUsd: 2 })).toEqual({ ok: true, data: { mode: "live" } });
    expect(await modeOf(agent.agentId)).toBe("live");
  });

  it("does not call tokens bought with real money simulated", async () => {
    // Live, bought BONK for real, switched back to paper, now switching to live again.
    // Those tokens are in the wallet: telling the owner to sell them "on paper" would
    // empty the book and leave them there.
    const agent = await seedReadyAgent();
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: false, status: "filled" });

    expect(await goLiveAction({ agentId: agent.agentId, capUsd: 2 })).toEqual({ ok: true, data: { mode: "live" } });
  });

  it("is not fooled by a live order that never filled, or by a real fill in another token", async () => {
    const agent = await seedReadyAgent();
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: false, status: "failed" });
    await recordTrade(agent, WIF, { isPaper: false, status: "filled" });

    const result = await goLiveAction({ agentId: agent.agentId, capUsd: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/1 paper position before going live/);
  });

  it("checks ownership before anything else", async () => {
    const agent = await seedReadyAgent();
    await hold(agent.agentId, BONK);
    const stranger = await seedAgent(db);
    asOwner(stranger.userId);

    expect(await goLiveAction({ agentId: agent.agentId, capUsd: 2 })).toEqual({
      ok: false,
      error: "You do not own this agent",
    });
  });
});

describe("backToPaperAction", () => {
  it("is never blocked by open positions, and its audit line says what stays behind", async () => {
    const agent = await seedReadyAgent("live");
    await hold(agent.agentId, BONK);
    await recordTrade(agent, BONK, { isPaper: false, status: "filled" });

    expect(await backToPaperAction(agent.agentId)).toEqual({ ok: true, data: { mode: "paper" } });
    expect(await modeOf(agent.agentId)).toBe("paper");
    expect(await auditSummaries(agent.agentId, "go_paper")).toEqual([
      "Switched Test Agent back to paper. Real tokens it still holds stay in its wallet; sell them before switching, or switch back to live to sell them.",
    ]);
  });
});

describe("secureWithdrawAction on Base", () => {
  const withdraw = (agentId: string, toAddress = BASE_DESTINATION) =>
    secureWithdrawAction({ agentId, chain: "base", asset: "usdc", amount: 1, toAddress });

  it("lets ten through in ten minutes and refuses the eleventh with a wait", async () => {
    const { agentId } = await seedReadyAgent();

    for (let i = 0; i < 10; i += 1) {
      const result = await withdraw(agentId);
      expect(result.ok, `withdrawal ${i + 1}`).toBe(true);
    }
    expect(sendWithdrawal).toHaveBeenCalledTimes(10);

    const eleventh = await withdraw(agentId);
    expect(eleventh.ok).toBe(false);
    if (eleventh.ok) return;
    expect(eleventh.error).toMatch(/^That's a lot of withdrawals in a short time\. Try again in \d+ (seconds|minutes)\.$/);
    // Refused before anything was signed, and nothing was written to the log for it.
    expect(sendWithdrawal).toHaveBeenCalledTimes(10);
    expect(await auditSummaries(agentId, "withdraw")).toHaveLength(10);
  });

  it("counts per owner: someone else's burst does not use up yours", async () => {
    const first = await seedReadyAgent();
    for (let i = 0; i < 10; i += 1) await withdraw(first.agentId);
    expect((await withdraw(first.agentId)).ok).toBe(false);

    const second = await seedReadyAgent();
    expect((await withdraw(second.agentId)).ok).toBe(true);
  });

  it("does not spend a slot on a withdrawal it refuses for the address or the owner", async () => {
    const agent = await seedReadyAgent();

    // The USDC contract itself, which the Deposit sheet offers to copy.
    expect(await withdraw(agent.agentId, USDC_MINT.base)).toEqual({ ok: false, error: USDC_TOKEN_NOT_A_WALLET });
    expect(await withdraw(agent.agentId, BONK)).toEqual({
      ok: false,
      error: "That's a Solana address. This withdrawal leaves on Base. Paste a 0x… address, or switch the chain to Solana.",
    });

    const stranger = await seedAgent(db);
    asOwner(stranger.userId);
    expect(await withdraw(agent.agentId)).toEqual({ ok: false, error: "You do not own this agent" });
    expect(sendWithdrawal).not.toHaveBeenCalled();

    // All ten of the owner's are still there.
    asOwner(agent.userId);
    for (let i = 0; i < 10; i += 1) expect((await withdraw(agent.agentId)).ok).toBe(true);
  });
});

describe("previewAgentWithdrawalAction", () => {
  const preview = (agentId: string, overrides: { toAddress?: string; amount?: number; asset?: "usdc" | "native" } = {}) =>
    previewAgentWithdrawalAction({ agentId, asset: "usdc", amount: 25, toAddress: BONK, ...overrides });

  it("returns what arrives and the two fees, and nothing else from the plan", async () => {
    const { agentId } = await seedReadyAgent();

    const result = await preview(agentId, { toAddress: `  ${BONK} ` });

    // Not the route, the cap or either wallet: those stay on the server.
    expect(result).toEqual({ ok: true, data: { delivered: 24.57, accountFeeUsdc: 0.3, tradingFeesUsdc: 0.13 } });
    expect(planWithdrawal).toHaveBeenCalledWith({ agentId, asset: "usdc", amount: 25, toAddress: BONK });
  });

  it("refuses what the withdrawal refuses, in the same order, before reading the chain", async () => {
    const agent = await seedReadyAgent();

    session = null;
    expect(await preview(agent.agentId)).toEqual({ ok: false, error: "Sign in first" });

    asOwner(agent.userId);
    expect(await preview(agent.agentId, { amount: 0 })).toEqual({ ok: false, error: "Enter an amount greater than zero" });
    expect(await preview(agent.agentId, { amount: Number.NaN })).toEqual({
      ok: false,
      error: "Enter an amount greater than zero",
    });
    expect(await preview(agent.agentId, { toAddress: " " })).toEqual({ ok: false, error: "Enter a destination address" });
    expect(await preview(agent.agentId, { toAddress: USDC_MINT.solana })).toEqual({
      ok: false,
      error: USDC_TOKEN_NOT_A_WALLET,
    });
    expect(await preview(agent.agentId, { toAddress: BASE_DESTINATION })).toEqual({
      ok: false,
      error: "That's a Base (0x…) address. This withdrawal leaves on Solana. Paste a Solana address, or switch the chain to Base.",
    });

    const stranger = await seedAgent(db);
    asOwner(stranger.userId);
    expect(await preview(agent.agentId)).toEqual({ ok: false, error: "You do not own this agent" });

    expect(planWithdrawal).not.toHaveBeenCalled();
  });

  it("hands back the planner's refusal word for word, and never a raw error", async () => {
    const { agentId } = await seedReadyAgent();

    const overCap =
      "That's more than this agent's 2 USDC per-transaction limit, and above the limit Tocker only sends to your own " +
      "Tocker wallet. Send at most 2 USDC to this address, withdraw to your own wallet, or raise the limit in the " +
      "agent's settings. Nothing was sent.";
    planWithdrawal.mockRejectedValueOnce(new Error(overCap));
    expect(await preview(agentId)).toEqual({ ok: false, error: overCap });

    // An RPC URL carries its key; a driver error is not a sentence.
    planWithdrawal.mockRejectedValueOnce(new Error("fetch failed: https://rpc.example/v2/secret-key"));
    expect(await preview(agentId)).toEqual({
      ok: false,
      error: "Couldn't check this withdrawal just now. Try again in a moment.",
    });
  });

  it("has its own limit, and uses up none of the withdrawals", async () => {
    const { agentId } = await seedReadyAgent();

    for (let i = 0; i < 60; i += 1) expect((await preview(agentId)).ok, `preview ${i + 1}`).toBe(true);
    const limited = await preview(agentId);
    expect(limited.ok).toBe(false);
    if (limited.ok) return;
    expect(limited.error).toMatch(/^Slow down — try again in \d+ seconds?\.$/);
    expect(planWithdrawal).toHaveBeenCalledTimes(60);

    // Nothing was signed, and all ten withdrawals of the burst limit are still there.
    expect(sendWithdrawal).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i += 1) {
      const sent = await secureWithdrawAction({ agentId, chain: "base", asset: "usdc", amount: 1, toAddress: BASE_DESTINATION });
      expect(sent.ok, `withdrawal ${i + 1}`).toBe(true);
    }
  });
});
