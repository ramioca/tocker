"use server";
/**
 * Sponsored USDC withdrawals from the user's own embedded Solana wallet.
 *
 * The user's wallet holds USDC and no SOL, so it cannot pay a network fee — and nothing
 * the user does may require SOL. Tocker's platform Solana wallet pays the fee, exactly as
 * it does for funding an agent (`prepareSponsoredFunding` / `submitSponsoredFunding` in
 * `./wallets.ts`), with the same security model:
 *
 *  1. `prepareSponsoredWithdrawal` builds the v0 transaction server-side — fee payer the
 *     platform, the user the only authority on every token transfer — and returns bytes.
 *  2. The browser signs (sign only; the user's wallet cannot broadcast).
 *  3. `submitSponsoredWithdrawal` rebuilds the expected message from the session and the
 *     chain, compares byte for byte, verifies the user's ed25519 signature, then has the
 *     platform co-sign through `cosignAsPlatform` (via `cosignSponsored`) with a budget of
 *     exactly two signature fees (plus one token account's rent when it opens one),
 *     broadcasts, and audits. A broadcast that fails without proving the network never
 *     got it is reported as unconfirmed, never as "your USDC did not move".
 *
 * The one thing a withdrawal has that funding does not: the recipient may never have held
 * USDC, so its token account has to be opened. The platform fronts that rent (so the
 * user still needs no SOL) and the user reimburses it in USDC in the same transaction —
 * {@link quoteSponsoredWithdrawal} tells the UI the fee before anyone holds to confirm.
 *
 * Rate limits (per user, in-process — see `rate-limit.ts` for what that does and does
 * not protect against): quote 60/min, prepare 10/min, submit 5 per 10 minutes and 30 per
 * day. The submit is the one that spends the platform's SOL.
 */
import { and, eq } from "drizzle-orm";
import { getDb, wallets } from "@/db";
import { getSession } from "@/lib/auth";
import { limiter, type RateLimitRule } from "@/lib/security/rate-limit";
import { isValidAddressForChain } from "@/lib/wallet-address";
import type { ActionResult } from "@/server/types";

/** What the withdraw modal shows before the hold-to-confirm. */
export interface SponsoredWithdrawalQuote {
  /** True when the recipient has never held USDC and this withdrawal opens its account. */
  newAccount: boolean;
  /** The one-time USDC fee for that, in dollars. 0 when `newAccount` is false. */
  feeUsdc: number;
  /** The smallest amount Tocker sponsors, in USDC. */
  minAmountUsdc: number;
}

export interface PreparedSponsoredWithdrawal {
  /** Unsigned v0 transaction, base64. The user signs it; they never broadcast it. */
  transaction: string;
  /** The platform Solana wallet — its fee payer. */
  feePayer: string;
  /** The user's embedded Solana wallet, as recorded. The client must sign with this one. */
  from: string;
  /** Echoed back so the client submits exactly what the transaction was built for. */
  amount: number;
  feeUsdc: number;
  newAccount: boolean;
}

export interface SponsoredWithdrawalSent {
  /** The transaction's signature — known even when the send did not say whether it went. */
  hash: string;
  /** True once the network confirmed it. */
  confirmed: boolean;
  /**
   * True when the broadcast failed without proving the network never got it, and the
   * network had not seen it when Tocker last looked. It may still land for about a
   * minute; the UI must not invite a second withdrawal as if nothing moved.
   */
  uncertain: boolean;
  feeUsdc: number;
}

const QUOTE_LIMIT: RateLimitRule = { limit: 60, windowMs: 60_000 };
const PREPARE_LIMIT: RateLimitRule = { limit: 10, windowMs: 60_000 };
const SUBMIT_BURST_LIMIT: RateLimitRule = { limit: 5, windowMs: 10 * 60_000 };
const SUBMIT_DAILY_LIMIT: RateLimitRule = { limit: 30, windowMs: 24 * 60 * 60_000 };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function limited(key: string, rule: RateLimitRule, what: string): string | null {
  const verdict = limiter.consume(key, rule);
  if (verdict.ok) return null;
  const wait =
    verdict.retryAfterSeconds >= 90
      ? `${Math.ceil(verdict.retryAfterSeconds / 60)} minutes`
      : `${verdict.retryAfterSeconds} seconds`;
  return `That's a lot of ${what} in a short time. Try again in ${wait}.`;
}

