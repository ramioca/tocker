import type { TrackerStage } from "@/components/spectrumui/blocks/ai-assistants/status-tracker";
import type { ReasoningStep, ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import {
  INTEL_SOURCE,
  SELL_CHECK_SOURCE,
  SENTIMENT_SOURCES,
  SMART_MONEY_SOURCE,
  planEnrichment,
  type EnrichmentPlan,
} from "@/lib/agent/enrichment";
import { LANDING_DEFAULTS } from "./defaults";
import { LANDING_SOURCES, usd2, usd3 } from "./signals-data";
import {
  SAMPLE_AGENT,
  SAMPLE_BUYS,
  SAMPLE_EVERY_MIN,
  SAMPLE_FLOOR,
  SAMPLE_FOUND,
  SAMPLE_NEXT_RUN_AT,
  SAMPLE_MODE,
  SAMPLE_OTHERS,
  SAMPLE_PROMPT,
  SAMPLE_ROWS,
  SAMPLE_RUN_AT,
  SAMPLE_SCORED,
  SAMPLE_SKIPS,
  SAMPLE_STOP_PCT,
  SAMPLE_TAKE_PROFIT_PCT,
  SAMPLE_TRADE_USD,
  clearsFloor,
  countWord,
  sampleRow,
} from "./sample";
import type { CoinName } from "./coins";

/**
 * The hero's sample run, opened up: what the How section's console shows. Pure
 * data plus `runAt(beat)`, the run at each step of its replay, so the copy rules
 * are testable (console-run.test.ts):
 *
 * - Real coins, made-up scores, and never a gate or safety outcome for a real
 *   token. Paid reads say what was bought, not what they found.
 * - discover_tokens sweeps the paid launch radars on both chains (the run loop
 *   always does); each score_token buys exactly what `planEnrichment` plans for
 *   its chain on the default data sources. The receipt totals those calls at
 *   registry prices, so it cannot under-report the run.
 */

/** `execution.proposalTtlMinutes` of the default config. */
export const SAMPLE_PROPOSAL_TTL_MIN = 60;

const TIBBIR = sampleRow("TIBBIR");
const SOL = sampleRow("SOL");
const SUPER_INU = sampleRow("SUPER INU");

/** Registry price of a data source, so the receipt can't drift from the Data section. */
const priceOf = (id: string) => {
  const source = LANDING_SOURCES.find((s) => s.id === id);
  if (!source) throw new Error(`unknown data source ${id}`);
  return source.priceUsd;
};

export const STAGES: TrackerStage[] = [
  { id: "discover", label: "Discover" },
  { id: "score", label: "Score" },
  { id: "propose", label: "Propose" },
  { id: "approve", label: "You approve" },
];

type Chain = "solana" | "base";

/** The paid launch radars discover_tokens sweeps on every run, one per chain. */
export const LAUNCH_RADARS = { solana: "solenrich-launches", base: "gate402-base-radar" } as const;
const LAUNCH_RADARS_IDS = Object.values(LAUNCH_RADARS);

/** What score_token buys for a token on `chain` that the free data has not ruled out. */
function readsFor(chain: Chain): string[] {
  const plan: EnrichmentPlan = planEnrichment({
    free: { total: 70, verdict: "watch", blockers: [] },
    chain,
    sources: LANDING_DEFAULTS.dataSources,
    remainingUsd: LANDING_DEFAULTS.maxDataSpendUsdPerRun,
    minScore: SAMPLE_FLOOR,
    already: false,
  });
  const sentiment = SENTIMENT_SOURCES.find((s) => (LANDING_DEFAULTS.dataSources as readonly string[]).includes(s));
  return [
    plan.intel && INTEL_SOURCE,
    plan.sellCheck && SELL_CHECK_SOURCE,
    plan.deep && sentiment,
    plan.smartMoney && SMART_MONEY_SOURCE,
  ].filter((id): id is string => typeof id === "string");
}

/** One transcript row, with the beats at which it starts and finishes. */
type Step = {
  call: ToolCall;
  start: number;
  done: number;
  /** Paid reads it made: a source id, how many times. */
  reads: { id: string; n: number }[];
  /** How many tokens it scored in full (score_token rows only). */
  scored?: number;
  /** The chain of each token it scored, one entry per token. */
  chains?: Chain[];
};

/** What one call to a source buys, in words: one and many. */
const READ_WORDS: Record<string, readonly [string, string]> = {
  "x-search": ["search", "searches"],
  [INTEL_SOURCE]: ["report", "reports"],
  [LAUNCH_RADARS_IDS[0]]: ["radar sweep", "radar sweeps"],
  [LAUNCH_RADARS_IDS[1]]: ["radar sweep", "radar sweeps"],
};
const bought = (id: string, n: number) => {
  const [one, many] = READ_WORDS[id] ?? ["read", "reads"];
  return n === 1 ? `${one} bought` : `${n} ${many} bought`;
};

/** A step's paid reads, as the cards that open under it. Each says what was bought, never what it found. */
const children = (stepId: string, reads: Step["reads"]): ToolCall[] =>
  reads.map(({ id, n }) => ({
    id: `${stepId}-${id}`,
    name: id,
    result: `${usd3(priceOf(id) * n)} · ${bought(id, n)}`,
    status: "success",
  }));

function scoreStep(s: {
  id: string;
  args: Record<string, unknown>;
  /** One per token scored. */
  chains: Chain[];
  result: string;
  start: number;
  done: number;
  startedAt: number;
  completedAt: number;
}): Step {
  const counts = new Map<string, number>();
  for (const chain of s.chains) for (const id of readsFor(chain)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const reads = [...counts].map(([id, n]) => ({ id, n }));
  const scored = s.chains.length;
  return {
    start: s.start,
    done: s.done,
    reads,
    scored,
    chains: s.chains,
    call: {
      id: s.id,
      name: scored > 1 ? `score_token ×${scored}` : "score_token",
      args: s.args,
      result: s.result,
      status: "success",
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      children: children(s.id, reads),
    },
  };
}

const RADAR_READS = [
  { id: LAUNCH_RADARS.solana, n: 1 },
  { id: LAUNCH_RADARS.base, n: 1 },
];

// Tool names are the run loop's own (src/lib/agent/tools.ts). Args are trimmed
// to what an owner reads at a glance. startedAt never 0: AgentSteps reads 0 as
// "no timing".
const STEPS: Step[] = [
  {
    start: 0,
    done: 1,
    reads: RADAR_READS,
    call: {
      id: "discover",
      name: "discover_tokens",
      args: { limit: 40 },
      result: `${SAMPLE_FOUND} candidates on Solana and Base, ranked for scoring.`,
      status: "success",
      startedAt: 100,
      completedAt: 1500,
      children: children("discover", RADAR_READS),
    },
  },
  scoreStep({
    id: "score-tibbir",
    args: { token: "TIBBIR", chain: "base" },
    chains: ["base"],
    result: `${TIBBIR.score} / 100 · your floor is ${SAMPLE_FLOOR}.`,
    start: 1,
    done: 2,
    startedAt: 1500,
    completedAt: 3300,
  }),
  scoreStep({
    id: "score-sol",
    args: { token: "SOL", chain: "solana" },
    chains: ["solana"],
    result: `${SOL.score} / 100 · your floor is ${SAMPLE_FLOOR}.`,
    start: 2,
    done: 3,
    startedAt: 3300,
    completedAt: 4900,
  }),
  scoreStep({
    id: "score-super-inu",
    args: { token: "SUPER INU", chain: "solana" },
    chains: ["solana"],
    result: `${SUPER_INU.score} / 100 · below your floor of ${SAMPLE_FLOOR}.`,
    start: 2,
    done: 3,
    startedAt: 3400,
    completedAt: 5100,
  }),
  scoreStep({
    id: "score-rest",
    args: { tokens: SAMPLE_OTHERS.map((r) => r.coin) },
    chains: SAMPLE_OTHERS.map((r) => (r.chain === "Base" ? "base" : "solana")),
    result: `${SAMPLE_OTHERS.map((r) => `${r.coin} ${r.score}`).join(", ").replace(/, ([^,]+)$/, " and $1")} / 100 · all below your floor of ${SAMPLE_FLOOR}.`,
    start: 3,
    done: 4,
    startedAt: 5100,
    completedAt: 7400,
  }),
  {
    start: 4,
    done: 5,
    reads: [],
    call: {
      id: "trade",
      name: `place_trade ×${SAMPLE_BUYS.length}`,
      args: { tokens: SAMPLE_BUYS.map((r) => r.coin), side: "buy", amountUsd: SAMPLE_TRADE_USD },
      result: `${countWord(SAMPLE_BUYS.length).replace(/^./, (c) => c.toUpperCase())} buys sent for your approval · paper · each expires in ${SAMPLE_PROPOSAL_TTL_MIN} min.`,
      status: "success",
      startedAt: 7400,
      completedAt: 8200,
    },
  },
  {
    start: 5,
    done: 6,
    reads: [],
    call: {
      id: "finish",
      name: "finish",
      args: { summary: `Proposed TIBBIR (${TIBBIR.score}) and SOL (${SOL.score}).` },
      result: `${SAMPLE_BUYS.length} proposals waiting on you · next run ${SAMPLE_NEXT_RUN_AT}.`,
      status: "success",
      startedAt: 8200,
      completedAt: 8400,
    },
  },
];

/** How many tokens the transcript shows scored in full; console-run.test.ts holds it to SAMPLE_SCORED. */
export const STEPS_SCORED = STEPS.reduce((n, s) => n + (s.scored ?? 0), 0);
/** Each token scored in full: its chain and the sources bought for it, for the planner check in the test. */
export const SCORE_READS = STEPS.flatMap((s) => (s.chains ?? []).map((chain) => ({ chain, ids: readsFor(chain) })));
/** discover_tokens' paid reads. */
export const DISCOVER_READS = STEPS[0].reads.map((r) => r.id);

/** The receipt: one row per source, in the order first bought, with the beat its last call lands. */
type PaidRow = { call: ToolCall; count: number; priceUsd: number; done: number };

const PAID: PaidRow[] = (() => {
  const rows = new Map<string, PaidRow>();
  for (const step of STEPS) {
    for (const { id, n } of step.reads) {
      const row = rows.get(id) ?? { call: { id: `paid-${id}`, name: id, status: "success" as const }, count: 0, priceUsd: 0, done: 0 };
      row.count += n;
      row.priceUsd += priceOf(id) * n;
      row.done = Math.max(row.done, step.done);
      rows.set(id, row);
    }
  }
  return [...rows.values()];
})();

export const DATA_TOTAL_USD = PAID.reduce((sum, p) => sum + p.priceUsd, 0);

const countOf = (id: string) => PAID.find((p) => p.call.name === id)?.count ?? 0;
const plural = (n: number, one: string, many: string) => `${countWord(n)} ${n === 1 ? one : many}`;
/** What the data bought, in words, from the receipt itself. */
const BOUGHT_WORDS = [
  DISCOVER_READS.length === 2 ? "the launch radars on both chains" : plural(DISCOVER_READS.length, "launch radar", "launch radars"),
  plural(countOf("x-search"), "X search", "X searches"),
  plural(countOf(INTEL_SOURCE), "token safety report", "token safety reports"),
]
  .join(", ")
  .replace(/, ([^,]+)$/, " and $1");

export const REASONING: ReasoningStep[] = [
  {
    id: "r1",
    content: `Screened ${SAMPLE_FOUND} candidates on Solana and Base and scored ${countWord(SAMPLE_SCORED - 1)} of them, plus SOL. Two clear your floor of ${SAMPLE_FLOOR}.`,
  },
  {
    id: "r2",
    content: `TIBBIR leads at ${TIBBIR.score}: volume and holders both accelerating, the pattern your strategy asks for.`,
  },
  {
    id: "r3",
    content: `Bought ${usd3(DATA_TOTAL_USD)} of data before deciding: ${BOUGHT_WORDS}.`,
  },
  {
    id: "r4",
    content: `SOL clears at ${SOL.score}. SUPER INU stops at ${SUPER_INU.score} and the other ${countWord(SAMPLE_OTHERS.length)} score lower, all below your floor.`,
  },
  {
    id: "r5",
    content: `Propose $${SAMPLE_TRADE_USD} on paper for TIBBIR and SOL, stop ${SAMPLE_STOP_PCT}%, take profit ${SAMPLE_TAKE_PROFIT_PCT}%. You decide; each proposal expires after an hour.`,
  },
];

/** The console's text alternative: its visible parts are a picture (aria-hidden), so this says what they show. */
export const CONSOLE_SUMMARY =
  `Sample, owner only: the ${SAMPLE_RUN_AT} run of ${SAMPLE_AGENT}, as its owner sees it. ` +
  `It screened ${SAMPLE_FOUND} candidates on Solana and Base, scored ${SAMPLE_SCORED} against a floor of ${SAMPLE_FLOOR} ` +
  `and bought ${usd3(DATA_TOTAL_USD)} of data: ${BOUGHT_WORDS}. ` +
  `It proposed ${SAMPLE_BUYS.length} paper buys of $${SAMPLE_TRADE_USD}: ${SAMPLE_BUYS.map((r) => `${r.coin} at ${r.score}`).join(" and ")}. ` +
  `${SAMPLE_SKIPS.map((r) => `${r.coin} stopped at ${r.score}`).join(", ")} and ${countWord(SAMPLE_OTHERS.length)} more scored lower, below the floor. ` +
  `Both wait for the owner's approval, starting with the request below. ` +
  `The next run is at ${SAMPLE_NEXT_RUN_AT}; exits are checked every 5 minutes in code, between runs too.`;

/** The approval request at the end of the run, and what each answer does (demo.tsx). */
export const APPROVAL = {
  title: `${SAMPLE_AGENT} wants to buy TIBBIR`,
  description: `$${SAMPLE_TRADE_USD} on paper at a score of ${TIBBIR.score}, against your floor of ${SAMPLE_FLOOR}. Stop ${SAMPLE_STOP_PCT}%, take profit ${SAMPLE_TAKE_PROFIT_PCT}%.`,
  // A no-break space before each dot, so a wrap never starts a line with one.
  meta: `${TIBBIR.chain} · place_trade · expires in ${SAMPLE_PROPOSAL_TTL_MIN} min`,
  result: {
    approved: {
      title: `Approved · $${SAMPLE_TRADE_USD} of TIBBIR on paper`,
      note: "In the app it fills on paper and posts to the feed. This demo sends nothing.",
    },
    rejected: {
      title: "Skipped TIBBIR · no position opened",
      note: "The agent moves on. SOL is still waiting for your OK.",
    },
    auto: {
      title: "Approvals off · it trades on its own",
      note: "Your floor, per-trade cap, daily trade limit and the hard gates still apply to every entry; stops and take profit still run in code.",
    },
  },
} as const;

/** Tracker stage and reasoning lines shown at each beat; the last beat is the finished run. */
const STAGE_AT = [0, 1, 1, 1, 2, 2, 3] as const;
const LINES_AT = [0, 1, 2, 3, 4, 5, 5] as const;
export const FINAL_BEAT = STAGE_AT.length - 1;

/**
 * A step as it stands at `beat`. A step that has not finished has no timing,
 * no result and no children, so it can't be opened or show a duration yet.
 */
function at(call: ToolCall, start: number, done: number, beat: number): ToolCall {
  if (beat >= done) return call;
  const { result: _r, children: _c, completedAt: _e, ...rest } = call;
  return { ...rest, status: beat >= start ? "running" : "pending" };
}

type RunFrame = {
  stage: number;
  lines: number;
  steps: ToolCall[];
  paid: { call: ToolCall; count: number; priceUsd: number; bought: boolean }[];
  /** The receipt's chips: the same array as long as the frame is, so a memoised list can skip a beat. */
  chips: ToolCall[];
  allBought: boolean;
  finished: boolean;
};

function frameAt(b: number): RunFrame {
  const paid = PAID.map((p) => ({ call: { ...p.call, status: b >= p.done ? "success" : "pending" } as ToolCall, count: p.count, priceUsd: p.priceUsd, bought: b >= p.done }));
  return {
    stage: STAGE_AT[b],
    lines: LINES_AT[b],
    steps: STEPS.map((s) => at(s.call, s.start, s.done, b)),
    paid,
    chips: paid.map((p) => p.call),
    allBought: paid.every((p) => p.bought),
    finished: b === FINAL_BEAT,
  };
}

/** Every frame, built once: a beat hands out the same objects each time, so memoised parts re-render only when they change. */
const FRAMES: readonly RunFrame[] = Array.from({ length: FINAL_BEAT + 1 }, (_, b) => frameAt(b));

/** The run at `beat` (clamped). `runAt(FINAL_BEAT)` is the finished run the page renders by default. */
export function runAt(beat: number): RunFrame {
  return FRAMES[Math.max(0, Math.min(FINAL_BEAT, Math.round(beat)))];
}

/** Every visible string in the run, for the copy checks. */
export const RUN_COPY: readonly string[] = [
  ...REASONING.map((r) => r.content),
  ...STEPS.flatMap((s) => [
    s.call.result ?? "",
    JSON.stringify(s.call.args ?? {}),
    ...(s.call.children ?? []).map((c) => c.result ?? ""),
  ]),
  CONSOLE_SUMMARY,
  APPROVAL.title,
  APPROVAL.description,
  APPROVAL.meta,
  ...Object.values(APPROVAL.result).flatMap((r) => [r.title, r.note]),
];

/* ------------------------------------------------------------------------ *
 * The How section's three-step story (console.tsx): the strategy its owner
 * wrote, the run it scored, the trade it asks for. Owner's view of a sample.
 * ------------------------------------------------------------------------ */

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The story's three steps, as the left column tells them. No real coin is named here. */
export const STORY = [
  {
    id: "strategy",
    kicker: "Strategy",
    title: "You write the strategy.",
    body: `A prompt in plain words, a score floor and your limits. There is no allowlist: it may trade any token that clears the hard gates and scores ${SAMPLE_FLOOR} or more, and a blocklist only takes tokens away. Nobody but you ever sees it.`,
  },
  {
    id: "run",
    kicker: "Scored run",
    title: "It scores, then pays for proof.",
    body: `Every ${SAMPLE_EVERY_MIN} minutes it screens Solana and Base, scores the best in full and buys only the data it needs. This run: ${SAMPLE_FOUND} candidates, ${SAMPLE_SCORED} scored, ${usd3(DATA_TOTAL_USD)} of data.`,
  },
  {
    id: "trade",
    kicker: "Trade",
    title: "Then it asks you.",
    body: `${capitalise(countWord(SAMPLE_BUYS.length))} cleared the floor, so it proposes ${countWord(SAMPLE_BUYS.length)} paper buys and waits for your OK. Try it: approve, skip, or switch approvals off. Stops and take profit run in code either way.`,
  },
] as const;

/** The sample agent's strategy as its owner sees it in the builder: the rows, in pairs. */
export const STRATEGY_PROMPT = SAMPLE_PROMPT;
export const STRATEGY_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Mode", `paper · ${SAMPLE_MODE}`],
  ["Runs", `every ${SAMPLE_EVERY_MIN} min`],
  ["Chains", "Solana · Base"],
  ["Score floor", `${SAMPLE_FLOOR} / 100`],
  ["Per trade", `$${SAMPLE_TRADE_USD}`],
  ["Exits", `stop ${SAMPLE_STOP_PCT}% · take ${SAMPLE_TAKE_PROFIT_PCT}%`],
];
/** The data sources it may buy from (a new agent's defaults) and its budget per run. */
export const STRATEGY_SOURCES: readonly string[] = LANDING_DEFAULTS.dataSources;
export const STRATEGY_BUDGET_USD = LANDING_DEFAULTS.maxDataSpendUsdPerRun;
/** The universe rule in words: open by default, the blocklist only subtracts. */
export const STRATEGY_UNIVERSE = `Any token that clears the hard gates and scores ${SAMPLE_FLOOR}+`;

/** Every token the run scored in full, best first: the top three, then the rest under the floor. */
export const SCORE_BOARD: readonly { id: string; label: string; coin?: CoinName; chain: string; score: number; clears: boolean }[] = [
  ...SAMPLE_ROWS.map((r) => ({ id: r.coin, label: r.coin, coin: r.coin, chain: r.chain, score: r.score, clears: clearsFloor(r.score) })),
  ...SAMPLE_OTHERS.map((r) => ({ id: r.coin, label: r.coin, coin: r.coin, chain: r.chain, score: r.score, clears: clearsFloor(r.score) })),
];

/** The strategy step's text alternative (its card is a picture). */
export const STRATEGY_SUMMARY =
  `${SAMPLE_AGENT}'s strategy, owner only: “${SAMPLE_PROMPT}” ` +
  STRATEGY_ROWS.map(([k, v]) => `${k}: ${v}`).join("; ") +
  `. ${STRATEGY_UNIVERSE}; blocklist empty. Data it may buy: ${STRATEGY_SOURCES.join(", ")}, up to ${usd2(STRATEGY_BUDGET_USD)} a run.`;
