/**
 * Unified cash + funding math.
 *
 * Pure, dependency-free, and shared by the server (API route, actions) and the
 * client (wallet chip, deposit sheet, builder funding step). Deliberately NOT
 * exported from `src/lib/wallets/index.ts`, which is `server-only`.
 *
 * The product idea in one line: a user has *one* balance — USDC — and the chain
 * it happens to sit on is an implementation detail we show on expand. Native
 * assets (ETH on Base, SOL on Solana) are not cash; they are gas.
 *
 * There is no bridging in v1. An onramp lands on one chain and stays there, so
 * every number below is per-chain underneath the single total. (A later step is
 * Circle CCTP to move USDC between Base and Solana; until then "unified" means
 * unified *presentation*, and funding an agent on a chain needs USDC on that
 * chain.)
 */
import type { Chain, WalletBalance } from "@/server/types";

export const CHAINS: readonly Chain[] = ["base", "solana"] as const;

export const USDC_DECIMALS = 6;
export const NATIVE_SYMBOL: Record<Chain, "ETH" | "SOL"> = { base: "ETH", solana: "SOL" };
export const NATIVE_DECIMALS: Record<Chain, number> = { base: 18, solana: 9 };

export const USDC_MINT: Record<Chain, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

/** The exact words a person needs before they send money to an address. */
export const NETWORK_WORDING: Record<Chain, { network: string; asset: string; warning: string }> = {
  base: {
    network: "Base (Ethereum L2, chain id 8453)",
    asset: "USDC — the native Circle token, not USDbC",
    warning: "Anything sent on Ethereum mainnet, Arbitrum or any other network is lost.",
  },
  solana: {
    network: "Solana mainnet",
    asset: "USDC — the SPL token EPjFWdd5…TDt1v",
    warning: "Anything sent on another network, or any other SPL token, is lost.",
  },
};

// ------------------------------------------------------------------ amounts

export const MIN_FUND_USD = 5;
export const DEFAULT_FUND_USD = 10;
export const FUND_PRESETS = [10, 25, 50, 100] as const;

/**
 * Somebody other than the user pays the network fee on a funding transfer, so funding
 * never sends native tokens and never blocks on them. The gas fields below survive for
 * the types and for the day this flips back; with it on, every leg's `native` is 0 and
 * `chain-short-native` never fires.
 *
 * **Who "somebody" is differs by chain, and that matters.**
 *
 *  - **Solana: Tocker's own platform wallet pays it.** It is the fee payer on the
 *    transaction (`prepareSponsoredFunding` builds it with `payerKey` set to that
 *    wallet, the user signs, the server co-signs and broadcasts), and it pays the rent
 *    on the agent's USDC account too. Nothing in Privy's dashboard is involved, so this
 *    is checkable ahead of time — and it is checked, both by the live-readiness gas step
 *    and by `prepareSponsoredFunding` itself, which refuses with a sentence naming the
 *    platform wallet and the SOL it is short of rather than letting a signature fail.
 *  - **Base: Privy sponsors it**, via `sponsor: true` on `sendTransaction`. That still
 *    depends on **fee sponsorship being enabled for this app in the Privy dashboard**,
 *    which no client can check ahead of time: the only signal is the signature failing
 *    with a message about the TEE stack. That case (and a dry wallet with sponsorship
 *    off) becomes {@link gasBlockerFor} at the point of failure, so the user is told
 *    what to deposit rather than shown a raw SDK error.
 */
export const GAS_SPONSORED = true;

/** What a Solana wallet needs to pay for one transfer itself: fee plus a little slack. */
export const SELF_PAID_FEE_NATIVE: Record<Chain, number> = { base: 0.0005, solana: 0.01 };

/** A tank, not a budget: enough gas for a few dozen trades — only used when gas is not sponsored. */
export const DEFAULT_GAS_USD = 1;
export const MAX_GAS_USD = 25;

/**
 * Only used to *describe* a gas allowance when the user holds none of that asset,
 * so Privy quotes no USD value and we cannot derive a price from their balance.
 * Never used for anything that moves money — the transfer is in native units.
 */