/** The session user's recorded embedded Solana wallet — the only wallet we build a transfer out of. */
async function myEmbeddedSolanaAddress(userId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, "solana"), eq(wallets.kind, "user_embedded")))
    .limit(1);
  return row?.address ?? null;
}

interface Resolved {
  from: string;
  to: string;
  platform: { walletId: string; address: string };
  newAccount: boolean;
  rentLamports: number;
}

/**
 * Everything both steps derive from the session and the chain — never from the caller,
 * who supplies only the destination and the amount: who is sending, who is paying, and
 * whether the recipient's USDC account has to be opened.
 */
async function resolveWithdrawal(userId: string, toAddress: string): Promise<ActionResult<Resolved>> {
  const to = toAddress?.trim() ?? "";
  if (!isValidAddressForChain("solana", to)) return fail("That doesn't look like a Solana address.");
  const { PublicKey } = await import("@solana/web3.js");
  try {
    new PublicKey(to);
  } catch {
    return fail("That doesn't look like a Solana address.");
  }

  const from = await myEmbeddedSolanaAddress(userId);
  if (!from) {
    return fail("Tocker has no Solana wallet on record for you yet. Sync your wallets from Settings and try again.");
  }
  if (from === to) return fail("That's your own Tocker wallet. Paste the address you want the USDC to go to.");

  const { platformFeePayer } = await import("@/lib/wallets/solana-cosign");
  let platform: { walletId: string; address: string };
  try {
    platform = await platformFeePayer();
  } catch (err) {
    console.error("[sponsored-withdraw] platform wallet unavailable", err);
    const { FEE_WALLET_REFILLING } = await import("@/lib/wallets/solana-sponsored");
    return fail(FEE_WALLET_REFILLING);
  }
  if (to === platform.address) return fail("That address is Tocker's own fee wallet, not somewhere to withdraw to.");

  const { readRecipientKind, tokenAccountRentLamports } = await import("@/lib/wallets/solana-sponsored");
  const { SOLANA_USDC_MINT, associatedTokenAddress } = await import("@/lib/wallets/solana-transfer");
  const { accountExists } = await import("@/lib/wallets/solana-rpc");

  let newAccount: boolean;
  try {
    const kind = await readRecipientKind(to);
    if (kind === "token_account") {
      return fail(
        "That's a token account, not a wallet address. Paste the wallet address instead — the one your exchange or wallet shows for receiving USDC on Solana.",
      );
    }
    if (kind === "program") return fail("That's a program address, not a wallet. Nothing can receive USDC there.");
    const ata = associatedTokenAddress(new PublicKey(to), SOLANA_USDC_MINT).toBase58();
    newAccount = !(await accountExists(ata));
  } catch (err) {
    console.warn("[sponsored-withdraw] could not read the recipient", err);
    return fail("Tocker couldn't check that address on Solana just now. Try again in a moment.");
  }

  const rentLamports = newAccount ? await tokenAccountRentLamports() : 0;
  return { ok: true, data: { from, to, platform, newAccount, rentLamports } };
}

/** The account fee for a resolved withdrawal: 0, a price, or null when it cannot be priced. */
async function feeFor(resolved: Resolved): Promise<number | null> {
  if (!resolved.newAccount) return 0;
  const { newAccountFeeUsdc, solPriceUsd } = await import("@/lib/wallets/solana-sponsored");
  return newAccountFeeUsdc({ rentLamports: resolved.rentLamports, solPriceUsd: await solPriceUsd() });
}

const CANNOT_PRICE =
  "This address has never held USDC, so its account has to be opened, and Tocker couldn't price that just now. Try again in a minute.";

