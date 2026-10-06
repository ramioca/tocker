/**
 * Unified cash + funding math.
 *
 * Pure, dependency-free, and shared by the server (API route, actions) and the
 * client (wallet chip, deposit sheet, builder funding step). Deliberately NOT
 * exported from `src/lib/wallets/index.ts`, which is `server-only`.
 *
 * The product idea in one line: a user has *one* balance — USDC — and the chain
 * it happens to sit on is an implementation detail we show on expand. Native
 * assets (ETH on Base, SOL on Solana) are not cash, and they are not the user's
 * problem either: every network fee is Tocker's (see {@link FEES_COVERED}).
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

/**
 * Who pays the network fee, said the same way everywhere: a fee row's value, and the
 * quiet line under anything that moves money (`<FeesCovered />`).
 *
 * True on both chains, by different mechanisms. On Base, Privy sponsors the gas
 * (`sponsor: true`). On Solana there is no sponsor service, so Tocker's own platform
 * wallet is the fee payer — and the rent payer when an account has to be opened — on
 * every transaction a user or an agent makes, and it refuels itself from its own USDC.
 * Either way the user holds USDC and nothing else.
 */
export const FEES_COVERED = "Covered by Tocker";
export const FEES_COVERED_SENTENCE = "Network fees are covered by Tocker.";

/** The exact words a person needs before they send money to an address. */
export const NETWORK_WORDING: Record<Chain, { network: string; asset: string; warning: string; fees: string }> = {
  base: {
    network: "Base (Ethereum L2, chain id 8453)",
    asset: "USDC (native Circle token, not USDbC)",
    warning: "Anything sent on Ethereum mainnet, Arbitrum or any other network is lost.",
    fees: FEES_COVERED,
  },
  solana: {
    network: "Solana mainnet",
    asset: "USDC (Circle SPL token)",
    warning: "Anything sent on another network, or any other SPL token, is lost.",
    fees: FEES_COVERED,
  },
};

// ------------------------------------------------------------------ amounts

export const MIN_FUND_USD = 5;
export const DEFAULT_FUND_USD = 10;
export const FUND_PRESETS = [10, 25, 50, 100] as const;

/**
 * Funding is USDC and nothing else — unconditionally.
 *
 * There used to be a `GAS_SPONSORED` flag here, with a gas allowance, a per-chain
 * "self-paid fee" and a fallback SOL price behind it "for the day this flips back". It
 * is not flipping back: nobody funds an agent with gas, because nobody pays gas in this
 * product except Tocker (see {@link FEES_COVERED}). So a plan has no native legs, there
 * is no native transfer to queue, and no blocker ever asks for SOL or ETH.
 *
 * When a transfer does fail on a fee anyway — the platform's fee wallet caught mid-refuel,
 * or Base sponsorship refusing — that is Tocker's problem, and {@link gasBlockerFor} says
 * so in one sentence instead of sending the user to buy gas.
 */

/**
 * Below this much of a native asset an agent's wallet holds nothing worth withdrawing:
 * the withdraw form only offers "Leftover SOL/ETH" above it.
 */
export const LEFTOVER_NATIVE_MIN = 0.001;

/** Pure: is there enough leftover SOL/ETH in a wallet to be worth offering as a withdrawal? */
export function hasLeftoverNative(amount: number | null | undefined): boolean {
  return typeof amount === "number" && Number.isFinite(amount) && amount > LEFTOVER_NATIVE_MIN;
}

/**
 * SOL the withdraw form never offers out of an agent's Solana wallet, because it may be
 * Tocker's rather than the owner's.
 *
 * An agent that signs and pays for its own transaction (the Privy `transfer` withdrawal,
 * the agent-paid swap fallback) is first topped up from the platform wallet by
 * `ensureAgentGas`. A drip lands only when the wallet is below that transaction's
 * requirement `r`, and sends `max(GAS_DRIP_SOL, r − balance + MIN_AGENT_SOL)`, so right
 * after any drip the wallet holds less than `r + GAS_DRIP_SOL`. The largest `r` in the
 * tree is the 0.006 SOL pre-quote top-up in `trading/jupiter.ts`; one drip is 0.01. So
 * without the owner sending SOL of their own, an agent never holds 0.016 SOL — and
 * offering anything below it as "leftover" would hand Tocker's fee money to whoever
 * clicks withdraw, once per drip. Above it, the owner gets what they put in.
 *
 * Kept as a number here rather than imported from `./gas`: this module is bundled into
 * the client, and `funding.test.ts` pins it against the real drip policy instead.
 */