export const FALLBACK_NATIVE_USD: Record<Chain, number> = { base: 3_000, solana: 150 };

export function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Floor, not round: never offer to spend a cent the user does not have. */
export function floorTo(value: number, digits: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const factor = 10 ** digits;
  return Math.floor(value * factor) / factor;
}

// -------------------------------------------------------------- unified cash

export interface ChainCash {
  chain: Chain;
  address: string | null;
  walletId: string | null;
  /** Human USDC units held on this chain. */
  usdc: number;
  /** USD value of that USDC. A dollar is a dollar, so this is face value unless Privy disagrees. */
  usdcUsd: number;
  /** Human native units (ETH / SOL). */
  native: number;
  nativeUsd: number | null;
  /** Derived from the user's own balance when both sides are known; null otherwise. */
  nativePriceUsd: number | null;
}

/** USDC one of the user's live agents holds in its own wallet, net of fees it owes. */
export interface AgentCash {
  id: string;
  slug: string;
  name: string;
  usdcUsd: number;
}

export interface UnifiedCash {
  /** USDC across the user's own embedded wallets, in dollars — what they can deposit into an agent. */
  totalUsd: number;
  /** Native assets, in dollars, shown small and separately. Never counted as cash. */
  gasUsd: number;
  perChain: ChainCash[];
  /** USDC sitting in the user's live agents' wallets, in dollars. Theirs, but working. */
  inAgentsUsd: number;
  agents: AgentCash[];
  /** Own wallets plus agents: the number the top bar shows. */
  allUsd: number;
}

function balanceOf(wallet: WalletBalance, asset: string) {
  return wallet.balances.find((b) => b.asset.toLowerCase() === asset);
}

export function readChainCash(wallet: WalletBalance): ChainCash {
  const usdcBal = balanceOf(wallet, "usdc");
  const nativeBal = balanceOf(wallet, NATIVE_SYMBOL[wallet.chain].toLowerCase());
  const usdc = usdcBal?.amount ?? 0;
  const native = nativeBal?.amount ?? 0;
  const nativeUsd = nativeBal?.usd ?? null;
  return {
    chain: wallet.chain,
    address: wallet.address,
    walletId: wallet.walletId,
    usdc,
    // USDC is a dollar; fall back to face value when Privy omits the quote.
    usdcUsd: usdcBal ? (usdcBal.usd ?? usdcBal.amount) : 0,
    native,
    nativeUsd,
    nativePriceUsd: nativeUsd !== null && native > 0 ? nativeUsd / native : null,
  };
}

export function emptyChainCash(chain: Chain): ChainCash {
  return {
    chain,
    address: null,
    walletId: null,
    usdc: 0,
    usdcUsd: 0,
    native: 0,
    nativeUsd: null,
    nativePriceUsd: null,
  };
}

/**
 * Collapse every embedded wallet into one cash number plus a per-chain
 * breakdown. Chains the user has no wallet for still appear, at zero — a
 * missing row reads as a bug, a zero row reads as "deposit here".
 */
export function unifiedCash(wallets: WalletBalance[], agents: AgentCash[] = []): UnifiedCash {
  const perChain = CHAINS.map((chain) => {
    const wallet = wallets.find((w) => w.chain === chain);
    return wallet ? readChainCash(wallet) : emptyChainCash(chain);
  });
  const totalUsd = round(perChain.reduce((sum, c) => sum + c.usdcUsd, 0), 2);
  const inAgentsUsd = round(agents.reduce((sum, a) => sum + a.usdcUsd, 0), 2);
  return {
    totalUsd,
    gasUsd: round(perChain.reduce((sum, c) => sum + (c.nativeUsd ?? 0), 0), 2),
    perChain,
    inAgentsUsd,
    agents,
    allUsd: round(totalUsd + inAgentsUsd, 2),
  };
}

export function cashOn(cash: UnifiedCash, chain: Chain): ChainCash {
  return cash.perChain.find((c) => c.chain === chain) ?? emptyChainCash(chain);
}

