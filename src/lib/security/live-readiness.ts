import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { agentFundingIntents, agents, getDb, isPglite, users } from "@/db";
import { isPrivyConfigured } from "@/lib/privy";
import { getAgentWalletBalances, isPaperWallet } from "@/lib/wallets";
// Constants and the pure helper only — the effectful half of `gas.ts` is workstream A's.
import { LAMPORTS_PER_SOL, MIN_PLATFORM_SOL, sponsoredFundingLamports } from "@/lib/wallets/gas";
import { FEES_COVERED, chainLabelFor, feeFailureKind } from "@/lib/wallets/funding";
import { fmtUsd } from "@/lib/money";
import { RETIRED_DATA_SOURCE_IDS } from "@/lib/agent/config";
import { thinkSource, thinkingReserveUsd } from "@/lib/agent/inference";
import { dataChainsFor, getDataSource } from "@/lib/data-sources/registry";
import { isMockMode } from "@/lib/x402/paidFetch";
import { UNAVAILABLE_TO_USERS, getMfaStatus } from "./mfa";
import { getKillSwitch } from "./kill-switch";
import { listSimulatedOpenPositions } from "./paper-positions";
import type { AgentConfig, WalletBudget } from "@/db/schema";
import type { Chain } from "@/server/types";

/**
 * Everything that has to be true before an agent signs its first real transaction,
 * evaluated server-side and rendered as a checklist by `/agents/[slug]/live`.
 *
 * The rule the whole screen is built on: a step is `pass` only when it was
 * *checked* and passed. "We could not tell" is `fail`, never `pass`. The one
 * concession is `warn`, for things that are worth seeing but cannot sensibly
 * block (a Privy wallet policy we can read but not safely write, say).
 *
 * W7 spends that concession twice more, both times on a balance we could not read rather
 * than a balance we read and disliked. That distinction did not exist before — the
 * platform balance reader answered zero for both — and it matters because an empty wallet
 * and an unreachable Privy endpoint want opposite treatment: the first must block a live
 * trade, and blocking one over the second costs the operator their test to save them a
 * failed data call that would have named the wallet to top up anyway. See
 * `checkPlatformDataWallets` and `readPlatformBalance`.
 */

/**
 * The step types live in `./types.ts` — the one module in `src/lib/security/` with no
 * imports, so a client component can name these shapes without a type-level edge to a
 * `server-only` module. They used to be declared here *and* there; adding the `gas` step
 * in W7 broke the copy in the client bundle before it broke anything else, so the
 * duplicate is gone and this file re-exports the originals.
 */
export type { LiveReadiness, ReadinessStep, ReadinessStepId, StepState } from "./types";
import type { LiveReadiness, ReadinessStep } from "./types";

/** "Solana and Base". Chain ids are for code; this checklist is read by the owner. */
function chainNames(chains: readonly Chain[]): string {
  return chains.map(chainLabelFor).join(" and ");
}

/** Enough USDC for one small trade plus slippage. There is no native minimum: fees are Tocker's. */
export const MIN_USDC = 5;

/**
 * The shape a first live trade should have: one chain, a tiny notional, one trade
 * a day. Deliberately conservative — the point of the first trade is to prove the
 * pipeline signs, fills and reports, not to make money.
 *
 * **There is no `maxPositionPct` here, and that is the point.** It used to clamp the
 * agent to 10%, which quietly made the preset unusable at the size it recommends:
 * `riskGuard` rejects a buy when `(held + ticket) / equity` exceeds the cap, so a $2
 * ticket against the $10 the operator was told to deposit is 20% — every buy rejected,
 * with a green checklist above it, because nothing on the checklist knew the two numbers
 * had to agree. A $2 ticket only fits a 10% cap from $20 up.
 *
 * Position sizing is the operator's decision and their default (25%) is already sane;
 * the preset's job is to make the *first* trade small and singular, which `maxTradeUsd`
 * and `maxDailyTrades` do on their own. What replaced the clamp is
 * {@link simulateFirstTrade}: rather than guess a percentage that works, the checklist
 * runs the real `riskGuard` against the real balance and reports the guard's own reason.
 */
export const FIRST_TRADE_PRESET = {
  maxTradeUsd: 2,
  maxDailyTrades: 1,
} as const;

export interface RiskVerdict {
  ok: boolean;
  /** What blocks going live. */
  problems: string[];
  /**
   * What the operator should know but is allowed to do (W7): a ticket above the $2
   * preset, more than one trade a day, more than one chain. The preset is advice, the
   * caps the operator typed are the rule — a person funding $10 and asking for $5 a
   * trade is making a decision, not a mistake.
   */
  cautions: string[];
}

/**
 * Pure: is this risk config sane for a *first* live trade, given the per-trade cap
 * the operator typed into the wizard? Separated out so it is testable without a
 * database, a wallet or a network.
 */
export function evaluateFirstTradeRisk(config: AgentConfig, capUsd: number): RiskVerdict {
  const problems: string[] = [];
  const cautions: string[] = [];
  const { risk, chains } = config;

  if (chains.length === 0) {
    problems.push("it trades no chains");
  } else if (chains.length > 1) {
    cautions.push(
      `it trades ${chains.length} chains; a first live trade is easier to debug on one, but that is your call`,
    );
  }
  if (!(capUsd > 0)) {
    problems.push("the per-trade cap you entered must be greater than zero");
  } else if (risk.maxTradeUsd > capUsd) {
    problems.push(`its max per trade is ${fmtUsd(risk.maxTradeUsd)} but you asked for a cap of ${fmtUsd(capUsd)}`);
  }
  if (risk.maxTradeUsd > FIRST_TRADE_PRESET.maxTradeUsd) {
    cautions.push(
      `its max per trade is ${fmtUsd(risk.maxTradeUsd)}, above the ${fmtUsd(FIRST_TRADE_PRESET.maxTradeUsd)} preset — allowed; the preset button shrinks it if you would rather prove the pipeline with less`,
    );
  }
  if (risk.maxDailyTrades > FIRST_TRADE_PRESET.maxDailyTrades) {
    cautions.push(`it may make ${risk.maxDailyTrades} trades a day; the preset allows one until you have seen a fill`);
  }
  if (risk.stopLossPct === null && risk.takeProfitPct === null && risk.trailingStopPct === null) {
    problems.push("it has no stop loss, take profit or trailing stop — the exit engine has nothing to enforce");
  }

  return { ok: problems.length === 0, problems, cautions };
}

