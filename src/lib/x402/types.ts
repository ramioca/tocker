/**
 * Shared types for the x402 payment layer.
 *
 * Every paid data fetch in the app goes through `src/lib/x402/paidFetch.ts`, which
 * needs to know (a) which agent is paying, (b) which wallets it may pay from, and
 * (c) how much of the per-run data budget is left.
 */
import type { Chain } from "@/server/types";

/** A Privy server wallet the agent may spend from. */
export interface AgentWalletRef {
  chain: Chain;
  walletId: string;
  address: string;
}

/**
 * Mutable per-run spend budget. `runAgent` creates one of these at the start of a
 * run from `config.risk.maxDataSpendUsdPerRun` and passes it to every paid fetch,
 * which increments `spentUsd` after each payment (real or simulated).
 */
export interface RunBudget {
  maxUsd: number;
  spentUsd: number;
}

/**
 * The most one run may spend on data, whatever its config says. The builder's slider
 * stops here too. Enforced where a budget is made and again where it is spent.
 */
export const MAX_DATA_SPEND_PER_RUN_USD = 5;

function cappedMaxUsd(maxUsd: number): number {
  // Not a finite number means not a budget: nothing may be spent against it.
  return Number.isFinite(maxUsd) ? Math.min(Math.max(0, maxUsd), MAX_DATA_SPEND_PER_RUN_USD) : 0;
}

export function newBudget(maxUsd: number): RunBudget {
  return { maxUsd: cappedMaxUsd(maxUsd), spentUsd: 0 };
}

export function budgetRemaining(budget: RunBudget): number {
  // A spend that is negative or not a number never buys headroom.
  const spent = Number.isFinite(budget.spentUsd) ? Math.max(0, budget.spentUsd) : Number.POSITIVE_INFINITY;
  return Math.max(0, cappedMaxUsd(budget.maxUsd) - spent);
}

/** Everything `paidFetch` needs about the caller. */
export interface X402Context {
  agentId: string;
  runId: string | null;
  mode: "paper" | "live";
  /**
   * The agent's trading wallets.
   *
   * **Not the payer.** Since W5 every x402 payment is signed by the *platform* wallet
   * on the resource's network (`src/lib/platform/wallets.ts`); an agent no longer needs
   * a wallet on a data network at all. Kept on the context because it identifies the
   * run's agent to anything that wants it, and because the payment row is still written
   * per agent and per run.
   */
  wallets: AgentWalletRef[];
  budget: RunBudget;
}

export interface PaidRequest {
  /** Registry id of the data source (used for the `x402_payments.source_id` column). */
  sourceId: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** CAIP-2 network the registry expects this resource to be priced on. */
  network: string;
  /** Registry price hint in USD. Used for accounting in mock mode. */
  priceUsd: number | null;
  /** Payload returned (verbatim) when running in mock mode. */
  fixture: unknown;
  /**
   * How long the *free* probe may take, in ms. Defaults to `PROBE_TIMEOUT_MS` (20s).
   * Nothing has been signed while this clock runs, so giving up costs nothing.
   */
  timeoutMs?: number;
  /**
   * How long the *paid* retry may take, in ms. Floored at `MIN_PAID_TIMEOUT_MS` (25s)
   * however small a number is passed: the retry signs an authorization and waits for a
   * facilitator to settle it on-chain, and aborting that is the only abort in this
   * module that can cost real money. Raise it for a source that advertises a long
   * `maxTimeoutSeconds` and actually uses it.
   */
  paidTimeoutMs?: number;
}

export interface PaidResponse {
  /** Parsed JSON body (or `{ text }` when the service did not return JSON). */
  data: unknown;
  amountUsd: number;
  network: string;
  txHash: string | null;
  settled: boolean;
  simulated: boolean;
  /** True when the endpoint answered 200 without asking for payment. */
  free: boolean;
}

/** Thrown when a payment would exceed `risk.maxDataSpendUsdPerRun`. */
export class X402BudgetError extends Error {
  readonly priceUsd: number;
  readonly remainingUsd: number;
  constructor(priceUsd: number, remainingUsd: number) {
    super(
      `Data spend cap reached: this call costs $${priceUsd.toFixed(4)} but only $${remainingUsd.toFixed(4)} of the per-run budget is left.`,
    );
    this.name = "X402BudgetError";
    this.priceUsd = priceUsd;
    this.remainingUsd = remainingUsd;
  }
}

/**
 * A daily ceiling was reached: this owner's, or the platform's (`daily-budget.ts`). A
 * budget error like the per-run one, so every caller that already treats "out of data
 * budget" as a soft outcome treats this the same way; only the sentence differs.
 */
export class X402DailyBudgetError extends X402BudgetError {
  readonly scope: "owner" | "platform";
  constructor(priceUsd: number, scope: "owner" | "platform") {
    super(priceUsd, 0);
    this.name = "X402DailyBudgetError";
    this.scope = scope;
    this.message =
      scope === "owner"
        ? "Data spend cap reached: your agents have used today's paid-data allowance. Carry on with the free signals; it resets over the next 24 hours."
        : "Paid data is unavailable right now. Carry on with the free signals and try again later.";
  }
}

/** Thrown when a paid call cannot be made (no wallet, unsupported network, upstream error). */
export class X402RequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "X402RequestError";
    this.status = status;
  }
}

/** A payment option parsed out of a 402 response (v1 body or v2 `PAYMENT-REQUIRED` header). */
export interface ParsedPaymentOption {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  /** Atomic units, as a decimal string. */
  amount: string;
  amountUsd: number;
}

/**
 * Which of our chains, if any, a CAIP-2 network maps to.
 *
 * Deliberately narrow: the platform (and every agent) holds funds on Base and Solana
 * only. A 402 that offers BSC or Polygon (CoinMarketCap offers both) is filtered out
 * rather than signed with the Base wallet, which would produce a valid signature
 * against an empty balance.
 */
export function chainForNetwork(network: string): Chain | null {
  if (network === "solana" || network.startsWith("solana:")) return "solana";
  if (network === "base" || network === "eip155:8453") return "base";
  return null;
}
