import "server-only";
import { sql } from "drizzle-orm";
import { getDb, isPglite } from "@/db";
import { isPrivyConfigured } from "@/lib/privy";
import { getAgentWalletBalances, isPaperWallet } from "@/lib/wallets";
import { getDataSource } from "@/lib/data-sources/registry";
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
 */

export type StepState = "pass" | "warn" | "fail";

export interface ReadinessStep {
  id: ReadinessStepId;
  title: string;
  state: StepState;
  /** What is true right now, in one sentence. */
  detail: string;
  /** Where to go to fix it. `null` when there is nothing to fix. */
  fix: { label: string; href: string } | null;
}

export type ReadinessStepId =
  | "database"
  | "privy"
  | "mfa"
  | "wallets"
  | "funding"
  | "budget"
  | "risk"
  | "data"
  | "killswitch";

export interface LiveReadiness {
  agentId: string;
  slug: string;
  steps: ReadinessStep[];
  /** True when nothing is `fail`. Warnings do not block. */
  ready: boolean;
  /** Minimum USDC we insist on before a first live trade. */
  minUsdc: number;
  /** What the operator's caps currently are, for the confirmation copy. */
  caps: { maxTradeUsd: number; maxDailyTrades: number; chains: Chain[] };
  checkedAt: string;
}

/** Enough USDC for one small trade plus slippage, and some native for gas. */
export const MIN_USDC = 5;

/**
 * The shape a first live trade should have: one chain, a tiny notional, one trade
 * a day. Deliberately conservative — the point of the first trade is to prove the
 * pipeline signs, fills and reports, not to make money.
 */
export const FIRST_TRADE_PRESET = {
  maxTradeUsd: 2,
  maxDailyTrades: 1,
  maxPositionPct: 10,
} as const;

export interface RiskVerdict {
  ok: boolean;
  problems: string[];
}

/**
 * Pure: is this risk config sane for a *first* live trade, given the per-trade cap
 * the operator typed into the wizard? Separated out so it is testable without a
 * database, a wallet or a network.
 */
export function evaluateFirstTradeRisk(config: AgentConfig, capUsd: number): RiskVerdict {
  const problems: string[] = [];
  const { risk, chains } = config;

  if (chains.length !== 1) {
    problems.push(
      `it trades ${chains.length === 0 ? "no chains" : `${chains.length} chains`}; a first live trade should be on one chain so there is one thing to debug`,
    );
  }
  if (!(capUsd > 0)) {
    problems.push("the per-trade cap you entered must be greater than zero");
  } else if (risk.maxTradeUsd > capUsd) {
    problems.push(`its max per trade is $${risk.maxTradeUsd} but you asked for a cap of $${capUsd}`);
  }
  if (risk.maxTradeUsd > FIRST_TRADE_PRESET.maxTradeUsd) {
    problems.push(`its max per trade is $${risk.maxTradeUsd}; keep the first one at $${FIRST_TRADE_PRESET.maxTradeUsd} or less`);
  }
  if (risk.maxDailyTrades > FIRST_TRADE_PRESET.maxDailyTrades) {
    problems.push(`it may make ${risk.maxDailyTrades} trades a day; allow one until you have seen a fill`);
  }
  if (risk.stopLossPct === null && risk.takeProfitPct === null && risk.trailingStopPct === null) {
    problems.push("it has no stop loss, take profit or trailing stop — the exit engine has nothing to enforce");
  }

  return { ok: problems.length === 0, problems };
}

/** Apply the preset to a config without touching anything else about it. */
export function withFirstTradePreset(config: AgentConfig): AgentConfig {
  const chains: Chain[] = config.chains.length > 1 ? [config.chains[0] as Chain] : [...config.chains];
  return {
    ...config,
    chains: chains.length > 0 ? chains : ["base"],
    risk: {
      ...config.risk,
      maxTradeUsd: Math.min(config.risk.maxTradeUsd, FIRST_TRADE_PRESET.maxTradeUsd),
      maxDailyTrades: Math.min(config.risk.maxDailyTrades, FIRST_TRADE_PRESET.maxDailyTrades),
      maxPositionPct: Math.min(config.risk.maxPositionPct, FIRST_TRADE_PRESET.maxPositionPct),
      // A first live trade with no floor under it is not a test, it is a donation.
      stopLossPct: config.risk.stopLossPct ?? 25,
    },
  };
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

  const [database, privy, mfa, wallets, killSwitch] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkPrivy()),
    checkMfa(input.ownerId),
    checkWallets(input.agentId, input.config.chains, settings),
    getKillSwitch(input.ownerId),
  ]);

  const steps: ReadinessStep[] = [
    database,
    privy,
    mfa,
    wallets.walletsStep,
    wallets.fundingStep,
    checkBudget(input.config, input.walletBudget ?? null, capUsd, settings),
    checkRisk(input.config, capUsd, settings),
    checkDataSources(input.config, settings),
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
  return {
    id: "mfa",
    title: "Second factor enrolled",
    state: "fail",
    detail: status.blockedReason ?? "Your Privy account has no second factor enrolled.",
    fix: { label: "Settings → Security", href: "/settings/security" },
  };
}