/**
 * Apply the preset to a config without touching anything else about it.
 *
 * `maxPositionPct` is deliberately left alone — see {@link FIRST_TRADE_PRESET}. Clamping
 * it here is what made every buy fail at the funded size the wizard recommends.
 */
export function withFirstTradePreset(config: AgentConfig): AgentConfig {
  const chains: Chain[] = config.chains.length > 1 ? [config.chains[0] as Chain] : [...config.chains];
  return {
    ...config,
    chains: chains.length > 0 ? chains : ["base"],
    risk: {
      ...config.risk,
      maxTradeUsd: Math.min(config.risk.maxTradeUsd, FIRST_TRADE_PRESET.maxTradeUsd),
      maxDailyTrades: Math.min(config.risk.maxDailyTrades, FIRST_TRADE_PRESET.maxDailyTrades),
      // A first live trade with no floor under it is not a test, it is a donation.
      stopLossPct: config.risk.stopLossPct ?? 25,
    },
  };
}

/**
 * Would a `maxTradeUsd` buy actually clear the risk guard against this balance?
 *
 * The checklist used to answer this by re-deriving the guard's arithmetic, which is how
 * it came to disagree with it. This calls the guard itself — the same pure
 * `riskGuard()` that `place_trade` calls, imported read-only from
 * `src/lib/trading/risk.ts` — with a synthetic order for the agent's own per-trade cap
 * against its real USDC, and reports the guard's own sentence when it refuses.
 *
 * The synthetic token scores perfectly and carries no blockers, because the universe
 * gates are a question about a token the agent has not picked yet; what is being tested
 * here is the *money* half of the guard — the trade cap, the sizing ceiling, the daily
 * limit, cash against the platform fee, and `maxPositionPct` against equity. Those are
 * the ones the operator can fix before going live, and the ones a preset can break.
 *
 * An agent that pays for its own thinking keeps one run's worth of it, and the wallet
 * floor, out of its trades (`thinkingReserveUsd`; the live book does the same in
 * `getPortfolio`). The guard is given the cash a buy may actually use, so a wallet that
 * covers the ticket but not the ticket and the thinking fails here, not on the first tick.
 *
 * Returns `null` when the trade would be allowed.
 */
export async function simulateFirstTrade(config: AgentConfig, usdc: number): Promise<string | null> {
  const [{ riskGuard }, { platformFeeUsd }] = await Promise.all([
    import("@/lib/trading/risk"),
    import("@/lib/platform/fee"),
  ]);
  const chain: Chain = (config.chains[0] as Chain) ?? "base";
  const amountUsd = config.risk.maxTradeUsd;
  // Zero for an agent that thinks on a key.
  const heldBack = Math.min(thinkingReserveUsd(config), Math.max(0, usdc));

  const verdict = riskGuard(
    { id: "readiness-simulation", mode: "live", config },
    { cashUsd: Math.max(0, usdc - heldBack), equityUsd: usdc, positions: [], tradesToday: 0 },
    {
      chain,
      side: "buy",
      tokenId: "readiness-simulation",
      tokenAddress: "readiness-simulation",
      symbol: "any token",
      amountUsd,
      rangePct: null,
    },
    {
      tokenId: "readiness-simulation",
      chain,
      address: "readiness-simulation",
      symbol: "any token",
      name: null,
      total: 100,
      verdict: "strong",
      components: {
        safety: 100,
        liquidity: 100,
        organic: 100,
        distribution: 100,
        momentum: 100,
        gecko: null,
        sentiment: null,
        smartMoney: null,
      },
      blockers: [],
      warnings: [],
      priceUsd: 1,
      liquidityUsd: 1_000_000,
      volume24hUsd: 1_000_000,
      marketCapUsd: 10_000_000,
      holderCount: 10_000,
      ageHours: 720,
      priceChange24hPct: 0,
      sources: ["readiness-simulation"],
      scoredAt: new Date().toISOString(),
    },
  );
  if (verdict.ok) return null;
  const fee = platformFeeUsd();
  return (
    `A ${fmtUsd(amountUsd)} buy against the ${fmtUsd(usdc)} this agent holds` +
    `${heldBack > 0 ? `, of which ${fmtUsd(heldBack)} is kept back to pay for its own thinking,` : ""}` +
    `${fee > 0 ? ` (plus the ${fmtUsd(fee)} Tocker fee)` : ""} would be refused by the risk guard: ${verdict.reason}`
  );
}

export interface ReadinessInput {
  agentId: string;
  slug: string;
  ownerId: string;
  config: AgentConfig;
  /** The wallet-layer Privy policy, from `agents.walletBudget`. */
  walletBudget?: WalletBudget | null;
  /** The per-trade cap the operator typed. Defaults to the preset. */
  capUsd?: number;
}

