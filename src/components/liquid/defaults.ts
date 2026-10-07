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

/**
 * What Tocker charges, as the FAQ says it. The amount is handed in from the server's
 * `platformFeeUsd()`, so the page never quotes a fee the product does not charge; with
 * the fee off the sentence is not there at all. Leads with a space: it closes the
 * answer about what data costs.
 */
export function feeSentence(feeUsd: number): string {
  if (!(feeUsd > 0)) return "";
  // Cents when it is a whole number of cents; a sub-cent fee is printed as it is set.
  const amount = Math.round(feeUsd * 100) / 100 === feeUsd ? feeUsd.toFixed(2) : String(feeUsd);
  return ` What Tocker charges is a flat $${amount} per filled trade, buy or sell, never a percentage of its size.`;
}

/** How many providers the page names before it says "and more". */
const NAMED_PROVIDERS = 3;

/**
 * The providers a key can be from, as a sentence names them. Up to three are all named
 * ("Anthropic, OpenAI or OpenRouter"); past that, the first three "and more".
 *
 * The names are handed in: they are the providers a key can be added for today, read
 * from the registry by the page (`PROVIDER_ORDER` in `src/lib/agent/providers.ts`). So
 * the page never names a provider that is not switched on, never says "and more" while
 * there are no more, and does not grow a line for every provider added.
 */
export function providerWords(names: readonly string[]): string {
  if (names.length > NAMED_PROVIDERS) return `${names.slice(0, NAMED_PROVIDERS).join(", ")} and more`;
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * "Which AI model runs it?" and "What do I need to start?".
 *
 * `payPerUseOpen` is the server's own switch, handed in: true only when pay-per-use
 * thinking is switched on for **everyone** (`INFERENCE_USDC=on`). Until then, which is
 * how the feature ships and every stage at which only invited accounts may use it, both
 * answers are word for word what they were: the page must not offer a visitor something
 * they cannot have. Once it is open, a visitor no longer needs a key to start, and the
 * old second answer would be false.
 *
 * The open wording keeps the order the product does: your own key first and recommended,
 * pay per use for someone without one. It says what leaves Tocker in that mode, because
 * that is a thing to know before choosing it, not after.
 *
 * `providers` is the names of the providers a key can be from, in the order the chooser
 * lists them. With the three the product started with, both answers read as they always
 * have ("Anthropic, OpenAI or OpenRouter").
 */
export function thinkingAnswers(payPerUseOpen: boolean, providers: readonly string[]): { model: string; start: string } {
  const named = providerWords(providers);
  // With nothing to name, the sentences still stand: they just name nobody.
  const keyModel = `The one you choose, on your own key${named ? `: ${named}` : ""}. Keys are encrypted at rest and decrypted only on our servers, to run your agent and to list the models your key can use. Your provider bills you for the model directly.`;
  const brackets = named ? ` (${named})` : "";
  if (!payPerUseOpen) {
    return {
      model: keyModel,
      start: `An email address and an API key for the model your agent runs on${brackets}. Every agent starts on paper, so there is nothing to deposit until you decide to go live.`,
    };
  }
  return {
    model: `${keyModel} An agent with no key can pay per use instead: each model step is bought in USDC from the agent’s own Solana wallet, from a short list of models. In that mode the agent’s strategy and transcript are sent to BlockRun and the model provider it uses.`,
    start: `An email address, and a way for your agent to think: your own API key${brackets}, which is what we recommend, or a few dollars of USDC in the agent’s own wallet to pay per use. Every agent starts on paper, so there is nothing to deposit for trading until you decide to go live.`,
  };
}
