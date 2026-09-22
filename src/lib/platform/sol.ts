/**
 * The platform Solana wallet keeps itself fuelled (W7).
 *
 * Every Solana network fee in this product is paid by one wallet: the operator's
 * funding transfer (their embedded wallet holds USDC and no SOL), the SOL drips that
 * let an agent open a token account, withdrawals, fee sweeps. When that wallet ran
 * dry — 0.0015 SOL after a day of drips — a new agent's $50 funding failed at creation
 * and the live checklist lit two red steps that were one problem, and the only fix on
 * offer was "send SOL to this address". Nobody should have to think about SOL.
 *
 * So the wallet converts a little of its own USDC to SOL whenever it is short, through
 * the same Jupiter Ultra path the agents trade on. USDC is the only asset anyone funds
 * with; SOL for fees is an implementation detail this module owns. Called before a
 * sponsored funding transfer, before a gas drip, from the marks tick as maintenance,
 * and from the live checklist when it finds the wallet short.
 */
import { getPriceUsd } from "@/lib/trading/prices";
import { JupiterExecutor } from "@/lib/trading/jupiter";
import { SOL_MINT } from "@/lib/trading/tokens";
import type { TradeRequest } from "@/lib/trading/executor";
import { MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { getPlatformWallet, readPlatformBalance, resetPlatformBalanceCache } from "./wallets";

/** Where a refuel tops the wallet up to: a few dozen fees and drips before the next one. */
export const TARGET_PLATFORM_SOL = 0.05;
/** USDC the wallet keeps for paid data reads — a refuel never spends into this. */
export const PLATFORM_USDC_RESERVE = 2;
/** Below this the swap is not worth its own fee. */
export const MIN_REFUEL_USDC = 1;
/** One refuel attempt per process per minute, however many callers ask. */
const THROTTLE_MS = 60_000;

export interface RefuelPlan {
  refuel: boolean;
  /** USDC to convert, in dollars. Zero when `refuel` is false. */
  usdc: number;
  /** Why nothing (or this much) happens — surfaced to the operator when it matters. */
  reason: string;
}

/**
 * Pure: whether and how much to convert. Tops up to the target, priced with a 2%
 * cushion for slippage and Jupiter's fee, never past what the wallet holds minus the
 * data reserve, never under the minimum that is worth a swap.
 */
export function planPlatformRefuel(input: {
  sol: number | null;
  usdc: number | null;
  solPriceUsd: number | null;
  minSol?: number;
  targetSol?: number;
  reserveUsdc?: number;
}): RefuelPlan {
  const minSol = input.minSol ?? MIN_PLATFORM_SOL;
  const targetSol = input.targetSol ?? TARGET_PLATFORM_SOL;
  const reserve = input.reserveUsdc ?? PLATFORM_USDC_RESERVE;
  if (input.sol === null) return { refuel: false, usdc: 0, reason: "the wallet's SOL balance could not be read" };
  if (input.sol >= minSol) return { refuel: false, usdc: 0, reason: `holds ${input.sol.toFixed(4)} SOL, above the ${minSol} SOL floor` };
  if (input.usdc === null) return { refuel: false, usdc: 0, reason: "the wallet's USDC balance could not be read" };
  if (input.solPriceUsd === null || !(input.solPriceUsd > 0)) {
    return { refuel: false, usdc: 0, reason: "no SOL price to size the conversion" };
  }
  const spendable = input.usdc - reserve;
  const wanted = (targetSol - input.sol) * input.solPriceUsd * 1.02;
  const usdc = Math.floor(Math.min(spendable, wanted) * 100) / 100;
  if (usdc < MIN_REFUEL_USDC) {
    return {
      refuel: false,
      usdc: 0,
      reason: `holds ${input.usdc.toFixed(2)} USDC, and ${reserve.toFixed(2)} of that is kept for paid data reads — send USDC or SOL to refuel`,
    };
  }
  return { refuel: true, usdc, reason: `converting $${usdc.toFixed(2)} of USDC to SOL` };
}

export interface RefuelResult {
  refueled: boolean;
  reason: string;
  usdc?: number;
  sol?: number;
  txHash?: string | null;
}

let lastAttemptAt = 0;
let inFlight: Promise<RefuelResult> | null = null;

/**
 * Make sure the platform Solana wallet holds at least {@link MIN_PLATFORM_SOL}, converting
 * its own USDC when it does not. Never throws; concurrent callers share one attempt and
 * a second attempt within a minute is skipped. `why` names the caller for the log line.
 */
export function ensurePlatformSol(why: string): Promise<RefuelResult> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (now - lastAttemptAt < THROTTLE_MS) {
    return Promise.resolve({ refueled: false, reason: "a refuel was attempted less than a minute ago" });
  }
  lastAttemptAt = now;
  inFlight = refuel(why).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function refuel(why: string): Promise<RefuelResult> {
  try {
    const wallet = await getPlatformWallet("solana");
    if (!wallet) return { refueled: false, reason: "the platform Solana wallet has not been created yet" };
    const reading = await readPlatformBalance(wallet);
    const solPriceUsd = await getPriceUsd("solana", SOL_MINT).catch(() => null);
    const plan = planPlatformRefuel({ sol: reading.native, usdc: reading.usdc, solPriceUsd });
    if (!plan.refuel) return { refueled: false, reason: plan.reason };

    console.warn(`[platform] refuelling the Solana wallet for ${why}: ${plan.reason} (held ${reading.native?.toFixed(4)} SOL)`);
    // No agent id: this executor must not try to drip gas to itself. With under 0.01 SOL
    // in the taker, Ultra goes gasless and Jupiter pays the signature.
    const executor = new JupiterExecutor({ chain: "solana", walletId: wallet.walletId, address: wallet.address });
    const request: TradeRequest = {
      chain: "solana",
      side: "buy",
      tokenId: `solana:${SOL_MINT}`,
      tokenAddress: SOL_MINT,
      symbol: "SOL",
      decimals: 9,
      amountUsd: plan.usdc,
      slippageBps: 100,
    };
    const quote = await executor.quote(request);
    const fill = await executor.execute(quote);
    resetPlatformBalanceCache();
    if (fill.status !== "filled") {
      console.warn(`[platform] refuel did not fill: ${fill.error ?? "unknown"}`);
      return { refueled: false, reason: `the USDC→SOL conversion did not fill: ${fill.error ?? "unknown"}`, txHash: fill.txHash };
    }
    console.warn(`[platform] refuelled: $${fill.amountUsd.toFixed(2)} → ${fill.amountToken.toFixed(4)} SOL (${fill.txHash ?? "no hash"})`);
    return { refueled: true, reason: plan.reason, usdc: fill.amountUsd, sol: fill.amountToken, txHash: fill.txHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[platform] refuel failed: ${message}`);
    return { refueled: false, reason: `the USDC→SOL conversion failed: ${message}` };
  }
}

/** Test seam: forget the throttle. */
export function resetPlatformRefuelThrottle(): void {
  lastAttemptAt = 0;
  inFlight = null;
}