/**
 * Which chain a Deposit button should open on.
 *
 * The chain the user already keeps cash on, because that is almost always where the
 * next deposit is going too. Defaulting to Base regardless meant a Solana-only user
 * opened the sheet on the wrong network every single time — and picking the wrong
 * network on a deposit is the one mistake in this product that loses the money.
 *
 * Ties (including "nothing anywhere") go to Solana: it is the cheaper chain, and it is
 * where the agent actually trades.
 */
export function preferredDepositChain(cash: UnifiedCash | undefined): Chain {
  if (!cash) return "solana";
  const base = cashOn(cash, "base").usdc;
  const solana = cashOn(cash, "solana").usdc;
  return base > solana ? "base" : "solana";
}

/** Price we will quote gas at: the user's own balance if we can see it, else a stale constant. */
export function nativePriceFor(cash: UnifiedCash, chain: Chain): { price: number; derived: boolean } {
  const price = cashOn(cash, chain).nativePriceUsd;
  return price && price > 0
    ? { price, derived: true }
    : { price: FALLBACK_NATIVE_USD[chain], derived: false };
}

/**
 * Native units for a dollar allowance. Kept to 6 significant-ish digits so the
 * number a user sees is the number that gets transferred.
 */
export function gasAllowanceNative(usd: number, price: number): number {
  if (!(usd > 0) || !(price > 0)) return 0;
  return round(usd / price, 6);
}

// ------------------------------------------------------------------- splits

export interface SplitLeg {
  chain: Chain;
  amount: number;
}

/**
 * Split `amountUsd` across chains in proportion to `weights`, to the cent.
 *
 * Rounding remainder goes to the heaviest chain, so the legs always add up to
 * exactly the amount the user typed. With no weight anywhere (a user with zero
 * everywhere, previewing) it splits evenly — the UI blocks that case anyway.
 */
export function splitProportional(amountUsd: number, weights: Array<{ chain: Chain; weight: number }>): SplitLeg[] {
  if (weights.length === 0 || !(amountUsd > 0)) return weights.map((w) => ({ chain: w.chain, amount: 0 }));
  if (weights.length === 1) return [{ chain: weights[0].chain, amount: round(amountUsd, 2) }];

  const total = weights.reduce((sum, w) => sum + Math.max(0, w.weight), 0);
  const even = amountUsd / weights.length;
  const legs = weights.map((w) => ({
    chain: w.chain,
    amount: total > 0 ? floorTo((amountUsd * Math.max(0, w.weight)) / total, 2) : floorTo(even, 2),
  }));

  const assigned = legs.reduce((sum, leg) => sum + leg.amount, 0);
  const remainder = round(amountUsd - assigned, 2);
  if (remainder !== 0) {
    let heaviest = 0;
    for (let i = 1; i < weights.length; i += 1) {
      if (Math.max(0, weights[i].weight) > Math.max(0, weights[heaviest].weight)) heaviest = i;
    }
    legs[heaviest].amount = round(legs[heaviest].amount + remainder, 2);
  }
  return legs;
}

// -------------------------------------------------------------------- plan

export type BlockerKind =
  | "no-chains"
  | "below-minimum"
  | "over-available"
  | "no-wallet"
  | "chain-short-usdc"
  | "chain-short-native";

export interface FundingBlocker {
  kind: BlockerKind;
  chain: Chain | null;
  /** One sentence, written for the person who has to fix it. */
  message: string;
  /** When set, the step shows a "Deposit … on <chain>" button that opens the deposit sheet. */
  deposit: { chain: Chain; asset: "usdc" | "native" } | null;
}

export interface FundingLeg {
  chain: Chain;
  /** Human USDC units to send from the user's embedded wallet to the agent wallet. */
  usdc: number;
  /** Human native units to send as gas. */
  native: number;
  /** What that gas is worth, at the price we quoted it. */
  nativeUsd: number;
  nativePriceDerived: boolean;
}

