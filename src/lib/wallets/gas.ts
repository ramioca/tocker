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

/** CAIP-2 id of Solana mainnet-beta, as Privy's RPC endpoint wants it. */
export const CAIP2_SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

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

export interface GasDripPlan {
  /** Whether the platform should send SOL before this order is signed. */
  drip: boolean;
  /** How much to send, in whole SOL. Zero when `drip` is false. */
  amountSol: number;
  /** What the wallet is short by, for the log line and the error message. */
  shortfallSol: number;
}

/**
 * Pure: the drip decision for one pending order.
 *
 * A drip covers the shortfall *plus* a cushion, and never sends less than
 * {@link GAS_DRIP_SOL} — a wallet topped up to exactly the next fee is a wallet that
 * comes back here on the next trade, and every drip costs a signature of its own.
 *
 * Rounded up to whole lamports so the number we send is the number that arrives.
 */
export function gasDripPlan(input: {
  balanceSol: number;
  /** The three fee fields added up, when the caller already has the total. */
  requiredLamports?: number;
  signatureFeeLamports?: number | null;
  prioritizationFeeLamports?: number | null;
  rentFeeLamports?: number | null;
}): GasDripPlan {
  const shortfallSol =
    input.requiredLamports === undefined
      ? gasShortfallSol(input)
      : gasShortfallSol({ balanceSol: input.balanceSol, signatureFeeLamports: input.requiredLamports });
  if (shortfallSol <= 0) return { drip: false, amountSol: 0, shortfallSol: 0 };
  const wanted = Math.max(GAS_DRIP_SOL, shortfallSol + MIN_AGENT_SOL);
  const amountSol = Math.ceil(wanted * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL;
  return { drip: true, amountSol, shortfallSol };
}

export interface EnsureGasResult {
  /** True when a drip was sent this call. */
  dripped: boolean;
  /** Transaction signature of the drip, when one was sent. */
  signature: string | null;
  /** The agent wallet's SOL after the call (best effort). */
  balanceSol: number;
}

export interface EnsureGasInput {
  agentId: string;
  chain: Chain;
  walletId: string;
  address: string;
  /** Lamports the pending order says the fee payer must cover. */
  requiredLamports: number;
}

/**
 * Make sure a live agent's Solana wallet can pay for its next Ultra order.
 *
 * Reads the wallet's SOL from `SOLANA_RPC_URL`, and if it cannot cover
 * `requiredLamports`, sends a drip from the platform Solana wallet as a raw
 * `SystemProgram.transfer`, waits for it to confirm, and writes an audit line.
 *
 * Throws a {@link import("@/lib/platform/wallets").PlatformWalletError} naming the
 * platform Solana wallet and its address when a drip is needed and the platform cannot
 * pay — that message is what the operator has to read to fix it.
 */
export async function ensureAgentGas(input: EnsureGasInput): Promise<EnsureGasResult> {
  if (input.chain !== "solana") {
    throw new Error(`ensureAgentGas only covers Solana; asked for ${input.chain}.`);
  }
  const { PlatformWalletError, ensurePlatformWallet } = await import("@/lib/platform/wallets");
  const { confirmSignature, getSolBalance } = await import("./solana-rpc");

  let balanceSol = 0;
  try {
    balanceSol = await getSolBalance(input.address);
  } catch (err) {
    // An unreadable balance must not be read as zero — that would drip on every trade.
    // Treat it as "cannot decide", and let the order proceed as Jupiter priced it.
    console.warn(
      `[gas] could not read SOL for ${input.address}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { dripped: false, signature: null, balanceSol: 0 };
  }

  const plan = gasDripPlan({ balanceSol, requiredLamports: input.requiredLamports });
  if (!plan.drip) return { dripped: false, signature: null, balanceSol };

  const platform = await ensurePlatformWallet("solana");
  const platformSol = await getSolBalance(platform.address).catch(() => 0);
  if (platformSol < plan.amountSol + 0.000_01) {
    throw new PlatformWalletError(
      `The agent's Solana wallet holds ${balanceSol.toFixed(6)} SOL and this trade needs ${(
        input.requiredLamports / LAMPORTS_PER_SOL
      ).toFixed(6)} SOL, but the platform Solana wallet (${platform.address}) holds only ${platformSol.toFixed(
        6,
      )} SOL and cannot top it up. Send at least ${MIN_PLATFORM_SOL} SOL to that address.`,
      "solana",
      platform.address,
    );
  }

  const { buildSolanaTransfer } = await import("./solana-transfer");
  const { privy, authorizationContext } = await import("@/lib/privy");
  const { solanaRpcUrl } = await import("./solana-rpc");

  const transaction = await buildSolanaTransfer({
    from: platform.address,
    to: input.address,
    asset: "native",
    amount: plan.amountSol,
    rpcUrl: solanaRpcUrl(),
  });

  const sent = await privy()
    .wallets()
    .solana()
    .signAndSendTransaction(platform.walletId, {
      caip2: CAIP2_SOLANA_MAINNET,
      transaction,
      authorization_context: authorizationContext(),
    });

  const signature = sent.hash;
  const status = await confirmSignature(signature, { timeoutMs: 20_000 });
  if (status !== "confirmed") {
    throw new PlatformWalletError(
      `The gas top-up to the agent's Solana wallet (${signature}) ${
        status === "failed" ? "failed on chain" : "did not confirm within 20 seconds"
      }. The trade was not signed.`,
      "solana",
      platform.address,
    );
  }

  const after = await getSolBalance(input.address).catch(() => balanceSol + plan.amountSol);
  await auditDrip(input, plan, platform.address, signature);
  return { dripped: true, signature, balanceSol: after };
}

/** One audit line per drip: whose agent, how much, from where, and the signature. */
async function auditDrip(
  input: EnsureGasInput,
  plan: GasDripPlan,
  platformAddress: string,
  signature: string,
): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    const { agents, getDb } = await import("@/db");
    const db = await getDb();
    const [agent] = await db
      .select({ ownerId: agents.ownerId, name: agents.name })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) return;

    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({
      userId: agent.ownerId,
      // Borrowing the nearest honest existing kind: the audit enum belongs to another
      // workstream's schema block, and a gas top-up is a wallet-funding event.
      kind: "budget_change",
      agentId: input.agentId,
      agentName: agent.name,
      summary: `Tocker sent ${plan.amountSol} SOL of gas to this agent's Solana wallet so it could pay for its next trade.`,
      metadata: {
        reason: "gas_drip",
        chain: "solana",
        amountSol: plan.amountSol,
        shortfallSol: plan.shortfallSol,
        toAddress: input.address,
        fromAddress: platformAddress,
        signature,
      },
    });
  } catch {
    // Audit is a record, not a gate: a failure here must not undo a confirmed transfer.
  }
}

