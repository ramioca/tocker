import "server-only";
/**
 * Reads for `/money` — the operator's own books, every agent at once.
 *
 * The page this feeds answers one question: **is this making money?** Which is not the
 * same question as "what is my equity", because equity does not know what the operation
 * cost. So everything here is arranged around one arithmetic:
 *
 *     net = (realised + unrealised PnL) − platform fees − x402 data − model tokens
 *           − thinking paid per use
 *
 * The last term is only ever non-zero for an owner whose agents pay for their own
 * thinking (`config.llm.source === "usdc"`). It is exact, read from the ledger, and it
 * is subtracted here once and nowhere else: a live book's P&L already has those payments
 * taken out as a money flow (`loadMoneyFlows`), the way a withdrawal is, so they are not
 * also a trading loss. See {@link ThinkingSummary}.
 *
 * Three rules shape the file:
 *
 * - **Paper never touches the headline.** A paper agent is born with a $10,000 notional.
 *   Summing that into a total next to a $12 live wallet does not produce a bigger number,
 *   it produces a meaningless one. Paper agents are listed, with their own PnL, and every
 *   total on the page is live-only. `MoneySummary.paper` carries their side separately.
 * - **Scoped to one user, read-only.** Every query filters on `agents.ownerId`. Nothing
 *   here writes, scores, or trades, and the only network call is `getPortfolio` per live
 *   agent — which degrades to the last equity snapshot rather than throwing (see
 *   `liveBook`). A money page that 500s because Privy is having an afternoon is worse
 *   than a money page that is five minutes stale and says so.
 * - **Model spend is an estimate and is labelled one.** See {@link MODEL_PRICES}. It
 *   covers the runs that thought on the owner's own key. A run that paid per use is not
 *   estimated: what it paid is on the ledger to the micro-dollar.
 *
 * The pure parts — {@link pnlByDay}, {@link combineEquity}, {@link estimateModelSpendUsd},
 * {@link ownKeyComparison} — take plain values and are tested in `money.test.ts`.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  agentFundingIntents,
  agentRuns,
  agents,
  auditEvents,
  equitySnapshots,
  getDb,
  inferencePayments,
  platformFees,
  positions,
  trades,
  x402Payments,
} from "@/db";
import { thinkSource, thinkingModel } from "@/lib/agent/inference";
import { DEFAULT_MODELS, knownModel } from "@/lib/agent/models";
import { getPortfolio } from "@/lib/agent/portfolio";
import { splitPnl, toNum } from "@/lib/money";
import { winRate } from "@/lib/pnl";
import { GIVE_UP_AFTER_MS, LATE_LOOK_MS } from "@/lib/x402/inference-reconcile";
import { payPerUseModel, type ThinkSource } from "@/lib/x402/inference-types";
import type { AgentMode, AgentStatus, EquityPoint } from "@/server/types";
import {
  fillFeeUsd,
  loadBookMarks,
  loadMoneyFlows,
  snapshotInCurrentMode,
  thinkingAnsweredUnprovenSql,
  thinkingPaidAtSql,
  thinkingPaidUsdSql,
  thinkingProvenSql,
  withdrawnUsdc,
} from "./_shared";

export { withdrawnUsdc };

// ---------------------------------------------------------------- model prices

export interface ModelPrice {
  label: string;
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * List prices per million tokens, for the models Anthropic and OpenAI sell themselves.
 *
 * **This is an estimate, and the page says so in as many words.** Three reasons it can
 * only ever be one:
 *
 *  1. `agent_runs` records `input_tokens` and `output_tokens` and nothing else — there is
 *     no cached-read or cache-write column, so a run that hit a warm prompt cache is
 *     billed here at the full input rate and the real invoice is lower, sometimes much.
 *  2. The model is read from the agent's config *now*. A run taken last week on a
 *     different model is priced at today's choice.
 *  3. The operator brings their own key, so the actual charge lands on their own account
 *     with the provider, at whatever rate that account has. Tocker never sees that bill.
 *
 * A model with no known price contributes `null`, not `0`: "we do not know" and "it was
 * free" are different facts and the UI prints them differently.
 *
 * This table is not what a price is looked up in. Every provider's prices are on its own
 * row in `src/lib/agent/providers.ts`, and {@link resolveModelPrice} reads them there,
 * by provider, because one model id lists at a different price on each host that serves
 * it. What is kept here is the two makers' own rows by id: the prices an id resolves to
 * when no provider is named.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = Object.fromEntries(
  // Anthropic's and OpenAI's own rows. OpenRouter resells the same models at the same
  // list price, and `resolveModelPrice` reads its ids through to these.
  [...DEFAULT_MODELS.anthropic, ...DEFAULT_MODELS.openai].flatMap((model) =>
    model.inputPerMTok === undefined || model.outputPerMTok === undefined
      ? []
      : [[model.id, { label: model.label, inputPerMTok: model.inputPerMTok, outputPerMTok: model.outputPerMTok }]],
  ),
);

/**
 * Find the price for a model id, on the provider it is used with.
 *
 * `provider` is the agent's own (`config.llm.provider`), and the price is read from that
 * provider's own list. The same open model is sold by several hosts under the same id at
 * different prices (`zai-org/GLM-5.3` is one price on Together and another on
 * DeepInfra), and a host's long path (`accounts/fireworks/models/glm-5p3`) is in no list
 * but its own. A price borrowed from another host would be a wrong number, so a model
 * its own provider does not list is unknown → `null`, which the page says.
 *
 * Anthropic, OpenAI and OpenRouter are the exception they always were: the three read
 * each other's lists, because OpenRouter resells the two makers' models at their list
 * prices under a longer id. Nothing an agent on one of them was priced at has moved.
 *
 * Without a provider the id is read in those three lists only. That is right for the one
 * caller that has none: a pay-per-use step, whose model is priced at its maker's own
 * rate ({@link ownKeyPrice}).
 *
 * Either way through the catalogue's own lookup, so the id resolves in any of its
 * spellings: as stored, a dated snapshot or its alias (`claude-haiku-4-5[-20251001]`),
 * and the OpenRouter form (`anthropic/claude-sonnet-5.5`). No prefix guessing:
 * `claude-opus-5-5` is not `claude-opus-5` at a different price.
 */
export function resolveModelPrice(model: string | null | undefined, provider?: string | null): ModelPrice | null {
  const known = knownModel(model, provider);
  if (!known || known.inputPerMTok === undefined || known.outputPerMTok === undefined) return null;
  return { label: known.label, inputPerMTok: known.inputPerMTok, outputPerMTok: known.outputPerMTok };
}

/**
 * Token counts × list price, at the price of the provider the tokens were bought from
 * when it is given. `null` when the model has no published price here.
 */
export function estimateModelSpendUsd(
  model: string | null | undefined,
  tokens: { inputTokens: number; outputTokens: number },
  provider?: string | null,
): number | null {
  const price = resolveModelPrice(model, provider);
  if (!price) return null;
  const input = Math.max(0, tokens.inputTokens) / 1_000_000;
  const output = Math.max(0, tokens.outputTokens) / 1_000_000;
  return input * price.inputPerMTok + output * price.outputPerMTok;
}

// ---------------------------------------------------------------- pay-per-use thinking

/**
 * The list price a model's tokens are billed at on an owner's own key.
 *
 * Anthropic's, OpenAI's and OpenRouter's lists first: that is where a pay-per-use id, in
 * the gateway's spelling (`anthropic/claude-haiku-4.5`), resolves. A pay-per-use model
 * none of those three lists (the Gemini rows) is priced at the per-token list rate the
 * pay-per-use table carries for it, which is the model maker's own published price and
 * what an OpenRouter key is billed. Anything else is unknown, and `null`.
 *
 * No provider is passed, on purpose. The comparison is with the model's maker, not with
 * whichever host an owner might buy the same model from, so this answer does not move
 * when a provider is added.
 */
export function ownKeyPrice(model: string | null | undefined): ModelPrice | null {
  const listed = resolveModelPrice(model);
  if (listed) return listed;
  const offered = payPerUseModel(model);
  return offered ? { label: offered.label, inputPerMTok: offered.inputPerMTok, outputPerMTok: offered.outputPerMTok } : null;
}

