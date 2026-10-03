import type { TrackerStage } from "@/components/spectrumui/blocks/ai-assistants/status-tracker";
import type { ReasoningStep, ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import { LANDING_SOURCES } from "./signals-data";
import {
  SAMPLE_FLOOR,
  SAMPLE_NEXT_RUN_AT,
  SAMPLE_ROWS,
  SAMPLE_SCORED,
  SAMPLE_STOP_PCT,
  SAMPLE_TAKE_PROFIT_PCT,
  SAMPLE_TRADE_USD,
} from "./sample";

/**
 * The hero's sample run, opened up: what the How section's console shows. Pure
 * data plus `runAt(beat)`, the run at each step of its replay, so the copy rules
 * are testable (console-run.test.ts):
 *
 * - Real coins, made-up scores, and never a gate or safety outcome for a real
 *   token. Paid reads say what was bought, not what they found.
 * - The paid reads follow `planEnrichment`: Deepnets token safety is a Solana
 *   read, so it goes to SUPER INU; TIBBIR, on Base, gets the X search.
 * - The data total is the sum of the calls shown, at registry prices.
 */

/** `execution.proposalTtlMinutes` of the default config. */
export const SAMPLE_PROPOSAL_TTL_MIN = 60;

const row = (coin: (typeof SAMPLE_ROWS)[number]["coin"]) => SAMPLE_ROWS.find((r) => r.coin === coin)!;
const TIBBIR = row("TIBBIR");
const SOL = row("SOL");
const SUPER_INU = row("SUPER INU");

/** Registry price of a data source, so the receipt can't drift from the Data section. */
const priceOf = (id: string) => {
  const source = LANDING_SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`unknown data source ${id}`);
  return source.priceUsd;
};

export const usd3 = (n: number) => `$${n.toFixed(3)}`;

export const STAGES: TrackerStage[] = [
  { id: "discover", label: "Discover" },
  { id: "score", label: "Score" },
  { id: "propose", label: "Propose" },
  { id: "approve", label: "You approve" },
];

/** The paid calls, in the order they were bought, with the beats at which each starts and lands. */
type PaidCall = { call: ToolCall; priceUsd: number; token: string; start: number; done: number };

const PAID: PaidCall[] = [
  {
    token: "TIBBIR",
    priceUsd: priceOf("x-search"),
    start: 1,
    done: 2,
    call: {
      id: "x",
      name: "x-search",
      args: { query: "$TIBBIR" },
      result: `${usd3(priceOf("x-search"))} · report bought`,
      status: "success",
      startedAt: 1600,
      completedAt: 2800,
    },
  },
  {
    token: "SUPER INU",
    priceUsd: priceOf("deepnets-token-safety"),
    start: 2,
    done: 3,
    call: {
      id: "safety",
      name: "deepnets-token-safety",
      args: { token: "SUPER INU" },
      result: `${usd3(priceOf("deepnets-token-safety"))} · report bought`,
      status: "success",
      startedAt: 3500,
      completedAt: 4900,
    },
  },
];

export const DATA_TOTAL_USD = PAID.reduce((sum, p) => sum + p.priceUsd, 0);

export const REASONING: ReasoningStep[] = [
  {
    id: "r1",
    content: `Scored ${SAMPLE_SCORED} tokens on Solana and Base. Two clear your floor of ${SAMPLE_FLOOR}.`,
  },
  {
    id: "r2",
    content: `TIBBIR leads at ${TIBBIR.score}: volume and holders both accelerating, the pattern your strategy asks for.`,
  },
  {
    id: "r3",
    content: `Bought ${usd3(DATA_TOTAL_USD)} of data before deciding: an X search on TIBBIR and a token safety report on SUPER INU.`,
  },
  {
    id: "r4",
    content: `SOL clears at ${SOL.score}. SUPER INU stops at ${SUPER_INU.score}, below your floor.`,
  },
  {
    id: "r5",
    content: `Propose $${SAMPLE_TRADE_USD} on paper for TIBBIR and SOL, stop ${SAMPLE_STOP_PCT}%, take profit ${SAMPLE_TAKE_PROFIT_PCT}%. You decide; each proposal expires after an hour.`,
  },
];

/** One transcript row, with the beats at which it starts and finishes. */
type Step = { call: ToolCall; start: number; done: number };

