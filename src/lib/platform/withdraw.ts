/**
 * How much an admin may take out of a platform wallet, and why not more.
 *
 * Pure, and deliberately import-free (types aside): the admin withdraw form runs this in
 * the browser to size "Max" and to explain a refusal, and the server action runs the
 * same function against a fresh balance read before anything is signed. Importing
 * `../wallets/gas` for `MIN_PLATFORM_SOL` would pull its lazy Privy imports into the
 * client bundle, so the number is repeated here and a test pins the two together.
 *
 * The only hard floor is **SOL on the Solana wallet**. That wallet is the fee payer for
 * every operator's funding transfer and the gas drip behind every agent withdrawal and
 * fee sweep on Solana, so emptying it stops money moving on that chain for everyone.
 * USDC has no floor — retiring a wallet is a legitimate reason to drain it — but the
 * form says out loud what a low remainder breaks (every source priced on that chain
 * answers 402) before the admin confirms. ETH on Base has no floor either: Privy
 * sponsors gas there, so the wallet never spends its own.
 */
import type { Chain } from "@/server/types";

/** SOL the platform Solana wallet keeps. Mirrors `MIN_PLATFORM_SOL` in `src/lib/wallets/gas.ts`. */
export const PLATFORM_SOL_FLOOR = 0.02;
/**
 * SOL a withdrawal out of the Solana wallet pays for itself: the signature, and the
 * destination's USDC token-account rent (~0.00204 SOL) when it has none yet. Rounded
 * up, because under-reserving fails the transfer and over-reserving costs nothing.
 */
export const PLATFORM_SOL_SEND_COST = 0.003;
/** Below this, a USDC remainder is called out on review. Matches the refuel reserve in `./sol.ts`. */
export const PLATFORM_USDC_LOW = 2;
/** Solana refuses to credit a fresh account with less than its rent-exempt minimum. */
const MIN_SOL_SEND = 0.001;

export type PlatformAsset = "usdc" | "native";

export interface PlatformBalances {
  /** `null` when the balance could not be read — never treated as zero. */
  usdc: number | null;
  native: number | null;
}

/** Decimal places an amount is floored to, per asset. USDC has 6; SOL and ETH are shown to 6 as well. */
const DISPLAY_DECIMALS = 6;

function floorTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(value * f + 1e-9) / f;
}

/**
 * The most that can leave this wallet as `asset`, or `null` when the balance it depends
 * on could not be read. Never negative.
 */
export function platformWithdrawable(chain: Chain, asset: PlatformAsset, balances: PlatformBalances): number | null {
  if (asset === "usdc") {
    if (balances.usdc === null) return null;
    return Math.max(0, floorTo(balances.usdc, DISPLAY_DECIMALS));
  }
  if (balances.native === null) return null;
  const kept = chain === "solana" ? PLATFORM_SOL_FLOOR + PLATFORM_SOL_SEND_COST : 0;
  return Math.max(0, floorTo(balances.native - kept, DISPLAY_DECIMALS));
}

/**
 * Why this withdrawal cannot go ahead, in one sentence, or `null` when it can. The
 * destination address is checked separately (`addressProblemForChain`).
 */
export function platformWithdrawProblem(input: {
  chain: Chain;
  asset: PlatformAsset;
  amount: number;
  balances: PlatformBalances;
}): string | null {
  const { chain, asset, amount, balances } = input;
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";

  const symbol = asset === "usdc" ? "USDC" : chain === "solana" ? "SOL" : "ETH";
  const max = platformWithdrawable(chain, asset, balances);
  if (max === null) {
    return `The platform ${chain} wallet's ${symbol} balance could not be read, so nothing will be sent. Try again in a minute.`;
  }

  if (chain === "solana") {
    if (balances.native === null) {
      return "The platform Solana wallet's SOL balance could not be read, and the transfer's fee is paid from it. Try again in a minute.";
    }
    if (asset === "native" && amount < MIN_SOL_SEND) {
      return `Send at least ${MIN_SOL_SEND} SOL. Solana refuses less than that to a new wallet.`;
    }
    if (asset === "usdc" && balances.native < PLATFORM_SOL_SEND_COST) {
      return `The platform Solana wallet needs at least ${PLATFORM_SOL_SEND_COST} SOL to pay for this transfer. Send it SOL first.`;
    }
  }

  if (amount > max + 1e-9) {
    if (asset === "native" && chain === "solana") {
      return `At most ${max} SOL can leave: the wallet keeps ${PLATFORM_SOL_FLOOR} SOL to pay every Solana fee, plus ${PLATFORM_SOL_SEND_COST} SOL for this transfer.`;
    }
    return `More than the wallet holds (${max} ${symbol}).`;
  }
  return null;
}

/**
 * What the review step should warn about, or `null`. Not a refusal: draining USDC is
 * allowed, it just stops data on that chain until the wallet is topped up again.
 */
export function platformWithdrawWarning(input: {
  chain: Chain;
  asset: PlatformAsset;
  amount: number;
  balances: PlatformBalances;
}): string | null {
  const { chain, asset, amount, balances } = input;
  if (asset !== "usdc" || balances.usdc === null) return null;
  const left = floorTo(Math.max(0, balances.usdc - amount), DISPLAY_DECIMALS);
  if (left <= 0) {
    return `This empties the wallet's USDC. Every data source priced on ${chain} will answer 402 until it is topped up${
      chain === "solana" ? ", and the wallet can no longer buy itself SOL" : ""
    }.`;
  }
  if (left < PLATFORM_USDC_LOW) {
    return `Leaves ${left} USDC. Data priced on ${chain} starts failing once that runs out${
      chain === "solana" ? ", and the wallet stops buying itself SOL below $" + PLATFORM_USDC_LOW : ""
    }.`;
  }
  return null;
}