/**
 * Create the agent's USDC associated token account on Solana, paid by the platform
 * Solana wallet, if it does not exist yet. Idempotent and best-effort: returns `false`
 * (never throws) when the platform wallet cannot pay, because a user can still fund
 * the agent — they just pay the rent themselves.
 */
export async function ensureAgentUsdcAta(input: { agentId: string; address: string }): Promise<boolean> {
  try {
    const { isPrivyConfigured } = await import("@/lib/privy");
    if (!isPrivyConfigured()) return false;
    if (!input.address || input.address.startsWith("PAPER")) return false;

    const { PublicKey } = await import("@solana/web3.js");
    const { associatedTokenAddress, SOLANA_USDC_MINT } = await import("./solana-transfer");
    const ata = associatedTokenAddress(new PublicKey(input.address), SOLANA_USDC_MINT).toBase58();

    const { accountExists, confirmSignature, getSolBalance, solanaRpcUrl } = await import("./solana-rpc");
    if (await accountExists(ata)) return true;

    const { ensurePlatformWallet } = await import("@/lib/platform/wallets");
    const platform = await ensurePlatformWallet("solana");
    const platformSol = await getSolBalance(platform.address).catch(() => 0);
    if (platformSol < ATA_RENT_SOL + 0.000_01) {
      console.warn(
        `[gas] platform Solana wallet ${platform.address} holds ${platformSol} SOL — not enough to pre-create the USDC account for agent ${input.agentId}. The funder will pay the rent instead.`,
      );
      return false;
    }

    const { buildCreateUsdcAtaTransaction } = await import("./solana-transfer");
    const { privy, authorizationContext } = await import("@/lib/privy");
    const transaction = await buildCreateUsdcAtaTransaction({
      payer: platform.address,
      owner: input.address,
      rpcUrl: solanaRpcUrl(),
    });
    const sent = await privy()
      .wallets()
      .solana()
      .signAndSendTransaction(platform.walletId, {
        caip2: CAIP2_SOLANA_MAINNET,
        transaction,
        authorization_context: authorizationContext(),
      });
    const status = await confirmSignature(sent.hash, { timeoutMs: 15_000 });
    return status === "confirmed";
  } catch (err) {
    console.warn(
      `[gas] could not pre-create the USDC account for agent ${input.agentId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