/**
 * Read-only: does a withdrawal to this address open a new USDC account, and what does
 * that cost? The modal calls this as the destination is typed, so the fee is on screen
 * before the hold-to-confirm. Nothing is built and nothing is signed.
 */
export async function quoteSponsoredWithdrawal(input: {
  toAddress: string;
}): Promise<ActionResult<SponsoredWithdrawalQuote>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const tooMany = limited(`sponsored-withdraw:quote:${session.userId}`, QUOTE_LIMIT, "address checks");
  if (tooMany) return fail(tooMany);

  const resolved = await resolveWithdrawal(session.userId, input.toAddress);
  if (!resolved.ok) return resolved;

  const feeUsdc = await feeFor(resolved.data);
  if (feeUsdc === null) return fail(CANNOT_PRICE);

  const { MIN_SPONSORED_WITHDRAWAL_USDC } = await import("@/lib/wallets/solana-sponsored");
  return {
    ok: true,
    data: { newAccount: resolved.data.newAccount, feeUsdc, minAmountUsdc: MIN_SPONSORED_WITHDRAWAL_USDC },
  };
}

/**
 * Step 1: build the withdrawal the user is asked to sign. The platform is the fee payer;
 * when the recipient's USDC account has to be opened the platform fronts the rent and the
 * transaction carries the user's USDC reimbursement for it.
 */
