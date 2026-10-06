"use server";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { agentFundingIntents, agents, getDb, wallets } from "@/db";
import { getSession } from "@/lib/auth";
import {
  applyAgentBudgetPolicy,
  getAgentWallets,
  getAgentWalletBalances as loadBalances,
  getUserWalletBalances,
} from "@/lib/wallets";
import { unifiedCash, type UnifiedCash } from "@/lib/wallets/funding";
import { toNumeric } from "@/lib/money";
import { newId } from "@/server/queries/_shared";
import { publicErrorMessage } from "./_shared";
import type {
  ActionResult,
  Chain,
  PreparedSponsoredFunding,
  WalletBalance,
} from "@/server/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Owner-only. The public record is the equity curve and the trades; the per-asset wallet
 * breakdown (how much gas it holds, how much dry powder is parked where) is operating
 * detail, and the only screen that renders it is the owner's settings page.
 */
export async function getAgentWalletBalances(agentId: string): Promise<ActionResult<WalletBalance[]>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  try {
    return { ok: true, data: await loadBalances(agentId) };
  } catch (err) {
    console.error("[getAgentWalletBalances]", err);
    return fail("Could not read wallet balances");
  }
}

// -------------------------------------------------------------- unified cash

/**
 * The signed-in user's own cash: USDC across their embedded wallets, presented
 * as one number with a per-chain breakdown underneath. Always the session's own
 * wallets — nothing about whose money this is comes from the caller.
 */
export async function getMyCash(): Promise<ActionResult<{ wallets: WalletBalance[]; cash: UnifiedCash }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  try {
    const rows = await getUserWalletBalances(session.userId);
    return { ok: true, data: { wallets: rows, cash: unifiedCash(rows) } };
  } catch (err) {
    console.error("[getMyCash]", err);
    return fail("Could not read your balances");
  }
}

/**
 * The agent's own wallet addresses, so the client can sign a transfer into them.
 * Owner-only: funding someone else's agent is not a feature, and the address of
 * a stranger's wallet is not public information in this product.
 */
export async function getAgentFundingTargets(
  agentId: string,
): Promise<ActionResult<Array<{ chain: Chain; address: string; walletId: string }>>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const rows = await getAgentWallets(agentId);

  // Last stop before the user signs: make sure the agent's USDC account exists and that
  // the platform, not the user, paid the rent for it (W7 B1). Idempotent, and a failure
  // only means the user's own transfer creates it — it must never block funding.
  const solana = rows.find((w) => w.chain === "solana");
  if (solana) {
    const { ensureAgentUsdcAta } = await import("@/lib/wallets/gas");
    await ensureAgentUsdcAta({ agentId, address: solana.address });
  }

  return {
    ok: true,
    data: rows.map((w) => ({ chain: w.chain, address: w.address, walletId: w.id })),
  };
}

// ------------------------------------------------- sponsored Solana funding

/**
 * Resolve a destination address to an agent the session user owns.
 *
 * Nothing about ownership comes from the caller: the address is looked up in `wallets`,
 * it has to be an `agent_server` Solana row, and that row's agent has to belong to the
 * session. An address that is not one of the caller's agents' wallets is not a case to
 * sponsor — it is a plain transfer the user pays for, so the client falls back.
 */
async function ownedAgentSolanaWallet(
  userId: string,
  toAddress: string,
): Promise<ActionResult<{ agentId: string; agentName: string; slug: string; address: string }>> {
  const to = toAddress?.trim();
  if (!to) return fail("No destination address");

  const db = await getDb();
  const [row] = await db
    .select({ address: wallets.address, agentId: wallets.agentId })
    .from(wallets)
    .where(and(eq(wallets.address, to), eq(wallets.chain, "solana"), eq(wallets.kind, "agent_server")))
    .limit(1);
  if (!row?.agentId) return fail("That address is not one of your agents' Solana wallets.");

  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, row.agentId))
    .limit(1);
  if (!agent) return fail("That wallet's agent no longer exists");
  if (agent.ownerId !== userId) return fail("You do not own this agent");

  return { ok: true, data: { agentId: agent.id, agentName: agent.name, slug: agent.slug, address: row.address } };
}