/** The answered pay-per-use steps on one model whose token counts the gateway reported. */
export interface ThinkingTokens {
  model: string;
  steps: number;
  /** What those steps cost, paid per use. USD. */
  paidUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * What the tokens of the answered pay-per-use steps would have cost at list price on the
 * owner's own key, next to what those same steps cost paid per use.
 *
 * Both figures cover the same steps: only steps whose token counts were reported, on a
 * model that has a list price. A step that was paid for and never answered has no tokens
 * to price, and is in neither. `unpricedSteps` says how many answered steps were left
 * out for want of a price, so the comparison never quietly covers less than it seems to.
 */
export interface OwnKeyComparison {
  /** Tokens × list price, USD. An estimate: a key is billed on real usage, cached input for less. */
  ownKeyUsd: number;
  /** What the same steps cost paid per use. Exact. */
  paidUsd: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  unpricedSteps: number;
}

/** Null when there is nothing to compare: no answered step reported its tokens on a priced model. */
export function ownKeyComparison(groups: readonly ThinkingTokens[]): OwnKeyComparison | null {
  const out: OwnKeyComparison = { ownKeyUsd: 0, paidUsd: 0, steps: 0, inputTokens: 0, outputTokens: 0, unpricedSteps: 0 };
  for (const group of groups) {
    const steps = Math.max(0, Math.floor(group.steps));
    if (steps === 0) continue;
    const price = ownKeyPrice(group.model);
    if (!price) {
      out.unpricedSteps += steps;
      continue;
    }
    const inputTokens = Math.max(0, group.inputTokens);
    const outputTokens = Math.max(0, group.outputTokens);
    out.ownKeyUsd += (inputTokens / 1_000_000) * price.inputPerMTok + (outputTokens / 1_000_000) * price.outputPerMTok;
    out.paidUsd += Math.max(0, group.paidUsd);
    out.steps += steps;
    out.inputTokens += inputTokens;
    out.outputTokens += outputTokens;
  }
  return out.steps === 0 ? null : out;
}

/** One step that came back with no answer: paid for, or signed for and not yet (or never) checked. */
export interface ThinkingStepRow {
  id: string;
  /** Null when the agent has since been deleted: the ledger outlives it. */
  agentName: string | null;
  agentSlug: string | null;
  model: string;
  usd: number;
  /**
   * `unanswered`: paid, confirmed, and no answer came. `checking`: signed, the request
   * failed, and the chain has not yet said whether the money moved. `unchecked`: the
   * same, and older than the reconciler checks on every pass: no verdict was reached in
   * time, nobody knows whether it moved, and nothing on the page may say that it did or
   * that it is being checked.
   */
  state: "unanswered" | "checking" | "unchecked";
  /** When the payment was signed, ISO. */
  at: string;
  /** The provider's HTTP status, when it answered at all. Never its text. */
  httpStatus: number | null;
  /** The payment on chain, when the gateway or the reconciler named it. */
  txHash: string | null;
}

/**
 * What an owner's agents have paid for their own thinking, from the ledger
 * (`inference_payments`). Present on a {@link MoneySummary} only when this account has
 * any such row, so an owner who never used pay-per-use sees nothing about it.
 *
 * `paidUsd` is the whole account: live agents, paper agents (a paper agent trades a
 * notional and still pays for thinking in real USDC from its real wallet) and agents
 * since deleted. Only the live part is in the page's totals, like every other total on
 * it.
 */
export interface ThinkingSummary {
  /** Proven to have left the wallet (`thinkingProvenSql`), at the settled amount. USD. */
  paidUsd: number;
  steps: number;
  /** `paidUsd` by who paid it. The three add up to it. */
  liveUsd: number;
  paperUsd: number;
  formerAgentsUsd: number;
  /** The part of `paidUsd` that bought no answer, and how many steps that was. */
  unansweredUsd: number;
  unansweredSteps: number;
  /**
   * Counted as charged, and being checked against the chain. Not in `paidUsd`, and not
   * taken out of any P&L, until the chain shows it. Two kinds of step are in it: one
   * whose request failed after it was signed, and one that was answered and whose
   * payment the gateway gave no transaction for (`checkingAnswered…`, a part of the
   * other two figures).
   */
  checkingUsd: number;
  checkingSteps: number;
  checkingAnsweredUsd: number;
  checkingAnsweredSteps: number;
  /**
   * The same two kinds, older than the reconciler checks on every pass
   * (`GIVE_UP_AFTER_MS`): no verdict could be reached in time. Such a row is looked at
   * again only now and then, for {@link THINKING_LATE_LOOK_DAYS} days, and then not at
   * all. Still counted as charged against the limits, in no total, and out of no P&L.
   * Not in `checkingUsd`.
   */
  uncheckedUsd: number;
  uncheckedSteps: number;
  uncheckedAnsweredUsd: number;
  uncheckedAnsweredSteps: number;
  /** Mock mode: priced, and no money moved. Not in `paidUsd`. */
  simulatedUsd: number;
  /**
   * The steps that got no answer (paid, being checked, or never checked), newest first,
   * at most {@link THINKING_STEPS_SHOWN}. An answered step is never in this list.
   */
  unanswered: ThinkingStepRow[];
  /** Null when no answered step reported its tokens on a model with a list price. */
  ownKey: OwnKeyComparison | null;
}

/** How many unanswered steps the page lists. The totals beside the list count all of them. */
export const THINKING_STEPS_SHOWN = 25;

/**
 * A `signed` row younger than this still has its paid request in flight (that request
 * has a 60-second clock of its own). Past it, the step is one the reconciler is working
 * out, and the page says so rather than showing nothing.
 */
const THINKING_IN_FLIGHT_MS = 2 * 60_000;

/**
 * How long a payment stays "being checked". The reconciler asks the chain about a row on
 * every pass for this long after it was written. Past it the row is closed, still counted
 * as charged, and only looked at again now and then, so the page must not go on saying it
 * is being checked. The reconciler's own figure, read from where it is defined, so the two
 * cannot drift.
 */
export const THINKING_CHECKED_FOR_MS = GIVE_UP_AFTER_MS;

/**
 * For how many days after it was written the reconciler still looks at such a row now
 * and then. After that nothing does. Also the reconciler's own figure.
 */
export const THINKING_LATE_LOOK_DAYS = Math.round(LATE_LOOK_MS / 86_400_000);

// ---------------------------------------------------------------- pure aggregation

const DAY_MS = 86_400_000;
/** The chart's resolution. Marks land every five minutes; three of them is one point. */
export const EQUITY_BUCKET_MS = 15 * 60_000;

export interface SnapshotPoint {
  agentId: string;
  /** Epoch ms, a Date, or an ISO string — whatever the caller has. */
  at: number | Date | string;
  equityUsd: number;
  cashUsd?: number;
}

/**
 * Money that moved into or out of an agent's wallet without being a trade: a deposit is
 * positive, a withdrawal negative. Equity moves by exactly this much, and none of it is
 * profit or loss.
 */
export interface FlowPoint {
  agentId: string;
  at: number | Date | string;
  amountUsd: number;
  /** What an agent paid for its own thinking. Taken out of the day like any flow, and named apart. */
  kind?: "thinking";
}

export interface PnlDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** Summed close across every contributing agent. */
  equityUsd: number;
  /**
   * Change from the previous day's close, less the day's net flow. `null` on the first
   * day — there is no prior.
   */
  pnlUsd: number | null;
  pnlPct: number | null;
  /**
   * Net money in (+) or out (−) that day: deposits, withdrawals and the opening book of
   * an agent that first appears that day. Already taken out of `pnlUsd`; non-zero means
   * the day's equity step was partly not trading.
   */
  flowUsd: number;
  /**
   * What the agents paid for their own thinking that day (pay-per-use only), as a
   * positive amount. Already taken out of `pnlUsd`, and kept apart from `flowUsd`: it
   * is a running cost, small and frequent, not the owner moving money.
   */
  thinkingUsd: number;
  /** How many agents had a book that day. Explains a step in the curve. */
  agents: number;
}