export interface FundingPlan {
  /** `true` when the user chose paper — there is nothing to transfer. */
  paper: boolean;
  legs: FundingLeg[];
  totalUsdc: number;
  totalGasUsd: number;
  blockers: FundingBlocker[];
  /** Safe to create-and-fund. A paper plan is always ready. */
  ready: boolean;
}

export interface FundingRequest {
  mode: "paper" | "fund";
  /** Total USDC the agent should end up with, in dollars. */
  amountUsd: number;
  /** Dollar value of gas to send per funded chain. */
  gasUsd: number;
  chains: Chain[];
  cash: UnifiedCash;
  /**
   * Explicit per-chain USDC amounts, when the user has dragged the split.
   * Missing chains fall back to proportional.
   */
  split?: Partial<Record<Chain, number>>;
}

const chainName: Record<Chain, string> = { base: "Base", solana: "Solana" };

/** Default split: proportional to what the user actually holds on each chain. */
export function defaultSplit(amountUsd: number, chains: Chain[], cash: UnifiedCash): SplitLeg[] {
  return splitProportional(
    amountUsd,
    chains.map((chain) => ({ chain, weight: cashOn(cash, chain).usdc })),
  );
}

/**
 * Everything the funding step needs to render: the transfers to make, and the
 * exact reasons it cannot. Never silently funds less than asked — a shortfall
 * is a blocker with a deposit CTA, not a quietly smaller number.
 */
export function planFunding(request: FundingRequest): FundingPlan {
  const { mode, chains, cash } = request;
  if (mode === "paper") {
    return { paper: true, legs: [], totalUsdc: 0, totalGasUsd: 0, blockers: [], ready: true };
  }

  const blockers: FundingBlocker[] = [];
  const amountUsd = round(request.amountUsd, 2);
  const gasUsd = GAS_SPONSORED ? 0 : round(request.gasUsd, 2);

  if (chains.length === 0) {
    blockers.push({
      kind: "no-chains",
      chain: null,
      message: "Pick at least one chain in Universe before you fund it.",
      deposit: null,
    });
    return { paper: false, legs: [], totalUsdc: 0, totalGasUsd: 0, blockers, ready: false };
  }

  if (!(amountUsd >= MIN_FUND_USD)) {
    blockers.push({
      kind: "below-minimum",
      chain: null,
      message: `Fund at least $${MIN_FUND_USD}. Below that, fees and slippage eat the position before the strategy gets a say.`,
      deposit: null,
    });
  }

  const availableOnChains = round(
    chains.reduce((sum, chain) => sum + cashOn(cash, chain).usdc, 0),
    2,
  );
  if (amountUsd > availableOnChains) {
    blockers.push({
      kind: "over-available",
      chain: null,
      message: `You have $${availableOnChains.toFixed(2)} of USDC on ${chains
        .map((c) => chainName[c])
        .join(" and ")}. Deposit more, or fund less.`,
      deposit: { chain: chains[0], asset: "usdc" },
    });
  }

  const proportional = defaultSplit(amountUsd, chains, cash);
  const legs: FundingLeg[] = chains.map((chain) => {
    const override = request.split?.[chain];
    const usdc = round(
      override !== undefined && Number.isFinite(override)
        ? Math.max(0, override)
        : (proportional.find((l) => l.chain === chain)?.amount ?? 0),
      2,
    );
    const { price, derived } = nativePriceFor(cash, chain);
    const native = gasAllowanceNative(gasUsd, price);
    return { chain, usdc, native, nativeUsd: gasUsd, nativePriceDerived: derived };
  });

  for (const leg of legs) {
    const chainCash = cashOn(cash, leg.chain);
    if (!chainCash.address) {
      blockers.push({
        kind: "no-wallet",
        chain: leg.chain,
        message: `You have no ${chainName[leg.chain]} wallet yet. Sync your wallets from the deposit sheet and try again.`,
        deposit: { chain: leg.chain, asset: "usdc" },
      });
      continue;
    }
    if (leg.usdc > chainCash.usdc + 1e-9) {
      blockers.push({
        kind: "chain-short-usdc",
        chain: leg.chain,
        message: `This split needs $${leg.usdc.toFixed(2)} of USDC on ${chainName[leg.chain]} and you have $${chainCash.usdc.toFixed(2)}.`,
        deposit: { chain: leg.chain, asset: "usdc" },
      });
    }
    if (leg.native > 0 && leg.native > chainCash.native + 1e-12) {
      blockers.push({
        kind: "chain-short-native",
        chain: leg.chain,
        message: `The agent needs ${NATIVE_SYMBOL[leg.chain]} on ${chainName[leg.chain]} to sign its own trades, and you have ${chainCash.native} ${NATIVE_SYMBOL[leg.chain]}.`,
        deposit: { chain: leg.chain, asset: "native" },
      });
    }
  }

  const totalUsdc = round(legs.reduce((sum, leg) => sum + leg.usdc, 0), 2);
  const fundedChains = legs.filter((leg) => leg.usdc > 0 || leg.native > 0).length;

  if (blockers.length === 0 && totalUsdc !== amountUsd) {
    blockers.push({
      kind: "over-available",
      chain: null,
      message: `The split adds up to $${totalUsdc.toFixed(2)}, not $${amountUsd.toFixed(2)}. Adjust it so the two agree.`,
      deposit: null,
    });
  }

  return {
    paper: false,
    legs,
    totalUsdc,
    totalGasUsd: round(gasUsd * fundedChains, 2),
    blockers,
    ready: blockers.length === 0 && totalUsdc > 0,
  };
}

