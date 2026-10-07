import type { CoinName } from "./coins";
import { LANDING_DEFAULTS, MODE_WORDS } from "./defaults";

/**
 * The one sample agent the page follows: the hero shows its latest run, and
 * the How section opens that same run as its owner sees it. Real coins, made-up
 * scores, and no claim about any real token's safety checks: a sample never
 * says a real token passed or failed a hard gate.
 *
 * It runs on a new agent's defaults (LANDING_DEFAULTS, which defaults.test.ts
 * holds to the agent config), with Base switched on.
 *
 * The run follows the run loop's rules: discover_tokens screens the launch
 * feeds (its quickScore is a pre-rank, not the score), then score_token scores
 * at least MIN_SCORED_PER_TICK fresh candidates in full, plus anything the
 * agent names. SOL never comes out of discovery, so the agent named it.
 */

export const SAMPLE_AGENT = "momentum-scout";
export const SAMPLE_PROMPT = "Momentum on Solana and Base: buy when volume and holders both accelerate.";
export const SAMPLE_MODE = MODE_WORDS[LANDING_DEFAULTS.mode];
export const SAMPLE_FLOOR = LANDING_DEFAULTS.minScore;
export const SAMPLE_TRADE_USD = LANDING_DEFAULTS.maxTradeUsd;
export const SAMPLE_STOP_PCT = LANDING_DEFAULTS.stopLossPct;
export const SAMPLE_TAKE_PROFIT_PCT = LANDING_DEFAULTS.takeProfitPct;
/** Minutes between runs. */
export const SAMPLE_EVERY_MIN = LANDING_DEFAULTS.intervalMinutes;
export const SAMPLE_RUN_AT = "14:15";
export const SAMPLE_NEXT_RUN_AT = "14:30";

/** Candidates discover_tokens returned this run. */
export const SAMPLE_FOUND = 38;

type SampleRow = { coin: CoinName; chain: "Solana" | "Base"; score: number };

/** The run's top three by score: two clear the floor, one doesn't. */
export const SAMPLE_ROWS = [
  { coin: "TIBBIR", chain: "Base", score: 81 },
  { coin: "SOL", chain: "Solana", score: 77 },
  { coin: "SUPER INU", chain: "Solana", score: 58 },
] as const satisfies readonly SampleRow[];

/** The rest of what it scored, all under the floor: listed on the score board, counted elsewhere. */
export const SAMPLE_OTHERS = [
  { coin: "BRETT", chain: "Base", score: 55 },
  { coin: "BONK", chain: "Solana", score: 49 },
  { coin: "WIF", chain: "Solana", score: 44 },
] as const satisfies readonly SampleRow[];
export const SAMPLE_OTHER_SCORES = SAMPLE_OTHERS.map((r) => r.score);

/** Tokens score_token scored in full this run. */
export const SAMPLE_SCORED = SAMPLE_ROWS.length + SAMPLE_OTHERS.length;

export const clearsFloor = (score: number) => score >= SAMPLE_FLOOR;

export const SAMPLE_BUYS = SAMPLE_ROWS.filter((r) => clearsFloor(r.score));
export const SAMPLE_SKIPS = SAMPLE_ROWS.filter((r) => !clearsFloor(r.score));
export const sampleRow = (coin: CoinName) => SAMPLE_ROWS.find((r) => r.coin === coin)!;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;
/** A count as a word, up to ten: "two buys". */
export const countWord = (n: number) => WORDS[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The hero card's text alternative. The card is one picture (role="img"), so
 * this carries everything it shows: the strategy first, then the run.
 */
export const HERO_LABEL =
  `Sample run by ${SAMPLE_AGENT}, paper, ${SAMPLE_MODE}, every ${SAMPLE_EVERY_MIN} minutes. ` +
  `Its strategy, visible only to its owner: “${SAMPLE_PROMPT}” ` +
  `At ${SAMPLE_RUN_AT} it screened ${SAMPLE_FOUND} candidates and scored ${SAMPLE_SCORED} against a floor of ${SAMPLE_FLOOR}: ` +
  SAMPLE_ROWS.map((r) => `${r.coin} on ${r.chain} ${r.score}, ${clearsFloor(r.score) ? `buy $${SAMPLE_TRADE_USD}` : "skip"}`).join("; ") +
  `; ${countWord(SAMPLE_OTHER_SCORES.length)} more below the floor. ` +
  `${capital(countWord(SAMPLE_BUYS.length))} buys wait for your OK. Next run ${SAMPLE_NEXT_RUN_AT}.`;