export const AGENT_SOL_KEPT = 0.016;

/**
 * The smallest SOL withdrawal the form accepts. Solana refuses to credit a new System
 * account with less than its rent-exempt minimum (890,880 lamports), so anything smaller
 * sent to a fresh address fails on chain.
 */
export const MIN_SOL_SEND = 0.001;

/** Pure: how much of a native asset the form keeps back in an agent's wallet on this chain. */
export function nativeKeptBack(chain: Chain): number {
  // Base fees are sponsored by Privy and nothing ever drips ETH into an agent, so all of
  // it is the owner's.
  return chain === "solana" ? AGENT_SOL_KEPT : 0;
}

/**
 * Pure: the leftover SOL/ETH an owner may withdraw from an agent — its balance less
 * {@link nativeKeptBack}, never negative. SOL is worked out in whole lamports so the
 * number the Max button fills in is exact.
 */
export function withdrawableNative(chain: Chain, balance: number | null | undefined): number {
  if (typeof balance !== "number" || !Number.isFinite(balance) || balance <= 0) return 0;
  if (chain === "solana") {
    const lamports = Math.floor(balance * 1e9 + 1e-6) - Math.round(AGENT_SOL_KEPT * 1e9);
    return lamports > 0 ? lamports / 1e9 : 0;
  }
  return balance;
}

// ------------------------------------------------------------ stranded funds

/**
 * USDC at or above this in an agent's wallet blocks deleting the agent. A cent is
 * withdrawable, so anything from a cent up is the owner's to take out first.
 */
export const STRANDED_USDC_MIN = 0.01;
/**
 * A token holding worth at least this blocks deleting the agent. Below it is dust: the
 * positions table hides anything under a quarter, and a sell would close it as residue.
 */
export const STRANDED_TOKEN_MIN_USD = 1;

export interface StrandedWalletInput {
  chain: Chain;
  /** Human USDC units, read from the chain wherever that is possible. */
  usdc: number;
  /** Human native units (SOL / ETH), before anything is kept back. */
  native: number;
}

export interface StrandedTokenInput {
  chain: Chain;
  symbol: string;
  /** Whole token units actually held. */
  amountToken: number;
  /** At the current mark. Null when there is no price at all — which is not "worthless". */
  valueUsd: number | null;
}

export type StrandedHolding =
  | { kind: "usdc"; chain: Chain; amount: number }
  | { kind: "native"; chain: Chain; symbol: "ETH" | "SOL"; amount: number }
  | { kind: "token"; chain: Chain; symbol: string; amount: number; valueUsd: number | null };

/**
 * Pure: what deleting an agent would leave stranded in its wallets.
 *
 * Deleting is irreversible and nothing in Tocker can reach a deleted agent's wallet, so
 * each of these blocks it — and each has a path out in the app:
 *  - USDC from a cent up (the withdraw form);
 *  - SOL or ETH the withdraw form offers — {@link withdrawableNative}. On Solana that is
 *    the balance above {@link AGENT_SOL_KEPT}, which may be Tocker's own fee money and is
 *    never the owner's to take, so it cannot hold a deletion up either. Counted by
 *    amount, not by a dollar quote: a Solana wallet read reports SOL with no USD value,
 *    and "$0" is how a wallet with 5 SOL in it used to pass this check;
 *  - tokens the agent bought with real money, worth {@link STRANDED_TOKEN_MIN_USD} or
 *    more, or with no price to say otherwise (the position's Sell).
 *
 * The caller decides which tokens count (see `readStrandedHoldings`): tokens someone
 * airdropped to the wallet never do, or anyone could make an agent undeletable.
 */