/**
 * Per-user limits on sponsored funding — each submit spends the platform's SOL on a fee,
 * and a prepare can start a refuel swap. Looser than withdrawals' (5 per 10 minutes):
 * a create-and-fund plus a retry or two is several transfers in a minute, all to the
 * user's own agents. In-process, like every limiter here (see `rate-limit.ts`).
 */
const FUNDING_PREPARE_LIMIT = { limit: 10, windowMs: 60_000 };
const FUNDING_SUBMIT_BURST_LIMIT = { limit: 10, windowMs: 10 * 60_000 };
const FUNDING_SUBMIT_DAILY_LIMIT = { limit: 50, windowMs: 24 * 60 * 60_000 };

/** Null when allowed; otherwise the sentence to show. */
async function fundingLimited(key: string, rule: { limit: number; windowMs: number }): Promise<string | null> {
  const { limiter } = await import("@/lib/security/rate-limit");
  const verdict = limiter.consume(key, rule);
  if (verdict.ok) return null;
  const wait =
    verdict.retryAfterSeconds >= 90
      ? `${Math.ceil(verdict.retryAfterSeconds / 60)} minutes`
      : `${verdict.retryAfterSeconds} seconds`;
  return `That's a lot of funding transfers in a short time. Try again in ${wait}.`;
}

/** The session user's recorded embedded Solana wallet — the only wallet we will build a transfer out of. */
async function myEmbeddedSolanaAddress(userId: string): Promise<ActionResult<string>> {
  const db = await getDb();
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, "solana"), eq(wallets.kind, "user_embedded")))
    .limit(1);
  if (!row) {
    return fail(
      "Tocker has no Solana wallet on record for you, so it cannot build a transfer out of one. Open Deposit and tap Sync wallets, then try again.",
    );
  }
  return { ok: true, data: row.address };
}

/**
 * Step 1 of sponsored funding: build the transaction the user is asked to sign.
 *
 * The operator's embedded Solana wallet holds USDC and no SOL, so it cannot pay a
 * network fee. Tocker's platform Solana wallet — the same one that pays for x402 data
 * and drips gas — is the fee payer, and it also pays the rent on the agent's USDC
 * account. Nothing here is signed: it returns bytes, and the browser decides.
 *
 * When the platform wallet is short it refuels from its own USDC and is checked once
 * more (`ensureSponsorCapacity`). If it still cannot pay, this fails with a sentence that
 * asks the user for nothing — there is no self-paid fallback for USDC on Solana: the
 * user's wallet has no SOL, and asking them to get some is exactly what this avoids.
 * The platform wallet's numbers go to the server log, where the operator reads them.
 */
