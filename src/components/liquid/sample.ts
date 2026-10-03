import type { CoinName } from "./coins";

/**
 * The one sample agent the page follows: the hero shows its latest run, and
 * the How section opens that same run as its owner sees it. Real coins, made-up
 * scores, and no claim about any real token's safety checks: a sample never
 * says a real token passed or failed a hard gate.
 */

export const SAMPLE_AGENT = "momentum-scout";
export const SAMPLE_PROMPT = "Momentum on Solana and Base: buy when volume and holders both accelerate.";
/** `universe.minScore` of the default config; signals-data.test.ts keeps it in step. */
export const SAMPLE_FLOOR = 62;
export const SAMPLE_TRADE_USD = 100;
export const SAMPLE_STOP_PCT = 15;
export const SAMPLE_TAKE_PROFIT_PCT = 40;
/** Minutes between runs: `schedule.intervalMinutes` of the default config. */
export const SAMPLE_EVERY_MIN = 15;
export const SAMPLE_SCORED = 38;
export const SAMPLE_RUN_AT = "14:15";
export const SAMPLE_NEXT_RUN_AT = "14:30";

export type SampleRow = { coin: CoinName; chain: "Solana" | "Base"; score: number };

/** The run's top three by score order of the story: two clear the floor, one doesn't. */
export const SAMPLE_ROWS = [
  { coin: "TIBBIR", chain: "Base", score: 81 },
  { coin: "SOL", chain: "Solana", score: 77 },
  { coin: "SUPER INU", chain: "Solana", score: 58 },
] as const satisfies readonly SampleRow[];

export const clearsFloor = (score: number) => score >= SAMPLE_FLOOR;
