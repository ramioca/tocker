/**
 * Transfers out of an agent's Solana wallet, paid for by the platform (W8).
 *
 * An agent's Solana wallet holds USDC and, ideally, no SOL at all. It used to pay for
 * its own withdrawals and for the platform's fee sweeps, which meant a SOL drip from the
 * platform before every one — 0.01 SOL parked in a wallet the owner could then withdraw,
 * to pay a 5,000-lamport fee. Now the platform Solana wallet is the fee payer (static
 * account 0) of every transfer out of an agent, and the payer of the destination's USDC
 * account rent when that account has to be opened. The agent signs only as the
 * authority over its own tokens or SOL; the platform co-signs through
 * `cosignSponsored` (→ `cosignAsPlatform`), which refuses unless a simulation of the
 * exact bytes costs it no more than the budget computed here.
 *
 * ## What the platform agrees to pay, per transaction type
 *
 *  - USDC out: two signatures, plus the destination account's rent only when this
 *    transaction opens it. {@link sponsoredUsdcTransferBudget}.
 *  - SOL out: two signatures. {@link sponsoredSolTransferBudget}.
 *
 * Exact, like the user-side sponsored transfers in `./solana-sponsored.ts`: no
 * compute-budget instructions, so no priority fee, and the fee is 5,000 lamports a
 * signature to the lamport — however many `TransferChecked` instructions ride along.
 *
 * ## Opening a recipient's USDC account is not free to the recipient
 *
 * Rent refunded by closing a token account goes to the account's *owner*, not to whoever
 * paid it. If the platform opened accounts for free, an owner could withdraw a cent to a
 * hundred fresh wallets, close the accounts and keep the rent. So the transaction that
 * opens a recipient's account also moves a one-time fee in USDC from the agent to the
 * platform (priced by `newAccountFeeUsdc`, which the user-side path uses). Fee sweeps go
 * to the platform's own account and pay no such fee.
 *
 * ## The per-trade cap in the agent's Privy policy
 *
 * The agent's wallet policy (`budgetRules` in `./index.ts`) DENYs `signTransaction` when
 * a top-level `TransferChecked.amount` is over the per-trade cap. Privy evaluates each
 * instruction of a Solana transaction on its own. {@link planAgentTransferRoute} decides
 * before anything is signed:
 *
 *  - at or under the cap, SOL, or no policy → one sponsored transaction;
 *  - over the cap, to the owner's own wallet or the platform (the destinations the cap
 *    does not guard — see {@link uncappedSolanaDestinations}) → one sponsored
 *    transaction whose transfer is split into `TransferChecked`s at or under the cap,
 *    when that fits in one packet (an owner's withdrawal that does not fit is refused
 *    with the most one withdrawal carries);
 *  - over the cap anywhere else → refused, with the way out: withdraw home, or raise the
 *    cap. It used to go through Privy's `transfer`, paid from a 0.01 SOL drip into the
 *    agent: the platform's SOL stranded in every agent it touched, and a recipient that
 *    closed its USDC account at the right moment made the drip pay it rent.
 *
 * Privy's `transfer` with a drip is now only ever a fee sweep *to the platform* — too big
 * for one packet, or refused by a policy the database disagrees with
 * ({@link isPolicyDenial}; a timeout or an outage is an error, not a reason to drip).
 * SOL withdrawals keep the last {@link AGENT_SOL_KEPT} SOL in the agent — SOL that may
 * have come from a drip is not the owner's to take (`./funding.ts`).
 *
 * ## What an owner's withdrawal must respect
 *
 * Every one costs the platform a fee, so: a $1 floor (0.001 SOL) unless it takes
 * everything, per-owner rate limits (10 per 10 minutes in-process, 50 a day from the
 * audit log), one transfer out of an agent at a time, and the agent's accrued Tocker
 * trading fees go to the platform first — in the same transaction, so "trade, withdraw
 * everything, abandon the agent" cannot leave them uncollectable.
 *
 * ## A send that fails without saying whether it went
 *
 * The signature is known before the broadcast. A send that times out or errors at a
 * gateway may still land, so it is reported as `pending` with that signature — never as
 * "nothing moved", which would invite a second withdrawal. Only a JSON-RPC refusal the
 * network has not seen is {@link TransferNotSent} (`broadcastSponsored`). A fee sweep
 * records the signature on its fee rows before the broadcast (`onSigned`) and resolves it
 * on the next pass ({@link inflightStatus}), so it never blocks the guardian waiting.
 *
 * Pure builders at the top (no network, no Privy, tested); the effectful functions below
 * import Privy lazily so this module still loads in a plain tsx script.
 */
import { base58 } from "@scure/base";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import type { WalletBudget } from "@/db/schema";
import { AGENT_SOL_KEPT, MIN_SOL_SEND } from "./funding";
import { ATA_RENT_LAMPORTS, SIGNATURE_FEE_LAMPORTS, SPONSOR_MARGIN_LAMPORTS } from "./gas";
import { solanaRpcUrl } from "./solana-rpc";
import {
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentInstruction,
  toBaseUnits,
  transferCheckedInstruction,
} from "./solana-transfer";
import type { WithdrawResult } from "./index";

// ------------------------------------------------------------------ budgets

/** The platform (fee payer) and the agent (authority over its tokens or SOL). */
export const AGENT_TRANSFER_SIGNERS = 2;
/** Rent-exempt minimum of a data-less System account; the fallback when the live read fails. */
export const RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS = 890_880;
/** Solana's packet limit: a serialized transaction, signature slots included, may not exceed it. */
export const MAX_TRANSACTION_BYTES = 1232;
/** A split transfer never has more pieces than this, whatever still fits in the packet. */
export const MAX_TRANSFER_PIECES = 48;
/**
 * A USDC request at most this far above the agent's balance is "everything" — one cent,
 * for a Max button's float. Anything further above is refused, never quietly shrunk.
 */
export const WITHDRAW_ALL_TOLERANCE_BASE_UNITS = 10_000;
/** {@link AGENT_SOL_KEPT} in lamports: SOL a withdrawal leaves in the agent's wallet. */
export const AGENT_SOL_KEPT_LAMPORTS = Math.round(AGENT_SOL_KEPT * 1e9);

/**
 * The smallest USDC withdrawal an owner can make out of an agent — $1, the same floor as
 * `MIN_SPONSORED_WITHDRAWAL_USDC` on the user side — unless it is everything the agent
 * holds. The platform pays every withdrawal's fee; below this the fee is the point
 * (a loop of 0.000001 USDC withdrawals home costs the platform 10,000 lamports each).
 */
export const MIN_AGENT_USDC_WITHDRAWAL_BASE_UNITS = 1_000_000;
/** The smallest SOL withdrawal, unless it is everything the agent can spare: `MIN_SOL_SEND`. */
export const MIN_AGENT_SOL_WITHDRAWAL_LAMPORTS = Math.round(MIN_SOL_SEND * 1e9);

/**
 * What a live rent read for a 165-byte token account may say. Mainnet answered 1,488,440
 * lamports (2026-09-23); the long-standing figure is 2,039,280. The RPC is trusted with
 * nothing outside this band: an inflated answer would inflate the account fee the agent
 * pays and the budget the platform co-signs under. Outside it, `ATA_RENT_LAMPORTS`.
 */
export const TOKEN_ACCOUNT_RENT_BAND = { min: 1_200_000, max: 2_100_000 } as const;
/** The same for a data-less System account: 650,240 live, 890,880 the long-standing figure. */
export const EMPTY_ACCOUNT_RENT_BAND = { min: 500_000, max: 1_000_000 } as const;

/** Pure: a live rent read, if it is inside `band`; null otherwise. */
export function saneRentLamports(value: unknown, band: { min: number; max: number }): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= band.min && value <= band.max ? Math.round(value) : null;
}

/**
 * Owner withdrawals out of agents, per owner. Every one is a transaction the platform
 * pays for, so they are limited like the user-side sponsored paths are: 10 per 10
 * minutes in this process, and {@link OWNER_WITHDRAWALS_PER_DAY} a day counted from the
 * audit log, which every instance shares. Fee sweeps are not owner withdrawals.
 */
export const OWNER_WITHDRAWAL_BURST_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;
export const OWNER_WITHDRAWALS_PER_DAY = 50;

/**
 * Pure: the most lamports the platform may lose to one sponsored USDC transfer out of
 * an agent — two signatures, and the destination account's rent when this transaction
 * opens it. `rentLamports` is the live rent-exempt minimum of a token account.
 */
export function sponsoredUsdcTransferBudget(input: { opensAccount: boolean; rentLamports: number }): number {
  return AGENT_TRANSFER_SIGNERS * SIGNATURE_FEE_LAMPORTS + (input.opensAccount ? Math.max(0, input.rentLamports) : 0);
}

/** Pure: the most the platform may lose to one sponsored SOL transfer out of an agent — the two signatures. */
export function sponsoredSolTransferBudget(): number {
  return AGENT_TRANSFER_SIGNERS * SIGNATURE_FEE_LAMPORTS;
}

// ------------------------------------------------------------------ builders

/**
 * Pure: `amount` as pieces of at most `cap` (full pieces first, the remainder last).
 * One piece when there is no cap or the amount is within it. Throws on a non-positive
 * amount or cap, and past {@link MAX_TRANSFER_PIECES} pieces.
 */
