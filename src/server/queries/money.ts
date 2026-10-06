import "server-only";
/**
 * Reads for `/money` — the operator's own books, every agent at once.
 *
 * The page this feeds answers one question: **is this making money?** Which is not the
 * same question as "what is my equity", because equity does not know what the operation
 * cost. So everything here is arranged around one arithmetic:
 *
 *     net = (realised + unrealised PnL) − platform fees − x402 data − model tokens
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
 * - **Model spend is an estimate and is labelled one.** See {@link MODEL_PRICES}.
 *
 * The pure parts — {@link pnlByDay}, {@link combineEquity}, {@link estimateModelSpendUsd}
 * — take plain values and are tested in `money.test.ts`.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  agentFundingIntents,
  agentRuns,
  agents,
  auditEvents,
  equitySnapshots,
  getDb,
  platformFees,
  positions,
  trades,
  x402Payments,
} from "@/db";
import { DEFAULT_MODELS, knownModel } from "@/lib/agent/models";
import { getPortfolio } from "@/lib/agent/portfolio";
import { splitPnl, toNum } from "@/lib/money";
import { winRate } from "@/lib/pnl";
import type { AgentMode, AgentStatus, EquityPoint } from "@/server/types";
import { fillFeeUsd, loadBookMarks, snapshotInCurrentMode, withdrawnUsdc } from "./_shared";

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
 * List prices per million tokens, for the models the builder offers.
 *
 * **This is an estimate, and the page says so in as many words.** Three reasons it can
 * only ever be one:
 *
 *  1. `agent_runs` records `input_tokens` and `output_tokens` and nothing else — there is
 *     no cached-read or cache-write column, so a run that hit a warm prompt cache is
 *     billed here at the full input rate and the real invoice is lower, sometimes much.
 *  2. The model is read from the agent's config *now*. A run taken last week on a
 *     different model is priced at today's choice.
 *  3. The operator brings their own key, so the actual charge lands on their Anthropic /
 *     OpenAI account at whatever rate their account has. Tocker never sees that bill.
 *
 * A model with no entry here contributes `null`, not `0`: "we do not know" and "it was
 * free" are different facts and the UI prints them differently.
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
 * Find the price for a model id.
 *
 * Through the catalogue's own lookup, so the id resolves in any of its spellings: as
 * stored, a dated snapshot or its alias (`claude-haiku-4-5[-20251001]`), and the
 * OpenRouter form (`anthropic/claude-sonnet-5.5`). No prefix guessing: `claude-opus-5-5`
 * is not `claude-opus-5` at a different price, and a model that is not listed is
 * unknown → `null`.
 */
export function resolveModelPrice(model: string | null | undefined): ModelPrice | null {
  const known = knownModel(model);
  if (!known || known.inputPerMTok === undefined || known.outputPerMTok === undefined) return null;
  return { label: known.label, inputPerMTok: known.inputPerMTok, outputPerMTok: known.outputPerMTok };
}