export async function evaluateLiveReadiness(input: ReadinessInput): Promise<LiveReadiness> {
  const capUsd = input.capUsd ?? FIRST_TRADE_PRESET.maxTradeUsd;
  const settings = `/agents/${input.slug}/settings`;

  // The checklist is owner-only, so the owner is the viewer. Deployment details (env
  // var names, Tocker's own wallets) are for an admin; everyone else gets the outcome.
  const viewerIsAdmin = await ownerIsAdmin(input.ownerId);

  const [database, privy, mfa, wallets, killSwitch, data, paperPositions] = await Promise.all([
    checkDatabase(viewerIsAdmin),
    Promise.resolve(checkPrivy(viewerIsAdmin)),
    checkMfa(input.ownerId),
    checkWallets(input.agentId, input.config.chains, settings),
    getKillSwitch(input.ownerId),
    checkData(input.config, settings, viewerIsAdmin),
    checkPaperPositions(input.agentId, input.slug),
  ]);

  // The risk step is the only one that has to wait for a balance, because the whole
  // point of it now is to run the real guard against the real number.
  const [risk, gas] = await Promise.all([
    checkRisk(input.config, capUsd, wallets.usdc, settings),
    checkGas(input.config, viewerIsAdmin),
  ]);

  const steps: ReadinessStep[] = [
    database,
    privy,
    mfa,
    wallets.walletsStep,
    wallets.fundingStep,
    gas,
    checkBudget(input.config, input.walletBudget ?? null, capUsd, settings),
    risk,
    data,
    {
      id: "killswitch",
      title: "Trading is not paused",
      state: killSwitch.paused ? "fail" : "pass",
      detail: killSwitch.paused
        ? "Your account-wide kill switch is on, so the scheduler is skipping every agent you own. Exits still run."
        : "Your account-wide kill switch is off, so scheduled runs will happen.",
      fix: killSwitch.paused ? { label: "Settings → Security", href: "/settings/security" } : null,
    },
    paperPositions,
  ];

  return {
    agentId: input.agentId,
    slug: input.slug,
    steps,
    // A transfer still confirming is not a failure, but it is not "ready" either: the
    // switch waits for the money to land.
    ready: steps.every((s) => s.state !== "fail") && !steps.some((step) => step.pending),
    minUsdc: MIN_USDC,
    caps: {
      maxTradeUsd: input.config.risk.maxTradeUsd,
      maxDailyTrades: input.config.risk.maxDailyTrades,
      chains: input.config.chains,
    },
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- individual checks

async function checkDatabase(viewerIsAdmin: boolean): Promise<ReadinessStep> {
  const embedded = isPglite();
  let error: string | null = null;
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // A driver error can name the host or carry a connection string, so its words go to
    // the server log, where the operator reads them, and never into a tenant's checklist.
    console.error("[live-readiness] database", error);
  }
  return databaseStep({ embedded, production: process.env.NODE_ENV === "production", error, viewerIsAdmin });
}

export interface DatabaseStepInput {
  /** Running on the embedded PGlite file rather than a real Postgres. */
  embedded: boolean;
  production: boolean;
  /** What the driver said when `select 1` failed; null when it answered. */
  error: string | null;
  viewerIsAdmin: boolean;
}

/**
 * The "Production database reachable" row, pure so both audiences are testable.
 *
 * Which database a deployment runs on, and why it failed, is the operator's business:
 * an admin gets the diagnosis and the /api/health link, everyone else the outcome.
 */
export function databaseStep(input: DatabaseStepInput): ReadinessStep {
  const { embedded, production, error, viewerIsAdmin } = input;
  const health = viewerIsAdmin ? { label: "Read /api/health", href: "/api/health" } : null;
  const step = { id: "database", title: "Production database reachable" } as const;
  if (error !== null) {
    return {
      ...step,
      state: "fail",
      detail: viewerIsAdmin
        ? `The database did not answer: ${error}`
        : "Tocker can't reach its database right now. Try again in a minute.",
      fix: health,
    };
  }
  if (embedded && production) {
    return {
      ...step,
      state: "fail",
      detail: viewerIsAdmin
        ? "This deploy is running on embedded PGlite — a file on an ephemeral disk. Every trade it records is lost when the instance recycles."
        : "Real-money trading isn't available on this deployment yet.",
      fix: health,
    };
  }
  if (embedded) {
    return {
      ...step,
      state: "warn",
      detail: viewerIsAdmin
        ? "Answering, but this is the local embedded PGlite file. Fine for development; never for real money."
        : "Running on a development database — fine for paper, never for real money.",
      fix: health,
    };
  }
  return { ...step, state: "pass", detail: "Answering queries.", fix: null };
}

/** What an owner is told when the deployment itself cannot hold real wallets. */
const NO_REAL_WALLETS = "Real wallets aren't available on this deployment yet, so there is nothing to trade from.";

function checkPrivy(viewerIsAdmin: boolean): ReadinessStep {
  const configured = isPrivyConfigured();
  const hasAuthKey = Boolean(process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim());
  if (!configured) {
    return {
      id: "privy",
      title: "Wallet infrastructure",
      state: "fail",
      detail: viewerIsAdmin
        ? "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are not both set, so there are no real wallets to trade from."
        : NO_REAL_WALLETS,
      fix: null,
    };
  }
  if (!hasAuthKey) {
    return {
      id: "privy",
      title: "Wallet infrastructure",
      state: "fail",
      detail: viewerIsAdmin
        ? "PRIVY_AUTHORIZATION_PRIVATE_KEY is missing. The server owns agent wallets with that key; without it it cannot sign a trade."
        : NO_REAL_WALLETS,
      fix: null,
    };
  }
  return {
    id: "privy",
    title: "Wallet infrastructure",
    state: "pass",
    detail: "Wallet credentials and the signing key are present; agent wallets can sign.",
    fix: null,
  };
}

async function checkMfa(ownerId: string): Promise<ReadinessStep> {
  const status = await getMfaStatus(ownerId);
  if (status.enrolled) {
    return {
      id: "mfa",
      title: "Second factor enrolled",
      state: "pass",
      detail: `${status.userMethods.join(", ")} enrolled on your account.`,
      fix: null,
    };
  }
  // Optional: a second factor is recommended for an account that moves real money,
  // but it is not a condition of going live.
  return {
    id: "mfa",
    title: "Second factor (optional)",
    state: "pass",
    // Beside a green check, "isn't available" read like a failure that had passed.
    detail:
      status.blockedReason === UNAVAILABLE_TO_USERS
        ? "Optional — Tocker doesn't offer two-factor sign-in yet, so there is nothing to enrol."
        : (status.blockedReason ??
          "No second factor enrolled. Optional — enrol one in Settings → Security if you want it."),
    fix: null,
  };
}

async function checkWallets(
  agentId: string,
  chains: Chain[],
  settings: string,
): Promise<{
  walletsStep: ReadinessStep;
  fundingStep: ReadinessStep;
  /** USDC across the agent's wallets on its enabled chains. `null` when unreadable. */
  usdc: number | null;
}> {
  let balances: Awaited<ReturnType<typeof getAgentWalletBalances>> = [];
  let error: string | null = null;
  try {
    balances = await getAgentWalletBalances(agentId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const relevant = balances.filter((w) => chains.includes(w.chain));
  // A balance that could not be read comes back as zeros, flagged. That is the same
  // "unreadable" as a throw: the row says so rather than "0.00 USDC, fund this agent".
  const unread = relevant.filter((w) => w.readFailed);
  if (!error && unread.length > 0) {
    error = `the ${chainNames(unread.map((w) => w.chain))} balance could not be read just now. Try again in a minute.`;
  }
  const paper = relevant.filter((w) => isPaperWallet(w.walletId));
  const missing = chains.filter((c) => !relevant.some((w) => w.chain === c));

  const walletsStep: ReadinessStep = error
    ? {
        id: "wallets",
        title: "Real agent wallets",
        state: "fail",
        detail: `Could not read this agent's wallets: ${error}`,
        fix: { label: "Agent settings → Wallets", href: `${settings}#wallets` },
      }
    : missing.length > 0
      ? {
          id: "wallets",
          title: "Real agent wallets",
          state: "fail",
          detail: `No wallet on ${chainNames(missing)}. The agent cannot trade a chain it has no wallet for.`,
          fix: { label: "Agent settings → Wallets", href: `${settings}#wallets` },
        }
      : paper.length > 0
        ? {
            id: "wallets",
            title: "Real agent wallets",
            state: "fail",
            detail: `${chainNames(paper.map((w) => w.chain))} still ${paper.length === 1 ? "has a placeholder wallet" : "have placeholder wallets"} from paper mode, created before real wallets were available here. ${paper.length === 1 ? "It holds" : "They hold"} nothing and can sign nothing.`,
            fix: { label: "Agent settings → Wallets", href: `${settings}#wallets` },
          }
        : {
            id: "wallets",
            title: "Real agent wallets",
            state: "pass",
            detail: `Tocker-managed wallets on ${chainNames(relevant.map((w) => w.chain))}, signed only by the app's own authorization key.`,
            fix: null,
          };

  const usdc = sumAsset(relevant, (asset) => asset === "usdc");

  const fundedUsdc = usdc >= MIN_USDC;

  // An unfunded agent whose owner already asked for funding at creation deserves the
  // story, not a fresh "Fund this agent": what they asked for, why it did not land, and
  // a retry. The $50 case that prompted this failed because the fee wallet was dry — and
  // its stored error told the owner to send SOL somewhere. A fee failure is Tocker's, so
  // it is retold here in Tocker's words, never the stored ones.
  let intentNote = "";
  let fixLabel = "Fund this agent";
  let pendingFunding = false;
  if (!fundedUsdc && walletsStep.state !== "fail") {
    try {
      const db = await getDb();
      const [intent] = await db
        .select()
        .from(agentFundingIntents)
        .where(eq(agentFundingIntents.agentId, agentId))
        .orderBy(desc(agentFundingIntents.createdAt))
        .limit(1);
      if (intent) {
        const amount = Number(intent.amountUsd ?? intent.amount);
        const label = Number.isFinite(amount) && amount > 0 ? fmtUsd(amount) : "your";
        if (intent.status === "failed") {
          const feeKind = feeFailureKind(intent.error);
          fixLabel = `Retry the ${label} funding`;
          if (feeKind === "refuel") {
            // Only Solana has a fee wallet that tops itself up; on Base the sponsor was short.
            const moment =
              intent.chain === "solana" ? "while Tocker's fee wallet was topping up" : "because Tocker couldn't cover its network fee just then";
            intentNote = ` The ${label} funding you set up at creation did not go through ${moment}. Network fees are covered by Tocker, so a retry is all it takes.`;
          } else if (feeKind === "unavailable") {
            // Sponsorship off, a co-sign refused: a retry of the same thing gets the same
            // answer, so the row neither promises one nor names SOL or ETH.
            intentNote = ` The ${label} funding you set up at creation did not go through: Tocker couldn't cover its network fee. Your USDC did not move.`;
            fixLabel = "Fund this agent";
          } else {
            const why = intent.error ? ` — ${intent.error.split(". ")[0].slice(0, 220)}` : "";
            intentNote = ` The ${label} funding you set up at creation did not go through${why}.`;
          }
        } else if (intent.status === "pending" || intent.status === "sent") {
          const ageMs = Date.now() - intent.createdAt.getTime();
          pendingFunding = ageMs < 10 * 60_000;
          intentNote = pendingFunding
            ? ` The ${label} funding is ${intent.status === "sent" ? "confirming on chain" : "being sent"} — this page re-checks by itself.`
            : ` The ${label} funding from creation was sent ${Math.round(ageMs / 60_000)} minutes ago and has not arrived; check the transaction, or fund again.`;
        }
      }
    } catch {
      // The balance is the answer; the intent is context.
    }
  }

  const fundingStep: ReadinessStep = {
    id: "funding",
    title: "Funded above the minimum",
    state: walletsStep.state === "fail" ? "fail" : fundedUsdc ? "pass" : pendingFunding ? "warn" : "fail",
    detail:
      walletsStep.state === "fail"
        ? "Cannot check a balance until the agent has real wallets."
        : `${usdc.toFixed(2)} USDC (need ${MIN_USDC.toFixed(2)}).${intentNote}`,
    fix: fundedUsdc || pendingFunding ? null : { label: fixLabel, href: `${settings}#wallets` },
    ...(pendingFunding ? { pending: true } : {}),
  };

  return { walletsStep, fundingStep, usdc: walletsStep.state === "fail" ? null : usdc };
}

/**
 * Below this much SOL, Tocker's fee wallet cannot sponsor even one first funding
 * transfer (a signature, the rent on a new USDC account, and the margin). That — not
 * the {@link MIN_PLATFORM_SOL} refuel floor — is what "empty" means to a user: between
 * the two it is still paying every fee while it refuels.
 */
export const FEE_WALLET_EMPTY_SOL = sponsoredFundingLamports({ ataExists: false }) / LAMPORTS_PER_SOL;

/** What the fee wallet's self-refuel did when the checklist found it short. */
export type FeeWalletRefuel =
  | { kind: "not-needed" }
  | { kind: "refueled"; usdc: number }
  | { kind: "in-flight" }
  | { kind: "failed"; reason: string };

export interface GasStepInput {
  chains: Chain[];
  /** Tocker's Solana fee wallet. `sol` is null when the balance could not be read. */
  platform: { sol: number | null; address: string | null; error: string | null };
  refuel: FeeWalletRefuel;
  /** In `ADMIN_EMAILS`. Only an admin is shown the fee wallet's balance, address or a link to it. */
  viewerIsAdmin: boolean;
}

const COVERED_DETAIL =
  `${FEES_COVERED}. It pays the network fee on your funding transfers and on every trade ` +
  "this agent makes, so the agent's wallet only ever needs USDC.";

/**
 * Pure: the "Network fees" row of the live checklist.
 *
 * Network fees are Tocker's, on both chains — Privy sponsors Base, and on Solana Tocker's
 * own fee wallet is the fee payer (and rent payer) on every transaction. So for the
 * person going live this row is simply "Covered by Tocker", and there is exactly one
 * exception worth their attention: the fee wallet is empty *and* its refuel from its own
 * USDC has not landed. Even then it is a `warn`, never a `fail` — nothing about it is
 * theirs to fix, it blocks nothing they can change, and a red row about Tocker's SOL on
 * an operator's go-live screen is the thing this whole pass exists to remove.
 *
 * An admin sees the same row with the wallet's balance, address and refuel status added,
 * a link to the Platform card, and a `warn` as soon as the wallet is under its refuel
 * floor or unreadable — early enough to act before any user notices.
 */
export function gasStep(input: GasStepInput): ReadinessStep {
  const base = { id: "gas" as const, title: "Network fees" };
  if (!input.chains.includes("solana")) {
    return {
      ...base,
      state: "pass",
      detail: `${FEES_COVERED}. Every network fee on Base is paid for you, so this agent's wallet only ever needs USDC.`,
      fix: null,
    };
  }

  const { sol } = input.platform;
  const refueled = input.refuel.kind === "refueled";
  const empty = sol !== null && sol < FEE_WALLET_EMPTY_SOL && !refueled;
  const low = sol !== null && sol < MIN_PLATFORM_SOL && !refueled;
  const admin = input.viewerIsAdmin ? ` ${adminFeeWalletNote(input)}` : "";

  if (empty) {
    return {
      ...base,
      state: "warn",
      detail: `Tocker is topping up its fee wallet; trading resumes on its own.${admin}`,
      fix: input.viewerIsAdmin ? PLATFORM_CARD : null,
    };
  }
  if (input.viewerIsAdmin && (low || sol === null)) {
    return { ...base, state: "warn", detail: `${COVERED_DETAIL}${admin}`, fix: PLATFORM_CARD };
  }
  return { ...base, state: "pass", detail: `${COVERED_DETAIL}${admin}`, fix: null };
}

/** The fee wallet as an admin needs to see it: balance, address, floor, and what the refuel did. */
function adminFeeWalletNote(input: GasStepInput): string {
  const { sol, address, error } = input.platform;
  const where = address ? ` at ${address}` : "";
  if (sol === null) {
    return `Admin only: the fee wallet's SOL balance could not be read${where}${error ? ` — ${error}` : ""}.`;
  }
  const holds = `Admin only: the fee wallet holds ${sol.toFixed(4)} SOL${where} (refuel floor ${MIN_PLATFORM_SOL} SOL)`;
  switch (input.refuel.kind) {
    case "refueled":
      return `${holds}; it just converted $${input.refuel.usdc.toFixed(2)} of its USDC to SOL.`;
    case "in-flight":
      return `${holds}; it is converting some of its USDC to SOL right now.`;
    case "failed":
      return `${holds}; its refuel from USDC did not happen: ${input.refuel.reason}.`;
    case "not-needed":
      return `${holds}.`;
  }
}

/**
 * The owner's admin status, for the gas step's extra detail. Anything that goes wrong
 * reading it answers "not an admin": the cost of that is a missing diagnostic line, the
 * cost of the opposite is showing a user Tocker's wallet.
 */
async function ownerIsAdmin(ownerId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId)).limit(1);
    const { isAdminEmail } = await import("@/lib/admin");
    return isAdminEmail(row?.email);
  } catch {
    return false;
  }
}