/**
 * The distinct deposits that would unblock a plan, in the order the blockers
 * raised them.
 *
 * Several blockers commonly point at the same deposit — "you have $0 of USDC on
 * Solana" and "you have no Solana wallet yet" both end at "put USDC on Solana".
 * Every reason is still worth printing; two identical buttons are not.
 */
export function depositTargets(plan: FundingPlan): Array<{ chain: Chain; asset: "usdc" | "native" }> {
  const seen = new Set<string>();
  const out: Array<{ chain: Chain; asset: "usdc" | "native" }> = [];
  for (const blocker of plan.blockers) {
    if (!blocker.deposit) continue;
    const key = `${blocker.deposit.chain}:${blocker.deposit.asset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(blocker.deposit);
  }
  return out;
}

/** The transfers a plan implies, flattened in the order they should be signed. */
export interface Transfer {
  chain: Chain;
  asset: "usdc" | "native";
  /** Human units. */
  amount: number;
}

export function transfersFor(plan: FundingPlan): Transfer[] {
  const out: Transfer[] = [];
  for (const leg of plan.legs) {
    // Gas first: a wallet with USDC and no gas cannot move it, which is the
    // worse half-funded state to be stuck in.
    if (leg.native > 0) out.push({ chain: leg.chain, asset: "native", amount: leg.native });
    if (leg.usdc > 0) out.push({ chain: leg.chain, asset: "usdc", amount: leg.usdc });
  }
  return out;
}

/**
 * The blocker to show when a transfer failed because nobody could pay the network fee.
 *
 * Sponsorship is a dashboard setting we cannot read from the browser, so this is a
 * *reaction*, not a precondition: it turns "0x1: insufficient lamports" into a deposit
 * button pointed at the right asset on the right chain.
 */
export function gasBlockerFor(chain: Chain, reason?: string): FundingBlocker {
  const amount = SELF_PAID_FEE_NATIVE[chain];
  const symbol = NATIVE_SYMBOL[chain];
  return {
    kind: "chain-short-native",
    chain,
    message:
      `${reason ? `${reason} ` : ""}You need about ${amount} ${symbol} on ${chainName[chain]} to pay the network fee for this transfer.`.trim(),
    deposit: { chain, asset: "native" },
  };
}

export function transferLabel(transfer: Transfer): string {
  const symbol = transfer.asset === "usdc" ? "USDC" : NATIVE_SYMBOL[transfer.chain];
  return `${transfer.amount} ${symbol} on ${chainName[transfer.chain]}`;
}

export function chainLabelFor(chain: Chain): string {
  return chainName[chain];
}