export function strandedHoldings(input: {
  wallets: readonly StrandedWalletInput[];
  tokens: readonly StrandedTokenInput[];
}): StrandedHolding[] {
  const out: StrandedHolding[] = [];
  for (const wallet of input.wallets) {
    if (Number.isFinite(wallet.usdc) && wallet.usdc >= STRANDED_USDC_MIN) {
      out.push({ kind: "usdc", chain: wallet.chain, amount: wallet.usdc });
    }
    const leftover = withdrawableNative(wallet.chain, wallet.native);
    if (hasLeftoverNative(leftover)) {
      out.push({ kind: "native", chain: wallet.chain, symbol: NATIVE_SYMBOL[wallet.chain], amount: leftover });
    }
  }
  for (const token of input.tokens) {
    if (!Number.isFinite(token.amountToken) || token.amountToken <= 0) continue;
    const value = token.valueUsd;
    const priced = typeof value === "number" && Number.isFinite(value);
    if (priced && value < STRANDED_TOKEN_MIN_USD) continue;
    out.push({
      kind: "token",
      chain: token.chain,
      symbol: token.symbol,
      amount: token.amountToken,
      valueUsd: priced ? value : null,
    });
  }
  return out;
}

function listPhrase(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Pure: the sentence that refuses a deletion, naming what is still there and what to do
 * about it. Null when nothing would be stranded.
 */
export function describeStranded(holdings: readonly StrandedHolding[]): string | null {
  if (holdings.length === 0) return null;
  const parts: string[] = [];

  const usdc = holdings.reduce((sum, h) => (h.kind === "usdc" ? sum + h.amount : sum), 0);
  if (usdc > 0) parts.push(`${floorTo(usdc, 2).toFixed(2)} USDC`);
  for (const h of holdings) {
    if (h.kind === "native") parts.push(`${floorTo(h.amount, 4).toFixed(4)} ${h.symbol}`);
  }

  // Most valuable first; an unpriced holding is named before a priced one, since nothing
  // says it is small.
  const tokens = holdings
    .filter((h): h is Extract<StrandedHolding, { kind: "token" }> => h.kind === "token")
    .sort((a, b) => {
      if (a.valueUsd === null || b.valueUsd === null) return (a.valueUsd === null ? 0 : 1) - (b.valueUsd === null ? 0 : 1);
      return b.valueUsd - a.valueUsd;
    });
  for (const t of tokens.slice(0, 2)) {
    parts.push(t.valueUsd === null ? t.symbol : `${t.symbol} (about $${t.valueUsd.toFixed(2)})`);
  }
  const more = tokens.length - 2;
  if (more > 0) parts.push(`${more} more token${more === 1 ? "" : "s"}`);

  const sells = tokens.length > 0;
  const withdraws = holdings.some((h) => h.kind !== "token");
  const fix = sells && withdraws
    ? "Sell its positions and withdraw the rest first"
    : sells
      ? `Sell ${tokens.length === 1 ? "it" : "them"} first`
      : `Withdraw ${parts.length === 1 ? "it" : "them"} first`;
  return `This agent still holds ${listPhrase(parts)}. ${fix} — once the agent is deleted, Tocker can't reach its wallet.`;
}

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
  /** Human native units (ETH / SOL) — leftovers at most. Nothing ever asks the user to hold any. */
  native: number;
  nativeUsd: number | null;
  /** Derived from the user's own balance when both sides are known; null otherwise. */
  nativePriceUsd: number | null;
  /**
   * True when this wallet's balance could not be read just now. The figures above are
   * then zeros that mean "unknown": show the chain as unavailable, never as empty, and
   * do not plan a transfer or offer a deposit on the strength of them.
   */
  readFailed?: boolean;
}

/**
 * What one of the user's agents holds of their money. A live agent: its cash (net of
 * fees it owes) plus its open positions at their marks. An agent that is funded but not
 * live yet (`parked`): the USDC waiting in its wallet.
 */
export interface AgentCash {
  id: string;
  slug: string;
  name: string;
  /** Cash plus positions — the number that counts toward the top bar. */
  equityUsd: number;
  cashUsd: number;
  positionsUsd: number;
  /**
   * True for an agent that is not live: real USDC was moved into its wallet and it is
   * still on paper. The money is the owner's and counts, and comes back out through
   * that agent's Withdraw. An agent is either live or parked, so no dollar is in both.
   */
  parked?: boolean;
}