export async function prepareSponsoredFunding(input: {
  toAddress: string;
  amount: number;
}): Promise<ActionResult<PreparedSponsoredFunding>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const tooMany = await fundingLimited(`sponsored-fund:prepare:${session.userId}`, FUNDING_PREPARE_LIMIT);
  if (tooMany) return fail(tooMany);

  const { MIN_SPONSORED_FUNDING_USDC } = await import("@/lib/wallets/solana-sponsored");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < MIN_SPONSORED_FUNDING_USDC) {
    return fail(`Send at least $${MIN_SPONSORED_FUNDING_USDC.toFixed(2)}.`);
  }

  const target = await ownedAgentSolanaWallet(session.userId, input.toAddress);
  if (!target.ok) return target;

  const from = await myEmbeddedSolanaAddress(session.userId);
  if (!from.ok) return from;
  if (from.data === target.data.address) return fail("That is the agent's own wallet, not yours");

  const { PublicKey } = await import("@solana/web3.js");
  const { SOLANA_USDC_MINT, associatedTokenAddress } = await import("@/lib/wallets/solana-transfer");
  const { accountExists } = await import("@/lib/wallets/solana-rpc");
  const {
    agentAccountOpeningRefusal,
    buildSponsoredUsdcTransfer,
    ensureSponsorCapacity,
    sponsoredAgentAccountOpens,
    sponsorReserveLamports,
    tokenAccountRentLamports,
  } = await import("@/lib/wallets/solana-sponsored");

  const ata = associatedTokenAddress(new PublicKey(target.data.address), SOLANA_USDC_MINT).toBase58();
  // An unreadable account is assumed missing: that only ever makes the check stricter,
  // and being wrong the other way would mean promising to pay rent we cannot cover.
  const ataExists = await accountExists(ata).catch(() => false);
  const rentLamports = ataExists ? 0 : await tokenAccountRentLamports();

  // Opening the agent's USDC account is rent the user never pays back, and agents are
  // free to create: a per-user daily count, asked here so the answer comes before the
  // user signs, and again at submit, where it binds.
  if (!ataExists) {
    const refusal = agentAccountOpeningRefusal({
      opensAccount: true,
      openedInWindow: await sponsoredAgentAccountOpens(session.userId),
    });
    if (refusal) {
      console.warn(`[prepareSponsoredFunding] ${session.userId}: agent account opening refused`);
      return fail(refusal);
    }
  }

  // Can the platform pay? If not, it converts a little of its own USDC to SOL and is
  // asked once more. A new agent's $50 funding used to fail right here (2026-09-22).
  const capacity = await ensureSponsorCapacity({
    needLamports: sponsorReserveLamports({ opensAccount: !ataExists, rentLamports }),
    why: "a sponsored funding transfer",
  });
  if (!capacity.ok) return fail(capacity.error);

  try {
    const transaction = await buildSponsoredUsdcTransfer({
      from: from.data,
      to: target.data.address,
      feePayer: capacity.address,
      amount,
    });
    return {
      ok: true,
      data: {
        sponsored: true,
        transaction: Buffer.from(transaction).toString("base64"),
        feePayer: capacity.address,
        from: from.data,
        expectedAmount: amount,
      },
    };
  } catch (err) {
    console.error("[prepareSponsoredFunding]", err);
    // The builder's own refusals ("The amount must be at least $1.") are worth showing;
    // an RPC or Privy throw is not, and can carry the RPC URL.
    const detail = publicErrorMessage(err, "");
    return fail(
      detail
        ? `Tocker could not build the funding transaction: ${detail}`
        : "Tocker could not build the funding transaction. Your USDC has not moved — try again in a minute.",
    );
  }
}

/**
 * Step 2 of sponsored funding: co-sign what the user signed, and broadcast it.
 *
 * This is a public POST endpoint that ends in the platform wallet putting its signature
 * on bytes from a browser, so the order here is the whole design:
 *
 *  1. session, then ownership, then the expectation rebuilt **from the session** — the
 *     caller says which agent and how much, never who is sending or who is paying;
 *  2. `validateSponsoredUsdcTransfer`, which accepts only the exact transaction this
 *     server authored, signed by the wallet on record. A failure returns here. Nothing
 *     is signed;
 *  3. `cosignAsPlatform` (through `cosignSponsored`, which looks a second time only on an
 *     over-budget reading) simulates the exact bytes and adds the platform's signature
 *     only if the platform loses at most two signature fees plus — when the agent's USDC
 *     account does not exist yet — that account's rent. Then the result is validated
 *     **again**: the user's signature must still verify over the same message, and both
 *     slots must be filled;
 *  4. only then, broadcast and confirm (`broadcastSponsored`, which knows the signature
 *     before sending, so an ambiguous send is looked up instead of called a failure).
 *
 * Rate-limited per user: prepare 10 a minute, submit 10 per 10 minutes and 50 a day —
 * and, counted in the audit log rather than in-process, at most
 * `MAX_SPONSORED_AGENT_ACCOUNT_OPENS` transfers a day that open an agent's USDC account.
 */