export function splitUnderCap(amount: bigint, cap: bigint | null): bigint[] {
  const zero = BigInt(0);
  if (amount <= zero) throw new Error("The amount must be greater than zero.");
  if (cap === null || amount <= cap) return [amount];
  if (cap <= zero) throw new Error("The cap must be greater than zero.");
  const count = (amount + cap - BigInt(1)) / cap;
  if (count > BigInt(MAX_TRANSFER_PIECES)) {
    throw new TooLargeForOneTransaction(`${count} transfers of at most the cap is more than one transaction carries`);
  }
  const pieces: bigint[] = [];
  let left = amount;
  while (left > cap) {
    pieces.push(cap);
    left -= cap;
  }
  pieces.push(left);
  return pieces;
}

export interface AgentUsdcTransferInput {
  /** The agent's Solana wallet — owner of the USDC, authority of every transfer here. */
  agent: string;
  /** The wallet (not token account) the USDC goes to. */
  destinationOwner: string;
  /** The platform Solana wallet. Fee payer, and rent payer when an account is opened. */
  feePayer: string;
  /**
   * USDC base units (6 decimals) the destination receives. Zero only for an open-only
   * transaction: the account and its fee, ahead of a Privy `transfer`.
   */
  amountBaseUnits: bigint;
  /**
   * Set when the destination has no USDC account: the platform opens it, and the agent
   * reimburses it `feeBaseUnits` of USDC in the same transaction. Ignored (no fee) when
   * the destination is the platform itself.
   */
  openAccount: { feeBaseUnits: bigint } | null;
  /**
   * Tocker's trading fees the agent owes (accrued, not yet swept), collected by this
   * transaction on an owner's withdrawal so they cannot be withdrawn out from under the
   * next sweep. Never on a transfer to the platform itself — a sweep *is* the fees.
   */
  tockerFeesBaseUnits?: bigint;
  /**
   * The agent's per-transaction cap, when its wallet policy has one. The fee to the
   * platform is always split into pieces at or under it; the transfer to the destination
   * only when {@link splitToDestination} is set, which the router does only for the
   * destinations the cap does not guard (the owner's own wallet, the platform).
   */
  capBaseUnits?: bigint | null;
  splitToDestination?: boolean;
}

/**
 * Pure: the instructions of a sponsored USDC transfer out of an agent, in the only
 * order they are built in:
 *
 *  1. only when opening: an idempotent create of the destination's USDC account, payer
 *     = the platform;
 *  2. `TransferChecked` agent → destination, authority = the agent (several, each at or
 *     under the cap, when split; none on an open-only transaction);
 *  3. only when the agent owes the platform something: `TransferChecked` agent → the
 *     platform's USDC account for the one-time account fee (when opening for someone
 *     other than the platform) plus Tocker's accrued trading fees (an owner withdrawal),
 *     authority = the agent, split at or under the cap.
 *
 * The platform is never the authority of a transfer. Throws on the combinations that
 * would make it one, or that make no sense: the platform as the agent, a transfer to
 * the agent's own wallet, a zero amount that opens nothing, an opening without its fee,
 * trading fees on a transfer to the platform.
 */
export function agentUsdcTransferInstructions(input: AgentUsdcTransferInput): TransactionInstruction[] {
  const zero = BigInt(0);
  const agent = new PublicKey(input.agent);
  const destinationOwner = new PublicKey(input.destinationOwner);
  const feePayer = new PublicKey(input.feePayer);
  if (feePayer.equals(agent)) throw new Error("The platform fee payer cannot be the agent wallet it pays for.");
  if (destinationOwner.equals(agent)) throw new Error("That is the agent's own wallet.");
  const toPlatform = destinationOwner.equals(feePayer);
  const openOnly = input.amountBaseUnits === zero && input.openAccount !== null && !toPlatform;
  if (input.amountBaseUnits < zero || (input.amountBaseUnits === zero && !openOnly)) {
    throw new Error("The amount must be greater than zero.");
  }
  if (input.openAccount && !toPlatform && input.openAccount.feeBaseUnits <= zero) {
    throw new Error("Opening the recipient's USDC account needs its one-time fee.");
  }
  const tockerFees = input.tockerFeesBaseUnits ?? zero;
  if (tockerFees < zero) throw new Error("Trading fees owed cannot be negative.");
  if (tockerFees > zero && toPlatform) throw new Error("A transfer to Tocker's own wallet carries no trading fees on top.");

  const cap = input.capBaseUnits ?? null;
  const source = associatedTokenAddress(agent, SOLANA_USDC_MINT);
  const transfer = (destination: PublicKey, amount: bigint) =>
    transferCheckedInstruction({
      source,
      destination,
      owner: agent,
      mint: SOLANA_USDC_MINT,
      amount,
      decimals: SOLANA_USDC_DECIMALS,
    });

  const instructions: TransactionInstruction[] = [];
  if (input.openAccount) {
    instructions.push(createAtaIdempotentInstruction({ payer: feePayer, owner: destinationOwner, mint: SOLANA_USDC_MINT }));
  }
  if (!openOnly) {
    const destination = associatedTokenAddress(destinationOwner, SOLANA_USDC_MINT);
    for (const piece of splitUnderCap(input.amountBaseUnits, input.splitToDestination ? cap : null)) {
      instructions.push(transfer(destination, piece));
    }
  }
  const owedPlatform = (input.openAccount && !toPlatform ? input.openAccount.feeBaseUnits : zero) + tockerFees;
  if (owedPlatform > zero) {
    const platformAccount = associatedTokenAddress(feePayer, SOLANA_USDC_MINT);
    for (const piece of splitUnderCap(owedPlatform, cap)) instructions.push(transfer(platformAccount, piece));
  }
  return instructions;
}

/** A transfer that does not fit in one Solana transaction. Thrown before anything is signed. */
export class TooLargeForOneTransaction extends Error {
  constructor(reason: string) {
    super(`This transfer does not fit in one Solana transaction: ${reason}.`);
    this.name = "TooLargeForOneTransaction";
  }
}

function compile(feePayer: string, blockhash: string, instructions: TransactionInstruction[]): Uint8Array {
  let bytes: Uint8Array;
  try {
    const message = new TransactionMessage({ payerKey: new PublicKey(feePayer), recentBlockhash: blockhash, instructions }).compileToV0Message();
    bytes = new VersionedTransaction(message).serialize();
  } catch (err) {
    throw new TooLargeForOneTransaction(err instanceof Error ? err.message : String(err));
  }
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    throw new TooLargeForOneTransaction(`${bytes.length} bytes, over the ${MAX_TRANSACTION_BYTES}-byte packet`);
  }
  return bytes;
}

/**
 * Pure: the unsigned v0 transaction for {@link agentUsdcTransferInstructions}; fee payer =
 * platform. Throws {@link TooLargeForOneTransaction} when it would not fit in one packet.
 */
export function buildAgentUsdcTransfer(input: AgentUsdcTransferInput & { blockhash: string }): Uint8Array {
  return compile(input.feePayer, input.blockhash, agentUsdcTransferInstructions(input));
}

export interface AgentSolTransferInput {
  agent: string;
  destination: string;
  feePayer: string;
  lamports: bigint;
}

/** Pure: one `SystemProgram.transfer` from the agent. The platform appears in no instruction; it only pays the fee. */
export function agentSolTransferInstructions(input: AgentSolTransferInput): TransactionInstruction[] {
  const agent = new PublicKey(input.agent);
  const destination = new PublicKey(input.destination);
  const feePayer = new PublicKey(input.feePayer);
  if (feePayer.equals(agent)) throw new Error("The platform fee payer cannot be the agent wallet it pays for.");
  if (destination.equals(agent)) throw new Error("That is the agent's own wallet.");
  if (input.lamports <= BigInt(0)) throw new Error("The amount must be greater than zero.");
  return [SystemProgram.transfer({ fromPubkey: agent, toPubkey: destination, lamports: input.lamports })];
}

/** Pure: the unsigned v0 transaction for {@link agentSolTransferInstructions}; fee payer = platform. */
export function buildAgentSolTransfer(input: AgentSolTransferInput & { blockhash: string }): Uint8Array {
  return compile(input.feePayer, input.blockhash, agentSolTransferInstructions(input));
}

// ------------------------------------------------------------ amount checks

const usdc = (base: bigint) => (Number(base) / 10 ** SOLANA_USDC_DECIMALS).toFixed(2);
/**
 * Fees owed are a share of each fill and seldom whole cents: two decimals when they are,
 * otherwise every decimal the amount has, so half a cent owed does not read "0.00 USDC".
 */
const usdcExact = (base: bigint) =>
  (Number(base) / 10 ** SOLANA_USDC_DECIMALS).toFixed(SOLANA_USDC_DECIMALS).replace(/0{1,4}$/, "");
