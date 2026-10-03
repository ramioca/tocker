import { DEFAULT_DATA_BUDGET_USD, usd2 } from "./signals-data";

/**
 * The defaults a new agent starts with, as the landing quotes them (the
 * Guardrails card, and the sample agent in sample.ts). A leaf module so the
 * page does not import the agent config (and zod) to print a dozen numbers;
 * `defaults.test.ts` fails the moment one of them drifts from
 * `DEFAULT_AGENT_CONFIG`.
 */
export const LANDING_DEFAULTS = {
  mode: "approve",
  intervalMinutes: 15,
  chains: ["solana"],
  dataSources: ["x-search", "cmc-quotes", "deepnets-token-safety"],
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

/** How each execution mode reads on the page. Every agent starts on paper. */
export const MODE_WORDS = { approve: "asks first", auto: "trades on its own" } as const;
const CHAIN_NAMES = { solana: "Solana", base: "Base" } as const;

/**
 * The chains a new agent starts on, then the one it can add. A no-break space
 * and a non-breaking hyphen keep "(Base opt‑in)" in one piece when it wraps.
 */
const chainsText = () => {
  const on = d.chains.map((c) => CHAIN_NAMES[c]).join(" and ");
  const off = (Object.keys(CHAIN_NAMES) as (keyof typeof CHAIN_NAMES)[]).filter((c) => !(d.chains as readonly string[]).includes(c));
  return off.length ? `${on} (${off.map((c) => CHAIN_NAMES[c]).join(" and ")} opt‑in)` : on;
};

/** The card's rows, read in pairs: label, value. */
export const DEFAULT_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Mode", `paper · ${MODE_WORDS[d.mode]}`],
  ["Runs", `every ${d.intervalMinutes} min`],
  ["Chains", chainsText()],
  ["Score floor", `${d.minScore} / 100`],
  ["Per trade", `$${d.maxTradeUsd}`],
  ["Per day", `${d.maxDailyTrades} trades`],
  ["Stop loss", `${d.stopLossPct}%`],
  ["Take profit", `${d.takeProfitPct}%`],
  ["Max slippage", `${d.slippageBps / 100}%`],
  ["Data per run", usd2(d.maxDataSpendUsdPerRun)],
  ["Min liquidity", `$${d.minLiquidityUsd / 1000}k`],
  ["Min age", `${d.minAgeMinutes} min`],
];