/**
 * Network fees: read Tocker's Solana fee wallet, let it refuel itself if it is short,
 * and hand the result to {@link gasStep}.
 *
 * The refuel is given eight seconds — this runs while a page renders — and one still in
 * flight is reported as such and finished on the next tick. Base-only agents skip the
 * reads entirely: Base fees are sponsored, and there is no wallet of ours to check.
 */
async function checkGas(config: AgentConfig, viewerIsAdmin: boolean): Promise<ReadinessStep> {
  if (!config.chains.includes("solana")) {
    return gasStep({
      chains: config.chains,
      platform: { sol: null, address: null, error: null },
      refuel: { kind: "not-needed" },
      viewerIsAdmin,
    });
  }

  let sol: number | null = null;
  let address: string | null = null;
  let error: string | null = null;
  try {
    const { getPlatformWallet, readPlatformBalance } = await import("@/lib/platform/wallets");
    const wallet = await getPlatformWallet("solana");
    if (!wallet) {
      error = "it has not been created yet";
    } else {
      address = wallet.address;
      const reading = await readPlatformBalance(wallet);
      sol = reading.native;
      error = reading.error;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  let refuel: FeeWalletRefuel = { kind: "not-needed" };
  if (sol !== null && sol < MIN_PLATFORM_SOL && address) {
    try {
      const { ensurePlatformSol } = await import("@/lib/platform/sol");
      const outcome = await Promise.race([
        ensurePlatformSol("the live checklist"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (outcome === null) {
        refuel = { kind: "in-flight" };
      } else if (outcome.refueled) {
        refuel = { kind: "refueled", usdc: outcome.usdc ?? 0 };
        const { getPlatformWallet, readPlatformBalance } = await import("@/lib/platform/wallets");
        const wallet = await getPlatformWallet("solana");
        sol = wallet ? ((await readPlatformBalance(wallet)).native ?? sol) : sol;
      } else {
        refuel = { kind: "failed", reason: outcome.reason };
      }
    } catch (err) {
      // The checklist reports; it must not fail because a refuel did.
      refuel = { kind: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  return gasStep({ chains: config.chains, platform: { sol, address, error }, refuel, viewerIsAdmin });
}

export interface PaperPositionsStepInput {
  slug: string;
  /** Already live: the switch this row guards has been made. */
  live: boolean;
  /**
   * One entry per simulated position still open: its symbol, or null when the token has
   * none on record. `null` for the whole list when the book could not be read.
   */
  symbols: Array<string | null> | null;
}

/** " (WIF, JUP, BONK and 2 more)", or nothing when no symbol is on record. */
function namedSymbols(symbols: Array<string | null>): string {
  // A symbol is whatever the token's creator typed, so it is trimmed and kept short.
  const known = symbols.flatMap((symbol) => (symbol?.trim() ? [symbol.trim().slice(0, 12)] : []));
  if (known.length === 0) return "";
  const shown = known.slice(0, 3);
  const rest = symbols.length - shown.length;
  return ` (${shown.join(", ")}${rest > 0 ? ` and ${rest} more` : ""})`;
}

/**
 * Pure: the "No paper positions open" row.
 *
 * `goLiveAction` refuses the switch while the agent holds a simulated position, and it
 * used to be the only thing that said so: in a toast, after the owner had funded the
 * agent, cleared every row here and held the button. This row says it first, from the
 * same count the action refuses on (`./paper-positions.ts`), and links to where the
 * positions are sold. The action's own refusal stays as the last line of defence.
 */
export function paperPositionsStep(input: PaperPositionsStepInput): ReadinessStep {
  const base = { id: "paperPositions" as const, title: "No paper positions open" };
  if (input.live) {
    return { ...base, state: "pass", detail: "Already live. This check only guards the switch from paper.", fix: null };
  }
  if (input.symbols === null) {
    return {
      ...base,
      state: "fail",
      detail:
        "Could not read this agent's open positions, so there is no telling whether a paper one would be carried into the live book. Re-check in a moment.",
      fix: null,
    };
  }
  const count = input.symbols.length;
  if (count === 0) {
    return {
      ...base,
      state: "pass",
      detail: "Nothing simulated is on the book, so the live book starts clean.",
      fix: null,
    };
  }
  const one = count === 1;
  return {
    ...base,
    state: "fail",
    detail:
      `${count} paper position${one ? " is" : "s are"} still open${namedSymbols(input.symbols)}. ` +
      `${one ? "It is" : "They are"} simulated, so ${one ? "it" : "they"} cannot follow the agent into a live book. ` +
      `Sell ${one ? "it" : "them"} on the agent page first; on paper that costs nothing real.`,
    fix: { label: `Sell ${one ? "it" : "them"} on the agent page`, href: `/agents/${input.slug}#positions` },
  };
}

/** Read the book and hand it to {@link paperPositionsStep}. An agent already live has no switch left to guard. */
async function checkPaperPositions(agentId: string, slug: string): Promise<ReadinessStep> {
  try {
    const db = await getDb();
    const [agent] = await db.select({ mode: agents.mode }).from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent?.mode === "live") return paperPositionsStep({ slug, live: true, symbols: [] });
    const held = await listSimulatedOpenPositions(db, agentId);
    return paperPositionsStep({ slug, live: false, symbols: held.map((position) => position.symbol) });
  } catch (err) {
    // As with the database row: the driver's words go to the server log, not the checklist.
    console.error("[live-readiness] paper positions", err instanceof Error ? err.message : err);
    return paperPositionsStep({ slug, live: false, symbols: null });
  }
}

function sumAsset(
  wallets: Awaited<ReturnType<typeof getAgentWalletBalances>>,
  match: (asset: string) => boolean,
): number {
  return wallets
    .flatMap((w) => w.balances)
    .filter((b) => match(b.asset))
    .reduce((sum, b) => sum + b.amount, 0);
}

/**
 * The budget step — two layers, and the operator is told which is which.
 *
 *  - **App layer:** `riskGuard()` enforces `maxTradeUsd`, `maxDailyTrades`,
 *    `maxPositionPct` and `maxDataSpendUsdPerRun` before any executor is reached.
 *  - **Wallet layer:** a Privy policy attached to the agent's server wallets
 *    (`agents.walletBudget`, applied by the Wallet budget card in settings) that
 *    refuses to sign an over-cap USDC transfer no matter who asks — the model, a
 *    buggy run loop, or a compromised route in this app.
 *
 * The app layer is what has to sit at or under the per-trade cap the operator typed.
 * The wallet layer is optional (product decision, 2026-09-21): an agent can only ever
 * spend the USDC in its own wallet and simply stops when that is gone, so a missing
 * policy is worth a warning, never a block.
 *
 * With one exception: an agent that pays for its own thinking. Its wallet signs a
 * payment on every model step, and a run of such an agent is not started while its
 * Solana wallet has no policy (the `no_policy` stop). Going live without one would be
 * going live with an agent that never thinks, so for that agent a missing Solana policy
 * fails the step.
 */
export function checkBudget(
  config: AgentConfig,
  walletBudget: WalletBudget | null,
  capUsd: number,
  settings: string,
): ReadinessStep {
  const { risk } = config;
  const dailyMax = risk.maxTradeUsd * risk.maxDailyTrades;
  const appWithinCap = risk.maxTradeUsd <= capUsd;
  const appLayer = `Per trade ${fmtUsd(risk.maxTradeUsd)} (your cap: ${fmtUsd(capUsd)}), at most ${risk.maxDailyTrades} a day — ${fmtUsd(dailyMax)} of turnover, plus ${fmtUsd(risk.maxDataSpendUsdPerRun)} of data per run, enforced before the executor.`;

  if (!appWithinCap) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "fail",
      detail: `Its per-trade cap is ${fmtUsd(risk.maxTradeUsd)}, above the ${fmtUsd(capUsd)} you entered.`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }
  const ceiling = "Whatever happens, it can only ever spend the USDC in its own wallet, and it stops when that is gone.";
  if (thinkSource(config) === "usdc" && !walletBudget?.policyIds?.solana) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "fail",
      detail: `${appLayer} This agent pays for its own thinking from its Solana wallet, and it is not allowed to pay for anything until that wallet has a spending limit applied. Save the agent's risk settings to apply one.`,
      fix: { label: "Agent settings → Wallet budget", href: `${settings}#budget` },
    };
  }
  if (!walletBudget) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "warn",
      detail: `${appLayer} ${ceiling} No wallet-level budget is attached — optional; one would make the wallet itself refuse an over-cap transfer as a second layer.`,
      fix: { label: "Agent settings → Wallet budget", href: `${settings}#budget` },
    };
  }
  if (walletBudget.perTxUsd > capUsd) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "warn",
      detail: `${appLayer} ${ceiling} The wallet policy underneath allows up to ${fmtUsd(walletBudget.perTxUsd)} a transfer — looser than the app cap, which is the one that binds.`,
      fix: { label: "Agent settings → Wallet budget", href: `${settings}#budget` },
    };
  }
  return {
    id: "budget",
    title: "Spend caps applied",
    state: "pass",
    detail: `${appLayer} Underneath it, a wallet-level budget makes the wallet itself refuse any USDC transfer above ${fmtUsd(walletBudget.perTxUsd)} — enforced when it signs, whatever this app asks for.`,
    fix: null,
  };
}