const sol = (lamports: bigint) => (Number(lamports) / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");

/**
 * Pure: how much USDC actually goes out, given what the agent holds and the one-time
 * account fee (zero when the recipient's account exists).
 *
 * A request for everything the agent holds — the balance, give or take
 * {@link WITHDRAW_ALL_TOLERANCE_BASE_UNITS} — sends everything minus the fee, because
 * "withdraw all" to a new wallet is the common case and failing it over a quarter would
 * be absurd; the fee comes back as `reducedBy`. A request further above the balance (a
 * typo, 400 for 40) is refused, never shrunk. Any other request that does not fit
 * alongside the fee is refused with the number that would.
 *
 * `exact` turns "everything" off: the amount goes out as asked or not at all. A fee sweep
 * is exact — it marks a precise sum of fee rows settled, and must never move less.
 *
 * On an owner's withdrawal two more things apply. `owedBaseUnits` — Tocker's accrued
 * trading fees — leaves the agent in the same transaction, exactly like the account fee:
 * it comes out of a withdraw-all and has to fit beside a partial one, so fees can never be
 * withdrawn before the sweep collects them. And `minBaseUnits` refuses a partial amount
 * under the floor; everything the agent holds may always go.
 */
export function fitUsdcWithdrawal(input: {
  heldBaseUnits: bigint;
  amountBaseUnits: bigint;
  feeBaseUnits: bigint;
  /** Tocker trading fees the agent owes, collected by the same transaction. */
  owedBaseUnits?: bigint;
  /** The smallest partial withdrawal; a withdraw-all is exempt. */
  minBaseUnits?: bigint;
  exact?: boolean;
}): { ok: true; amountBaseUnits: bigint; reducedBy: bigint } | { ok: false; problem: string } {
  const zero = BigInt(0);
  const { heldBaseUnits: held, amountBaseUnits: amount, feeBaseUnits: fee } = input;
  const owed = input.owedBaseUnits !== undefined && input.owedBaseUnits > zero ? input.owedBaseUnits : zero;
  const min = input.minBaseUnits ?? zero;
  if (amount <= zero) return { ok: false, problem: "Enter an amount greater than zero." };
  const tooMuch = `The agent's Solana wallet holds ${usdc(held)} USDC, less than the ${usdc(amount)} USDC asked for.`;
  const costs = fee + owed;
  if (input.exact) return amount + costs <= held ? { ok: true, amountBaseUnits: amount, reducedBy: zero } : { ok: false, problem: tooMuch };
  if (amount > held + BigInt(WITHDRAW_ALL_TOLERANCE_BASE_UNITS)) return { ok: false, problem: tooMuch };
  const all = amount >= held;
  if (!all && amount < min) {
    return { ok: false, problem: `The smallest withdrawal is ${usdc(min)} USDC — or withdraw everything the agent holds.` };
  }
  if (!all && amount + costs <= held) return { ok: true, amountBaseUnits: amount, reducedBy: zero };
  if (all && held > costs) return { ok: true, amountBaseUnits: held - costs, reducedBy: amount - (held - costs) };
  if (costs === zero) return { ok: false, problem: tooMuch };

  const first: string[] = [];
  if (owed > zero) first.push(`the ${usdcExact(owed)} USDC it owes in Tocker trading fees`);
  if (fee > zero) first.push(`a one-time ${usdc(fee)} USDC for opening this wallet's USDC account (it has never held USDC)`);
  const what = first.join(" and ");
  if (held <= costs) {
    return {
      ok: false,
      problem: `The agent holds ${usdc(held)} USDC, and ${what} would come out of it first — there is nothing left to send.`,
    };
  }
  return {
    ok: false,
    problem: `The agent holds ${usdc(held)} USDC, and ${what} comes out first, so it can send at most ${usdcExact(held - costs)} USDC here — or withdraw everything, and that comes out of the total.`,
  };
}

/**
 * Pure: why a SOL withdrawal cannot go through, or null when it can.
 *
 *  - The agent keeps its last `keepLamports` (see {@link AGENT_SOL_KEPT}): SOL that may
 *    have come from a platform drip is not the owner's to withdraw.
 *  - A System account must hold 0 or at least the rent-exempt minimum, so a withdrawal
 *    may not leave a sliver behind, nor open a wallet that has never held SOL
 *    (`destinationLamports` 0) with less than that minimum.
 */
export function solWithdrawalProblem(input: {
  balanceLamports: number;
  lamports: bigint;
  keepLamports?: number;
  rentExemptLamports?: number;
  /** The destination's lamports; 0 when it has never held SOL. Omitted: not checked. */
  destinationLamports?: number | null;
  /** The smallest withdrawal, unless it is everything the agent can spare. Omitted: none. */
  minLamports?: number;
}): string | null {
  const zero = BigInt(0);
  if (input.lamports <= zero) return "Enter an amount greater than zero.";
  const balance = BigInt(Math.max(0, Math.floor(input.balanceLamports)));
  const keep = BigInt(Math.max(0, Math.floor(input.keepLamports ?? 0)));
  const rentExempt = BigInt(Math.max(0, Math.floor(input.rentExemptLamports ?? RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS)));
  const spendable = balance > keep ? balance - keep : zero;
  if (input.lamports > balance) {
    return `The agent's Solana wallet holds ${sol(balance)} SOL, less than the ${sol(input.lamports)} SOL asked for.`;
  }
  if (keep > zero && input.lamports > balance - keep) {
    return spendable > zero
      ? `The agent keeps its last ${sol(keep)} SOL to cover network fees, so the most it can send is ${sol(spendable)} SOL.`
      : `The agent has no SOL to spare: it keeps its last ${sol(keep)} SOL to cover network fees.`;
  }
  const min = BigInt(Math.max(0, Math.floor(input.minLamports ?? 0)));
  if (input.lamports < min && input.lamports !== spendable) {
    return `The smallest SOL withdrawal is ${sol(min)} SOL — or everything the agent can spare (${sol(spendable)} SOL).`;
  }
  const remainder = balance - input.lamports;
  if (remainder > zero && remainder < rentExempt) {
    return (
      `That would leave ${sol(remainder)} SOL behind, and a Solana wallet has to hold either nothing or at least ` +
      `${sol(rentExempt)} SOL. Withdraw all ${sol(balance)} SOL, or leave at least that much.`
    );
  }
  if (input.destinationLamports === 0 && input.lamports < rentExempt) {
    return `That wallet has never held SOL, and Solana won't open it with less than ${sol(rentExempt)} SOL. Send at least that much.`;
  }
  return null;
}

// ------------------------------------------------------ checks on the bytes

function messageOf(transaction: Uint8Array): Uint8Array | null {
  try {
    return VersionedTransaction.deserialize(transaction).message.serialize();
  } catch {
    return null;
  }
}

/**
 * Pure: do two transactions carry the same message, byte for byte? Signatures may
 * differ; nothing else may. Run after each signer, so the platform only ever co-signs
 * the transaction this server authored — not whatever a signing backend handed back.
 */
export function sameMessage(a: Uint8Array, b: Uint8Array): boolean {
  const ma = messageOf(a);
  const mb = messageOf(b);
  if (!ma || !mb || ma.length !== mb.length) return false;
  for (let i = 0; i < ma.length; i += 1) if (ma[i] !== mb[i]) return false;
  return true;
}

/** Pure: how many required signatures are still empty (all zero). -1 when the bytes do not parse. */
export function missingSignatures(transaction: Uint8Array): number {
  try {
    const tx = VersionedTransaction.deserialize(transaction);
    let missing = 0;
    for (let i = 0; i < tx.message.header.numRequiredSignatures; i += 1) {
      const sig = tx.signatures[i];
      if (!sig || sig.length !== 64 || sig.every((byte) => byte === 0)) missing += 1;
    }
    return missing;
  } catch {
    return -1;
  }
}

/** Pure: a signed transaction's id — its first signature, base58. Null when unsigned or unparseable. */
export function transactionId(transaction: Uint8Array): string | null {
  try {
    const first = VersionedTransaction.deserialize(transaction).signatures[0];
    if (!first || first.length !== 64 || first.every((byte) => byte === 0)) return null;
    return base58.encode(first);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- routing

/** Pure: the per-trade cap the agent's Solana wallet policy enforces, in USDC base units. Null when none is attached. */
export function solanaCapBaseUnits(walletBudget: WalletBudget | null | undefined): bigint | null {
  if (!walletBudget?.policyIds?.solana) return null;
  const perTx = Number(walletBudget.perTxUsd);
  if (!Number.isFinite(perTx) || perTx <= 0) return null;
  // Exactly the arithmetic `applyAgentBudgetPolicy` writes into the rule.
  return BigInt(Math.round(perTx * 1_000_000));
}

/**
 * Pure: the USDC token accounts an agent's per-trade cap does not need to guard — the
 * platform's (fee sweeps) and the owner's own embedded wallets' (withdrawals home).
 * Money that can only go back to the person who put it in, or to the platform that
 * already holds the signing key, is not what a per-trade cap protects against.
 * Deduplicated; invalid addresses are skipped.
 *
 * The router splits over-cap transfers to these under the cap. It is also the list
 * `budgetRules(chain, cap, { uncappedSolanaDestinations })` takes to write the exemption
 * into the Privy policy itself — not wired: `@privy-io/node` does not type the `neq`
 * operator that needs, and it has not been confirmed against a non-production Privy app.
 */
export function uncappedSolanaDestinations(input: {
  platformAddress: string | null;
  ownerAddresses: readonly string[];
}): string[] {
  const out = new Set<string>();
  for (const owner of [input.platformAddress, ...input.ownerAddresses]) {
    if (!owner) continue;
    try {
      out.add(associatedTokenAddress(new PublicKey(owner), SOLANA_USDC_MINT).toBase58());
    } catch {
      // not a Solana address — nothing to exempt
    }
  }
  return [...out];
}

export type AgentTransferRoute =
  /** One sponsored transaction. `split`: its transfer to the destination is cut into pieces at or under the cap. */
  | { route: "sponsored"; split: boolean; reason: string }
  /**
   * Privy's `transfer` endpoint, with the agent paying the fee from a SOL drip. Only ever
   * a fee sweep to the platform too large for one packet (see {@link planAgentSolanaTransfer}).
   */
  | { route: "privy_transfer"; reason: string }
  /** Not sent at all: over the cap, to an address the cap guards. */
  | { route: "refused"; reason: string };

/**
 * Pure: which path a transfer out of an agent's Solana wallet takes.
 *
 *  - SOL, no policy attached, or USDC at or under the cap: sponsored. The policy's DENY
 *    rules only fire on token-program amounts over the cap.
 *  - USDC over the cap to a destination the cap does not guard (the owner's own wallet,
 *    the platform): sponsored, split into `TransferChecked`s at or under the cap —
 *    Privy evaluates each instruction on its own.
 *  - USDC over the cap anywhere else: refused. A sponsored transaction would be refused
 *    by the policy, and splitting a transfer to a third party to slip under the owner's
 *    cap is exactly what the cap is there to stop. It used to go through Privy's
 *    `transfer` instead, paid from a 0.01 SOL drip into the agent — which left ~0.00999
 *    SOL of the platform's stranded in every agent it touched, and let a recipient that
 *    closed its USDC account between the check and the send make the drip pay it rent.
 *    The owner can withdraw to their own wallet (split, sponsored) or raise the cap.
 */
export function planAgentTransferRoute(input: {
  asset: "usdc" | "native";
  amountBaseUnits: bigint;
  capBaseUnits: bigint | null;
  destinationExempt: boolean;
}): Exclude<AgentTransferRoute, { route: "privy_transfer" }> {
  if (input.asset === "native") {
    return { route: "sponsored", split: false, reason: "SOL transfers are not capped by the wallet policy" };
  }
  if (input.capBaseUnits === null) {
    return { route: "sponsored", split: false, reason: "no wallet policy caps this agent's transfers" };
  }
  if (input.amountBaseUnits <= input.capBaseUnits) {
    return { route: "sponsored", split: false, reason: "at or under the wallet policy's cap" };
  }
  if (input.destinationExempt) {
    return {
      route: "sponsored",
      split: true,
      reason: "over the cap, to the owner's own wallet or the platform: split into transfers at or under it",
    };
  }
  return { route: "refused", reason: "over the wallet policy's per-transaction cap, to an address it guards" };
}

/** Pure: the sentence an owner reads when an over-cap transfer to a guarded address is refused. */
export function overCapRefusal(capBaseUnits: bigint): string {
  const cap = usdc(capBaseUnits);
  return (
    `That's more than this agent's ${cap} USDC per-transaction limit, and above the limit Tocker only sends to your own ` +
    `Tocker wallet. Send at most ${cap} USDC to this address, withdraw to your own wallet, or raise the limit in the ` +
    `agent's settings. Nothing was sent.`
  );
}

/**
 * Pure: did Privy *refuse* to sign on policy, as opposed to failing to answer?
 *
 * Only a refusal justifies the Privy-`transfer` fallback: it proves nothing was signed
 * and that asking again would be refused again. A timeout, a 429 or a 5xx proves
 * neither, and falling back on one would drip SOL into the agent for a transfer that may
 * simply work in a minute. A 403 is a permission refusal; a 400/422 counts only when it
 * says it is about the policy.
 */
export function isPolicyDenial(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 403) return true;
  if (status !== 400 && status !== 422) return false;
  let text = err instanceof Error ? err.message : "";
  try {
    text += ` ${JSON.stringify((err as { error?: unknown }).error) ?? ""}`;
  } catch {
    // an unserializable body says nothing more
  }
  return /polic|denied|not allowed|violat/i.test(text);
}

/**
 * Pure: is this co-sign refusal the token program saying the *agent's* USDC is short?
 * (`TransferChecked` error 0x1, InsufficientFunds — not 0x11 or 0x1f.)
 */
export function isAgentUsdcShort(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== "CosignRefused") return false;
  const needle = `${TOKEN_PROGRAM_ID.toBase58()} failed: custom program error: 0x1`.toLowerCase();
  const lower = err.message.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return false;
    if (!/[0-9a-f]/.test(lower.charAt(at + needle.length))) return true;
    from = at + 1;
  }
}