export async function submitSponsoredFunding(input: {
  toAddress: string;
  amount: number;
  /** The transaction from `prepareSponsoredFunding`, with the user's signature on it. */
  signedTransaction: string;
}): Promise<ActionResult<{ hash: string; confirmed: boolean; uncertain: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const tooMany =
    (await fundingLimited(`sponsored-fund:submit:${session.userId}`, FUNDING_SUBMIT_BURST_LIMIT)) ??
    (await fundingLimited(`sponsored-fund:submit-day:${session.userId}`, FUNDING_SUBMIT_DAILY_LIMIT));
  if (tooMany) return fail(tooMany);

  const sponsored = await import("@/lib/wallets/solana-sponsored");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < sponsored.MIN_SPONSORED_FUNDING_USDC) {
    return fail(`Send at least $${sponsored.MIN_SPONSORED_FUNDING_USDC.toFixed(2)}.`);
  }
  if (!input.signedTransaction) return fail("No signed transaction was submitted");

  const target = await ownedAgentSolanaWallet(session.userId, input.toAddress);
  if (!target.ok) return target;

  const from = await myEmbeddedSolanaAddress(session.userId);
  if (!from.ok) return from;

  const { platformFeePayer } = await import("@/lib/wallets/solana-cosign");
  let platform: { walletId: string; address: string };
  try {
    platform = await platformFeePayer();
  } catch (err) {
    console.error("[submitSponsoredFunding] platform wallet unavailable", err);
    return fail(sponsored.FEE_WALLET_REFILLING);
  }

  let submitted: Uint8Array;
  try {
    submitted = new Uint8Array(Buffer.from(input.signedTransaction, "base64"));
  } catch {
    return fail("The signed transaction was not valid base64");
  }

  const expected = {
    from: from.data,
    to: target.data.address,
    feePayer: platform.address,
    amount,
  };

  const check = sponsored.validateSponsoredUsdcTransfer(submitted, expected);
  if (!check.ok) {
    console.warn(`[submitSponsoredFunding] refused to co-sign for ${session.userId}: ${check.reason}`);
    return fail(
      `Tocker will not sign this transaction because ${check.reason}. Nothing was sent. Start the transfer again.`,
    );
  }

  // The tightest budget this transaction can have: two signatures, plus the rent of the
  // agent's USDC account only if it is still missing (when it already exists, the
  // idempotent create costs nothing).
  const { PublicKey } = await import("@solana/web3.js");
  const { SOLANA_USDC_MINT, associatedTokenAddress } = await import("@/lib/wallets/solana-transfer");
  const { accountExists } = await import("@/lib/wallets/solana-rpc");
  const ata = associatedTokenAddress(new PublicKey(target.data.address), SOLANA_USDC_MINT).toBase58();
  const ataExists = await accountExists(ata).catch(() => false);

  // The binding check on the per-user daily count of agent accounts the platform opens
  // (see `MAX_SPONSORED_AGENT_ACCOUNT_OPENS`). Before the co-sign: nothing is signed yet.
  if (!ataExists) {
    const refusal = sponsored.agentAccountOpeningRefusal({
      opensAccount: true,
      openedInWindow: await sponsored.sponsoredAgentAccountOpens(session.userId),
    });
    if (refusal) {
      console.warn(`[submitSponsoredFunding] ${session.userId}: agent account opening refused`);
      return fail(refusal);
    }
  }

  const maxOutflowLamports = sponsored.sponsoredCosignBudgetLamports({
    opensAccount: !ataExists,
    rentLamports: ataExists ? 0 : await sponsored.tokenAccountRentLamports(),
  });

  let signedBase64: string;
  try {
    signedBase64 = await sponsored.cosignSponsored({
      transactionBase64: input.signedTransaction,
      maxOutflowLamports,
      purpose: "sponsored funding transfer",
    });
  } catch (err) {
    console.warn(`[submitSponsoredFunding] co-sign refused for ${session.userId}`, err);
    return fail(sponsored.explainCosignFailure(err, "funding transfer"));
  }

  const fullySigned = new Uint8Array(Buffer.from(signedBase64, "base64"));
  if (!sponsored.isFullySigned(fullySigned)) {
    return fail(
      "Tocker signed this transfer but your own signature did not survive. Nothing was sent — try again.",
    );
  }
  // The same boundary, run again on the bytes that are about to be broadcast: the
  // platform's signature is the only thing that may have changed.
  const after = sponsored.validateSponsoredUsdcTransfer(fullySigned, expected);
  if (!after.ok) {
    return fail(`Tocker's signature changed this transfer (${after.reason}). Nothing was sent.`);
  }

  // "Did not move" only when it is known. A send that times out, or errors at a gateway,
  // may already be relayed; calling that a failure puts the builder's "sign it again"
  // dialog in front of a transfer that then lands twice. Unknown is returned as sent and
  // unconfirmed — the funding checklist waits on the agent's real balance either way.
  const sent = await sponsored.broadcastSponsored(signedBase64);
  if (sent.outcome === "rejected") {
    return fail(`The network turned this transfer down: ${sent.reason}. Your USDC did not move.`);
  }
  if (sent.outcome === "failed") {
    return fail(`The transfer reached the network but failed there (${sent.signature}). Your USDC did not move.`);
  }
  const hash = sent.signature;
  const confirmed = sent.outcome === "confirmed";
  const uncertain = sent.outcome === "unknown";

  const { recordAudit } = await import("@/lib/security/audit");
  await recordAudit({
    userId: session.userId,
    // Borrowing the nearest honest existing kind, exactly as the gas drip does: the
    // audit enum belongs to another workstream's schema block, and this is a wallet
    // funding event the platform paid for.
    kind: "budget_change",
    agentId: target.data.agentId,
    agentName: target.data.agentName,
    summary: uncertain
      ? `Sent ${amount} USDC toward this agent's Solana wallet with Tocker paying the fee; the network had not confirmed it when Tocker last checked, and it may not land.`
      : `Tocker's platform Solana wallet paid the network fee so ${amount} USDC could be funded into this agent's Solana wallet.`,
    metadata: {
      reason: "sponsored_funding",
      chain: "solana",
      amountUsdc: amount,
      // Counted by `sponsoredAgentAccountOpens` — the per-user daily cap reads this key.
      openedAgentAccount: !ataExists,
      fromAddress: expected.from,
      toAddress: expected.to,
      feePayer: platform.address,
      signature: hash,
      confirmed,
      delivery: sent.outcome,
      ...(uncertain ? { sendError: sent.reason } : {}),
    },
  });

  revalidatePath(`/agents/${target.data.slug}/settings`);
  return { ok: true, data: { hash, confirmed, uncertain } };
}