async function checkWallets(
  agentId: string,
  chains: Chain[],
  settings: string,
): Promise<{ walletsStep: ReadinessStep; fundingStep: ReadinessStep }> {
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
        fix: { label: "Agent settings", href: settings },
      }
    : missing.length > 0
      ? {
          id: "wallets",
          title: "Real agent wallets",
          state: "fail",
          detail: `No wallet on ${missing.join(" and ")}. The agent cannot trade a chain it has no wallet for.`,
          fix: { label: "Agent settings", href: settings },
        }
      : paper.length > 0
        ? {
            id: "wallets",
            title: "Real agent wallets",
            state: "fail",
            detail: `${paper.map((w) => w.chain).join(" and ")} still has a \`paper_\` placeholder wallet, created because Privy was unconfigured when the agent was made. It holds nothing and can sign nothing.`,
            fix: { label: "Agent settings", href: settings },
          }
        : {
            id: "wallets",
            title: "Real agent wallets",
            state: "pass",
            detail: `Privy server wallets on ${relevant.map((w) => w.chain).join(" and ")}, owned by the app's authorization key.`,
            fix: null,
          };

  const usdc = sumAsset(relevant, (asset) => asset === "usdc");
  const gasUsd = relevant
    .flatMap((w) => w.balances)
    .filter((b) => b.asset !== "usdc")
    .reduce((sum, b) => sum + (b.usd ?? 0), 0);
  const gasAmount = sumAsset(relevant, (asset) => asset !== "usdc");

  const fundedUsdc = usdc >= MIN_USDC;
  // Privy sometimes omits the USD quote for a native balance; a non-zero raw
  // amount is still gas, so accept either signal rather than blocking on a quote.
  const fundedGas = gasUsd > 0 || gasAmount > 0;

  const fundingStep: ReadinessStep = {
    id: "funding",
    title: "Funded above the minimum",
    state: walletsStep.state === "fail" ? "fail" : fundedUsdc && fundedGas ? "pass" : "fail",
    detail:
      walletsStep.state === "fail"
        ? "Cannot check a balance until the agent has real wallets."
        : `${usdc.toFixed(2)} USDC (need ${MIN_USDC.toFixed(2)}) and ${
            fundedGas ? "some" : "no"
          } native balance for gas.`,
    fix: fundedUsdc && fundedGas ? null : { label: "Fund this agent", href: settings },
  };

  return { walletsStep, fundingStep };
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
 * Both must sit at or under the per-trade cap the operator typed into the wizard.
 * A missing wallet policy is a hard fail for a *first live trade* specifically:
 * the whole point of the first one is that the floor under it is real.
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
      fix: { label: "Agent settings → Risk", href: settings },
    };
  }
  if (!walletBudget) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "fail",
      detail: `${appLayer} But no wallet budget is attached: nothing below this app refuses an over-cap transfer, so a bug here has no floor under it.`,
      fix: { label: "Agent settings → Wallet budget", href: settings },
    };
  }
  if (walletBudget.perTxUsd > capUsd) {
    return {
      id: "budget",
      title: "Spend caps applied",
      state: "fail",
      detail: `${appLayer} The wallet policy caps transfers at $${walletBudget.perTxUsd}, above the $${capUsd} you entered.`,
      fix: { label: "Agent settings → Wallet budget", href: settings },
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

function checkRisk(config: AgentConfig, capUsd: number, settings: string): ReadinessStep {
  const verdict = evaluateFirstTradeRisk(config, capUsd);
  return {
    id: "risk",
    title: "Risk config sane for a first trade",
    state: verdict.ok ? "pass" : "fail",
    detail: verdict.ok
      ? `One chain (${config.chains.join("")}), $${config.risk.maxTradeUsd} a trade, ${config.risk.maxDailyTrades} a day, with an exit rule in place.`
      : `Not yet: ${verdict.problems.join("; ")}.`,
    fix: verdict.ok ? null : { label: "Agent settings → Risk", href: settings },
  };
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
      fix: { label: "Agent settings → Data", href: settings },
    };
  }
  if (config.dataSources.length === 0) {
    return {
      id: "data",
      title: "Data sources live",
      state: "warn",
      detail: "No paid sources configured. Scoring still runs on the free providers; the agent just buys no sentiment.",
      fix: { label: "Agent settings → Data", href: settings },
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