// ----------------------------------------------------------------- RPC reads

async function rpc<T>(method: string, params: unknown[], timeoutMs = 10_000): Promise<T> {
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (HTTP ${res.status})`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Solana RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  if (body.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
  return body.result;
}

/** A blockhash, and the last block height it is valid at — which is what "expired" means. */
export async function latestBlockhashWithExpiry(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await rpc<{ value?: { blockhash?: string; lastValidBlockHeight?: number } }>("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const blockhash = result?.value?.blockhash;
  const lastValidBlockHeight = result?.value?.lastValidBlockHeight;
  if (!blockhash || typeof lastValidBlockHeight !== "number") {
    throw new Error("Solana RPC getLatestBlockhash returned no blockhash");
  }
  return { blockhash, lastValidBlockHeight };
}

let rentExemptCache: { lamports: number; at: number } | null = null;

/**
 * The live rent-exempt minimum of a data-less account; {@link RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS}
 * when the RPC does not answer, or answers outside {@link EMPTY_ACCOUNT_RENT_BAND}.
 */
export async function rentExemptMinimumLamports(): Promise<number> {
  if (rentExemptCache && Date.now() - rentExemptCache.at < 10 * 60_000) return rentExemptCache.lamports;
  try {
    const lamports = saneRentLamports(Number(await rpc<number>("getMinimumBalanceForRentExemption", [0])), EMPTY_ACCOUNT_RENT_BAND);
    if (lamports !== null) {
      rentExemptCache = { lamports, at: Date.now() };
      return lamports;
    }
  } catch {
    // the constant below is the long-standing figure
  }
  return RENT_EXEMPT_EMPTY_ACCOUNT_LAMPORTS;
}

export type FinalStatus = "confirmed" | "failed" | "expired" | "pending";

/**
 * One look at a transaction sent earlier: landed (`confirmed` / `failed`), can never
 * land (`expired` — the chain is past its blockhash's last valid height and has not
 * seen it), or still might (`pending`). Throws when the RPC does not answer; a caller
 * must read that as `pending`, never as `expired`.
 */
export async function inflightStatus(signature: string, lastValidBlockHeight: number): Promise<FinalStatus> {
  const { signatureStatus } = await import("./solana-rpc");
  const status = await signatureStatus(signature);
  if (status !== "pending") return status;
  const height = Number(await rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]));
  if (!Number.isFinite(height) || height <= lastValidBlockHeight) return "pending";
  // One last look: it may have landed in the final valid block.
  const last = await signatureStatus(signature);
  return last === "pending" ? "expired" : last;
}

// -------------------------------------------------------------------- errors

/** Privy refused on policy to sign as the agent. Nothing was signed, nothing can land. */
export class AgentSignatureRefused extends Error {
  constructor(reason: string) {
    super(`The agent's wallet would not sign this transfer: ${reason}`);
    this.name = "AgentSignatureRefused";
  }
}

/**
 * The transaction was fully signed and is known not to have moved anything: the network
 * refused it at the door, it failed on chain, or its blockhash expired unseen. A caller
 * that recorded its signature may release it.
 */
export class TransferNotSent extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferNotSent";
  }
}

const COULD_NOT_READ = "Tocker couldn't read this transfer's accounts on Solana just now. Nothing was sent — try again in a moment.";

// --------------------------------------------------------------------- plan

export interface AgentTransferPlan {
  asset: "usdc" | "native";
  route: Exclude<AgentTransferRoute["route"], "refused">;
  /** Split the transfer to the destination into pieces at or under the cap. */
  split: boolean;
  reason: string;
  agentAddress: string;
  /** The destination wallet. */
  destination: string;
  /** The platform Solana wallet. */
  feePayer: string;
  toPlatform: boolean;
  capBaseUnits: bigint | null;
  /** USDC base units, or lamports for SOL, that the destination receives. */
  amountBaseUnits: bigint;
  /** The USDC account fee in base units; 0 when nothing is opened (or it is the platform's). */
  feeBaseUnits: bigint;
  /** Tocker trading fees this transaction collects for the platform, in USDC base units; 0 on a sweep or a SOL transfer. */
  owedBaseUnits: bigint;
  /** True when the destination's USDC account does not exist yet. */
  opensAccount: boolean;
  /** Live rent of the account opened; 0 when none is. */
  rentLamports: number;
  /** What the destination receives, in human units. */
  delivered: number;
  /** The one-time USDC fee for opening the recipient's account; 0 when none is. */
  accountFeeUsdc: number;
  /** {@link owedBaseUnits} in human units. */
  tradingFeesUsdc: number;
}

/**
 * What an owner's withdrawal owes Tocker before anything else goes out: trading fees the
 * sweep has not collected yet. `owedBaseUnits` is collected by the withdrawal's own
 * transaction; `reservedBaseUnits` is already on its way in a sweep still in flight, so it
 * is treated as gone. Absent on a fee sweep, which is exempt from the owner's minimum too.
 */
export interface OwnerWithdrawalTerms {
  owedBaseUnits: bigint;
  reservedBaseUnits: bigint;
}

/** The dummy blockhash a size check compiles against; any 32 bytes compile to the same length. */
const SIZE_CHECK_BLOCKHASH = PublicKey.default.toBase58();

/** Pure: does this plan's transaction fit in one packet? */
function fits(plan: AgentTransferPlan): boolean {
  try {
    buildPlanned(plan, SIZE_CHECK_BLOCKHASH);
    return true;
  } catch (err) {
    if (err instanceof TooLargeForOneTransaction) return false;
    throw err;
  }
}

