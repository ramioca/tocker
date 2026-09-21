/**
 * The trade-execution contract. Nothing outside this directory talks to Jupiter or
 * Privy directly — the run loop only ever sees `quote()` / `execute()`.
 */
import type { Chain } from "@/server/types";
import type { AgentWalletRef } from "@/lib/x402/types";

export interface TradeRequest {
  chain: Chain;
  side: "buy" | "sell";
  /** `${chain}:${address}` of the token being bought or sold. */
  tokenId: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
  /** USD notional. Buys spend this much USDC; sells liquidate this much of the position. */
  amountUsd: number;
  /**
   * Sells only (W7): the exact token amount to send, in whole units, when the caller
   * knows it — a full exit passes the held balance so the venue never has to derive a
   * token amount from a price that has already moved. Executors MUST prefer this over
   * `amountUsd / price` when it is present, and clamp to what the wallet actually holds.
   * Ignored for buys.
   */
  amountToken?: number;
  slippageBps: number;
}

export interface Quote {
  request: TradeRequest;
  venue: "jupiter" | "privy-base" | "paper";
  /** USD price of one whole token. */
  priceUsd: number;
  /** Token amount in whole units. */
  amountToken: number;
  /** USD notional actually routed. */
  amountUsd: number;
  feeUsd: number;
  /**
   * The slippage tolerance the venue actually applied to this route, in basis points
   * (W7). On Jupiter Ultra this is Jupiter's own dynamic number, not the agent's — we
   * stopped sending `slippageBps` because doing so forfeits both dynamic slippage and
   * Ultra's gasless mode. The agent's configured number is the *ceiling* this is
   * checked against, and the receipt should print this one as the tolerance used.
   * Absent when the venue does not report one (the paper simulator).
   */
  appliedSlippageBps?: number;
  /** Venue-specific handle needed by `execute` (Jupiter requestId + tx, Privy quote, …). */
  handle: unknown;
}

export interface Fill {
  status: "filled" | "failed";
  txHash: string | null;
  priceUsd: number;
  amountToken: number;
  amountUsd: number;
  feeUsd: number;
  error?: string;
}

export interface TradeExecutor {
  readonly venue: Quote["venue"];
  readonly isPaper: boolean;
  quote(req: TradeRequest): Promise<Quote>;
  execute(quote: Quote): Promise<Fill>;
}

export interface ExecutorAgent {
  id: string;
  mode: "paper" | "live";
  wallets: AgentWalletRef[];
}

export class LiveWalletError extends Error {
  constructor(chain: Chain) {
    super(
      `Live mode needs a real Privy server wallet on ${chain}. This agent has none (or only a placeholder), so the run cannot trade.`,
    );
    this.name = "LiveWalletError";
  }
}

/** Resolves the agent's server wallet for a chain, refusing paper placeholders. */
export function liveWalletFor(agent: ExecutorAgent, chain: Chain): AgentWalletRef {
  const wallet = agent.wallets.find((w) => w.chain === chain);
  if (!wallet || wallet.walletId.startsWith("paper_") || !wallet.address) throw new LiveWalletError(chain);
  return wallet;
}

/** Paper agents always get the simulator; live agents get the real venue for the chain. */
export async function getExecutor(agent: ExecutorAgent, chain: Chain): Promise<TradeExecutor> {
  if (agent.mode === "paper") {
    const { PaperExecutor } = await import("./paper");
    return new PaperExecutor();
  }
  const wallet = liveWalletFor(agent, chain);
  if (chain === "solana") {
    const { JupiterExecutor } = await import("./jupiter");
    // The agent id is what lets the executor top its own wallet up with gas and write
    // the audit line for it (W7 B2).
    return new JupiterExecutor(wallet, agent.id);
  }
  const { BaseSwapExecutor } = await import("./base");
  return new BaseSwapExecutor(wallet);
}

/** Converts a whole-unit token amount to atomic base units as a decimal string. */
export function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const scaled = amount * 10 ** decimals;
  return BigInt(Math.round(scaled)).toString();
}

/** Converts atomic base units back to whole units. */
export function fromBaseUnits(amount: string, decimals: number): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n / 10 ** decimals : 0;
}

/**
 * Whole-unit token amount → base units, **floored**, as a decimal string.
 *
 * `BigInt` over a decimal string rather than `Math.round(amount * 10 ** decimals)`:
 * a 9-decimal token priced at `1e-7` overflows a double's exact-integer range, and
 * rounding *up* asks the venue for a unit the wallet does not hold — which is how a
 * stop loss turns into "insufficient funds" on a position that is plainly there.
 */
export function floorBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";

  // `toString()`, not `toFixed()`: the shortest round-trip decimal form is the number a
  // person typed, while `(1234.5678).toFixed(20)` exposes the binary residue
  // ("1234.56780000000003383") and would ask the venue for 33833 units nobody holds.
  let text = amount.toString();
  let exponent = 0;
  const e = text.indexOf("e");
  if (e >= 0) {
    exponent = Number(text.slice(e + 1));
    text = text.slice(0, e);
  }

  const [whole, fraction = ""] = text.split(".");
  const digits = `${whole}${fraction}`;
  // Where the decimal point sits inside `digits`, and how many digits survive the shift.
  const cut = whole.length + exponent + decimals;
  if (cut <= 0) return "0";
  return BigInt(digits.padEnd(cut, "0").slice(0, cut)).toString();
}

/**
 * Clamp a base-unit amount to what the wallet actually holds.
 *
 * `held === null` means the balance read failed, and then the request stands: refusing
 * to sell because an RPC blinked is worse than asking for a hair too much and being
 * told so by the venue.
 */
export function clampToHeld(requestedBaseUnits: string, held: bigint | null): string {
  if (held === null) return requestedBaseUnits;
  const asked = BigInt(requestedBaseUnits);
  return (asked < held ? asked : held).toString();
}

/**
 * Residual dust: a position whose remaining base units cannot be sold is closed.
 *
 * One base unit of an 18-decimal token is worth nothing and cannot route; leaving it on
 * the books means the position never closes and the guardian retries forever.
 */
export function isDustBaseUnits(remaining: bigint, decimals: number, priceUsd: number): boolean {
  if (remaining <= BigInt(0)) return true;
  if (!(priceUsd > 0)) return remaining <= BigInt(1);
  const valueUsd = (Number(remaining) / 10 ** decimals) * priceUsd;
  return valueUsd < 0.01;
}