export async function prepareSponsoredWithdrawal(input: {
  toAddress: string;
  amount: number;
}): Promise<ActionResult<PreparedSponsoredWithdrawal>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const tooMany = limited(`sponsored-withdraw:prepare:${session.userId}`, PREPARE_LIMIT, "withdrawals");
  if (tooMany) return fail(tooMany);

  const { MIN_SPONSORED_WITHDRAWAL_USDC } = await import("@/lib/wallets/solana-sponsored");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < MIN_SPONSORED_WITHDRAWAL_USDC) {
    return fail(`The smallest withdrawal is $${MIN_SPONSORED_WITHDRAWAL_USDC}.`);
  }

  const resolved = await resolveWithdrawal(session.userId, input.toAddress);
  if (!resolved.ok) return resolved;
  const { from, to, platform, newAccount, rentLamports } = resolved.data;

  const feeUsdc = await feeFor(resolved.data);
  if (feeUsdc === null) return fail(CANNOT_PRICE);

  // The user's USDC has to cover the withdrawal and the fee. Checked here so the answer
  // is a sentence with numbers in it, not a failed simulation at submit.
  const { PublicKey } = await import("@solana/web3.js");
  const { SOLANA_USDC_DECIMALS, SOLANA_USDC_MINT, associatedTokenAddress, toBaseUnits } = await import(
    "@/lib/wallets/solana-transfer"
  );
  const { getTokenAccountBalance } = await import("@/lib/wallets/solana-rpc");
  // Null is "no USDC account" or "the RPC did not answer" — indistinguishable here, so
  // it skips the check rather than telling someone with money that they have none. The
  // co-sign simulation catches a real shortfall either way.
  const held = await getTokenAccountBalance(associatedTokenAddress(new PublicKey(from), SOLANA_USDC_MINT).toBase58());
  const needed = toBaseUnits(amount, SOLANA_USDC_DECIMALS) + toBaseUnits(feeUsdc, SOLANA_USDC_DECIMALS);
  if (held !== null && held < needed) {
    const heldUsd = Number(held) / 10 ** SOLANA_USDC_DECIMALS;
    const most = Math.floor((heldUsd - feeUsdc) * 100) / 100;
    if (feeUsdc === 0) {
      return fail(`You have $${heldUsd.toFixed(2)} USDC on Solana — not enough to send $${amount.toFixed(2)}.`);
    }
    return fail(
      `You have $${heldUsd.toFixed(2)} USDC on Solana, and this address needs a one-time $${feeUsdc.toFixed(2)} account fee on top. ` +
        (most >= MIN_SPONSORED_WITHDRAWAL_USDC
          ? `The most you can send there is $${most.toFixed(2)}.`
          : `That leaves less than the $${MIN_SPONSORED_WITHDRAWAL_USDC} minimum.`),
    );
  }

  const { buildSponsoredUsdcWithdrawal, ensureSponsorCapacity, sponsorReserveLamports } = await import(
    "@/lib/wallets/solana-sponsored"
  );
  const capacity = await ensureSponsorCapacity({
    needLamports: sponsorReserveLamports({ opensAccount: newAccount, rentLamports }),
    why: "a sponsored withdrawal",
  });
  if (!capacity.ok) return fail(capacity.error);
  if (capacity.address !== platform.address) return fail("Tocker's fee wallet changed. Try again.");

  try {
    const transaction = await buildSponsoredUsdcWithdrawal({
      from,
      to,
      feePayer: platform.address,
      amount,
      createRecipientAccount: newAccount,
      reimbursementUsdc: feeUsdc,
    });
    return {
      ok: true,
      data: {
        transaction: Buffer.from(transaction).toString("base64"),
        feePayer: platform.address,
        from,
        amount,
        feeUsdc,
        newAccount,
      },
    };
  } catch (err) {
    console.error("[prepareSponsoredWithdrawal]", err);
    return fail(`Tocker could not build this withdrawal: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Step 2: co-sign what the user signed, and broadcast it.
 *
 * A public POST that ends in the platform wallet signing bytes from a browser, so the
 * order is the design: session → rate limit → the expectation rebuilt from the session
 * and the chain (the caller says where and how much, never who sends or who pays, nor
 * whether an account is being opened) → the fee, the one number the caller supplies,
 * still covers the rent plus `NEW_ACCOUNT_FEE_MIN_MARGIN` at today's *live* price (no
 * live price, no new account) → the byte-for-byte validator → `cosignAsPlatform` with the exact budget (which
 * simulates and refuses anything costing the platform more; `cosignSponsored` looks a
 * second time only when that refusal is over-budget) → the validator again on the
 * co-signed bytes → broadcast (`broadcastSponsored`, which knows the signature before it
 * sends) → audit.
 */
export async function submitSponsoredWithdrawal(input: {
  toAddress: string;
  amount: number;
  /** The account fee `prepareSponsoredWithdrawal` priced; 0 when no account is opened. */
  feeUsdc?: number;
  /** The transaction from `prepareSponsoredWithdrawal`, with the user's signature on it. */
  signedTransaction: string;
}): Promise<ActionResult<SponsoredWithdrawalSent>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const tooMany =
    limited(`sponsored-withdraw:submit:${session.userId}`, SUBMIT_BURST_LIMIT, "withdrawals") ??
    limited(`sponsored-withdraw:submit-day:${session.userId}`, SUBMIT_DAILY_LIMIT, "withdrawals today");
  if (tooMany) return fail(tooMany);

  const sponsored = await import("@/lib/wallets/solana-sponsored");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < sponsored.MIN_SPONSORED_WITHDRAWAL_USDC) {
    return fail(`The smallest withdrawal is $${sponsored.MIN_SPONSORED_WITHDRAWAL_USDC}.`);
  }
  const feeUsdc = Number(input.feeUsdc ?? 0);
  if (!Number.isFinite(feeUsdc) || feeUsdc < 0) return fail("That account fee is not a number. Nothing was sent.");
  if (!input.signedTransaction) return fail("No signed transaction was submitted.");

  const resolved = await resolveWithdrawal(session.userId, input.toAddress);
  if (!resolved.ok) return resolved;
  const { from, to, platform, newAccount, rentLamports } = resolved.data;

  // The chain moved between prepare and submit. Neither is the user's doing, and both
  // are fixed by sending again — which re-quotes.
  if (!newAccount && feeUsdc > 0) {
    return fail("The recipient's USDC account was opened in the meantime, so no account fee is due. Nothing was sent — send it again.");
  }
  if (newAccount && feeUsdc === 0) {
    return fail("This address needs a new USDC account now, which has a small one-time fee. Nothing was sent — send it again to see it.");
  }
  if (newAccount) {
    // The fee is the caller's number, so it is held to today's price with a margin, and
    // with no live price there is no new account: the floor alone is below the rent
    // whenever SOL is above ~$168.
    const price = await sponsored.solPriceUsd();
    if (price === null) return fail(`${CANNOT_PRICE} Nothing was sent.`);
    const covers = sponsored.reimbursementCoversRent({ feeUsdc, rentLamports, solPriceUsd: price });
    if (!covers.ok) {
      return fail(`The account fee needs a fresh quote (${covers.reason}). Nothing was sent — send it again.`);
    }
  }

  let submitted: Uint8Array;
  try {
    submitted = new Uint8Array(Buffer.from(input.signedTransaction, "base64"));
  } catch {
    return fail("The signed transaction was not valid base64. Nothing was sent.");
  }

  const expected = {
    from,
    to,
    feePayer: platform.address,
    amount,
    createRecipientAccount: newAccount,
    reimbursementUsdc: feeUsdc,
  };
  const check = sponsored.validateSponsoredUsdcWithdrawal(submitted, expected);
  if (!check.ok) {
    console.warn(`[submitSponsoredWithdrawal] refused to co-sign for ${session.userId}: ${check.reason}`);
    return fail(`Tocker will not sign this withdrawal because ${check.reason}. Nothing was sent. Start the withdrawal again.`);
  }

  let signedBase64: string;
  try {
    signedBase64 = await sponsored.cosignSponsored({
      transactionBase64: input.signedTransaction,
      maxOutflowLamports: sponsored.sponsoredCosignBudgetLamports({ opensAccount: newAccount, rentLamports }),
      purpose: "sponsored withdrawal",
    });
  } catch (err) {
    console.warn(`[submitSponsoredWithdrawal] co-sign refused for ${session.userId}`, err);
    return fail(sponsored.explainCosignFailure(err, "withdrawal"));
  }

  const fullySigned = new Uint8Array(Buffer.from(signedBase64, "base64"));
  if (!sponsored.isFullySigned(fullySigned)) {
    return fail("Tocker signed this withdrawal but your own signature did not survive. Nothing was sent — try again.");
  }
  const after = sponsored.validateSponsoredUsdcWithdrawal(fullySigned, expected);
  if (!after.ok) {
    return fail(`Tocker's signature changed this withdrawal (${after.reason}). Nothing was sent.`);
  }

  // "Did not move" is said only when it is known: a send that times out or errors at
  // the gateway may already be on its way, and telling the user otherwise invites a
  // second withdrawal with a fresh blockhash that lands as well.
  const sent = await sponsored.broadcastSponsored(signedBase64);
  if (sent.outcome === "rejected") {
    return fail(`The network turned this withdrawal down: ${sent.reason}. Your USDC did not move.`);
  }
  if (sent.outcome === "failed") {
    return fail(`The withdrawal reached the network but failed there (${sent.signature}). Your USDC did not move.`);
  }
  const hash = sent.signature;
  const confirmed = sent.outcome === "confirmed";
  const uncertain = sent.outcome === "unknown";

  const { recordAudit } = await import("@/lib/security/audit");
  await recordAudit({
    userId: session.userId,
    kind: "withdraw",
    summary: uncertain
      ? `Sent a withdrawal of ${amount} USDC from your Solana wallet to ${to}; the network had not confirmed it when Tocker last checked, and it may not land.`
      : `Withdrew ${amount} USDC from your Solana wallet to ${to}; Tocker paid the network fee` +
        (newAccount ? ` and opened the recipient's USDC account for a ${feeUsdc.toFixed(2)} USDC fee.` : "."),
    metadata: {
      reason: "sponsored_withdrawal",
      chain: "solana",
      amountUsdc: amount,
      accountFeeUsdc: feeUsdc,
      openedRecipientAccount: newAccount,
      fromAddress: from,
      toAddress: to,
      feePayer: platform.address,
      signature: hash,
      confirmed,
      delivery: sent.outcome,
      ...(uncertain ? { sendError: sent.reason } : {}),
    },
  });

  return { ok: true, data: { hash, confirmed, uncertain, feeUsdc } };
}
