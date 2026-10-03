import { DEFAULT_DATA_BUDGET_USD } from "./signals-data";

/**
 * The defaults a new agent starts with, as the landing's Guardrails card
 * quotes them. A leaf module so the page does not import the agent config (and
 * zod) to print twelve numbers; `defaults.test.ts` fails the moment one of them
 * drifts from `DEFAULT_AGENT_CONFIG`.
 */
export const LANDING_DEFAULTS = {
  mode: "approve",
  intervalMinutes: 15,
  chains: ["solana"],
  minScore: 62,
  maxTradeUsd: 100,
  maxDailyTrades: 10,
  stopLossPct: 15,
  takeProfitPct: 40,
  slippageBps: 300,
  maxDataSpendUsdPerRun: DEFAULT_DATA_BUDGET_USD,
  minLiquidityUsd: 15_000,
  minAgeMinutes: 30,
} as const;

const d = LANDING_DEFAULTS;

/** The card's rows, read in pairs: label, value. Every agent starts on paper; "asks first" is the approve mode. */
export const DEFAULT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Mode", "paper · asks first"],
  ["Runs", `every ${d.intervalMinutes} min`],
  ["Chains", "Solana (Base opt-in)"],
  ["Score floor", `${d.minScore} / 100`],
  ["Per trade", `$${d.maxTradeUsd}`],
  ["Per day", `${d.maxDailyTrades} trades`],
  ["Stop loss", `${d.stopLossPct}%`],
  ["Take profit", `${d.takeProfitPct}%`],
  ["Max slippage", `${d.slippageBps / 100}%`],
  ["Data per run", `$${d.maxDataSpendUsdPerRun.toFixed(2)}`],
  ["Min liquidity", `$${d.minLiquidityUsd / 1000}k`],
  ["Min age", `${d.minAgeMinutes} min`],
];
