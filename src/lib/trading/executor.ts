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
    return new JupiterExecutor(wallet);
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
