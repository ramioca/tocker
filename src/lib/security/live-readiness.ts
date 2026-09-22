import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { agentFundingIntents, getDb, isPglite } from "@/db";
import { isPrivyConfigured } from "@/lib/privy";
import { getAgentWalletBalances, isPaperWallet } from "@/lib/wallets";
// Constants and the pure helper only — the effectful half of `gas.ts` is workstream A's.
import { MIN_AGENT_SOL, MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { dataChainsFor, getDataSource } from "@/lib/data-sources/registry";
import { isMockMode } from "@/lib/x402/paidFetch";
import { getMfaStatus } from "./mfa";
import { getKillSwitch } from "./kill-switch";
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

/** Enough USDC for one small trade plus slippage, and some native for gas. */
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
    problems.push(`its max per trade is $${risk.maxTradeUsd} but you asked for a cap of $${capUsd}`);
  }
  if (risk.maxTradeUsd > FIRST_TRADE_PRESET.maxTradeUsd) {
    cautions.push(
      `its max per trade is $${risk.maxTradeUsd}, above the $${FIRST_TRADE_PRESET.maxTradeUsd} preset — allowed; the preset button shrinks it if you would rather prove the pipeline with less`,
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
 * Returns `null` when the trade would be allowed.
 */
export async function simulateFirstTrade(config: AgentConfig, usdc: number): Promise<string | null> {
  const [{ riskGuard }, { platformFeeUsd }] = await Promise.all([
    import("@/lib/trading/risk"),
    import("@/lib/platform/fee"),
  ]);
  const chain: Chain = (config.chains[0] as Chain) ?? "base";
  const amountUsd = config.risk.maxTradeUsd;

  const verdict = riskGuard(
    { id: "readiness-simulation", mode: "live", config },
    { cashUsd: usdc, equityUsd: usdc, positions: [], tradesToday: 0 },
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
    `A $${amountUsd.toFixed(2)} buy against the $${usdc.toFixed(2)} this agent holds` +
    `${fee > 0 ? ` (plus the $${fee.toFixed(2)} Tocker fee)` : ""} would be refused by the risk guard: ${verdict.reason}`
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

  const [database, privy, mfa, wallets, killSwitch, data] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkPrivy()),
    checkMfa(input.ownerId),
    checkWallets(input.agentId, input.config.chains, settings),
    getKillSwitch(input.ownerId),
    checkData(input.config, settings),
  ]);

  // The risk step is the only one that has to wait for a balance, because the whole
  // point of it now is to run the real guard against the real number.
  const [risk, gas] = await Promise.all([
    checkRisk(input.config, capUsd, wallets.usdc, settings),
    checkGas(input.config, wallets.agentSol),
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
  ];

  return {
    agentId: input.agentId,
    slug: input.slug,
    steps,
    ready: steps.every((s) => s.state !== "fail"),
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

async function checkDatabase(): Promise<ReadinessStep> {
  const embedded = isPglite();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    if (embedded && process.env.NODE_ENV === "production") {
      return {
        id: "database",
        title: "Production database reachable",
        state: "fail",
        detail:
          "This deploy is running on embedded PGlite — a file on an ephemeral disk. Every trade it records is lost when the instance recycles.",
        fix: { label: "Read /api/health", href: "/api/health" },
      };
    }
    return {
      id: "database",
      title: "Production database reachable",
      state: embedded ? "warn" : "pass",
      detail: embedded
        ? "Answering, but this is the local embedded PGlite file. Fine for development; never for real money."
        : "Answering queries.",
      fix: embedded ? { label: "Read /api/health", href: "/api/health" } : null,
    };
  } catch (err) {
    return {
      id: "database",
      title: "Production database reachable",
      state: "fail",
      detail: `The database did not answer: ${err instanceof Error ? err.message : String(err)}`,
      fix: { label: "Read /api/health", href: "/api/health" },
    };
  }
}

function checkPrivy(): ReadinessStep {
  const configured = isPrivyConfigured();
  const hasAuthKey = Boolean(process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY?.trim());
  if (!configured) {
    return {
      id: "privy",
      title: "Privy configured",
      state: "fail",
      detail: "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET are not both set, so there are no real wallets to trade from.",
      fix: null,
    };
  }
  if (!hasAuthKey) {
    return {
      id: "privy",
      title: "Privy configured",
      state: "fail",
      detail:
        "PRIVY_AUTHORIZATION_PRIVATE_KEY is missing. The server owns agent wallets with that key; without it it cannot sign a trade.",
      fix: null,
    };
  }
  return {
    id: "privy",
    title: "Privy configured",
    state: "pass",
    detail: "App credentials and the wallet authorization key are present. `pnpm preflight` proves they actually sign.",
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
      detail: `Privy reports ${status.userMethods.join(", ")} enrolled on your account.`,
      fix: null,
    };
  }
  // Optional: a second factor is recommended for an account that moves real money,
  // but it is not a condition of going live.
  return {
    id: "mfa",
    title: "Second factor (optional)",
    state: "pass",
    detail: status.blockedReason ?? "No second factor enrolled. Optional — enrol one in Settings → Security if you want it.",
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
  /** SOL on the agent's Solana wallet, for the gas step. */
  agentSol: number;
}> {
  let balances: Awaited<ReturnType<typeof getAgentWalletBalances>> = [];
  let error: string | null = null;
  try {
    balances = await getAgentWalletBalances(agentId);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const relevant = balances.filter((w) => chains.includes(w.chain));
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
          detail: `No wallet on ${missing.join(" and ")}. The agent cannot trade a chain it has no wallet for.`,
          fix: { label: "Agent settings → Wallets", href: `${settings}#wallets` },
        }
      : paper.length > 0
        ? {
            id: "wallets",
            title: "Real agent wallets",
            state: "fail",
            detail: `${paper.map((w) => w.chain).join(" and ")} still has a \`paper_\` placeholder wallet, created because Privy was unconfigured when the agent was made. It holds nothing and can sign nothing.`,
            fix: { label: "Agent settings → Wallets", href: `${settings}#wallets` },
          }
        : {
            id: "wallets",
            title: "Real agent wallets",
            state: "pass",
            detail: `Privy server wallets on ${relevant.map((w) => w.chain).join(" and ")}, owned by the app's authorization key.`,
            fix: null,
          };

  const usdc = sumAsset(relevant, (asset) => asset === "usdc");
  // SOL on the agent's Solana wallet specifically — the gas step's input. A Base wallet's
  // ETH is a different question, and Base gas is not the one that fails.
  const agentSol = relevant
    .filter((w) => w.chain === "solana")
    .flatMap((w) => w.balances)
    .filter((b) => b.asset.toLowerCase() === "sol")
    .reduce((sum, b) => sum + b.amount, 0);

  const fundedUsdc = usdc >= MIN_USDC;

  // An unfunded agent whose owner already asked for funding at creation deserves the
  // story, not a fresh "Fund this agent": what they asked for, why it did not land, and
  // a retry. The $50 case that prompted this failed because the fee wallet was dry.
  let intentNote = "";
  let fixLabel = "Fund this agent";
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
        const label = Number.isFinite(amount) && amount > 0 ? `$${amount.toFixed(2)}` : "your";
        if (intent.status === "failed") {
          const why = intent.error ? ` — ${intent.error.split(". ")[0].slice(0, 220)}` : "";
          intentNote = ` The ${label} funding you set up at creation did not go through${why}. Tocker's fee wallet now refuels itself, so a retry should land.`;
          fixLabel = `Retry the ${label} funding`;
        } else if (intent.status === "pending" || intent.status === "sent") {
          intentNote = ` The ${label} funding from creation is ${intent.status === "sent" ? "confirming on chain" : "still pending"} — reload in a minute.`;
        }
      }
    } catch {
      // The balance is the answer; the intent is context.
    }
  }

  const fundingStep: ReadinessStep = {
    id: "funding",
    title: "Funded above the minimum",
    state: walletsStep.state === "fail" ? "fail" : fundedUsdc ? "pass" : "fail",
    detail:
      walletsStep.state === "fail"
        ? "Cannot check a balance until the agent has real wallets."
        : `${usdc.toFixed(2)} USDC (need ${MIN_USDC.toFixed(2)}).${intentNote}`,
    fix: fundedUsdc ? null : { label: fixLabel, href: `${settings}#wallets` },
  };

  return { walletsStep, fundingStep, usdc: walletsStep.state === "fail" ? null : usdc, agentSol };
}