/**
 * Pure: the most a split transfer can carry in one packet — a whole number of cap-sized
 * pieces, beside whatever else the transaction carries. 0 when not even one piece fits.
 */
export function largestSplitThatFits(plan: AgentTransferPlan): bigint {
  const cap = plan.capBaseUnits;
  if (cap === null || cap <= BigInt(0)) return BigInt(0);
  for (let pieces = MAX_TRANSFER_PIECES; pieces >= 1; pieces -= 1) {
    const amount = cap * BigInt(pieces);
    if (amount >= plan.amountBaseUnits) continue;
    if (fits({ ...plan, amountBaseUnits: amount })) return amount;
  }
  return BigInt(0);
}

/**
 * Read the chain and decide exactly what a transfer out of an agent would do — what the
 * destination receives, whether an account is opened and for what fee, and the route —
 * without signing anything. Throws a readable sentence for anything that cannot go.
 *
 * `capBaseUnits` and `destinationExempt` come from the database (see
 * {@link planAgentSolanaWithdrawal}); everything else from the chain. A read that fails
 * refuses the transfer rather than guessing: an account read as missing when it exists
 * would charge the agent for opening it.
 *
 * Only a transfer *to the platform* (a fee sweep) ever falls back to Privy's `transfer`,
 * when it is too large for one packet. Anything else too large is refused with the most
 * one withdrawal can carry, and anything over the cap to a guarded address is refused —
 * neither is ever paid for with a SOL drip into the agent.
 */
export async function planAgentSolanaTransfer(input: {
  agentAddress: string;
  asset: "usdc" | "native";
  /** Human units (12.5 USDC, 0.02 SOL). */
  amount: number;
  toAddress: string;
  platformAddress: string;
  capBaseUnits: bigint | null;
  destinationExempt: boolean;
  /** Send exactly `amount` or nothing — no "withdraw everything" (see {@link fitUsdcWithdrawal}). */
  exact?: boolean;
  /** Set for an owner's withdrawal (minimums, fees owed); absent for a fee sweep. */
  withdrawal?: OwnerWithdrawalTerms;
}): Promise<AgentTransferPlan> {
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new Error("Enter an amount greater than zero.");
  const sponsored = await import("./solana-sponsored");
  const rpcReads = await import("./solana-rpc");

  let destination: PublicKey;
  try {
    destination = new PublicKey(input.toAddress);
  } catch {
    throw new Error("That is not a Solana address.");
  }
  const to = destination.toBase58();
  if (to === input.agentAddress) throw new Error("That is the agent's own wallet.");
  // A USDC token account (or a program) pasted where a wallet belongs would get a USDC
  // account *owned by that account* — which nobody can ever sign for.
  const kind = await sponsored.readRecipientKind(to).catch(() => null);
  if (kind === null) throw new Error(COULD_NOT_READ);
  if (kind !== "wallet") {
    throw new Error(
      kind === "token_account"
        ? "That address is a token account, not a wallet. Paste the wallet address it belongs to — sending there would lose the funds."
        : "That address is a program, not a wallet. Nothing was sent.",
    );
  }
  const toPlatform = to === input.platformAddress;
  const common = {
    agentAddress: input.agentAddress,
    destination: to,
    feePayer: input.platformAddress,
    toPlatform,
    capBaseUnits: input.capBaseUnits,
    owedBaseUnits: BigInt(0),
    tradingFeesUsdc: 0,
  };

  if (input.asset === "native") {
    const lamports = toBaseUnits(input.amount, 9);
    if (lamports <= BigInt(0)) throw new Error("That amount rounds to zero SOL.");
    let reads: [number, number, number];
    try {
      reads = await Promise.all([
        rpcReads.getLamports(input.agentAddress),
        rpcReads.getLamports(to),
        rentExemptMinimumLamports(),
      ]);
    } catch {
      throw new Error(COULD_NOT_READ);
    }
    const [balanceLamports, destinationLamports, rentExemptLamports] = reads;
    const problem = solWithdrawalProblem({
      balanceLamports,
      lamports,
      keepLamports: AGENT_SOL_KEPT_LAMPORTS,
      rentExemptLamports,
      destinationLamports,
      minLamports: input.withdrawal ? MIN_AGENT_SOL_WITHDRAWAL_LAMPORTS : 0,
    });
    if (problem) throw new Error(problem);
    const route = planAgentTransferRoute({ asset: "native", amountBaseUnits: lamports, capBaseUnits: null, destinationExempt: false });
    return {
      ...common,
      asset: "native",
      route: "sponsored",
      split: false,
      reason: route.reason,
      amountBaseUnits: lamports,
      feeBaseUnits: BigInt(0),
      opensAccount: false,
      rentLamports: 0,
      delivered: Number(lamports) / 1e9,
      accountFeeUsdc: 0,
    };
  }

  const requested = toBaseUnits(input.amount, SOLANA_USDC_DECIMALS);
  if (requested <= BigInt(0)) throw new Error("That amount rounds to zero USDC.");
  const source = associatedTokenAddress(new PublicKey(input.agentAddress), SOLANA_USDC_MINT).toBase58();
  const destinationAta = associatedTokenAddress(destination, SOLANA_USDC_MINT).toBase58();
  let held: bigint;
  let ataExists: boolean;
  try {
    const [balance, exists] = await Promise.all([
      rpcReads.getTokenAccountBalance(source),
      rpcReads.accountExists(destinationAta),
    ]);
    ataExists = exists;
    if (balance !== null) {
      held = balance;
    } else {
      // Null is "no USDC account" or "the RPC did not answer": ask which.
      if (await rpcReads.accountExists(source)) throw new Error("balance unreadable");
      held = BigInt(0);
    }
  } catch {
    throw new Error(COULD_NOT_READ);
  }

  // A sweep already on its way has taken its fees, whatever the balance says yet.
  const reserved = input.withdrawal && input.withdrawal.reservedBaseUnits > BigInt(0) ? input.withdrawal.reservedBaseUnits : BigInt(0);
  const available = held > reserved ? held - reserved : BigInt(0);
  const owed = input.withdrawal && !toPlatform && input.withdrawal.owedBaseUnits > BigInt(0) ? input.withdrawal.owedBaseUnits : BigInt(0);

  let rentLamports = 0;
  if (!ataExists) {
    const live = await sponsored.tokenAccountRentLamports();
    const sane = saneRentLamports(live, TOKEN_ACCOUNT_RENT_BAND);
    if (sane === null) console.warn(`[agent-transfer] token-account rent read ${live} is outside the sane band; using ${ATA_RENT_LAMPORTS}`);
    rentLamports = sane ?? ATA_RENT_LAMPORTS;
  }
  let feeBaseUnits = BigInt(0);
  let accountFeeUsdc = 0;
  if (!ataExists && !toPlatform) {
    const fee = sponsored.newAccountFeeUsdc({ rentLamports, solPriceUsd: await sponsored.solPriceUsd() });
    if (fee === null) {
      throw new Error("Tocker couldn't price opening the recipient's USDC account just now. Nothing was sent — try again in a minute.");
    }
    feeBaseUnits = toBaseUnits(fee, SOLANA_USDC_DECIMALS);
    accountFeeUsdc = fee;
  }
  // "Everything" as the owner sees it includes a sweep's fees still in flight: read a
  // request between what is available and what the balance says as everything available.
  const asked =
    reserved > BigInt(0) && requested >= available && requested <= held + BigInt(WITHDRAW_ALL_TOLERANCE_BASE_UNITS) ? available : requested;
  const fit = fitUsdcWithdrawal({
    heldBaseUnits: available,
    amountBaseUnits: asked,
    feeBaseUnits,
    owedBaseUnits: owed,
    minBaseUnits: input.withdrawal ? BigInt(MIN_AGENT_USDC_WITHDRAWAL_BASE_UNITS) : BigInt(0),
    exact: input.exact,
  });
  if (!fit.ok) throw new Error(fit.problem);

  const route = planAgentTransferRoute({
    asset: "usdc",
    amountBaseUnits: fit.amountBaseUnits,
    capBaseUnits: input.capBaseUnits,
    destinationExempt: input.destinationExempt,
  });
  if (route.route === "refused") throw new Error(overCapRefusal(input.capBaseUnits ?? BigInt(0)));
  const plan: AgentTransferPlan = {
    ...common,
    asset: "usdc",
    route: "sponsored",
    split: route.split,
    reason: route.reason,
    amountBaseUnits: fit.amountBaseUnits,
    feeBaseUnits,
    owedBaseUnits: owed,
    opensAccount: !ataExists,
    rentLamports,
    delivered: Number(fit.amountBaseUnits) / 10 ** SOLANA_USDC_DECIMALS,
    accountFeeUsdc,
    tradingFeesUsdc: Number(owed) / 10 ** SOLANA_USDC_DECIMALS,
  };
  if (fits(plan)) return plan;
  if (toPlatform) {
    // A fee sweep of more cap-sized pieces than one packet carries: the platform is the
    // recipient, its account exists, and nobody but Tocker chose the amount.
    return { ...plan, route: "privy_transfer", split: false, reason: `${plan.reason}; too large for one transaction` };
  }
  const most = largestSplitThatFits(plan);
  const cap = usdc(input.capBaseUnits ?? BigInt(0));
  throw new Error(
    most > BigInt(0)
      ? `At its ${cap} USDC per-transaction limit, this agent can send at most ${usdc(most)} USDC in one withdrawal. ` +
          `Withdraw that much now and the rest after it, or raise the limit in the agent's settings. Nothing was sent.`
      : `This withdrawal doesn't fit in one Solana transaction at the agent's ${cap} USDC per-transaction limit. ` +
          `Raise the limit in the agent's settings and try again. Nothing was sent.`,
  );
}