// ----------------------------------------------------------- funding intents

export interface FundingIntentRow {
  id: string;
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  amountUsd: number | null;
  status: "pending" | "sent" | "failed" | "cancelled";
  toAddress: string;
  txHash: string | null;
  error: string | null;
  onCreate: boolean;
  createdAt: string;
}

/**
 * Record what the user agreed to send before they are asked to sign it.
 *
 * The transfer itself is signed client-side — the server has no key and cannot
 * make it happen. What it can do is remember the promise, so an agent whose
 * second leg was rejected in the wallet popup shows up as half-funded instead of
 * quietly looking fine.
 */
export async function recordFundingIntents(input: {
  agentId: string;
  onCreate?: boolean;
  transfers: Array<{ chain: Chain; asset: "usdc" | "native"; amount: number; amountUsd?: number }>;
}): Promise<ActionResult<{ ids: string[] }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  if (input.transfers.length === 0) return { ok: true, data: { ids: [] } };
  if (input.transfers.length > 8) return fail("That is more transfers than a funding plan can have");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const targets = await getAgentWallets(input.agentId);
  const values = [];
  for (const transfer of input.transfers) {
    if (!(transfer.amount > 0)) return fail("Every transfer must be greater than zero");
    const target = targets.find((t) => t.chain === transfer.chain);
    if (!target) return fail(`This agent has no ${transfer.chain} wallet`);
    values.push({
      id: newId("fund"),
      agentId: input.agentId,
      userId: session.userId,
      chain: transfer.chain,
      asset: transfer.asset,
      amount: toNumeric(transfer.amount, 18),
      amountUsd: transfer.amountUsd === undefined ? null : toNumeric(transfer.amountUsd, 6),
      toAddress: target.address,
      onCreate: input.onCreate === true,
    });
  }

  await db.insert(agentFundingIntents).values(values);
  revalidatePath(`/agents/${agent.slug}/settings`);
  return { ok: true, data: { ids: values.map((v) => v.id) } };
}