/**
 * Gas: can anything here actually pay a Solana network fee?
 *
 * The checklist used to assert "Gas is sponsored" on the funding line and leave it
 * there. Nothing in the app passes `sponsor: true` to Privy on the swap path, so that
 * line was a claim, not a check. An agent funded with USDC and no SOL depends on one of
 * three things, and this step says which one it is standing on:
 *
 *  1. Jupiter Ultra goes gasless on its own when the taker holds under ~0.01 SOL and the
 *     order is not in manual-slippage mode — Jupiter's call, per route and per token;
 *  2. failing that, the platform Solana wallet drips {@link GAS_DRIP_SOL} to the agent
 *     (`ensureAgentGas`), which needs the platform wallet to hold {@link MIN_PLATFORM_SOL};
 *  3. the agent holding {@link MIN_AGENT_SOL} itself.
 *
 * ## Why an empty platform wallet is now a fail, not a warning
 *
 * Because the operator cannot get money *in* without it. The platform Solana wallet is
 * the fee payer on the funding transfer itself (`prepareSponsoredFunding`): the user's
 * embedded wallet holds USDC and no SOL, so if the platform cannot pay, there is no
 * funding transfer to make — and withdrawing or sweeping fees back out needs a drip from
 * the same wallet. It also still drips gas for trades and pays the agent's token-account
 * rent. The agent holding its own SOL covers item 3 and nothing else, so it can no
 * longer rescue an empty platform wallet the way it used to.
 *
 * Base-only agents skip it: Base swaps do not ask the agent's wallet for a native
 * balance, and a step that reports on a chain the agent does not trade is noise.
 */