/** Pure: a plan's unsigned transaction and the platform's budget for it. */
function buildPlanned(plan: AgentTransferPlan, blockhash: string): { bytes: Uint8Array; budget: number } {
  if (plan.asset === "native") {
    return {
      bytes: buildAgentSolTransfer({
        agent: plan.agentAddress,
        destination: plan.destination,
        feePayer: plan.feePayer,
        lamports: plan.amountBaseUnits,
        blockhash,
      }),
      budget: sponsoredSolTransferBudget(),
    };
  }
  return {
    bytes: buildAgentUsdcTransfer({
      agent: plan.agentAddress,
      destinationOwner: plan.destination,
      feePayer: plan.feePayer,
      amountBaseUnits: plan.amountBaseUnits,
      openAccount: plan.opensAccount ? { feeBaseUnits: plan.feeBaseUnits } : null,
      tockerFeesBaseUnits: plan.owedBaseUnits,
      capBaseUnits: plan.capBaseUnits,
      splitToDestination: plan.split,
      blockhash,
    }),
    budget: sponsoredUsdcTransferBudget({ opensAccount: plan.opensAccount, rentLamports: plan.rentLamports }),
  };
}

// -------------------------------------------------------------------- effects

/** Called with the transaction id once every signature is on it, before it is broadcast. Throw to send nothing. */
export type OnSigned = (signature: string, lastValidBlockHeight: number) => Promise<void>;

export interface SponsoredAgentTransferOutcome {
  signature: string;
  /** `pending`: accepted or unresolved, and it may still land until its blockhash expires. */
  status: "confirmed" | "failed" | "pending";
  feePayer: string;
  /** Lamports the platform agreed to lose at most. */
  budgetLamports: number;
  lastValidBlockHeight: number;
  /** What the destination receives, in human units. */
  delivered: number;
  /** The one-time USDC fee for opening the recipient's account; 0 when none was opened. */
  accountFeeUsdc: number;
}

/**
 * Build a plan's transaction, sign it as the agent, make sure the platform can pay,
 * co-sign as the platform, broadcast. The platform never co-signs anything this function
 * did not author: the agent-signed bytes are compared to the built message before the
 * co-signature, and the result again after it.
 *
 * Throws {@link AgentSignatureRefused} when Privy refuses on policy (callers may fall back
 * — nothing exists that could land), {@link TransferNotSent} when the network refused the
 * signed transaction, and a plain `Error` with a readable sentence for everything else
 * before the broadcast. After the broadcast it never throws for an unclear answer: that
 * is `pending`, with the signature.
 */
async function sendPlanned(
  plan: AgentTransferPlan,
  agentWalletId: string,
  options: { purpose: string; confirmTimeoutMs: number; onSigned?: OnSigned },
): Promise<SponsoredAgentTransferOutcome> {
  const cosign = await import("./solana-cosign");
  const sponsored = await import("./solana-sponsored");
  const { purpose } = options;
  const { blockhash, lastValidBlockHeight } = await latestBlockhashWithExpiry().catch(() => {
    throw new Error(COULD_NOT_READ);
  });
  const { bytes: built, budget } = buildPlanned(plan, blockhash);

  let agentSigned: string;
  try {
    agentSigned = await cosign.signAsServerWallet(agentWalletId, Buffer.from(built).toString("base64"));
  } catch (err) {
    if (isPolicyDenial(err)) throw new AgentSignatureRefused(err instanceof Error ? err.message : String(err));
    console.warn(`[agent-transfer] the agent's wallet did not sign the ${purpose}`, err);
    throw new Error(`Tocker couldn't get the agent's wallet to sign this ${purpose} just now. Nothing was sent — try again in a minute.`, {
      cause: err,
    });
  }
  if (!sameMessage(built, Buffer.from(agentSigned, "base64"))) {
    throw new Error(`The agent's signature changed the ${purpose} transaction. Nothing was sent.`);
  }

  // Only now, with an agent signature that will be used, does the platform make sure it
  // can pay — refuelling from its own USDC once if it is short. Nobody is asked for SOL.
  const capacity = await sponsored.ensureSponsorCapacity({ needLamports: budget + SPONSOR_MARGIN_LAMPORTS, why: `an agent ${purpose}` });
  if (!capacity.ok) throw new Error(capacity.error);
  if (capacity.address !== plan.feePayer) throw new Error("Tocker's fee wallet changed while this was being signed. Nothing was sent — try again.");

  let signed: string;
  try {
    // One more look on an over-budget reading: the platform's own traffic landing between
    // `cosignAsPlatform`'s unpinned balance read and its simulation. The budget stays exact.
    signed = await sponsored.cosignSponsored({ transactionBase64: agentSigned, maxOutflowLamports: budget, purpose });
  } catch (err) {
    console.warn(`[agent-transfer] co-sign refused for the ${purpose}`, err);
    const sentence = isAgentUsdcShort(err)
      ? "The agent's wallet doesn't hold that much USDC any more. Nothing was sent."
      : sponsored.explainCosignFailure(err, purpose);
    throw new Error(sentence, { cause: err });
  }
  const signedBytes = Buffer.from(signed, "base64");
  if (!sameMessage(built, signedBytes) || missingSignatures(signedBytes) !== 0) {
    throw new Error(`The platform's co-signature left the ${purpose} transaction altered or incomplete. Nothing was sent.`);
  }
  // The transaction id is the fee payer's signature, known before anything is sent.
  const signature = transactionId(signedBytes);
  if (!signature) throw new Error(`The ${purpose} transaction has no fee-payer signature. Nothing was sent.`);
  if (options.onSigned) await options.onSigned(signature, lastValidBlockHeight);

  const sent = await sponsored.broadcastSponsored(signed, {
    sendAndConfirm: (tx) => cosign.sendAndConfirm(tx, options.confirmTimeoutMs),
  });
  const base = {
    signature: sent.signature || signature,
    feePayer: plan.feePayer,
    budgetLamports: budget,
    lastValidBlockHeight,
    delivered: plan.delivered,
    accountFeeUsdc: plan.accountFeeUsdc,
  };
  switch (sent.outcome) {
    case "rejected":
      throw new TransferNotSent(`The network turned this ${purpose} down (${sent.reason}). Nothing moved.`);
    case "confirmed":
    case "failed":
      return { ...base, status: sent.outcome };
    case "pending":
    case "unknown":
      // Accepted, or unclear. Either way it may still land, so it is never "failed".
      return { ...base, status: "pending" };
  }
}

/** What a routed transfer did, in the shape every withdrawal caller already reads. */
export type AgentSolanaWithdrawal = WithdrawResult & {
  route: AgentTransferPlan["route"];
  /** The platform wallet when it paid the fee; null on the Privy-transfer path. */
  feePayer: string | null;
  /** What the destination receives (the request, less any account fee on a withdraw-all). */
  delivered: number;
  /** One-time USDC fee for opening the recipient's account; 0 when none was opened. */
  accountFeeUsdc: number;
  /** Tocker trading fees the agent owed, collected by the same transaction; 0 when none. */
  tradingFeesUsdc: number;
  /** For a sponsored transfer still in flight: the height past which it can never land. */
  lastValidBlockHeight?: number;
};

/**
 * Pure: a sponsored outcome as a {@link WithdrawResult}. A transaction that failed on
 * chain moved nothing, and says so by throwing {@link TransferNotSent} — exactly as
 * `pollWithdrawal` does for a failed Privy action — so no caller can read it as sent.
 */
export function withdrawalFromOutcome(outcome: {
  signature: string;
  status: FinalStatus;
  feePayer: string;
  delivered: number;
  accountFeeUsdc: number;
  tradingFeesUsdc?: number;
  lastValidBlockHeight?: number;
}): AgentSolanaWithdrawal {
  const base = {
    txHash: outcome.signature,
    // Not a Privy wallet action: there is none on this path. Labelled so nobody mistakes it for one.
    actionId: `solana-sponsored:${outcome.signature}`,
    route: "sponsored" as const,
    feePayer: outcome.feePayer,
    delivered: outcome.delivered,
    accountFeeUsdc: outcome.accountFeeUsdc,
    tradingFeesUsdc: outcome.tradingFeesUsdc ?? 0,
    ...(outcome.lastValidBlockHeight === undefined ? {} : { lastValidBlockHeight: outcome.lastValidBlockHeight }),
  };
  if (outcome.status === "confirmed") return { ...base, status: "succeeded" };
  if (outcome.status === "pending") return { ...base, status: "pending" };
  throw new TransferNotSent(
    outcome.status === "failed"
      ? `The transfer (${outcome.signature}) failed on chain; nothing moved. Tocker's fee wallet paid its network fee.`
      : `The transfer (${outcome.signature}) expired before the network picked it up; nothing moved. Try again.`,
  );
}

/** A withdrawal as the client sees it: the receipt fields, what arrived, any account fee, and any trading fees collected. */
export type ClientWithdrawal = WithdrawResult & { delivered: number; accountFeeUsdc: number; tradingFeesUsdc: number };

/** Pure: {@link AgentSolanaWithdrawal} without the routing detail, which stays in the audit. */
export function withdrawalForClient(sent: AgentSolanaWithdrawal): ClientWithdrawal {
  return {
    txHash: sent.txHash,
    actionId: sent.actionId,
    status: sent.status,
    delivered: sent.delivered,
    accountFeeUsdc: sent.accountFeeUsdc,
    tradingFeesUsdc: sent.tradingFeesUsdc,
  };
}