export interface UnifiedCash {
  /** USDC across the user's own embedded wallets, in dollars — what they can deposit into an agent. */
  totalUsd: number;
  /** Leftover native assets (ETH, SOL), in dollars. Never counted as cash, never asked for. */
  gasUsd: number;
  perChain: ChainCash[];
  /**
   * What the user's agents hold, in dollars: live agents' equity (cash plus open
   * positions) and the USDC parked in funded agents that are not live yet. Theirs, but
   * not in their own wallets.
   */
  inAgentsUsd: number;
  agents: AgentCash[];
  /** Own wallets plus agents: the number the top bar shows. */
  allUsd: number;
  /**
   * True when something that belongs in these totals could not be read: one of the
   * user's wallets, or an agent's (which is then left out of `agents` rather than listed
   * at zero). The totals are a floor, not the answer, and are not shown as one.
   */
  partial?: boolean;
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
    ...(wallet.readFailed ? { readFailed: true } : {}),
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
 *
 * `agents` are the ones that could be read. `agentsUnread` says some could not: they
 * are absent from the list, and the result is marked `partial` so nothing prints the
 * totals as the whole of it. A wallet of the user's own that could not be read marks it
 * the same way.
 */
export function unifiedCash(
  wallets: WalletBalance[],
  agents: AgentCash[] = [],
  options: { agentsUnread?: boolean } = {},
): UnifiedCash {
  const perChain = CHAINS.map((chain) => {
    const wallet = wallets.find((w) => w.chain === chain);
    return wallet ? readChainCash(wallet) : emptyChainCash(chain);
  });
  const totalUsd = round(perChain.reduce((sum, c) => sum + c.usdcUsd, 0), 2);
  const inAgentsUsd = round(agents.reduce((sum, a) => sum + a.equityUsd, 0), 2);
  const partial = options.agentsUnread === true || perChain.some((c) => c.readFailed === true);
  return {
    totalUsd,
    gasUsd: round(perChain.reduce((sum, c) => sum + (c.nativeUsd ?? 0), 0), 2),
    perChain,
    inAgentsUsd,
    agents,
    allUsd: round(totalUsd + inAgentsUsd, 2),
    ...(partial ? { partial: true } : {}),
  };
}

/**
 * The sentence for a chain whose balance could not be read. It says what is known (the
 * read failed) and not what is not (that the wallet is empty).
 */
export function balanceUnreadSentence(chain: Chain): string {
  return `Couldn't read your ${chainName[chain]} balance just now. Nothing has moved. Try again in a minute.`;
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
  /** A chain's balance could not be read. Not a shortfall: no deposit CTA, try again. */
  | "balance-unread"
  /** A transfer failed on its network fee. Tocker's to fix, never the user's: no deposit CTA. */
  | "fee-wallet";

/** The only thing a blocker ever asks the user to deposit. */
export interface DepositTarget {
  chain: Chain;
  asset: "usdc";
}

export interface FundingBlocker {
  kind: BlockerKind;
  chain: Chain | null;
  /** One sentence, written for the person who has to fix it. */
  message: string;
  /** When set, the step shows a "Deposit USDC on <chain>" button that opens the deposit sheet. */
  deposit: DepositTarget | null;
}

export interface FundingLeg {
  chain: Chain;
  /** Human USDC units to send from the user's embedded wallet to the agent wallet. */
  usdc: number;
}

export interface FundingPlan {
  /** `true` when the user chose paper — there is nothing to transfer. */
  paper: boolean;
  legs: FundingLeg[];
  totalUsdc: number;
  blockers: FundingBlocker[];
  /** Safe to create-and-fund. A paper plan is always ready. */
  ready: boolean;
}

export interface FundingRequest {
  mode: "paper" | "fund";
  /** Total USDC the agent should end up with, in dollars. */
  amountUsd: number;
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
 *
 * USDC only. A plan never carries a native leg and never blocks on the user's SOL or
 * ETH, whatever they hold: network fees are Tocker's.
 */
export function planFunding(request: FundingRequest): FundingPlan {
  const { mode, chains, cash } = request;
  if (mode === "paper") {
    return { paper: true, legs: [], totalUsdc: 0, blockers: [], ready: true };
  }

  const blockers: FundingBlocker[] = [];
  const amountUsd = round(request.amountUsd, 2);

  if (chains.length === 0) {
    blockers.push({
      kind: "no-chains",
      chain: null,
      message: "Pick at least one chain in Universe before you fund it.",
      deposit: null,
    });
    return { paper: false, legs: [], totalUsdc: 0, blockers, ready: false };
  }

  if (!(amountUsd >= MIN_FUND_USD)) {
    blockers.push({
      kind: "below-minimum",
      chain: null,
      message: `Fund at least $${MIN_FUND_USD}. Below that, fees and slippage eat the position before the strategy gets a say.`,
      deposit: null,
    });
  }

  // A chain whose balance could not be read is not a chain with nothing on it. It blocks
  // the plan (nothing is sent against a number nobody could read) and says so, instead of
  // "you have $0.00, deposit more" over a wallet that may hold plenty.
  const unread = chains.filter((chain) => cashOn(cash, chain).readFailed === true);
  for (const chain of unread) {
    blockers.push({ kind: "balance-unread", chain, message: balanceUnreadSentence(chain), deposit: null });
  }

  const availableOnChains = round(
    chains.reduce((sum, chain) => sum + cashOn(cash, chain).usdc, 0),
    2,
  );
  if (unread.length === 0 && amountUsd > availableOnChains) {
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
    return { chain, usdc };
  });

  for (const leg of legs) {
    const chainCash = cashOn(cash, leg.chain);
    // Already blocked above, in its own words.
    if (chainCash.readFailed) continue;
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
  }

  const totalUsdc = round(legs.reduce((sum, leg) => sum + leg.usdc, 0), 2);

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
export function depositTargets(plan: FundingPlan): DepositTarget[] {
  const seen = new Set<string>();
  const out: DepositTarget[] = [];
  for (const blocker of plan.blockers) {
    if (!blocker.deposit) continue;
    const key = `${blocker.deposit.chain}:${blocker.deposit.asset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(blocker.deposit);
  }
  return out;
}

/** The transfers a plan implies, flattened in the order they should be signed. USDC only. */
export interface Transfer {
  chain: Chain;
  asset: "usdc";
  /** Human units. */
  amount: number;
}

export function transfersFor(plan: FundingPlan): Transfer[] {
  const out: Transfer[] = [];
  for (const leg of plan.legs) {
    if (leg.usdc > 0) out.push({ chain: leg.chain, asset: "usdc", amount: leg.usdc });
  }
  return out;
}

// ------------------------------------------------------------- fee failures

/**
 * Why a transfer failed on its network fee, when it did. Both are Tocker's problem and
 * neither is ever told to the user as "get SOL" or "get ETH"; they differ in whether the
 * same send can work a minute later.
 *
 *  - `"refuel"` — the fee payer was short for a moment: Tocker's Solana fee wallet caught
 *    mid-refuel (the RPC's "insufficient lamports", `InsufficientFundsForFee`, the "no
 *    record of a prior credit" a zero-SOL payer gets), or a Base sponsorship that could
 *    not cover this one. Transient, so the UI offers the same send again.
 *  - `"unavailable"` — Tocker cannot or will not pay this fee: Base sponsorship switched
 *    off for the app, a co-signature refused because the transaction would cost the fee
 *    wallet more than its allowance, a fee payer that is not Tocker's. The same send gets
 *    the same answer, so nothing promises a retry will work.
 */
export type FeeFailureKind = "refuel" | "unavailable";

/**
 * A person backing out of a wallet prompt — the prompt's own wording only. Deliberately
 * not a bare "reject": the server's broadcast failures read "The network rejected this
 * transfer: …", and those are exactly the fee failures this module has to catch.
 */
const WALLET_CANCELLATION =
  /\b(?:you|user)\s+(?:cancel+ed|rejected|denied|declined|closed|exited)\b|\brejected the request\b|\brequest (?:was )?(?:rejected|denied|declined)\b|\bclosed the (?:modal|wallet|window|popup|prompt)\b/i;

/** Someone sending the SOL or ETH they hold, asking for more than it covers: about the amount, not the fee. */
const NATIVE_AMOUNT_TOO_HIGH = /than this wallet can send/i;

/** Configuration or a refusal: a retry of the same send gets the same answer. Checked before {@link FEE_REFUEL}. */
const FEE_UNAVAILABLE =
  /tee stack|sponsorship is not enabled|not enabled for this app|switch it on|over its [\d.]+ (?:SOL|ETH) allowance|fee ?payer is \S+,? not\b/i;

/** A fee payer that is short right now. */
const FEE_REFUEL =
  /insufficient lamports|insufficient ?funds ?for ?(?:fee|gas|rent)|no record of a prior credit|refilling|topping up|cannot top it up|network fee|fee ?payer|fee wallet|sponsor|\bgas\b|lamports/i;

/** The older copy that named the native asset outright. Whole, upper-case words, so "Solana" does not count. */
const NATIVE_WORD = /\b(?:SOL|ETH)\b/;

/**
 * Pure: did this transfer fail on its *network fee* — and if so, which kind of failure
 * ({@link FeeFailureKind})? Null for everything else: the user's USDC being short (the
 * token program's plain "insufficient funds"), a bad address, a cancelled prompt.
 */
export function feeFailureKind(message: string | null | undefined): FeeFailureKind | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  if (WALLET_CANCELLATION.test(text) || NATIVE_AMOUNT_TOO_HIGH.test(text)) return null;
  if (FEE_UNAVAILABLE.test(text)) return "unavailable";
  if (FEE_REFUEL.test(text) || NATIVE_WORD.test(text)) return "refuel";
  return null;
}

/** Pure: did this transfer fail on its network fee, of either kind? */
export function isNetworkFeeFailure(message: string | null | undefined): boolean {
  return feeFailureKind(message) !== null;
}

/**
 * The one sentence a user reads when a transfer failed on its network fee.
 *
 * It never asks for SOL or ETH — holding none is the design, not the fault — and it says
 * the thing a person actually wants to know after a failed money movement: their money
 * did not go anywhere. Only a `"refuel"` failure says to try again; an `"unavailable"`
 * one would fail the same way, so it does not pretend otherwise.
 *
 * `asset` is what was being sent: USDC for funding and most withdrawals, "native" for a
 * leftover-SOL/ETH withdrawal (which is then "Nothing was sent", not "Your USDC").
 */
export function feeFailureSentence(
  chain: Chain,
  kind: FeeFailureKind = "refuel",
  asset: "usdc" | "native" = "usdc",
): string {
  const unmoved = asset === "usdc" ? "Your USDC has not moved" : "Nothing was sent";
  if (kind === "unavailable") return `Tocker couldn't cover the network fee on this transfer. ${unmoved}.`;
  return chain === "solana"
    ? `Tocker pays this network fee, and its fee wallet is topping up right now. ${unmoved} — try again in a minute.`
    : `Tocker pays this network fee and could not cover it just now. ${unmoved} — try again in a minute.`;
}

/**
 * Pure: the error a user should read for a failed transfer. A fee failure becomes
 * {@link feeFailureSentence} for its kind; anything else is passed through, already a
 * sentence. The raw text belongs in the server log and the audit row, never in a toast.
 */
export function userFacingTransferError(
  message: string,
  chain: Chain,
  asset: "usdc" | "native" = "usdc",
): string {
  const kind = feeFailureKind(message);
  return kind ? feeFailureSentence(chain, kind, asset) : message;
}

/**
 * The blocker to show when a transfer failed because its network fee could not be paid.
 *
 * It used to open the deposit sheet on SOL or ETH. It has no deposit target now: the
 * fee is Tocker's and the user's wallet is fine. For a `"refuel"` failure the fix is a
 * retry once the fee wallet has refilled; for `"unavailable"` there is nothing for the
 * user to do, and the message says only that nothing moved.
 */
export function gasBlockerFor(chain: Chain, kind: FeeFailureKind = "refuel"): FundingBlocker {
  return {
    kind: "fee-wallet",
    chain,
    message: feeFailureSentence(chain, kind),
    deposit: null,
  };
}

export function transferLabel(transfer: Transfer): string {
  return `${transfer.amount} USDC on ${chainName[transfer.chain]}`;
}

export function chainLabelFor(chain: Chain): string {
  return chainName[chain];
}