async function checkGas(config: AgentConfig, agentSol: number): Promise<ReadinessStep> {
  const title = "Network fees";
  if (!config.chains.includes("solana")) {
    return {
      id: "gas",
      title,
      state: "pass",
      detail: "This agent trades Base only, where the swap path does not ask its wallet for a native balance.",
      fix: null,
    };
  }

  const agentOk = agentSol >= MIN_AGENT_SOL;

  let platformSol: number | null = null;
  let platformAddress: string | null = null;
  let platformError: string | null = null;
  try {
    const { getPlatformWallet, readPlatformBalance } = await import("@/lib/platform/wallets");
    const wallet = await getPlatformWallet("solana");
    if (!wallet) {
      platformError = "it has not been created yet";
    } else {
      platformAddress = wallet.address;
      const reading = await readPlatformBalance(wallet);
      platformSol = reading.native;
      platformError = reading.error;
    }
  } catch (err) {
    platformError = err instanceof Error ? err.message : String(err);
  }

  // Short: let the wallet refuel itself from its own USDC before saying anything, but
  // give it eight seconds — this runs while a page renders. A swap that is still in
  // flight is reported as such and finished on the next tick.
  let refuelNote = "";
  if (platformSol !== null && platformSol < MIN_PLATFORM_SOL && platformAddress) {
    try {
      const { ensurePlatformSol } = await import("@/lib/platform/sol");
      const outcome = await Promise.race([
        ensurePlatformSol("the live checklist"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (outcome === null) {
        refuelNote = " It is converting a little of its USDC to SOL right now — reload in a minute.";
      } else if (outcome.refueled) {
        const { getPlatformWallet, readPlatformBalance } = await import("@/lib/platform/wallets");
        const wallet = await getPlatformWallet("solana");
        platformSol = wallet ? (await readPlatformBalance(wallet)).native : platformSol;
        refuelNote = ` It just converted $${(outcome.usdc ?? 0).toFixed(2)} of its USDC to SOL.`;
      } else {
        refuelNote = ` It refuels itself from its own USDC, but ${outcome.reason}.`;
      }
    } catch {
      // The checklist reports; it must not fail because a refuel did.
    }
  }

  const platformOk = platformSol !== null && platformSol >= MIN_PLATFORM_SOL;
  const platformSays =
    platformSol !== null
      ? `${platformSol.toFixed(4)} SOL${platformAddress ? ` (${platformAddress})` : ""}`
      : `an unreadable balance${platformError ? ` — ${platformError}` : ""}`;
  const agentSays = `${agentSol.toFixed(4)} SOL`;

  if (!platformOk) {
    // A fail however much SOL the agent holds: this wallet pays the fee on the
    // operator's funding transfer and on every drip, withdrawal and sweep. It refuels
    // itself from its own USDC; when even that cannot happen, the one thing to do is
    // send it USDC or SOL — said once, plainly, without the mechanics.
    return {
      id: "gas",
      title,
      state: "fail",
      detail:
        `Tocker's Solana wallet pays every network fee for you — on your funding transfer and on the agent's ` +
        `trades — and it holds ${platformSays}, under the ${MIN_PLATFORM_SOL} SOL it keeps.${refuelNote}`,
      fix: { label: "Settings → Admin → Platform wallets", href: PLATFORM_CARD.href },
    };
  }
  return {
    id: "gas",
    title,
    state: "pass",
    detail: agentOk
      ? `Covered. The agent holds ${agentSays} and Tocker's Solana wallet holds ${platformSays}; you never fund SOL yourself.`
      : `Covered. Tocker's Solana wallet (${platformSays}) pays the fees and tops the agent up when a trade needs it${
          refuelNote.trim() ? ` —${refuelNote}` : ""
        }; you never fund SOL yourself.`,
    fix: null,
  };
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
 */
function checkBudget(
  config: AgentConfig,
  walletBudget: WalletBudget | null,
  capUsd: number,
  settings: string,
): ReadinessStep {
  const { risk } = config;
  const dailyMax = risk.maxTradeUsd * risk.maxDailyTrades;
  const appWithinCap = risk.maxTradeUsd <= capUsd;
  const appLayer = `Per trade $${risk.maxTradeUsd} (your cap: $${capUsd}), at most ${risk.maxDailyTrades} a day — $${dailyMax.toFixed(2)} of turnover, plus $${risk.maxDataSpendUsdPerRun} of data per run, enforced before the executor.`;

  if (!appWithinCap) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "fail",
      detail: `Its per-trade cap is $${risk.maxTradeUsd}, above the $${capUsd} you entered.`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }
  const ceiling = "Whatever happens, it can only ever spend the USDC in its own wallet, and it stops when that is gone.";
  if (!walletBudget) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "warn",
      detail: `${appLayer} ${ceiling} No Privy wallet policy is attached — optional; one would make the wallet itself refuse an over-cap transfer as a second layer.`,
      fix: { label: "Agent settings → Wallet budget", href: `${settings}#budget` },
    };
  }
  if (walletBudget.perTxUsd > capUsd) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "warn",
      detail: `${appLayer} ${ceiling} The wallet policy underneath allows up to $${walletBudget.perTxUsd} a transfer — looser than the app cap, which is the one that binds.`,
      fix: { label: "Agent settings → Wallet budget", href: `${settings}#budget` },
    };
  }
  return {
    id: "budget",
    title: "Spend caps applied",
    state: "pass",
    detail: `${appLayer} Underneath it, a Privy policy makes the wallet itself refuse any USDC transfer above $${walletBudget.perTxUsd} — enforced when it signs, whatever this app asks for.`,
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
      ? "Execution mode is **auto**: the first tick can sign and fill on its own."
      : `Execution mode is **approve**: the first tick will write a proposal with a ${config.execution.proposalTtlMinutes}-minute window and wait for you, not fill.`;

  if (!verdict.ok) {
    return {
      id: "risk",
      title: "Risk config sane for a first trade",
      state: "fail",
      detail: `Not yet: ${verdict.problems.join("; ")}. ${mode}`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  const shape = `One chain (${config.chains.join("")}), $${config.risk.maxTradeUsd} a trade, ${config.risk.maxDailyTrades} a day, at most ${config.risk.maxPositionPct}% of equity in one token, with an exit rule in place.`;

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
      detail: `${shape} Simulated against the $${usdc.toFixed(2)} it holds, a $${config.risk.maxTradeUsd.toFixed(2)} buy clears the risk guard. ${mode} Worth knowing: ${verdict.cautions.join("; ")}.`,
      fix: { label: "Agent settings → Risk", href: `${settings}#risk` },
    };
  }

  return {
    id: "risk",
    title: "Risk config sane for a first trade",
    state: "pass",
    detail: `${shape} Simulated against the $${usdc.toFixed(2)} it holds, a $${config.risk.maxTradeUsd.toFixed(2)} buy clears the risk guard. ${mode}`,
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
async function checkData(config: AgentConfig, settings: string): Promise<ReadinessStep> {
  const step = checkDataSources(config, settings);
  // Mock mode already fails the step for a better reason, and there is no wallet
  // question when nothing is being paid.
  if (isMockMode() || step.state === "fail") return step;

  const platform = await checkPlatformDataWallets(config);
  if (platform) {
    return {
      id: "data",
      title: "Data sources live",
      state: platform.state,
      detail: platform.detail,
      fix: PLATFORM_CARD,
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
    ? `They all price on ${chains[0]}, and the platform's ${chains[0]} wallet is funded to pay for them.`
    : `They price on ${chains.join(" and ")}, and the platform's wallets on both are funded to pay for them.`;
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
        unreadable.push(`${chain} (${wallet.address})${reading.error ? ` — ${reading.error}` : ""}`);
      } else if (!(reading.usdc > 0)) {
        empty.push(`${chain} (${wallet.address})`);
      }
    }

    if (missing.length > 0) {
      return {
        state: "fail",
        detail:
          `This agent's sources price on ${chains.join(" and ")}, but there is no platform wallet on ` +
          `${missing.join(" or ")} yet. Create both from Settings → Admin and send USDC to the addresses it ` +
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

function checkDataSources(config: AgentConfig, settings: string): ReadinessStep {
  // `isMockMode()` is the authority on what the runtime actually does: mock only
  // when X402_MOCK is exactly "1". Reading it rather than re-deriving the rule is
  // the point — a checklist that disagrees with the code it is checking is worse
  // than no checklist.
  const unknown = config.dataSources.filter((id) => !getDataSource(id));

  if (isMockMode()) {
    return {
      id: "data",
      title: "Data sources live",
      state: "fail",
      detail: "X402_MOCK=1, so every paid source returns a fixture. The agent would trade real money on canned data.",
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
  if (config.dataSources.length === 0) {
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
    detail: `Real x402 payments are on, and ${config.dataSources.length} registered source${config.dataSources.length === 1 ? "" : "s"} will be paid for, capped at $${config.risk.maxDataSpendUsdPerRun} a run.`,
    fix: null,
  };
}