/** The agent a transfer leaves from: who owns it, and what its wallet policy caps. Read once per transfer. */
interface AgentRecord {
  id: string;
  ownerId: string;
  name: string;
  walletBudget: WalletBudget | null;
}

async function readAgent(agentId: string): Promise<AgentRecord> {
  const { eq } = await import("drizzle-orm");
  const { agents, getDb } = await import("@/db");
  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, walletBudget: agents.walletBudget })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) throw new Error("Agent not found");
  return agent;
}

/** Tocker trading fees an owner's withdrawal collects: the rows, and their sum. */
interface FeesToCollect {
  feeIds: string[];
  amountUsd: number;
}

/** The agent's Solana wallet, the platform, and the plan — everything short of signing. */
async function resolvePlan(input: {
  agent: AgentRecord;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
  exact?: boolean;
  /** An owner's withdrawal: minimums apply, and Tocker's accrued fees come out first. */
  owner: boolean;
}): Promise<{ walletId: string; plan: AgentTransferPlan; fees: FeesToCollect | null }> {
  const walletsLib = await import("./index");
  const [wallet] = (await walletsLib.getAgentWallets(input.agent.id)).filter((w) => w.chain === "solana");
  if (!wallet) throw new Error("No solana wallet for this agent");
  if (walletsLib.isPaperWallet(wallet.id)) throw new Error("Paper wallets hold no real funds");

  const { platformFeePayer } = await import("./solana-cosign");
  let platform: { walletId: string; address: string };
  try {
    platform = await platformFeePayer();
  } catch (err) {
    console.error("[agent-transfer] the platform Solana wallet is unavailable", err);
    const { FEE_WALLET_REFILLING } = await import("./solana-sponsored");
    throw new Error(FEE_WALLET_REFILLING, { cause: err });
  }
  if (platform.address === wallet.address) {
    throw new Error("That wallet is Tocker's own fee wallet; it does not sponsor transfers out of itself.");
  }

  const context =
    input.asset === "usdc"
      ? await capAndExemption(input.agent, input.toAddress, platform.address)
      : { capBaseUnits: null, destinationExempt: false };

  // An owner's USDC withdrawal pays what the agent owes Tocker first, in the same
  // transaction — otherwise "trade, then withdraw everything before the sweep" keeps the
  // fees. Unreadable fees refuse the withdrawal rather than guess zero.
  let withdrawal: OwnerWithdrawalTerms | undefined;
  let fees: FeesToCollect | null = null;
  if (input.owner) {
    withdrawal = { owedBaseUnits: BigInt(0), reservedBaseUnits: BigInt(0) };
    if (input.asset === "usdc") {
      const settlement = await import("@/lib/platform/settlement");
      let owed: Awaited<ReturnType<typeof settlement.solanaFeesOwed>>;
      try {
        owed = await settlement.solanaFeesOwed({ agentId: input.agent.id, ownerId: input.agent.ownerId, agentName: input.agent.name });
      } catch (err) {
        console.error(`[agent-transfer] ${input.agent.id}: could not read the fees owed`, err);
        throw new Error("Tocker couldn't read this agent's trading fees just now. Nothing was sent — try again in a minute.", { cause: err });
      }
      withdrawal = {
        owedBaseUnits: toBaseUnits(owed.freeUsd, SOLANA_USDC_DECIMALS),
        reservedBaseUnits: toBaseUnits(owed.inflightUsd, SOLANA_USDC_DECIMALS),
      };
      fees = owed.free.length > 0 && owed.freeUsd > 0 ? { feeIds: owed.free.map((row) => row.id), amountUsd: owed.freeUsd } : null;
    }
  }

  const plan = await planAgentSolanaTransfer({
    agentAddress: wallet.address,
    asset: input.asset,
    amount: input.amount,
    toAddress: input.toAddress,
    platformAddress: platform.address,
    ...context,
    exact: input.exact,
    withdrawal,
  });
  return { walletId: wallet.id, plan, fees: plan.owedBaseUnits > BigInt(0) ? fees : null };
}

/**
 * Read-only: what a withdrawal out of an agent's Solana wallet would do — what arrives,
 * any one-time account fee, any trading fees collected, the route — without signing
 * anything. For a confirm screen; callers check ownership first. Throws the same
 * sentences the withdrawal would.
 */
export async function planAgentSolanaWithdrawal(input: {
  agentId: string;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}): Promise<AgentTransferPlan> {
  const agent = await readAgent(input.agentId);
  return (await resolvePlan({ ...input, agent, owner: true })).plan;
}