/** Token counts × list price. `null` when the model has no published price here. */
export function estimateModelSpendUsd(
  model: string | null | undefined,
  tokens: { inputTokens: number; outputTokens: number },
): number | null {
  const price = resolveModelPrice(model);
  if (!price) return null;
  const input = Math.max(0, tokens.inputTokens) / 1_000_000;
  const output = Math.max(0, tokens.outputTokens) / 1_000_000;
  return input * price.inputPerMTok + output * price.outputPerMTok;
}

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

  // dayKey → { net, inflow }. The opening book counts on the day an agent first appears.
  const flowByDay = new Map<string, { net: number; inflow: number }>();
  const addFlow = (key: string, amountUsd: number) => {
    const day = flowByDay.get(key) ?? { net: 0, inflow: 0 };
    day.net += amountUsd;
    if (amountUsd > 0) day.inflow += amountUsd;
    flowByDay.set(key, day);
  };
  for (const open of opening.values()) addFlow(utcDayKey(open.at), open.equityUsd);
  for (const flow of opts.flows ?? []) {
    const ms = toMs(flow.at);
    const open = opening.get(flow.agentId);
    if (!open || !Number.isFinite(ms) || !Number.isFinite(flow.amountUsd) || flow.amountUsd === 0) continue;
    if (ms < open.at + resolutionMs) continue; // inside the opening book already
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
    const flow = flowByDay.get(key) ?? { net: 0, inflow: 0 };
    const pnlUsd = previous === null ? null : total - previous - flow.net;
    const base = previous === null ? 0 : previous + flow.inflow;
    rows.push({
      day: key,
      equityUsd: total,
      pnlUsd,
      pnlPct: pnlUsd === null || base === 0 ? null : (pnlUsd / Math.abs(base)) * 100,
      flowUsd: previous === null ? 0 : flow.net,
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
 */
export function combineEquity(
  snapshots: readonly SnapshotPoint[],
  bucketMs: number = EQUITY_BUCKET_MS,
): EquityPoint[] {
  const size = bucketMs > 0 ? bucketMs : EQUITY_BUCKET_MS;
  const byAgent = new Map<string, Map<number, { at: number; equityUsd: number; cashUsd: number }>>();
  const buckets = new Set<number>();

  for (const point of snapshots) {
    const ms = toMs(point.at);
    if (!Number.isFinite(ms) || !Number.isFinite(point.equityUsd)) continue;
    const bucket = Math.floor(ms / size) * size;
    buckets.add(bucket);
    const forAgent = byAgent.get(point.agentId) ?? new Map();
    const held = forAgent.get(bucket);
    if (!held || ms >= held.at) {
      forAgent.set(bucket, { at: ms, equityUsd: point.equityUsd, cashUsd: point.cashUsd ?? 0 });
    }
    byAgent.set(point.agentId, forAgent);
  }

  const carried = new Map<string, { equityUsd: number; cashUsd: number }>();
  return [...buckets]
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
      return { at: new Date(bucket).toISOString(), equityUsd, cashUsd };
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
  /** Estimate — see {@link MODEL_PRICES}. Null when the model has no published price. */
  modelSpendUsd: number | null;
  inputTokens: number;
  outputTokens: number;
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
  today: { pnlUsd: number | null; pnlPct: number | null; flowUsd: number };
  /** True when any live agent's wallet read failed — the page has to say so. */
  stale: boolean;
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
  today: { pnlUsd: null, pnlPct: null, flowUsd: 0 },
  stale: false,
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
  if (rows.length === 0) return EMPTY_MONEY;

  const ids = rows.map((r) => r.id);
  const since = new Date(startOfUtcDayMs(Date.now()) - (SNAPSHOT_WINDOW_DAYS - 1) * DAY_MS);
  const bucketSeconds = Math.round(EQUITY_BUCKET_MS / 1000);
  // Inlined, not bound: this expression appears in both SELECT and GROUP BY, and each
  // bound use becomes its own `$n`, so Postgres would see two different expressions and
  // refuse the query. `bucketSeconds` is a server constant, never user input.
  const bucketExpr = sql<string>`floor(extract(epoch from ${equitySnapshots.at}) / ${sql.raw(String(bucketSeconds))})`;

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
  ] = await Promise.all([
    // One row per agent per 15 minutes: the last snapshot in the bucket. The bucket
    // index alone carries the timestamp (900s divides a day exactly, so a bucket never
    // straddles UTC midnight), which keeps a driver-specific timestamp cast out of it.
    db
      .select({
        agentId: equitySnapshots.agentId,
        bucket: bucketExpr,
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
        inputTokens: sql<string>`coalesce(sum(${agentRuns.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${agentRuns.outputTokens}), 0)`,
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
    loadBookMarks(
      db,
      rows.filter((r) => r.mode === "live").map((r) => r.id),
    ),
  ]);

  // ---- snapshots -----------------------------------------------------------
  const points: SnapshotPoint[] = snapshotRows.map((row) => ({
    agentId: row.agentId,
    at: Number(row.bucket) * bucketSeconds * 1000,
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
      modelSpendUsd: estimateModelSpendUsd(model, run),
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
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
    totals.tradeCount += agent.tradeCount;
    if (agent.modelSpendUsd === null) totals.unpricedAgents += 1;
    else {
      totals.modelSpendUsd += agent.modelSpendUsd;
      totals.pricedAgents += 1;
    }
    totals.fundedUsd += funding.get(agent.id)?.usdc ?? 0;
  }
  totals.pnlUsd = totals.realizedPnlUsd + totals.unrealizedPnlUsd;
  totals.costsUsd = totals.feesUsd + totals.dataSpendUsd + totals.modelSpendUsd;
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
    today: { pnlUsd: today?.pnlUsd ?? null, pnlPct: today?.pnlPct ?? null, flowUsd: today?.flowUsd ?? 0 },
    stale: live.some((a) => a.stale),
  };
}
