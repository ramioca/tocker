/**
 * Gas for the agent's Solana wallet (W7 contract — implemented by workstream A).
 *
 * An agent is funded with USDC only. Jupiter Ultra goes gasless on its own when the
 * taker holds under ~0.01 SOL and the order is not in manual-slippage mode, but that is
 * Jupiter's call per route and per token, so the platform keeps a small SOL float in
 * every live agent's Solana wallet as the fallback: when an Ultra order comes back with
 * the taker as fee payer and the wallet cannot cover `signatureFeeLamports +
 * prioritizationFeeLamports + rentFeeLamports`, the platform Solana wallet drips
 * {@link GAS_DRIP_SOL} to it (a plain SystemProgram transfer, signed and sent through
 * Privy, confirmed before the order is retried) and an audit line is written.
 *
 * The same platform wallet pre-creates the agent's USDC associated token account, so a
 * user funding the agent never pays the ~0.00204 SOL rent from their own wallet.
 *
 * Constants and pure helpers live here so the readiness checklist and tests can import
 * them without pulling Privy in; the effectful functions import Privy lazily, exactly
 * as `src/lib/platform/wallets.ts` does.
 */
import type { Chain } from "@/server/types";

/** Below this the agent's wallet is considered dry and the platform tops it up. */
export const MIN_AGENT_SOL = 0.005;
/** What one top-up sends. Covers a few dozen swaps plus a couple of new-token ATAs. */
export const GAS_DRIP_SOL = 0.01;
/** What the platform Solana wallet should hold to be able to drip and to create ATAs. */
export const MIN_PLATFORM_SOL = 0.02;
/** Rent-exempt minimum for a token account, in SOL. */
export const ATA_RENT_SOL = 0.00203928;

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Pure: how much SOL (whole units) a wallet is short of covering an order's fees. */
export function gasShortfallSol(input: {
  balanceSol: number;
  signatureFeeLamports?: number | null;
  prioritizationFeeLamports?: number | null;
  rentFeeLamports?: number | null;
}): number {
  const need =
    ((input.signatureFeeLamports ?? 0) + (input.prioritizationFeeLamports ?? 0) + (input.rentFeeLamports ?? 0)) /
    LAMPORTS_PER_SOL;
  const short = need - Math.max(0, input.balanceSol);
  return short > 0 ? short : 0;
}

export interface EnsureGasResult {
  /** True when a drip was sent this call. */
  dripped: boolean;
  /** Transaction signature of the drip, when one was sent. */
  signature: string | null;
  /** The agent wallet's SOL after the call (best effort). */
  balanceSol: number;
}

/**
 * Make sure a live agent's Solana wallet can pay for its next Ultra order. Implemented
 * by workstream A; until then it reports the balance and never sends anything.
 *
 * Throws a `PlatformWalletError` (from `@/lib/platform/wallets`) naming the platform
 * Solana wallet and its address when a drip is needed and the platform cannot pay.
 */
export async function ensureAgentGas(_input: {
  agentId: string;
  chain: Chain;
  walletId: string;
  address: string;
  /** Lamports the pending order says the fee payer must cover. */
  requiredLamports: number;
}): Promise<EnsureGasResult> {
  throw new Error("ensureAgentGas: not implemented (W7 / workstream A)");
}

/**
 * Create the agent's USDC associated token account on Solana, paid by the platform
 * Solana wallet, if it does not exist yet. Idempotent and best-effort: returns `false`
 * (never throws) when the platform wallet cannot pay, because a user can still fund
 * the agent — they just pay the rent themselves.
 */
export async function ensureAgentUsdcAta(_input: { agentId: string; address: string }): Promise<boolean> {
  return false;
}