/**
 * The risk step, in two halves.
 *
 * The first is {@link evaluateFirstTradeRisk} — a pure read of the config's shape. The
 * second is {@link simulateFirstTrade}, which runs the real guard against the real
 * balance, and exists because the shape check alone said "green" while every buy this
 * agent could make was going to be rejected. A checklist that disagrees with the code it
 * is checking is worse than no checklist.
 *
 * The detail always closes with the agent's **execution mode**, because "ready" means
 * two different things depending on it: in `auto` the first tick can fill, in `approve`
 * it can only propose, and an operator who has not been told which one they are in reads
 * a proposal as a trade. It is informational, never a failure — approve mode is the
 * default and the safer of the two.
 */
async function checkRisk(
  config: AgentConfig,
  capUsd: number,
  usdc: number | null,
  settings: string,
): Promise<ReadinessStep> {
  const verdict = evaluateFirstTradeRisk(config, capUsd);
  const mode =
    config.execution.mode === "auto"
      ? "Execution mode is auto: the first tick can sign and fill on its own."
      : `Execution mode is approve: the first tick will write a proposal with a ${config.execution.proposalTtlMinutes}-minute window and wait for you, not fill.`;

  if (!verdict.ok) {
    return {
      id: "risk",
      title: "Risk config sane for a first trade",
      state: "fail",
      detail: `Not yet: ${verdict.problems.join("; ")}. ${mode}`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  const chains = config.chains.length === 1 ? `One chain (${chainNames(config.chains)})` : chainNames(config.chains);
  const shape = `${chains}, ${fmtUsd(config.risk.maxTradeUsd)} a trade, ${config.risk.maxDailyTrades} a day, at most ${config.risk.maxPositionPct}% of equity in one token, with an exit rule in place.`;

  if (usdc === null) {
    return {
      id: "risk",
      title: "Risk config sane for a first trade",
      state: "warn",
      detail: `${shape} The balance could not be read, so a trade could not be simulated against it. ${mode}`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  const refusal = await simulateFirstTrade(config, usdc);
  if (refusal) {
    return {
      id: "risk",
      title: "Risk config sane for a first trade",
      state: "fail",
      detail: `${refusal}. ${mode}`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  if (verdict.cautions.length > 0) {
    return {
      id: "risk",
      title: "Risk config sane for a first trade",
      state: "warn",
      detail: `${shape} Simulated against the ${fmtUsd(usdc)} it holds, a ${fmtUsd(config.risk.maxTradeUsd)} buy clears the risk guard. ${mode} Worth knowing: ${verdict.cautions.join("; ")}.`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  return {
    id: "risk",
    title: "Risk config sane for a first trade",
    state: "pass",
    detail: `${shape} Simulated against the ${fmtUsd(usdc)} it holds, a ${fmtUsd(config.risk.maxTradeUsd)} buy clears the risk guard. ${mode}`,
    fix: null,
  };
}

/**
 * The `data` step: the agent's own source list *and* every wallet that will pay for it.
 *
 * Both have to be true for a paid call to work, and they fail in completely different
 * places, so the step reports whichever is wrong and sends the operator to the right
 * screen for it.
 */
async function checkData(config: AgentConfig, settings: string, viewerIsAdmin: boolean): Promise<ReadinessStep> {
  const step = checkDataSources(config, settings, viewerIsAdmin);
  // Mock mode already fails the step for a better reason, and there is no wallet
  // question when nothing is being paid.
  if (isMockMode() || step.state === "fail") return step;

  const platform = await checkPlatformDataWallets(config);
  if (platform) {
    // Tocker's data wallets are Tocker's to fund. An owner is told what it means for
    // them; the addresses, the admin page and the instructions are for an admin.
    return {
      id: "data",
      title: "Data sources live",
      state: platform.state,
      detail: viewerIsAdmin
        ? platform.detail
        : platform.state === "fail"
          ? "Tocker's wallet that pays for this agent's data isn't ready yet, so its paid sources would fail. That is on us, not you."
          : "Tocker couldn't confirm the wallet that pays for this agent's data just now. Paid sources may fail on the first run.",
      fix: viewerIsAdmin ? PLATFORM_CARD : null,
    };
  }
  return { ...step, detail: `${step.detail} ${dataWalletSummary(config)}`.trimEnd() };
}

/**
 * Where an operator goes to see the platform wallets and their balances.
 *
 * `/settings/admin#platform`, not `/settings#platform`: the Platform card moved behind
 * `requireAdmin()` in W6, and the anchor it used to live at leads to a page that no
 * longer has it. A fix link that leads nowhere is worse than no fix link — the operator
 * concludes the checklist is wrong rather than the URL.
 */
const PLATFORM_CARD = {
  label: "Settings → Admin → Platform wallets",
  href: "/settings/admin#platform",
} as const;

/** One sentence naming which wallet pays for what, for the passing case. */
function dataWalletSummary(config: AgentConfig): string {
  const chains = dataChainsFor(config.dataSources, config.chains);
  if (chains.length === 0) return "";
  return chains.length === 1
    ? `They all price on ${chainNames(chains)}, and Tocker's ${chainNames(chains)} wallet is funded to pay for them.`
    : `They price on ${chainNames(chains)}, and Tocker's wallets on both are funded to pay for them.`;
}

/**
 * The platform wallets that will pay for *this agent's* sources, checked only when real
 * payments are on.
 *
 * This used to check Base and nothing else, off a `DATA_CHAIN` constant — true of most
 * sources and false of the ones that matter for a Solana test.
 * `deepnets-token-safety` (in the default source list) and `solenrich-launches` price on
 * Solana, and `payingWalletFor` picks the platform wallet by the *resource's* network. A
 * green checklist over an empty Solana wallet meant the failure surfaced as a 402 in the
 * first run's log — exactly the class of surprise this screen exists to prevent.
 *
 * So the chains come from the registry, `dataChainsFor(config.dataSources, config.chains)`, and every
 * one of them is checked and named with its address.
 *
 * "Could not read it" is a `warn`, not a `fail`. That is the one place this screen bends
 * its own rule, and deliberately: the reader below returns `null` for unread and a number
 * for read (it used to return zero for both), so an unreadable balance is now
 * distinguishable from an empty wallet — and blocking a funded operator's test because
 * Privy's balance endpoint hiccuped costs more than letting a paid call fail with an
 * error that names the wallet to top up. A wallet we *read* and found empty is still a
 * hard fail.
 *
 * Returns null when there is nothing to say.
 */
async function checkPlatformDataWallets(
  config: AgentConfig,
): Promise<{ detail: string; state: "fail" | "warn" } | null> {
  const chains = dataChainsFor(config.dataSources, config.chains);
  if (chains.length === 0) return null;

  try {
    const { getPlatformWallet, readPlatformBalance } = await import("@/lib/platform/wallets");

    const missing: Chain[] = [];
    const empty: string[] = [];
    const unreadable: string[] = [];

    for (const chain of chains) {
      const wallet = await getPlatformWallet(chain);
      if (!wallet) {
        missing.push(chain);
        continue;
      }
      const reading = await readPlatformBalance(wallet);
      if (reading.usdc === null) {
        unreadable.push(`${chainLabelFor(chain)} (${wallet.address})${reading.error ? ` — ${reading.error}` : ""}`);
      } else if (!(reading.usdc > 0)) {
        empty.push(`${chainLabelFor(chain)} (${wallet.address})`);
      }
    }

    if (missing.length > 0) {
      return {
        state: "fail",
        detail:
          `This agent's sources price on ${chainNames(chains)}, but there is no platform wallet on ` +
          `${missing.map(chainLabelFor).join(" or ")} yet. Create both from Settings → Admin and send USDC to the addresses it ` +
          `shows — a wallet that does not exist cannot be funded, and a paid call on that chain can only 402.`,
      };
    }
    if (empty.length > 0) {
      return {
        state: "fail",
        detail:
          `The platform wallet on ${empty.join(" and ")} holds no USDC, and this agent has sources priced ` +
          `there, so those calls would answer 402. Top it up.`,
      };
    }
    if (unreadable.length > 0) {
      return {
        state: "warn",
        detail:
          `Could not read the platform wallet on ${unreadable.join("; ")}. It may be funded and it may not — ` +
          `check the Platform card before the first run rather than finding out from a 402.`,
      };
    }
    return null;
  } catch (err) {
    return {
      state: "warn",
      detail: `Could not check the platform data wallets: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function checkDataSources(config: AgentConfig, settings: string, viewerIsAdmin: boolean): ReadinessStep {
  // `isMockMode()` is the authority on what the runtime actually does: mock only
  // when X402_MOCK is exactly "1". Reading it rather than re-deriving the rule is
  // the point — a checklist that disagrees with the code it is checking is worse
  // than no checklist.
  // A retired id still saved on the config buys nothing and cannot be unticked in the
  // picker, so it is not held against the agent.
  const sourceIds = config.dataSources.filter((id) => !RETIRED_DATA_SOURCE_IDS.includes(id));
  const unknown = sourceIds.filter((id) => !getDataSource(id));

  if (isMockMode()) {
    return {
      id: "data",
      title: "Data sources live",
      state: "fail",
      detail: viewerIsAdmin
        ? "X402_MOCK=1, so every paid source returns a fixture. The agent would trade real money on canned data."
        : "Paid data runs on sample responses on this deployment, so the agent would trade real money on canned data.",
      fix: null,
    };
  }
  if (unknown.length > 0) {
    return {
      id: "data",
      title: "Data sources live",
      state: "fail",
      detail: `${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not in the data-source registry any more.`,
      fix: { label: "Agent settings → Data", href: `${settings}#data` },
    };
  }
  if (sourceIds.length === 0) {
    return {
      id: "data",
      title: "Data sources live",
      state: "warn",
      detail: "No paid sources configured. Scoring still runs on the free providers; the agent just buys no sentiment.",
      fix: { label: "Agent settings → Data", href: `${settings}#data` },
    };
  }
  return {
    id: "data",
    title: "Data sources live",
    state: "pass",
    detail: `Real x402 payments are on, and ${sourceIds.length} registered source${sourceIds.length === 1 ? "" : "s"} will be paid for, capped at ${fmtUsd(config.risk.maxDataSpendUsdPerRun)} a run.`,
    fix: null,
  };
}