function toMs(at: number | Date | string): number {
  if (typeof at === "number") return at;
  if (at instanceof Date) return at.getTime();
  const parsed = new Date(at).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** `YYYY-MM-DD` in UTC. Never the viewer's timezone: a trading day has to be one thing. */
export function utcDayKey(at: number | Date | string): string {
  return new Date(toMs(at)).toISOString().slice(0, 10);
}

function startOfUtcDayMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Day-by-day P&L across a set of agents, from their equity snapshots.
 *
 * Each agent's **last snapshot of a UTC day** is its close for that day, and the day's
 * total is the sum of those closes. P&L for the day is the change in that total.
 *
 * Two decisions that are the whole reason this is a function and not four lines:
 *
 *  - **Closes carry forward.** An agent that did not snapshot on Tuesday still owns
 *    whatever it owned on Monday. Summing only the agents that reported would print
 *    Tuesday as a loss of one agent's entire book and Wednesday as a miraculous
 *    recovery. The carried-forward close is the honest reading.
 *  - **Money moved is not money made.** A new agent is a step up in equity on the day it
 *    appears, a deposit is a step up and a withdrawal a step down, and none of them is a
 *    gain or a loss. So each is a flow: an agent's first point is its opening book, and
 *    `opts.flows` carries deposits and withdrawals. The day's P&L is the change in the
 *    summed close less the day's net flow, and its percentage is measured against the
 *    prior close plus what came in. `flowUsd` on the row says a step was partly money
 *    moving, so the UI can say so instead of colouring it.
 *  - **Thinking is a cost, not a loss.** A flow of kind `thinking` is what an agent paid
 *    for its own model steps. It left the wallet, so it is taken out of the day's P&L
 *    like a withdrawal, but it is reported as `thinkingUsd`, not in `flowUsd`.
 *
 * A flow at or before an agent's first point (within `resolutionMs` of it, since a point
 * may stand for a bucket of marks) is already inside that opening book and is not counted
 * twice.
 *
 * Days are contiguous, so a quiet weekend still gets rows (flat, at the carried close).
 * Weekends are not special: crypto does not close.
 */
export function pnlByDay(
  snapshots: readonly SnapshotPoint[],
  opts: { days?: number; now?: number | Date; flows?: readonly FlowPoint[]; resolutionMs?: number } = {},
): PnlDay[] {
  const days = Math.max(1, Math.floor(opts.days ?? 30));
  const resolutionMs = Math.max(0, opts.resolutionMs ?? 0);

  // agentId → dayKey → { at, equity } for the latest point seen in that day.
  const byAgent = new Map<string, Map<string, { at: number; equityUsd: number }>>();
  // agentId → its earliest point: the book it opened with.
  const opening = new Map<string, { at: number; equityUsd: number }>();
  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;

  for (const point of snapshots) {
    const ms = toMs(point.at);
    if (!Number.isFinite(ms) || !Number.isFinite(point.equityUsd)) continue;
    firstMs = Math.min(firstMs, ms);
    lastMs = Math.max(lastMs, ms);
    const key = utcDayKey(ms);
    const forAgent = byAgent.get(point.agentId) ?? new Map();
    const held = forAgent.get(key);
    if (!held || ms >= held.at) forAgent.set(key, { at: ms, equityUsd: point.equityUsd });
    byAgent.set(point.agentId, forAgent);
    const open = opening.get(point.agentId);
    if (!open || ms < open.at) opening.set(point.agentId, { at: ms, equityUsd: point.equityUsd });
  }

  if (byAgent.size === 0) return [];

  // dayKey → { net, inflow, thinking }. The opening book counts on the day an agent first
  // appears. `thinking` is what was paid for thinking, positive, and is not in `net`.
  const flowByDay = new Map<string, { net: number; inflow: number; thinking: number }>();
  const dayOf = (key: string) => {
    const day = flowByDay.get(key) ?? { net: 0, inflow: 0, thinking: 0 };
    flowByDay.set(key, day);
    return day;
  };
  const addFlow = (key: string, amountUsd: number) => {
    const day = dayOf(key);
    day.net += amountUsd;
    if (amountUsd > 0) day.inflow += amountUsd;
  };
  for (const open of opening.values()) addFlow(utcDayKey(open.at), open.equityUsd);
  for (const flow of opts.flows ?? []) {
    const ms = toMs(flow.at);
    const open = opening.get(flow.agentId);
    if (!open || !Number.isFinite(ms) || !Number.isFinite(flow.amountUsd) || flow.amountUsd === 0) continue;
    if (ms < open.at + resolutionMs) continue; // inside the opening book already
    if (flow.kind === "thinking") {
      // Only ever money out. A positive "payment" is not one, and is not netted.
      if (flow.amountUsd < 0) dayOf(utcDayKey(ms)).thinking += -flow.amountUsd;
      continue;
    }
    addFlow(utcDayKey(ms), flow.amountUsd);
  }

  const nowMs = opts.now === undefined ? Date.now() : toMs(opts.now);
  const startDay = startOfUtcDayMs(firstMs);
  // A clock that is behind the data must not truncate the series.
  const endDay = Math.max(startOfUtcDayMs(Number.isFinite(nowMs) ? nowMs : lastMs), startOfUtcDayMs(lastMs));

  const carried = new Map<string, number>();
  const rows: PnlDay[] = [];
  let previous: number | null = null;

  for (let cursor = startDay; cursor <= endDay; cursor += DAY_MS) {
    const key = utcDayKey(cursor);
    let total = 0;
    let contributing = 0;
    for (const [agentId, byDay] of byAgent) {
      const close = byDay.get(key);
      if (close) carried.set(agentId, close.equityUsd);
      const value = carried.get(agentId);
      if (value === undefined) continue; // not born yet
      total += value;
      contributing += 1;
    }
    const flow = flowByDay.get(key) ?? { net: 0, inflow: 0, thinking: 0 };
    // What was paid for thinking left the wallet without being lost on a trade, so it is
    // added back: the close fell by it, and the day's trading did not.
    const pnlUsd = previous === null ? null : total - previous - flow.net + flow.thinking;
    const base = previous === null ? 0 : previous + flow.inflow;
    rows.push({
      day: key,
      equityUsd: total,
      pnlUsd,
      pnlPct: pnlUsd === null || base === 0 ? null : (pnlUsd / Math.abs(base)) * 100,
      flowUsd: previous === null ? 0 : flow.net,
      thinkingUsd: previous === null ? 0 : flow.thinking,
      agents: contributing,
    });
    previous = total;
  }

  return rows.slice(-days);
}

/**
 * Every agent's curve summed into one, bucketed so a month of five-minute marks is a few
 * hundred points rather than ten thousand.
 *
 * Same carry-forward rule as {@link pnlByDay}, and for the same reason: a bucket where
 * only one of three agents reported is not a bucket where the other two went to zero.
 *
 * Each point is stamped with the latest snapshot inside its bucket, not the bucket's
 * start: the chart prints the minute, and a reading taken at 14:25 is not one from 14:15.
 */
export function combineEquity(
  snapshots: readonly SnapshotPoint[],
  bucketMs: number = EQUITY_BUCKET_MS,
): EquityPoint[] {
  const size = bucketMs > 0 ? bucketMs : EQUITY_BUCKET_MS;
  const byAgent = new Map<string, Map<number, { at: number; equityUsd: number; cashUsd: number }>>();
  // Bucket start → the latest snapshot time inside it, across every agent.
  const buckets = new Map<number, number>();

  for (const point of snapshots) {
    const ms = toMs(point.at);
    if (!Number.isFinite(ms) || !Number.isFinite(point.equityUsd)) continue;
    const bucket = Math.floor(ms / size) * size;
    buckets.set(bucket, Math.max(buckets.get(bucket) ?? ms, ms));
    const forAgent = byAgent.get(point.agentId) ?? new Map();
    const held = forAgent.get(bucket);
    if (!held || ms >= held.at) {
      forAgent.set(bucket, { at: ms, equityUsd: point.equityUsd, cashUsd: point.cashUsd ?? 0 });
    }
    byAgent.set(point.agentId, forAgent);
  }

  const carried = new Map<string, { equityUsd: number; cashUsd: number }>();
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((bucket) => {
      let equityUsd = 0;
      let cashUsd = 0;
      for (const [agentId, byBucket] of byAgent) {
        const point = byBucket.get(bucket);
        if (point) carried.set(agentId, { equityUsd: point.equityUsd, cashUsd: point.cashUsd });
        const value = carried.get(agentId);
        if (!value) continue;
        equityUsd += value.equityUsd;
        cashUsd += value.cashUsd;
      }
      return { at: new Date(buckets.get(bucket) ?? bucket).toISOString(), equityUsd, cashUsd };
    });
}