// Tool names are the run loop's own (src/lib/agent/tools.ts). Args are trimmed
// to what an owner reads at a glance. startedAt never 0: AgentSteps reads 0 as
// "no timing".
const STEPS: Step[] = [
  {
    start: 0,
    done: 1,
    call: {
      id: "discover",
      name: "discover_tokens",
      args: { limit: 40 },
      result: `${SAMPLE_SCORED} tokens on Solana and Base, ranked for scoring.`,
      status: "success",
      startedAt: 100,
      completedAt: 1500,
    },
  },
  {
    start: 1,
    done: 2,
    call: {
      id: "score-tibbir",
      name: "score_token",
      args: { token: "TIBBIR", chain: "base" },
      result: `${TIBBIR.score} / 100 · your floor is ${SAMPLE_FLOOR}.`,
      status: "success",
      startedAt: 1500,
      completedAt: 3400,
      children: [PAID[0].call],
    },
  },
  {
    start: 2,
    done: 3,
    call: {
      id: "score-super-inu",
      name: "score_token",
      args: { token: "SUPER INU", chain: "solana" },
      result: `${SUPER_INU.score} / 100 · below your floor of ${SAMPLE_FLOOR}.`,
      status: "success",
      startedAt: 3400,
      completedAt: 5100,
      children: [PAID[1].call],
    },
  },
  {
    start: 4,
    done: 5,
    call: {
      id: "trade-tibbir",
      name: "place_trade",
      args: { token: "TIBBIR", side: "buy", amountUsd: SAMPLE_TRADE_USD },
      result: `Sent for your approval · paper · expires in ${SAMPLE_PROPOSAL_TTL_MIN} min.`,
      status: "success",
      startedAt: 5100,
      completedAt: 5500,
    },
  },
  {
    start: 4,
    done: 5,
    call: {
      id: "trade-sol",
      name: "place_trade",
      args: { token: "SOL", side: "buy", amountUsd: SAMPLE_TRADE_USD },
      result: `Sent for your approval · paper · expires in ${SAMPLE_PROPOSAL_TTL_MIN} min.`,
      status: "success",
      startedAt: 5500,
      completedAt: 5900,
    },
  },
  {
    start: 5,
    done: 6,
    call: {
      id: "finish",
      name: "finish",
      args: { summary: `Proposed TIBBIR (${TIBBIR.score}) and SOL (${SOL.score}).` },
      result: `2 proposals waiting on you · next run ${SAMPLE_NEXT_RUN_AT}.`,
      status: "success",
      startedAt: 5900,
      completedAt: 6100,
    },
  },
];

/** Tracker stage and reasoning lines shown at each beat; the last beat is the finished run. */
const STAGE_AT = [0, 1, 1, 1, 2, 2, 3] as const;
const LINES_AT = [0, 1, 2, 3, 4, 5, 5] as const;
export const FINAL_BEAT = STAGE_AT.length - 1;

/**
 * One beat of the replay. Six beats make 4.8s: the replay is over inside five
 * seconds (WCAG 2.2.2), and the finished trace reports the time it showed.
 */
export const BEAT_MS = 800;
/** How long the model thought, as the finished trace reports it. */
export const THOUGHT_MS = FINAL_BEAT * BEAT_MS;

/**
 * A step as it stands at `beat`. A step that has not finished has no timing,
 * no result and no children, so it can't be opened or show a duration yet.
 */
function at(call: ToolCall, start: number, done: number, beat: number): ToolCall {
  if (beat >= done) return call;
  const { result: _r, children: _c, completedAt: _e, ...rest } = call;
  return { ...rest, status: beat >= start ? "running" : "pending" };
}

export type RunFrame = {
  stage: number;
  lines: number;
  steps: ToolCall[];
  paid: { call: ToolCall; priceUsd: number; token: string; bought: boolean }[];
  finished: boolean;
};

/** The run at `beat` (clamped). `runAt(FINAL_BEAT)` is the finished run the page renders by default. */
export function runAt(beat: number): RunFrame {
  const b = Math.max(0, Math.min(FINAL_BEAT, Math.round(beat)));
  return {
    stage: STAGE_AT[b],
    lines: LINES_AT[b],
    steps: STEPS.map((s) => at(s.call, s.start, s.done, b)),
    paid: PAID.map((p) => ({ call: at(p.call, p.start, p.done, b), priceUsd: p.priceUsd, token: p.token, bought: b >= p.done })),
    finished: b === FINAL_BEAT,
  };
}

/** Every visible string in the run, for the copy checks. */
export const RUN_COPY: readonly string[] = [
  ...REASONING.map((r) => r.content),
  ...STEPS.flatMap((s) => [s.call.result ?? "", JSON.stringify(s.call.args ?? {})]),
  ...PAID.flatMap((p) => [p.call.result ?? "", JSON.stringify(p.call.args ?? {})]),
];