/** Pure: "in 40 seconds" / "in 7 minutes" — how long a rate-limited caller waits. */
export function waitSentence(retryAfterSeconds: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

/** Owner withdrawals out of agents that this owner made since `since`, from the audit log every instance shares. */
async function ownerWithdrawalsSince(ownerId: string, since: Date): Promise<number> {
  const { and, eq, gt, sql } = await import("drizzle-orm");
  const { auditEvents, getDb } = await import("@/db");
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.userId, ownerId),
        eq(auditEvents.kind, "withdraw"),
        gt(auditEvents.createdAt, since),
        // Only `recordAgentSolanaWithdrawal` writes a route; fee sweeps and rent recycles do not.
        sql`${auditEvents.metadata}->>'route' is not null`,
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Null when this owner may make another withdrawal out of an agent; otherwise the
 * sentence to show. Takes a slot of the in-process burst limit, then checks the day's
 * count in the audit log (which every serverless instance shares, so the daily ceiling
 * does not multiply with the instance count). A count that cannot be read lets the
 * withdrawal through: the burst limit still stands, and a database that cannot answer
 * would refuse the withdrawal a moment later anyway.
 */
async function ownerWithdrawalLimited(ownerId: string, now: Date = new Date()): Promise<string | null> {
  const { limiter } = await import("@/lib/security/rate-limit");
  const verdict = limiter.consume(`agent-withdraw:${ownerId}`, OWNER_WITHDRAWAL_BURST_LIMIT, now.getTime());
  if (!verdict.ok) return `That's a lot of withdrawals in a short time. Try again in ${waitSentence(verdict.retryAfterSeconds)}.`;
  const today = await ownerWithdrawalsSince(ownerId, new Date(now.getTime() - 24 * 60 * 60_000)).catch((err: unknown) => {
    console.warn(`[agent-transfer] could not count ${ownerId}'s withdrawals today`, err);
    return 0;
  });
  if (today >= OWNER_WITHDRAWALS_PER_DAY) {
    return `That's ${OWNER_WITHDRAWALS_PER_DAY} withdrawals out of your agents in the last 24 hours, which is the daily limit. Try again tomorrow.`;
  }
  return null;
}

/**
 * Agents with a transfer out of them under way in this process. One at a time per agent:
 * two parallel withdrawals of the same balance would both be co-signed, and the one that
 * fails on chain still costs the platform its fee. Per process, like the rate limiter;
 * across instances, the co-sign simulation and the fee rows' conditional claim still hold.
 */
const busyAgents = new Set<string>();

/**
 * Move USDC or SOL out of an agent's Solana wallet with the platform paying the fee.
 * Callers have already checked ownership (the withdraw actions) or own the money
 * (settlement, which sets `feeSweep`). Routes by {@link planAgentSolanaTransfer}.
 *
 * An owner's withdrawal (the default) is rate-limited per owner, has a $1 / 0.001 SOL
 * floor unless it takes everything, and collects the agent's accrued Tocker fees in the
 * same transaction: those rows are claimed with the transaction's signature before the
 * broadcast, settled when it confirms, released when it is known not to have moved, and
 * otherwise resolved against the chain by the next settlement pass.
 */
export async function withdrawFromAgentSolana(input: {
  agentId: string;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
  purpose?: string;
  /** Send exactly `amount` or nothing: no "withdraw everything" shrinking. Fee sweeps set it. */
  exact?: boolean;
  /** How long the broadcast waits for a confirmation before answering `pending`. */
  confirmTimeoutMs?: number;
  /** See {@link OnSigned}. Only the sponsored path calls it. */
  onSigned?: OnSigned;
  /** The platform's own fee sweep: no owner limits or minimums, and only ever to the platform. */
  feeSweep?: boolean;
}): Promise<AgentSolanaWithdrawal> {
  const { isPrivyConfigured } = await import("@/lib/privy");
  if (!isPrivyConfigured()) throw new Error("Privy is not configured — withdrawals are unavailable");
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new Error("Amount must be greater than zero");

  const agent = await readAgent(input.agentId);
  const sweep = input.feeSweep === true;
  if (!sweep) {
    const limited = await ownerWithdrawalLimited(agent.ownerId);
    if (limited) throw new Error(limited);
  }
  if (busyAgents.has(agent.id)) {
    throw new Error(
      sweep
        ? "a transfer out of this agent is already under way; the sweep waits for the next pass"
        : "A transfer out of this agent is already under way. Wait for it to finish, then try again.",
    );
  }
  busyAgents.add(agent.id);
  try {
    return await transferOut(agent, input, sweep);
  } finally {
    busyAgents.delete(agent.id);
  }
}

async function transferOut(
  agent: AgentRecord,
  input: Parameters<typeof withdrawFromAgentSolana>[0],
  sweep: boolean,
): Promise<AgentSolanaWithdrawal> {
  const { walletId, plan, fees } = await resolvePlan({
    agent,
    asset: input.asset,
    amount: input.amount,
    toAddress: input.toAddress,
    exact: input.exact,
    owner: !sweep,
  });
  if (sweep && !plan.toPlatform) throw new Error("A fee sweep only ever goes to Tocker's own wallet. Nothing was sent.");
  const purpose = input.purpose ?? "withdrawal";
  if (plan.route === "privy_transfer") {
    console.warn(`[agent-transfer] ${agent.id}: ${purpose} goes through Privy's transfer (${plan.reason})`);
    return viaPrivyTransfer({ walletId, plan, agentId: agent.id });
  }

  const settlement = fees ? await import("@/lib/platform/settlement") : null;
  const claim: { marker: string | null } = { marker: null };
  const onSigned: OnSigned = async (signature, lastValidBlockHeight) => {
    if (input.onSigned) await input.onSigned(signature, lastValidBlockHeight);
    if (!fees || !settlement) return;
    try {
      claim.marker = await settlement.claimFeesForTransfer(fees.feeIds, signature, lastValidBlockHeight);
    } catch (err) {
      throw new Error("Tocker was collecting this agent's trading fees at the same moment. Nothing was sent — try again in a minute.", {
        cause: err,
      });
    }
  };
  const release = async () => {
    if (fees && settlement && claim.marker) await settlement.releaseFeesFromTransfer(fees.feeIds, claim.marker).catch(() => undefined);
  };

  let outcome: SponsoredAgentTransferOutcome;
  try {
    outcome = await sendPlanned(plan, walletId, { purpose, confirmTimeoutMs: input.confirmTimeoutMs ?? 25_000, onSigned });
  } catch (err) {
    if (err instanceof TransferNotSent) await release();
    if (!(err instanceof AgentSignatureRefused)) throw err;
    // Privy refused on policy: nothing was signed as the agent and the platform never
    // co-signed, so nothing exists that could land alongside a fallback. Only a sweep to
    // the platform gets one; an owner's transfer is told why instead of paid for by a drip.
    if (plan.toPlatform && plan.asset === "usdc") {
      console.warn(`[agent-transfer] ${agent.id}: sponsored ${purpose} refused (${err.message}); using Privy's transfer`);
      return viaPrivyTransfer({ walletId, plan: { ...plan, split: false }, agentId: agent.id });
    }
    throw new Error(
      `The agent's wallet policy refused to sign this ${purpose}. Nothing was sent. Withdraw to your own Tocker wallet, ` +
        `or check the per-transaction limit in the agent's settings.`,
      { cause: err },
    );
  }

  if (fees && settlement && claim.marker) {
    if (outcome.status === "confirmed") {
      await settlement.settleCollectedFees({
        agentId: agent.id,
        ownerId: agent.ownerId,
        agentName: agent.name,
        chain: "solana",
        feeIds: fees.feeIds,
        amountUsd: fees.amountUsd,
        txHash: outcome.signature,
        toAddress: plan.feePayer,
      });
    } else if (outcome.status === "failed") {
      await release();
    }
    // `pending`: the rows keep the marker; the next settlement pass (or withdrawal) asks the chain.
  }
  // A transaction that failed on chain moved nothing but cost the platform its fee. The
  // owner sees it, and it counts toward the day's limit (`ownerWithdrawalsSince`), so a
  // recipient that closes its account between the simulation and the send cannot make
  // failures free.
  if (!sweep && outcome.status === "failed") await recordFailedWithdrawal(agent, plan, outcome.signature);
  return withdrawalFromOutcome({ ...outcome, tradingFeesUsdc: plan.tradingFeesUsdc });
}

/** The audit row for an owner's withdrawal that failed on chain. Never throws. */
async function recordFailedWithdrawal(agent: AgentRecord, plan: AgentTransferPlan, signature: string): Promise<void> {
  try {
    const { recordAudit } = await import("@/lib/security/audit");
    const unit = plan.asset === "usdc" ? "USDC" : "SOL";
    await recordAudit({
      userId: agent.ownerId,
      kind: "withdraw",
      agentId: agent.id,
      agentName: agent.name,
      summary: `A withdrawal of ${plan.delivered} ${unit} from ${agent.name} on solana failed on chain (${signature}); nothing moved. Tocker paid its network fee.`,
      metadata: {
        chain: "solana",
        asset: plan.asset,
        delivered: 0,
        to: plan.destination,
        txHash: signature,
        status: "failed",
        route: "sponsored",
        feePayer: plan.feePayer,
      },
    });
  } catch {
    // `recordAudit` swallows its own failures; this guards the dynamic import.
  }
}

/**
 * The Privy-`transfer` path: the agent is its own fee payer, from a SOL drip
 * (`ensureAgentGas`, inside `withdrawFromAgent`). Only ever a fee sweep to the platform —
 * too large for one packet, or refused by a policy the database disagrees with. Its
 * recipient is Tocker, whose USDC account exists, so the drip pays a signature and
 * never rent anyone else could reclaim. Nothing an owner or a stranger chooses the
 * destination of goes this way.
 */
async function viaPrivyTransfer(input: { agentId: string; walletId: string; plan: AgentTransferPlan }): Promise<AgentSolanaWithdrawal> {
  const { plan } = input;
  if (!plan.toPlatform) throw new Error("Only a transfer to Tocker's own wallet may go through Privy's transfer. Nothing was sent.");
  const walletsLib = await import("./index");
  try {
    const result = await walletsLib.withdrawFromAgent({
      agentId: input.agentId,
      chain: "solana",
      asset: plan.asset,
      amount: plan.delivered,
      toAddress: plan.destination,
    });
    return { ...result, route: "privy_transfer", feePayer: null, delivered: plan.delivered, accountFeeUsdc: 0, tradingFeesUsdc: 0 };
  } catch (err) {
    const { FEE_WALLET_REFILLING } = await import("./solana-sponsored");
    // Never a request for SOL: when the drip cannot be paid, that is Tocker's to fix.
    const message =
      err instanceof Error && err.name === "PlatformWalletError" ? FEE_WALLET_REFILLING : err instanceof Error ? err.message : String(err);
    throw new Error(message, { cause: err });
  }
}

/** The agent's cap, and whether the destination is one the cap does not guard. */
async function capAndExemption(
  agent: AgentRecord,
  toAddress: string,
  platformAddress: string,
): Promise<{ capBaseUnits: bigint | null; destinationExempt: boolean }> {
  const capBaseUnits = solanaCapBaseUnits(agent.walletBudget);
  if (capBaseUnits === null) return { capBaseUnits, destinationExempt: false };
  const { and, eq } = await import("drizzle-orm");
  const { getDb, wallets } = await import("@/db");
  const db = await getDb();
  const owned = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, agent.ownerId), eq(wallets.chain, "solana"), eq(wallets.kind, "user_embedded")));
  const exempt = uncappedSolanaDestinations({ platformAddress, ownerAddresses: owned.map((w) => w.address) });
  let destinationAta: string | null = null;
  try {
    destinationAta = associatedTokenAddress(new PublicKey(toAddress), SOLANA_USDC_MINT).toBase58();
  } catch {
    destinationAta = null;
  }
  return { capBaseUnits, destinationExempt: destinationAta !== null && exempt.includes(destinationAta) };
}

/**
 * The audit row for a Solana withdrawal an owner made: what arrived, who paid the network
 * fee (Tocker, or — on the Privy-transfer path — the agent, from a drip), and any one-time
 * fee for opening the recipient's USDC account, which the agent paid in USDC.
 */
export async function recordAgentSolanaWithdrawal(input: {
  userId: string;
  agent: { id: string; name: string };
  asset: "usdc" | "native";
  requested: number;
  to: string;
  sent: AgentSolanaWithdrawal;
}): Promise<void> {
  const { recordAudit } = await import("@/lib/security/audit");
  const unit = input.asset === "usdc" ? "USDC" : "SOL";
  const short = `${input.to.slice(0, 6)}…${input.to.slice(-4)}`;
  const feeNote =
    input.sent.accountFeeUsdc > 0
      ? ` The recipient had never held USDC; opening its account cost a one-time ${input.sent.accountFeeUsdc.toFixed(2)} USDC.`
      : "";
  const tradingNote =
    input.sent.tradingFeesUsdc > 0
      ? ` The ${usdcExact(BigInt(Math.round(input.sent.tradingFeesUsdc * 10 ** SOLANA_USDC_DECIMALS)))} USDC of Tocker trading fees the agent owed went to Tocker in the same transaction.`
      : "";
  const lead =
    input.sent.status === "succeeded"
      ? `Withdrew ${input.sent.delivered} ${unit} from ${input.agent.name} on solana to ${short}`
      : `Sent a withdrawal of ${input.sent.delivered} ${unit} from ${input.agent.name} on solana to ${short}; it had not confirmed when Tocker last looked`;
  await recordAudit({
    userId: input.userId,
    kind: "withdraw",
    agentId: input.agent.id,
    agentName: input.agent.name,
    summary: lead + (input.sent.feePayer ? "; Tocker paid the network fee." : ".") + feeNote + tradingNote,
    metadata: {
      chain: "solana",
      asset: input.asset,
      requested: input.requested,
      delivered: input.sent.delivered,
      accountFeeUsdc: input.sent.accountFeeUsdc,
      tradingFeesUsdc: input.sent.tradingFeesUsdc,
      to: input.to,
      txHash: input.sent.txHash,
      status: input.sent.status,
      route: input.sent.route,
      feePayer: input.sent.feePayer,
    },
  });
}