// ---------------------------------------------------------------- shapes

export interface MoneyAgentRow {
  id: string;
  slug: string;
  name: string;
  avatarSeed: string | null;
  mode: AgentMode;
  status: AgentStatus;
  model: string;
  /**
   * The provider `model` is bought from on the owner's key (`config.llm.provider`), and
   * so the list its price is read in. `getMoney` always sets it. It is optional so that
   * a row made without one is priced as every row was before providers had their own
   * lists: in Anthropic's, OpenAI's and OpenRouter's.
   */
  provider?: string | null;
  /** Cash + positions at the last mark. Null only when nothing has ever been recorded. */
  equityUsd: number | null;
  cashUsd: number | null;
  positionsUsd: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  /** realised + unrealised. Not net of costs — `netUsd` is. */
  pnlUsd: number;
  /** Tocker's flat per-fill fee, every row on the ledger, settled or not. */
  feesUsd: number;
  /** The part of `feesUsd` the agent still owes. Already deducted from live cash. */
  feesAccruedUsd: number;
  /** x402 micropayments booked against this agent. */
  dataSpendUsd: number;
  /** The part of `dataSpendUsd` that was mock-mode and moved no money. */
  dataSpendSimulatedUsd: number;
  /**
   * Estimate — see {@link MODEL_PRICES}. Null when the model has no published price.
   * The runs that thought on the owner's own key only: a run that paid per use is in
   * `thinkingUsd`, exactly, and is never also estimated here.
   */
  modelSpendUsd: number | null;
  /** Tokens of the runs behind `modelSpendUsd`. */
  inputTokens: number;
  outputTokens: number;
  /** Where this agent's thinking comes from today. */
  thinkSource: ThinkSource;
  /** The model a pay-per-use agent thinks on. Null for an agent on its owner's key. */
  thinkingModel: string | null;
  /**
   * What this agent has paid for its own thinking: proven on chain (`thinkingProvenSql`),
   * at the settled amount. Real USDC from its own wallet, whatever its mode. Zero for an
   * agent that never paid per use.
   */
  thinkingUsd: number;
  /** Paid steps behind `thinkingUsd`. */
  thinkingSteps: number;
  /** The part of `thinkingUsd` that bought no answer. */
  thinkingUnansweredUsd: number;
  /** Counted as charged and being checked against the chain. Not in `thinkingUsd`. */
  thinkingCheckingUsd: number;
  /** Open longer than the reconciler looks: could not be checked. Not in `thinkingUsd`. */
  thinkingUncheckedUsd: number;
  /** Mock mode: priced, and no money moved. Not in `thinkingUsd`. */
  thinkingSimulatedUsd: number;
  runCount: number;
  tradeCount: number;
  /** Closed sells that made money, over closed sells. Null until something closes. */
  winRate: number | null;
  firstFundedAt: string | null;
  /** True when the live wallet could not be read and the numbers are the last snapshot. */
  stale: boolean;
}

export interface MoneyTotals {
  equityUsd: number;
  cashUsd: number;
  positionsUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  pnlUsd: number;
  feesUsd: number;
  dataSpendUsd: number;
  /** Sum of the agents that have a price. `pricedAgents` says how many that was. */
  modelSpendUsd: number;
  /** What the live agents paid for their own thinking. Exact. Zero without pay-per-use. */
  thinkingUsd: number;
  costsUsd: number;
  /** pnl − costs. The number the page exists for. */
  netUsd: number;
  tradeCount: number;
  agentCount: number;
  pricedAgents: number;
  unpricedAgents: number;
  /** USDC actually sent to agent wallets. The chart's basis when there is any. */
  fundedUsd: number;
}

export interface MoneySummary {
  live: MoneyAgentRow[];
  paper: MoneyAgentRow[];
  totals: MoneyTotals;
  /** Live agents only, bucketed to 15 minutes, oldest first. */
  equity: EquityPoint[];
  /** What the equity curve is measured against: funded USDC, else the first point. */
  basisUsd: number;
  /** Last 30 UTC days, live agents only. */
  days: PnlDay[];
  /**
   * The most recent day's P&L, pulled out because it is a headline. Net of deposits and
   * withdrawals; `flowUsd` is what moved that day, so the headline can say a step was
   * partly money in or out.
   */
  today: { pnlUsd: number | null; pnlPct: number | null; flowUsd: number; thinkingUsd: number };
  /** True when any live agent's wallet read failed — the page has to say so. */
  stale: boolean;
  /** Pay-per-use thinking, for the whole account. Null when it has never paid for a step. */
  thinking: ThinkingSummary | null;
}

const EMPTY_TOTALS: MoneyTotals = {
  equityUsd: 0,
  cashUsd: 0,
  positionsUsd: 0,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  pnlUsd: 0,
  feesUsd: 0,
  dataSpendUsd: 0,
  modelSpendUsd: 0,
  thinkingUsd: 0,
  costsUsd: 0,
  netUsd: 0,
  tradeCount: 0,
  agentCount: 0,
  pricedAgents: 0,
  unpricedAgents: 0,
  fundedUsd: 0,
};

export const EMPTY_MONEY: MoneySummary = {
  live: [],
  paper: [],
  totals: EMPTY_TOTALS,
  equity: [],
  basisUsd: 0,
  days: [],
  today: { pnlUsd: null, pnlPct: null, flowUsd: 0, thinkingUsd: 0 },
  stale: false,
  thinking: null,
};

// ---------------------------------------------------------------- the read

/** Snapshot window: 30 displayed days plus the day before, so day one has a delta. */
const SNAPSHOT_WINDOW_DAYS = 31;

interface Book {
  equityUsd: number | null;
  cashUsd: number | null;
  positionsUsd: number | null;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  stale: boolean;
}

/**
 * A live agent's book, from the wallet when the wallet answers and from the last
 * snapshot when it does not.
 *
 * `getPortfolio` already reports `cashReadFailed` rather than pretending an unreadable
 * wallet is an empty one (the same reason `snapshotEquity` refuses to write a point on
 * it). Here that flag means: keep the position numbers, which came from marks and are
 * fine, but take cash and equity from the last snapshot and flag the row stale. A throw
 * — no wallet, no agent row, a provider outage — falls all the way back.
 */
async function liveBook(
  agentId: string,
  fallback: { equityUsd: number; cashUsd: number } | undefined,
  ledger: { realizedPnlUsd: number; costBasisUsd: number },
): Promise<Book> {
  const fromSnapshot = (): Book => ({
    equityUsd: fallback ? fallback.equityUsd : null,
    cashUsd: fallback ? fallback.cashUsd : null,
    positionsUsd: fallback ? fallback.equityUsd - fallback.cashUsd : null,
    realizedPnlUsd: ledger.realizedPnlUsd,
    // Positions are worth (equity − cash) at the last mark; what they cost is the
    // summed basis. The difference is the open PnL, same derivation as `/home`.
    unrealizedPnlUsd: fallback ? fallback.equityUsd - fallback.cashUsd - ledger.costBasisUsd : 0,
    stale: true,
  });

  try {
    const portfolio = await getPortfolio(agentId);
    if (portfolio.cashReadFailed) {
      const snapshot = fromSnapshot();
      return { ...snapshot, unrealizedPnlUsd: portfolio.unrealizedPnlUsd };
    }
    const positionsUsd = portfolio.equityUsd - portfolio.cashUsd;
    return {
      equityUsd: portfolio.equityUsd,
      cashUsd: portfolio.cashUsd,
      positionsUsd,
      realizedPnlUsd: portfolio.realizedPnlUsd,
      unrealizedPnlUsd: portfolio.unrealizedPnlUsd,
      stale: false,
    };
  } catch (err) {
    console.warn(
      `[money] ${agentId}: falling back to the last snapshot — ${err instanceof Error ? err.message : String(err)}`,
    );
    return fromSnapshot();
  }
}