/** Close out one intent once the wallet has answered — a hash, or the reason it did not. */
export async function settleFundingIntent(input: {
  id: string;
  status: "sent" | "failed" | "cancelled";
  txHash?: string;
  error?: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [intent] = await db
    .select({ id: agentFundingIntents.id, userId: agentFundingIntents.userId, agentId: agentFundingIntents.agentId })
    .from(agentFundingIntents)
    .where(eq(agentFundingIntents.id, input.id))
    .limit(1);
  if (!intent) return fail("That funding record no longer exists");
  if (intent.userId !== session.userId) return fail("That funding record is not yours");

  await db
    .update(agentFundingIntents)
    .set({
      status: input.status,
      txHash: input.txHash?.slice(0, 200) ?? null,
      error: input.error?.slice(0, 300) ?? null,
      settledAt: new Date(),
    })
    .where(eq(agentFundingIntents.id, input.id));

  const [agent] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, intent.agentId))
    .limit(1);
  if (agent) revalidatePath(`/agents/${agent.slug}/settings`);
  return { ok: true, data: undefined };
}

/** Owner-only funding history for one agent — the settings page's honest status. */
export async function getFundingIntents(agentId: string): Promise<ActionResult<FundingIntentRow[]>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const rows = await db
    .select()
    .from(agentFundingIntents)
    .where(eq(agentFundingIntents.agentId, agentId))
    .orderBy(desc(agentFundingIntents.createdAt))
    .limit(20);

  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      chain: r.chain as Chain,
      asset: r.asset === "native" ? "native" : "usdc",
      amount: Number(r.amount),
      amountUsd: r.amountUsd === null ? null : Number(r.amountUsd),
      status: r.status,
      toAddress: r.toAddress,
      txHash: r.txHash,
      error: r.error,
      onCreate: r.onCreate,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ------------------------------------------------------------- wallet budget
//
// Withdrawing from an agent is `secureWithdrawAction` (security.ts): the one action that
// moves an agent's money out, with the chain and destination checks, the limits and the
// audit row. There is deliberately no second one in this file.

/**
 * Owner-only. Set the agent's wallet-layer budget: the per-transaction USDC cap
 * enforced by Privy policies attached to the agent's server wallets. This is the
 * hard floor under the app-level risk config — the wallet refuses to sign an
 * over-cap transfer even if every other control fails.
 */
export async function setAgentWalletBudget(input: {
  agentId: string;
  perTxUsd: number;
}): Promise<ActionResult<{ perTxUsd: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const perTxUsd = Number(input.perTxUsd);
  if (!Number.isFinite(perTxUsd) || perTxUsd < 1 || perTxUsd > 100_000) {
    return fail("Budget must be between $1 and $100,000 per transaction");
  }

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, slug: agents.slug, walletBudget: agents.walletBudget })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  try {
    const walletBudget = await applyAgentBudgetPolicy({
      agentId: agent.id,
      agentName: agent.name,
      perTxUsd,
      existing: agent.walletBudget,
    });
    if (!walletBudget) return fail("This agent has no real wallets to attach a policy to");

    await db.update(agents).set({ walletBudget }).where(eq(agents.id, agent.id));
    revalidatePath(`/agents/${agent.slug}/settings`);
    return { ok: true, data: { perTxUsd: walletBudget.perTxUsd } };
  } catch (err) {
    // A Privy policy API or database error: log it, don't forward it.
    console.error("[setAgentWalletBudget]", err);
    return fail("Could not apply the budget policy with the wallet provider. Nothing changed — try again in a minute.");
  }
}