/** A Solana transaction id as an explorer expects it. Anything else is not linked. */
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

type MoneyDb = Awaited<ReturnType<typeof getDb>>;

/**
 * The owner's side of the pay-per-use ledger, in three grouped reads: what each agent
 * paid, the tokens the answered steps used per model, and the steps that got no answer.
 *
 * Scoped by `owner_id`, the column the ledger writes from the run's own owner, and never
 * by anything the request carries. The ledger keeps no prompt and no answer (only a hash
 * of the request), so nothing here can show one. The provider's own words for a failure
 * (`detail`) are not selected either: an owner is told the status and shown the
 * transaction, never a sentence a third party wrote.
 */
async function loadThinking(db: MoneyDb, userId: string, now: Date) {
  const amount = thinkingPaidUsdSql();
  const signedAt = thinkingPaidAtSql();
  // The one condition both the Thinking total and the P&L flow are made from.
  const proven = thinkingProvenSql();
  const answeredUnproven = thinkingAnsweredUnprovenSql();
  const staleBefore = new Date(now.getTime() - THINKING_IN_FLIGHT_MS).toISOString();
  const gaveUpBefore = new Date(now.getTime() - THINKING_CHECKED_FOR_MS).toISOString();
  // Signed for a request that then failed: `unconfirmed`, or `signed` for longer than a
  // request can still be in flight. Whether the money moved is not known.
  const failedUnproven = sql`(${inferencePayments.status} = 'unconfirmed' or (${inferencePayments.status} = 'signed' and ${signedAt} < ${staleBefore}::timestamptz))`;
  // Counted as charged and not proven: the failed ones, and the answered ones the
  // gateway gave no transaction for.
  const unproven = sql`(${failedUnproven} or ${answeredUnproven})`;
  // The reconciler asks the chain about a row on every pass for a fixed time after it
  // was written, measured the way it measures (`created_at`). Inside that time the row is
  // being checked; past it no verdict was reached in time, and the page says that instead.
  const gaveUp = sql`(${inferencePayments.createdAt} < ${gaveUpBefore}::timestamptz)`;
  const checking = sql`(${unproven} and not ${gaveUp})`;
  const unchecked = sql`(${unproven} and ${gaveUp})`;

  const [byAgent, tokens, unanswered] = await Promise.all([
    db
      .select({
        agentId: inferencePayments.agentId,
        paidUsd: sql<string>`coalesce(sum(${amount}) filter (where ${proven}), 0)`,
        paidSteps: sql<number>`(count(*) filter (where ${proven}))::int`,
        unansweredUsd: sql<string>`coalesce(sum(${amount}) filter (where ${inferencePayments.status} = 'paid_no_answer'), 0)`,
        unansweredSteps: sql<number>`(count(*) filter (where ${inferencePayments.status} = 'paid_no_answer'))::int`,
        checkingUsd: sql<string>`coalesce(sum(${amount}) filter (where ${checking}), 0)`,
        checkingSteps: sql<number>`(count(*) filter (where ${checking}))::int`,
        checkingAnsweredUsd: sql<string>`coalesce(sum(${amount}) filter (where ${checking} and ${answeredUnproven}), 0)`,
        checkingAnsweredSteps: sql<number>`(count(*) filter (where ${checking} and ${answeredUnproven}))::int`,
        uncheckedUsd: sql<string>`coalesce(sum(${amount}) filter (where ${unchecked}), 0)`,
        uncheckedSteps: sql<number>`(count(*) filter (where ${unchecked}))::int`,
        uncheckedAnsweredUsd: sql<string>`coalesce(sum(${amount}) filter (where ${unchecked} and ${answeredUnproven}), 0)`,
        uncheckedAnsweredSteps: sql<number>`(count(*) filter (where ${unchecked} and ${answeredUnproven}))::int`,
        simulatedUsd: sql<string>`coalesce(sum(${amount}) filter (where ${inferencePayments.status} = 'simulated'), 0)`,
        simulatedSteps: sql<number>`(count(*) filter (where ${inferencePayments.status} = 'simulated'))::int`,
      })
      .from(inferencePayments)
      .where(
        and(
          eq(inferencePayments.ownerId, userId),
          // Reserved, released and not-charged rows moved no money and are nobody's cost:
          // a step the reconciler proved was never charged is in no figure on this page.
          inArray(inferencePayments.status, ["settled", "paid_no_answer", "signed", "unconfirmed", "simulated"]),
        ),
      )
      .groupBy(inferencePayments.agentId),

    // Only answered steps that reported their tokens: those are the ones a key would
    // have been billed for, and the only ones there is anything to price. And only the
    // proven ones, so "what the same steps cost paid per use" is money known to have
    // been paid, like every other paid figure here.
    db
      .select({
        model: inferencePayments.model,
        steps: sql<number>`count(*)::int`,
        paidUsd: sql<string>`coalesce(sum(${amount}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${inferencePayments.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${inferencePayments.outputTokens}), 0)`,
      })
      .from(inferencePayments)
      .where(
        and(
          eq(inferencePayments.ownerId, userId),
          eq(inferencePayments.status, "settled"),
          proven,
          sql`${inferencePayments.inputTokens} is not null`,
          sql`${inferencePayments.outputTokens} is not null`,
        ),
      )
      .groupBy(inferencePayments.model),

    db
      .select({
        id: inferencePayments.id,
        status: inferencePayments.status,
        gaveUp: sql<boolean>`${gaveUp}`,
        model: inferencePayments.model,
        usd: sql<string>`${amount}`,
        // Epoch seconds, for the reason given at the funding read below.
        at: sql<number | string>`extract(epoch from ${signedAt})::float8`,
        httpStatus: inferencePayments.httpStatus,
        txHash: inferencePayments.txHash,
        agentName: agents.name,
        agentSlug: agents.slug,
      })
      .from(inferencePayments)
      // Onto the viewer's own agents only. A deleted agent's rows keep their place in the
      // list and simply lose the name.
      .leftJoin(agents, and(eq(agents.id, inferencePayments.agentId), eq(agents.ownerId, userId)))
      // The steps that got no answer. An answered step whose payment is still being
      // confirmed is counted above and is not one of these.
      .where(and(eq(inferencePayments.ownerId, userId), sql`(${inferencePayments.status} = 'paid_no_answer' or ${failedUnproven})`))
      .orderBy(desc(signedAt), desc(inferencePayments.id))
      .limit(THINKING_STEPS_SHOWN),
  ]);

  return { byAgent, tokens, unanswered };
}

/**
 * Everything `/money` renders, in one call.
 *
 * Wide and shallow on purpose: seven grouped aggregates over the user's agents, one
 * bucketed snapshot read, and `getPortfolio` per live agent in parallel. No per-agent
 * SQL loop — an operator with twenty agents should cost the same round trips as one
 * with two.
 */
export async function getMoney(userId: string): Promise<MoneySummary> {
  const db = await getDb();
  const rows = await db.select().from(agents).where(eq(agents.ownerId, userId));
  if (rows.length === 0) {
    // No agent is not the same as no record. The ledger outlives an agent, so an owner
    // who deleted their only one is still shown what it paid, and the steps it paid for
    // and got no answer to. An owner who never paid for a step gets the very same empty
    // summary as before.
    const thinking = summarizeThinking(await loadThinking(db, userId, new Date()), { live: new Set(), paper: new Set() });
    return thinking ? { ...EMPTY_MONEY, thinking } : EMPTY_MONEY;
  }

  const ids = rows.map((r) => r.id);
  const since = new Date(startOfUtcDayMs(Date.now()) - (SNAPSHOT_WINDOW_DAYS - 1) * DAY_MS);
  const bucketSeconds = Math.round(EQUITY_BUCKET_MS / 1000);
  // Inlined, not bound: this expression appears in both SELECT and GROUP BY, and each
  // bound use becomes its own `$n`, so Postgres would see two different expressions and
  // refuse the query. `bucketSeconds` is a server constant, never user input.
  const bucketExpr = sql<string>`floor(extract(epoch from ${equitySnapshots.at}) / ${sql.raw(String(bucketSeconds))})`;

  // Every live agent's deposits, withdrawals and thinking payments, read once: the
  // all-time basis below and the daily table both take what was paid for thinking from
  // this one list, so the two can never disagree about it.
  const liveAgentIds = rows.filter((r) => r.mode === "live").map((r) => r.id);
  const flowsLoading = loadMoneyFlows(db, liveAgentIds);

  const [
    snapshotRows,
    positionRows,
    feeRows,
    dataRows,
    runRows,
    tradeRows,
    fundingRows,
    depositRows,
    withdrawRows,
    bookMarks,
    liveFlows,
    thinking,
  ] = await Promise.all([
    // One row per agent per 15 minutes: the last snapshot in the bucket, at its own time
    // (the chart prints the minute, so not the bucket's start), read as epoch seconds the
    // way getEquitySeries reads it. The bucket index stands in if that ever fails to read
    // (900s divides a day exactly, so a bucket never straddles UTC midnight).
    db
      .select({
        agentId: equitySnapshots.agentId,
        bucket: bucketExpr,
        lastAt: sql<number | string>`extract(epoch from max(${equitySnapshots.at}))::float8`,
        equityUsd: sql<string>`(array_agg(${equitySnapshots.equityUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
        cashUsd: sql<string>`(array_agg(${equitySnapshots.cashUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
      })
      .from(equitySnapshots)
      .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
      .where(and(inArray(equitySnapshots.agentId, ids), snapshotInCurrentMode(), gte(equitySnapshots.at, since)))
      .groupBy(equitySnapshots.agentId, bucketExpr),

    db
      .select({
        agentId: positions.agentId,
        amountToken: positions.amountToken,
        avgCostUsd: positions.avgCostUsd,
        realizedPnlUsd: positions.realizedPnlUsd,
      })
      .from(positions)
      .where(inArray(positions.agentId, ids)),

    db
      .select({
        agentId: platformFees.agentId,
        total: sql<string>`coalesce(sum(${platformFees.amountUsd}), 0)`,
        accrued: sql<string>`coalesce(sum(${platformFees.amountUsd}) filter (where ${platformFees.status} = 'accrued'), 0)`,
      })
      .from(platformFees)
      .where(inArray(platformFees.agentId, ids))
      .groupBy(platformFees.agentId),

    db
      .select({
        agentId: x402Payments.agentId,
        total: sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)`,
        simulated: sql<string>`coalesce(sum(${x402Payments.amountUsd}) filter (where ${x402Payments.simulated}), 0)`,
      })
      .from(x402Payments)
      .where(inArray(x402Payments.agentId, ids))
      .groupBy(x402Payments.agentId),

    db
      .select({
        agentId: agentRuns.agentId,
        runs: sql<number>`count(*)::int`,
        // The runs that thought on the owner's own key: every run but a pay-per-use one.
        // Rows from before the column existed have no source and were all key runs. A
        // pay-per-use run is not estimated at all: what it paid is on the ledger.
        inputTokens: sql<string>`coalesce(sum(${agentRuns.inputTokens}) filter (where ${agentRuns.llmSource} is distinct from 'usdc'), 0)`,
        outputTokens: sql<string>`coalesce(sum(${agentRuns.outputTokens}) filter (where ${agentRuns.llmSource} is distinct from 'usdc'), 0)`,
      })
      .from(agentRuns)
      .where(inArray(agentRuns.agentId, ids))
      .groupBy(agentRuns.agentId),

    // Whole filled ledger: `winRate` replays it per token, so a partial history would
    // book a sell against a basis that is not there and report a loss that never happened.
    // With the Tocker fee charged on each fill (`platform_fees.trade_id` is unique, so the
    // join never repeats one): a sale that lost money after fees is not a win.
    db
      .select({
        agentId: trades.agentId,
        tokenId: trades.tokenId,
        side: trades.side,
        amountToken: trades.amountToken,
        priceUsd: trades.priceUsd,
        feeUsd: trades.feeUsd,
        tockerFeeUsd: platformFees.amountUsd,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .leftJoin(platformFees, eq(platformFees.tradeId, trades.id))
      .where(and(inArray(trades.agentId, ids), eq(trades.status, "filled")))
      .orderBy(trades.createdAt),

    db
      .select({
        agentId: agentFundingIntents.agentId,
        // Epoch seconds, not `::text`: Postgres prints a UTC offset as "+00", which `Date`
        // cannot parse, and an Invalid Date's `toISOString()` throws.
        firstAt: sql<number | string | null>`extract(epoch from min(coalesce(${agentFundingIntents.settledAt}, ${agentFundingIntents.createdAt})))::float8`,
        usdc: sql<string>`coalesce(sum(${agentFundingIntents.amount}) filter (where lower(${agentFundingIntents.asset}) = 'usdc'), 0)`,
      })
      .from(agentFundingIntents)
      .where(and(inArray(agentFundingIntents.agentId, ids), eq(agentFundingIntents.status, "sent")))
      .groupBy(agentFundingIntents.agentId),

    // Deposits and withdrawals inside the window, one row each, for `pnlByDay`'s flows.
    db
      .select({
        agentId: agentFundingIntents.agentId,
        at: sql<number | string>`extract(epoch from coalesce(${agentFundingIntents.settledAt}, ${agentFundingIntents.createdAt}))::float8`,
        amount: agentFundingIntents.amount,
      })
      .from(agentFundingIntents)
      .where(
        and(
          inArray(agentFundingIntents.agentId, ids),
          eq(agentFundingIntents.status, "sent"),
          sql`lower(${agentFundingIntents.asset}) = 'usdc'`,
          sql`coalesce(${agentFundingIntents.settledAt}, ${agentFundingIntents.createdAt}) >= ${since.toISOString()}`,
        ),
      ),

    db
      .select({ agentId: auditEvents.agentId, at: auditEvents.createdAt, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, userId),
          eq(auditEvents.kind, "withdraw"),
          inArray(auditEvents.agentId, ids),
          gte(auditEvents.createdAt, since),
        ),
      ),

    // A live book's basis is its first live mark plus what was deposited since, less what
    // was withdrawn: the one the agent card and agent page measure all-time P&L against.
    // Outside the window on purpose.
    loadBookMarks(db, liveAgentIds, flowsLoading),
    flowsLoading,
    loadThinking(db, userId, new Date()),
  ]);

  // ---- snapshots -----------------------------------------------------------
  const points: SnapshotPoint[] = snapshotRows.map((row) => ({
    agentId: row.agentId,
    at: Number.isFinite(Number(row.lastAt)) ? Number(row.lastAt) * 1000 : Number(row.bucket) * bucketSeconds * 1000,
    equityUsd: toNum(row.equityUsd),
    cashUsd: toNum(row.cashUsd),
  }));

  const latestByAgent = new Map<string, { at: number; equityUsd: number; cashUsd: number }>();
  for (const point of points) {
    const at = point.at as number;
    const held = latestByAgent.get(point.agentId);
    if (!held || at >= held.at) {
      latestByAgent.set(point.agentId, { at, equityUsd: point.equityUsd, cashUsd: point.cashUsd ?? 0 });
    }
  }

  // An agent that has not been marked inside the window still has a last known book.
  // One extra round trip each, and only for the agents that need it.
  const missing = ids.filter((id) => !latestByAgent.has(id));
  if (missing.length > 0) {
    const stragglers = await Promise.all(
      missing.map(async (id) => {
        const [row] = await db
          .select({ equityUsd: equitySnapshots.equityUsd, cashUsd: equitySnapshots.cashUsd, at: equitySnapshots.at })
          .from(equitySnapshots)
          .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
          .where(and(eq(equitySnapshots.agentId, id), snapshotInCurrentMode()))
          .orderBy(sql`${equitySnapshots.at} desc`)
          .limit(1);
        return row ? { id, ...row } : null;
      }),
    );
    for (const row of stragglers) {
      if (!row) continue;
      latestByAgent.set(row.id, {
        at: row.at.getTime(),
        equityUsd: toNum(row.equityUsd),
        cashUsd: toNum(row.cashUsd),
      });
    }
  }

  // ---- per-agent ledgers ---------------------------------------------------
  const ledgerByAgent = new Map<string, { realizedPnlUsd: number; costBasisUsd: number }>();
  for (const id of ids) ledgerByAgent.set(id, { realizedPnlUsd: 0, costBasisUsd: 0 });
  for (const row of positionRows) {
    const ledger = ledgerByAgent.get(row.agentId);
    if (!ledger) continue;
    ledger.realizedPnlUsd += toNum(row.realizedPnlUsd);
    ledger.costBasisUsd += toNum(row.amountToken) * toNum(row.avgCostUsd);
  }

  const fees = new Map(feeRows.map((r) => [r.agentId, { total: toNum(r.total), accrued: toNum(r.accrued) }]));
  const data = new Map(dataRows.map((r) => [r.agentId, { total: toNum(r.total), simulated: toNum(r.simulated) }]));
  const runs = new Map(
    runRows.map((r) => [
      r.agentId,
      { runs: Number(r.runs ?? 0), inputTokens: toNum(r.inputTokens), outputTokens: toNum(r.outputTokens) },
    ]),
  );
  const funding = new Map(
    fundingRows.map((r) => [r.agentId, { firstAt: r.firstAt, usdc: toNum(r.usdc) }]),
  );

  const thinkingByAgent = new Map(
    thinking.byAgent.map((r) => [
      r.agentId ?? "",
      {
        paidUsd: toNum(r.paidUsd),
        paidSteps: Number(r.paidSteps ?? 0),
        unansweredUsd: toNum(r.unansweredUsd),
        unansweredSteps: Number(r.unansweredSteps ?? 0),
        checkingUsd: toNum(r.checkingUsd),
        uncheckedUsd: toNum(r.uncheckedUsd),
        simulatedUsd: toNum(r.simulatedUsd),
      },
    ]),
  );

  const tradesByAgent = new Map<string, typeof tradeRows>();
  for (const row of tradeRows) {
    const list = tradesByAgent.get(row.agentId) ?? [];
    list.push(row);
    tradesByAgent.set(row.agentId, list);
  }

  // ---- the books -----------------------------------------------------------
  const liveRows = rows.filter((r) => r.mode === "live");
  const books = new Map<string, Book>();
  const liveBooks = await Promise.all(
    liveRows.map((row) =>
      liveBook(row.id, latestByAgent.get(row.id), ledgerByAgent.get(row.id) ?? { realizedPnlUsd: 0, costBasisUsd: 0 }),
    ),
  );
  liveRows.forEach((row, i) => books.set(row.id, liveBooks[i]));

  for (const row of rows) {
    if (books.has(row.id)) continue;
    // Paper. Its cash is a ledger replay, not a wallet, so the last snapshot is exactly
    // as fresh as `getPortfolio` would be and costs no network to read. Before the first
    // snapshot an agent is still holding its whole paper float.
    const latest = latestByAgent.get(row.id);
    const ledger = ledgerByAgent.get(row.id) ?? { realizedPnlUsd: 0, costBasisUsd: 0 };
    const equityUsd = latest ? latest.equityUsd : toNum(row.paperStartingUsd);
    const cashUsd = latest ? latest.cashUsd : toNum(row.paperStartingUsd);
    books.set(row.id, {
      equityUsd,
      cashUsd,
      positionsUsd: equityUsd - cashUsd,
      realizedPnlUsd: ledger.realizedPnlUsd,
      unrealizedPnlUsd: equityUsd - cashUsd - ledger.costBasisUsd,
      stale: false,
    });
  }

  const build = (row: (typeof rows)[number]): MoneyAgentRow => {
    const book = books.get(row.id)!;
    // Same rule as `/home` and the agent page: the headline is equity − basis and
    // realised is whatever open does not explain, so this row matches the agent card.
    // A live book with no mark to measure from keeps the ledger's own split.
    // A book read from the wallet just now is fresher than its last mark, so a deposit or
    // withdrawal since that mark is already in it and joins the basis; a stale book is
    // that mark, and is measured against the mark's own basis.
    const marks = bookMarks.get(row.id);
    const basisUsd =
      row.mode === "paper"
        ? toNum(row.paperStartingUsd)
        : marks
          ? marks.startEquityUsd + (book.stale ? 0 : marks.flowSinceMarkUsd)
          : null;
    const split =
      book.equityUsd !== null && basisUsd !== null
        ? splitPnl({
            equityUsd: book.equityUsd,
            cashUsd: book.cashUsd,
            basisUsd,
            costBasisUsd: ledgerByAgent.get(row.id)?.costBasisUsd ?? 0,
          })
        : {
            pnlUsd: book.realizedPnlUsd + book.unrealizedPnlUsd,
            realizedPnlUsd: book.realizedPnlUsd,
            unrealizedPnlUsd: book.unrealizedPnlUsd,
          };
    const fee = fees.get(row.id) ?? { total: 0, accrued: 0 };
    const spend = data.get(row.id) ?? { total: 0, simulated: 0 };
    const run = runs.get(row.id) ?? { runs: 0, inputTokens: 0, outputTokens: 0 };
    const fund = funding.get(row.id);
    const fundedAtMs = fund && fund.firstAt !== null ? Number(fund.firstAt) * 1000 : Number.NaN;
    const model = row.config?.llm?.model ?? "";
    // Whose price list the key-run tokens are read in. The config's provider is the one
    // its key is for: an agent is not saved with a key of another provider. (One saved
    // before that was checked can only pair two of the first three, which read each
    // other's prices.)
    const provider = row.config?.llm?.provider ?? null;
    const source = thinkSource(row.config);
    const paidForThinking = thinkingByAgent.get(row.id);
    // A pay-per-use agent that never ran on a key has no tokens to estimate: that is a
    // zero, not "no price", whatever key model its config still names.
    const nothingOnAKey = source === "usdc" && run.inputTokens === 0 && run.outputTokens === 0;
    const agentTrades = tradesByAgent.get(row.id) ?? [];
    const wr = winRate(
      agentTrades.map((t) => ({
        tokenId: t.tokenId,
        side: t.side,
        amountToken: toNum(t.amountToken),
        priceUsd: toNum(t.priceUsd),
        feeUsd: fillFeeUsd(t.feeUsd, t.tockerFeeUsd),
        status: "filled" as const,
        createdAt: t.createdAt,
      })),
    );

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      avatarSeed: row.avatarSeed,
      mode: row.mode,
      status: row.status,
      model,
      provider,
      equityUsd: book.equityUsd,
      cashUsd: book.cashUsd,
      positionsUsd: book.positionsUsd,
      realizedPnlUsd: split.realizedPnlUsd,
      unrealizedPnlUsd: split.unrealizedPnlUsd,
      pnlUsd: split.pnlUsd,
      feesUsd: fee.total,
      feesAccruedUsd: fee.accrued,
      dataSpendUsd: spend.total,
      dataSpendSimulatedUsd: spend.simulated,
      modelSpendUsd: nothingOnAKey ? 0 : estimateModelSpendUsd(model, run, provider),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      thinkSource: source,
      thinkingModel: source === "usdc" && row.config?.llm ? thinkingModel({ llm: row.config.llm }) : null,
      thinkingUsd: paidForThinking?.paidUsd ?? 0,
      thinkingSteps: paidForThinking?.paidSteps ?? 0,
      thinkingUnansweredUsd: paidForThinking?.unansweredUsd ?? 0,
      thinkingCheckingUsd: paidForThinking?.checkingUsd ?? 0,
      thinkingUncheckedUsd: paidForThinking?.uncheckedUsd ?? 0,
      thinkingSimulatedUsd: paidForThinking?.simulatedUsd ?? 0,
      runCount: run.runs,
      tradeCount: agentTrades.length,
      winRate: wr.rate,
      firstFundedAt: Number.isFinite(fundedAtMs) ? new Date(fundedAtMs).toISOString() : null,
      stale: book.stale,
    };
  };

  const byNewest = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  const live = rows.filter((r) => r.mode === "live").sort(byNewest).map(build);
  const paper = rows.filter((r) => r.mode === "paper").sort(byNewest).map(build);

  // ---- totals: live only ---------------------------------------------------
  const totals: MoneyTotals = { ...EMPTY_TOTALS, agentCount: live.length };
  for (const agent of live) {
    totals.equityUsd += agent.equityUsd ?? 0;
    totals.cashUsd += agent.cashUsd ?? 0;
    totals.positionsUsd += agent.positionsUsd ?? 0;
    totals.realizedPnlUsd += agent.realizedPnlUsd;
    totals.unrealizedPnlUsd += agent.unrealizedPnlUsd;
    totals.feesUsd += agent.feesUsd;
    totals.dataSpendUsd += agent.dataSpendUsd;
    totals.thinkingUsd += agent.thinkingUsd;
    totals.tradeCount += agent.tradeCount;
    if (agent.modelSpendUsd === null) totals.unpricedAgents += 1;
    else {
      totals.modelSpendUsd += agent.modelSpendUsd;
      totals.pricedAgents += 1;
    }
    totals.fundedUsd += funding.get(agent.id)?.usdc ?? 0;
  }
  totals.pnlUsd = totals.realizedPnlUsd + totals.unrealizedPnlUsd;
  // Thinking paid per use is subtracted here and only here. `pnlUsd` above does not hold
  // it: a live book's basis already moved down by every such payment, as it does for a
  // withdrawal, so the wallet falling by it is not also a trading loss.
  totals.costsUsd = totals.feesUsd + totals.dataSpendUsd + totals.modelSpendUsd + totals.thinkingUsd;
  totals.netUsd = totals.pnlUsd - totals.costsUsd;

  // ---- the series: live only, so it agrees with the tiles above it ---------
  const liveIds = new Set(live.map((a) => a.id));
  const livePoints = points.filter((p) => liveIds.has(p.agentId));
  const equity = combineEquity(livePoints);
  const flows: FlowPoint[] = [
    ...depositRows.map((r) => ({ agentId: r.agentId, at: Number(r.at) * 1000, amountUsd: toNum(r.amount) })),
    ...withdrawRows.flatMap((r) => {
      const usdc = withdrawnUsdc(r.metadata);
      return r.agentId && usdc > 0 ? [{ agentId: r.agentId, at: r.at, amountUsd: -usdc }] : [];
    }),
    // What the live agents paid for their own thinking, from the same list the all-time
    // basis was made from. Deposits and withdrawals in that list are the two reads above.
    ...[...liveFlows].flatMap(([agentId, list]) =>
      list.flatMap((flow) => (flow.kind === "thinking" ? [{ agentId, at: flow.at, amountUsd: flow.amountUsd, kind: flow.kind }] : [])),
    ),
  ].filter((f) => liveIds.has(f.agentId));
  const days = pnlByDay(livePoints, { days: 30, flows, resolutionMs: EQUITY_BUCKET_MS });
  const today = days.at(-1);

  return {
    live,
    paper,
    totals,
    equity,
    basisUsd: totals.fundedUsd > 0 ? totals.fundedUsd : (equity[0]?.equityUsd ?? 0),
    days,
    today: {
      pnlUsd: today?.pnlUsd ?? null,
      pnlPct: today?.pnlPct ?? null,
      flowUsd: today?.flowUsd ?? 0,
      thinkingUsd: today?.thinkingUsd ?? 0,
    },
    stale: live.some((a) => a.stale),
    thinking: summarizeThinking(thinking, { live: new Set(live.map((a) => a.id)), paper: new Set(paper.map((a) => a.id)) }),
  };
}

/**
 * The account's pay-per-use picture from the three ledger reads, or null when there is
 * none to show: no step was ever paid for, is being or could not be checked, or was
 * simulated.
 */
function summarizeThinking(
  ledger: Awaited<ReturnType<typeof loadThinking>>,
  agentIds: { live: ReadonlySet<string>; paper: ReadonlySet<string> },
): ThinkingSummary | null {
  const out: ThinkingSummary = {
    paidUsd: 0,
    steps: 0,
    liveUsd: 0,
    paperUsd: 0,
    formerAgentsUsd: 0,
    unansweredUsd: 0,
    unansweredSteps: 0,
    checkingUsd: 0,
    checkingSteps: 0,
    checkingAnsweredUsd: 0,
    checkingAnsweredSteps: 0,
    uncheckedUsd: 0,
    uncheckedSteps: 0,
    uncheckedAnsweredUsd: 0,
    uncheckedAnsweredSteps: 0,
    simulatedUsd: 0,
    unanswered: [],
    ownKey: null,
  };
  let rowsSeen = 0;
  for (const row of ledger.byAgent) {
    const paidUsd = toNum(row.paidUsd);
    out.paidUsd += paidUsd;
    out.steps += Number(row.paidSteps ?? 0);
    out.unansweredUsd += toNum(row.unansweredUsd);
    out.unansweredSteps += Number(row.unansweredSteps ?? 0);
    out.checkingUsd += toNum(row.checkingUsd);
    out.checkingSteps += Number(row.checkingSteps ?? 0);
    out.checkingAnsweredUsd += toNum(row.checkingAnsweredUsd);
    out.checkingAnsweredSteps += Number(row.checkingAnsweredSteps ?? 0);
    out.uncheckedUsd += toNum(row.uncheckedUsd);
    out.uncheckedSteps += Number(row.uncheckedSteps ?? 0);
    out.uncheckedAnsweredUsd += toNum(row.uncheckedAnsweredUsd);
    out.uncheckedAnsweredSteps += Number(row.uncheckedAnsweredSteps ?? 0);
    out.simulatedUsd += toNum(row.simulatedUsd);
    rowsSeen +=
      Number(row.paidSteps ?? 0) + Number(row.checkingSteps ?? 0) + Number(row.uncheckedSteps ?? 0) + Number(row.simulatedSteps ?? 0);
    // The ledger outlives an agent, so a row can name one this account no longer has.
    if (row.agentId && agentIds.live.has(row.agentId)) out.liveUsd += paidUsd;
    else if (row.agentId && agentIds.paper.has(row.agentId)) out.paperUsd += paidUsd;
    else out.formerAgentsUsd += paidUsd;
  }
  // A payment still in flight (signed moments ago) is in none of the four counts, and
  // is not yet anything to show.
  if (rowsSeen === 0) return null;

  out.unanswered = ledger.unanswered.flatMap((row): ThinkingStepRow[] => {
    const seconds = typeof row.at === "number" ? row.at : Number(row.at);
    if (!Number.isFinite(seconds)) return [];
    return [
      {
        id: row.id,
        agentName: row.agentName ?? null,
        agentSlug: row.agentSlug ?? null,
        model: row.model,
        usd: toNum(row.usd),
        state: row.status === "paid_no_answer" ? "unanswered" : row.gaveUp === true ? "unchecked" : "checking",
        at: new Date(seconds * 1000).toISOString(),
        httpStatus: row.httpStatus ?? null,
        // Linked only when it reads as a Solana transaction id: the value came from the
        // gateway's receipt, and a link is built from it.
        txHash: row.txHash && SOLANA_SIGNATURE.test(row.txHash) ? row.txHash : null,
      },
    ];
  });
  out.ownKey = ownKeyComparison(
    ledger.tokens.map((row) => ({
      model: row.model,
      steps: Number(row.steps ?? 0),
      paidUsd: toNum(row.paidUsd),
      inputTokens: toNum(row.inputTokens),
      outputTokens: toNum(row.outputTokens),
    })),
  );
  return out;
}
