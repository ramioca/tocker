/**
 * The agent's tool belt.
 *
 * Every tool is wrapped so that it writes a `tool_call` step before it runs and a
 * `tool_result` step (with `durationMs`) after, and an `error` step if it throws.
 * Tools return structured failures instead of throwing, so one bad call does not kill
 * the run — the model gets to read the reason and try something else.
 */
import { getScoreHistory, scoreTrend } from "@/lib/tokens/history";
import { loadCachedScores } from "@/lib/trading/score-cache";
import { buyCostUsd, floorToCents, formatFeeRate, maxBuyUsd, platformFeeBps } from "@/lib/platform/fee";
import { MAX_PROPOSALS_PER_TICK, MIN_SCORED_PER_TICK, SEEN_WINDOW_MS } from "./limits";
import { INTEL_SOURCE, SMART_MONEY_SOURCE, planEnrichment, type EnrichmentPlan } from "./enrichment";

import { nanoid } from "nanoid";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, posts, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { smartMoneyEndpoint } from "@/lib/data-sources/nansen";
import { DATA_SOURCES, getDataSource, toDataSourceInfo } from "@/lib/data-sources/registry";
import { X402BudgetError, type RunBudget, type X402Context } from "@/lib/x402/types";
import { getExecutor, type ExecutorAgent, type TradeRequest } from "@/lib/trading/executor";
import { DUST_POSITION_USD, applyFill, heldAmountToken, sellAmountToken } from "@/lib/trading/positions";
import { getPriceUsd } from "@/lib/trading/prices";
import { recentRangePct } from "@/lib/trading/range";
import { checkQuoteSanity } from "@/lib/trading/sanity";
import { buildReceipt, saveReceipt } from "@/lib/trading/receipt";
import { chargePlatformFee } from "@/lib/platform/fees";
import { notifyFill } from "@/lib/notifications";
import { redactDeep, redactSecrets } from "@/lib/security/redact";
import {
  createProposal,
  openProposalsUsd,
  pendingProposalTokenIds,
  expireAgentProposals,
  hasPendingProposal,
  indicativePrice,
  notifyAgentFollowers,
  requiresApproval,
} from "@/lib/trading/proposals";
import { riskGuard, type OrderIntent } from "@/lib/trading/risk";
import { executeTrade } from "@/lib/trading/settle";
import { ensureQuoteToken, resolveToken } from "@/lib/trading/tokens";
import {
  discoverCandidates,
  getTokenScoreDetail,
  MAX_DISCOVERY_LIMIT,
  renderCandidates,
  renderScore,
  smartMoneyLine,
  smartMoneyLineFromScore,
  smartMoneyNotReadLine,
  smartMoneyReading,
  sweepFilters,
  toTradeScore,
  type TokenScoreDetail,
} from "@/lib/tokens";
import { compactNumber } from "@/lib/money";
import type { Chain, TokenCandidate, TokenScore } from "@/server/types";
import { describePortfolio, effectiveTicketUsd, getPortfolio, spendableCashUsd, toRiskPortfolio } from "./portfolio";
import type { RunLogger } from "./logger";
import { buildPositionTools } from "./tools-positions";

export interface RunAgentRecord {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  mode: "paper" | "live";
  config: AgentConfig;
}

export interface RunContext {
  runId: string;
  agent: RunAgentRecord;
  x402: X402Context;
  budget: RunBudget;
  logger: RunLogger;
  /** Set by the `finish` tool. */
  finished: { summary: string | null };
  tradeIds: string[];
  postIds: string[];
  /**
   * Set for a provider whose API refuses a tool parameter that is an object with no
   * declared properties (`freeFormParams` in the provider registry). The one such
   * parameter, `query_data_source.params`, is then declared as JSON in a string.
   */
  freeFormParamsAsJson?: boolean;
}

const chainSchema = z.enum(["solana", "base"]);

const freeFormParams = z.record(z.string(), z.unknown());

/**
 * How `query_data_source.params` is declared to the model: an object of whatever the
 * source asks for, or, for a provider that refuses an object with no declared
 * properties, that same object as JSON in a string.
 */
export function freeFormParamsSchema(asJson: boolean) {
  return asJson
    ? z.string().default("{}").describe('Source-specific parameters, as a JSON object written in a string, e.g. {"query":"..."}')
    : freeFormParams.default({}).describe("Source-specific parameters");
}

/**
 * Pure: a source's parameters as the model sent them, as an object. A model may send the
 * object itself or, where the tool was declared that way, the same object as JSON in a
 * string. Anything else is null, and the tool says what it needs.
 */
export function readFreeFormParams(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === "") return {};
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = freeFormParams.safeParse(candidate);
  return parsed.success && !Array.isArray(candidate) ? parsed.data : null;
}

type ToolOutcome = Record<string, unknown>;

function fail(reason: string, extra: ToolOutcome = {}): ToolOutcome {
  return { ok: false, reason, ...extra };
}

/** Wraps a tool body with step logging and error containment. */
function logged(
  ctx: RunContext,
  name: string,
  fn: (input: Record<string, unknown>) => Promise<ToolOutcome>,
): (input: Record<string, unknown>) => Promise<ToolOutcome> {
  return async (input) => {
    const startedAt = Date.now();
    await ctx.logger.log({ kind: "tool_call", toolName: name, payload: { input } });
    try {
      // Scrubbed before the model reads it, not only before it is stored: what a tool
      // returns includes failure text from RPC nodes and paid APIs, and the model writes
      // in public. A credential it never saw is one it cannot repeat.
      const result = redactDeep(await fn(input));
      await ctx.logger.log({
        kind: "tool_result",
        toolName: name,
        payload: { result },
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err));
      await ctx.logger.log({
        kind: "error",
        toolName: name,
        payload: { error: message },
        durationMs: Date.now() - startedAt,
      });
      return fail(message);
    }
  };
}

async function fetchBaseIntel(address: string): Promise<ToolOutcome> {
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${address}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return fail(`DexScreener responded ${res.status}`);
  const body: unknown = await res.json();
  const rows = Array.isArray(body) ? body : [];
  const first = rows[0];
  if (!first || typeof first !== "object") return fail("No Base pair found for this address.");
  const r = first as Record<string, unknown>;
  return {
    ok: true,
    source: "dexscreener (free)",
    priceUsd: Number(r.priceUsd),
    liquidityUsd: (r.liquidity as Record<string, unknown> | undefined)?.usd ?? null,
    volume24h: (r.volume as Record<string, unknown> | undefined)?.h24 ?? null,
    priceChange: r.priceChange ?? null,
    fdv: r.fdv ?? null,
    dexId: r.dexId ?? null,
  };
}

const discoveryFeedSchema = z.enum([
  "new_launches",
  "trending",
  "top_organic",
  "momentum",
  "gecko_launches",
  "paid_launches",
  "smart_money",
]);

/**
 * Shrinks a score to the fields worth spending the model's context on. `smartMoney` is
 * the paid smart money read in words, when there is something to say about one.
 */
function scorePayload(score: TokenScore, smartMoney: string | null = null): ToolOutcome {
  return {
    ok: true,
    symbol: score.symbol,
    chain: score.chain,
    address: score.address,
    total: score.total,
    verdict: score.verdict,
    components: score.components,
    blockers: score.blockers,
    warnings: score.warnings,
    priceUsd: score.priceUsd,
    liquidityUsd: score.liquidityUsd,
    volume24hUsd: score.volume24hUsd,
    marketCapUsd: score.marketCapUsd,
    holderCount: score.holderCount,
    ageHours: score.ageHours,
    priceChange24hPct: score.priceChange24hPct,
    sources: score.sources,
    scoredAt: score.scoredAt,
    rendered: renderScore(score, smartMoney),
  };
}

/**
 * What a score_token result says about the paid smart money read, or `null` when there
 * is nothing to say: the read itself when it is on hand, else what a cached score still
 * holds of one, else why a read that was wanted is missing. `said` is the line `rendered`
 * carries; `status` is "reading" (with the net flow and the wallet count the component
 * was scored from), "none" (bought, and no tracked wallet traded the token), "cached"
 * (bought with an earlier score, amounts not kept) or "not_read".
 */
function smartMoneyNote(detail: TokenScoreDetail, missed: string | undefined): (ToolOutcome & { said: string }) | null {
  const { score, smartMoney: read } = detail;
  if (read !== null) {
    const reading = smartMoneyReading(read);
    return {
      status: reading === null ? "none" : "reading",
      ...(reading === null ? {} : { netFlowUsd: reading.netflowUsd, wallets: reading.wallets }),
      said: smartMoneyLine(read),
    };
  }
  const kept = smartMoneyLineFromScore(score);
  if (kept !== null) return { status: score.components.smartMoney === null ? "none" : "cached", said: kept };
  if (missed !== undefined) return { status: "not_read", said: smartMoneyNotReadLine(missed.slice("smartMoney:".length)) };
  return null;
}

/**
 * What `amountUsd` means, for the model that fills it in. The fee is said here, where a
 * buy is sized: it is charged on top of the amount, so the amount is not what the buy
 * costs. With the fee off the sentence is the plain one.
 */
function tradeAmountWords(feeBps: number): string {
  const plain = "USD notional to buy, or USD worth of the position to sell";
  if (!(feeBps > 0)) return plain;
  return `${plain}. A buy is charged the ${formatFeeRate(feeBps)} Tocker fee on top of this amount, so your cash has to cover both; a sell's fee comes off what the sale brings in, never off the size you may sell`;
}

/** An age ceiling in the candidate table's own units: "45m", "1h", "2.5h", "3d". */
function ageWords(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return hours < 48 ? `${Number(hours.toFixed(1))}h` : `${Math.round(hours / 24)}d`;
}

/** Keeps each call of a tool in `inFlight` from the moment it is made until it settles. */
function tracked<I, O>(inFlight: Set<Promise<unknown>>, execute: (input: I) => Promise<O>): (input: I) => Promise<O> {
  return (input) => {
    const call = execute(input);
    inFlight.add(call);
    const settled = () => void inFlight.delete(call);
    void call.then(settled, settled);
    return call;
  };
}

export function buildTools(ctx: RunContext): ToolSet {
  const { agent } = ctx;
  const executorAgent: ExecutorAgent = { id: agent.id, mode: agent.mode, wallets: ctx.x402.wallets };
  const allowedSources = agent.config.dataSources;
  const { universe } = agent.config;
  /** `approve`: every order this agent places becomes a proposal for its owner. */
  const approvalMode = requiresApproval(agent.config);
  /** Tokens already proposed this tick, so one tick cannot queue five decisions on BONK. */
  const proposedThisTick = new Set<string>();
  /** Tokens scored this tick that clear the bar — the shortlist `finish` holds the model to, once. */
  const shortlistThisTick = new Map<string, { symbol: string; total: number }>();
  let finishNudged = false;
  /** post_note has been used this tick. */
  let notePostedThisTick = false;
  /** Tokens whose paid signals were already bought this tick — the score cache holds them. */
  const enrichedThisTick = new Set<string>();
  /**
   * The smart money board is the owner's to switch on, twice: the feed under "How it
   * finds tokens" and the source that sells it under "Data it buys". Nothing the model
   * sends changes either.
   */
  const smartMoneyBoardOn = universe.discovery.includes("smart_money") && allowedSources.includes(SMART_MONEY_SOURCE);
  /**
   * The smart money boards bought this tick, by chain. One record for every sweep of
   * the tick, so a chain's board is paid for once however many times the model sweeps.
   */
  const smartMoneyBoards = new Map<Chain, Promise<TokenCandidate[]>>();
  /** Every token scored this tick, and the fresh candidates discovery surfaced — `finish` compares the two, once. */
  const scoredThisTick = new Set<string>();
  const freshThisTick = new Map<string, string>();
  let researchNudged = false;
  /**
   * A sweep under the owner's own settings, with no filter of the model's, has come back
   * this tick, or a narrowed sweep has started widening to one.
   */
  let ownerSweepThisTick = false;
  /**
   * A sweep got as far as its feeds this tick, so its launch radar may be paid for,
   * whether or not the sweep then came back. `finish` never orders a sweep after that:
   * the sweep it ordered would buy the same radar a second time.
   */
  let sweepStartedThisTick = false;
  /**
   * The discover_tokens calls that have not come back yet. A step's tool calls run side
   * by side, so `finish` can be called while a sweep of the same step is still out. It
   * waits for these, and judges the tick on the table they bring back.
   */
  const sweepsInFlight = new Set<Promise<unknown>>();

  /**
   * Whether a buy could still go through this tick: a buy left today, cash for a ticket,
   * trading not paused. Unknown counts as no, because the one caller asks before sending
   * the model back for research, and research nothing can come of is the owner's money.
   * A ticket is one that would stay on the book: a position under `DUST_POSITION_USD`
   * leaves it at once and no exit rule watches it, so a few cents of cash is not a
   * reason to pay for a sweep.
   */
  const canStillBuy = async (): Promise<boolean> => {
    try {
      const portfolio = await getPortfolio(agent.id);
      if (portfolio.cashReadFailed || portfolio.tradesToday >= agent.config.risk.maxDailyTrades) return false;
      if (effectiveTicketUsd(portfolio, agent.config).amountUsd < DUST_POSITION_USD) return false;
      const { isTradingPaused } = await import("@/lib/security/kill-switch");
      return !(await isTradingPaused(agent.ownerId));
    } catch {
      return false;
    }
  };

  /**
   * Scores a token for this agent, with what is known of its smart money read beside
   * the score. Returns `null` only when scoring itself blew up.
   */
  const scoreDetailFor = async (
    chain: "solana" | "base",
    address: string,
    paid: { deep?: boolean; smartMoney?: boolean; sellCheck?: boolean } = {},
  ): Promise<TokenScoreDetail | null> => {
    const wantsPaid = paid.deep === true || paid.smartMoney === true || paid.sellCheck === true;
    try {
      return await getTokenScoreDetail({
        chain,
        address,
        universe,
        maxTradeUsd: agent.config.risk.maxTradeUsd,
        dataSources: allowedSources,
        ...(paid.deep === true ? { deep: true } : {}),
        ...(paid.smartMoney === true || paid.sellCheck === true
          ? {
              paid: {
                ...(paid.smartMoney === true ? { smartMoney: true } : {}),
                ...(paid.sellCheck === true ? { sellCheck: true } : {}),
              },
            }
          : {}),
        ...(wantsPaid ? { x402: ctx.x402 } : {}),
      });
    } catch {
      // A scoring failure must never become a trade; the caller turns null into a refusal.
      return null;
    }
  };
  /** The free score alone, for the callers that only size or guard an order. */
  const scoreFor = async (chain: "solana" | "base", address: string): Promise<TokenScore | null> =>
    (await scoreDetailFor(chain, address))?.score ?? null;

  return {
    discover_tokens: tool({
      description: `Sweep your discovery feeds for tradeable candidates on your chains. Call it with no arguments first: your owner's settings (age, liquidity, holders, blocklist, feeds, chains) already apply. Free — with one exception: the \`paid_launches\` feed buys a pre-screened launch radar per chain (SolEnrich on Solana, gate402 on Base, about $0.02 a chain) and only runs when your config or this call asks for it. \`gecko_launches\` is free but narrow: it reads GeckoTerminal's new and trending pools on either chain and keeps only the tokens GeckoTerminal's own GT Score rates 50 or better, so it surfaces few names and skips anything minutes old that nobody has rated yet. ${
        smartMoneyBoardOn
          ? "`smart_money` is on for you: the first sweep of a chain each tick buys Nansen's board of the tokens tracked funds and smart traders accumulated most in 24 hours ($0.05 a chain, once), and the SM24H column is that net flow in USD."
          : "`smart_money` is a paid feed only your owner can switch on; naming it here does nothing."
      } Returns a ranked table already filtered on the gates that can be checked for free (age, liquidity, holders, blocklist); safety gates are applied later by score_token. maxAgeHours and minLiquidityUsd only NARROW the sweep: use them when the table is too long or your strategy is about new launches. To get more candidates, drop them or try other feeds.`,
      inputSchema: z.object({
        chain: chainSchema.optional().describe("Restrict to one chain; omit to sweep every chain you trade"),
        feeds: z
          .array(discoveryFeedSchema)
          .min(1)
          .max(7)
          .optional()
          .describe("Sweep these feeds instead of your configured ones, for this call only. Omit to use your configured feeds"),
        maxAgeHours: z
          .number()
          .positive()
          .max(87_600)
          .optional()
          .describe(
            "Narrows the sweep: only tokens younger than this many hours. Omit to use your owner's age window. It cannot go past your owner's maximum age and never finds more tokens",
          ),
        minLiquidityUsd: z
          .number()
          .min(0)
          .max(100_000_000)
          .optional()
          .describe(
            "Narrows the sweep: only tokens with at least this much liquidity, in USD. Omit to use your owner's floor. A value below your owner's floor is raised to it",
          ),
        limit: z.number().int().min(1).max(50).optional().describe("How many candidates to return (default 30)"),
      }),
      execute: tracked(sweepsInFlight, logged(ctx, "discover_tokens", async (input) => {
        const parsed = z
          .object({
            chain: chainSchema.optional(),
            feeds: z.array(discoveryFeedSchema).optional(),
            maxAgeHours: z.number().optional(),
            minLiquidityUsd: z.number().optional(),
            limit: z.number().optional(),
          })
          .parse(input);

        const chains = parsed.chain ? [parsed.chain] : agent.config.chains;
        if (parsed.chain && !agent.config.chains.includes(parsed.chain)) {
          return fail(`Chain ${parsed.chain} is not enabled for this agent.`, { enabled: agent.config.chains });
        }

        // Launches first, paid for. GeckoTerminal's rated launches and the paid launch
        // radars (SolEnrich on Solana, gate402 on Base — the platform's wallet pays,
        // about $0.02 a sweep) run on every sweep whatever the feed list says: the
        // operator's instruction (2026-09-22) is to pay for the endpoints before
        // deciding, never to let a free list gate what gets researched. Jupiter's free
        // lists still run, but their names rank after the launches.
        const feeds = new Set<string>(parsed.feeds ?? universe.discovery);
        feeds.add("gecko_launches");
        feeds.add("paid_launches");
        const ownFeeds = new Set<string>([...universe.discovery, "gecko_launches", "paid_launches"]);
        // The smart money board follows the owner's two switches and nothing else. With
        // both on it is in every sweep, for the reason the radars are: a model that
        // names its own feeds must not be what leaves out data its owner turned on.
        // Without both it is in no sweep, whatever feed list the model sends. Either way
        // a chain's board is bought once a tick (`smartMoneyBoards`).
        if (smartMoneyBoardOn) feeds.add("smart_money");
        else {
          feeds.delete("smart_money");
          ownFeeds.delete("smart_money");
        }

        // What this call narrowed, in the words the model is told it in. The model's two
        // filters are held inside the owner's (`sweepFilters`), so a filter is in this list
        // only when it is tighter than the owner's; a feed list only when it leaves out a
        // feed the owner configured; a chain only when the agent trades another as well.
        const applied = sweepFilters(universe, parsed);
        const narrowedBy = [
          applied.maxAgeHours !== null && applied.maxAgeHours !== universe.maxAgeHours ? `under ${ageWords(applied.maxAgeHours)}` : null,
          applied.minLiquidityUsd > universe.minLiquidityUsd ? `$${compactNumber(applied.minLiquidityUsd)}+ liquidity` : null,
          parsed.feeds && [...ownFeeds].some((feed) => !feeds.has(feed)) ? `feeds ${parsed.feeds.join(" + ")}` : null,
          agent.config.chains.some((chain) => !chains.includes(chain)) ? `${chains.join(", ")} only` : null,
        ].filter((words): words is string => words !== null);
        const narrowed = narrowedBy.length > 0;

        // The radars this call has paid for. Both sweeps below are handed the same map, so
        // the second reads a chain's radar from it and never buys that radar again. (A radar
        // is asked for the sweep's liquidity floor: when the model raised it, the rows read
        // again are the ones above the model's floor, and the rest are not bought.)
        const bought = new Map<Chain, TokenCandidate[]>();
        // How many rows the table holds. Wider than the old 20 by default: the fresh part
        // of the table is what matters.
        const limit = parsed.limit ?? 30;
        const sweep = {
          universe,
          // Only used by the `paid_launches` feed; every other feed ignores these.
          x402: ctx.x402,
          dataSources: allowedSources,
          alwaysPaidLaunches: true,
          paidLaunches: bought,
          smartMoneyBoards,
          // The whole ranked pool, not `limit` rows of it. Which rows are fresh is only
          // known further down, and a pool cut to the table's size first can be all names
          // the agent has already seen while fresh ones sit just past the cut: the table
          // then said "nothing new" and the tick ended. The table is cut once, below. A
          // sweep's limit is a final slice, so this asks no provider for anything more.
          limit: MAX_DISCOVERY_LIMIT,
        };
        // From here the launch radar may be paid for, whatever happens to this call.
        sweepStartedThisTick = true;
        let candidates = await discoverCandidates({
          ...sweep,
          chains,
          feeds: [...feeds] as typeof universe.discovery,
          ...(parsed.minLiquidityUsd === undefined ? {} : { minLiquidityUsd: parsed.minLiquidityUsd }),
          ...(parsed.maxAgeHours === undefined ? {} : { maxAgeHours: parsed.maxAgeHours }),
        });

        // What the agent has already dealt with: held, proposed and undecided, or scored
        // within the seen window. Those are flagged and go at the bottom, in the room the
        // fresh rows leave, so the top of the table is research the agent has not done
        // yet — the same three names re-scored every five minutes was the whole complaint.
        const [portfolio, proposed, cached] = await Promise.all([
          getPortfolio(agent.id),
          pendingProposalTokenIds(agent.id),
          loadCachedScores(candidates.map((c) => c.token.id)),
        ]);
        const heldIds = new Set(portfolio.positions.map((p) => p.token.id));
        const seenReason = (tokenId: string): string | null => {
          if (heldIds.has(tokenId)) return "held";
          if (proposed.has(tokenId)) return "proposed, awaiting your owner";
          const row = cached.get(tokenId);
          if (row && Date.now() - row.scoredAt.getTime() < SEEN_WINDOW_MS) {
            return `scored ${Math.max(1, Math.round((Date.now() - row.scoredAt.getTime()) / 60_000))}m ago at ${Math.round(row.total)}`;
          }
          return null;
        };
        const isFresh = (c: TokenCandidate) => seenReason(c.token.id) === null;

        // A narrowed sweep that came back thin widens itself, once: the same sweep under
        // the owner's settings alone, its rows added after the ones the model's filters
        // matched. A weak model reads "maxAgeHours" as a way to see more, passes a small
        // number, gets an empty table and ends the tick on it (seen live, 2026-10-08).
        // Not repeated when the owner's sweep has already come back this tick: the model
        // has that table, and a second copy is tokens its owner pays to have read again.
        //
        // Thin is counted on everything the model's filters matched, before the table's
        // limit, and a table its limit fills is not thin however low the model set it.
        const matched = candidates.filter(isFresh).length;
        const thin = narrowed && matched < Math.min(MIN_SCORED_PER_TICK, limit);
        const widened = thin && !ownerSweepThisTick;
        if (widened) {
          // Claimed before the sweep is awaited: two calls made in one step run side by
          // side, and only one of them may widen.
          ownerSweepThisTick = true;
          // The widening never pays. A radar the first sweep bought is read again from the
          // record. One it did not buy (a chain the model left out) is left out here too:
          // were it bought now, a later sweep of that chain would pay for it a second time
          // in the same tick. That chain's free feeds are still swept.
          for (const chain of agent.config.chains) if (!bought.has(chain)) bought.set(chain, []);
          // The same for the smart money board, on a copy: the tick's own record must
          // stay empty for a chain nobody has bought, so a later sweep of it still can.
          const boards = new Map(smartMoneyBoards);
          for (const chain of agent.config.chains) if (!boards.has(chain)) boards.set(chain, Promise.resolve([]));
          const own = await discoverCandidates({
            ...sweep,
            smartMoneyBoards: boards,
            chains: agent.config.chains,
            feeds: [...ownFeeds] as typeof universe.discovery,
          });
          const have = new Set(candidates.map((c) => c.token.id));
          const added = own.filter((c) => !have.has(c.token.id));
          for (const [id, score] of await loadCachedScores(added.map((c) => c.token.id))) cached.set(id, score);
          candidates = [...candidates, ...added];
        }
        if (!narrowed) ownerSweepThisTick = true;

        // One table of at most `limit` rows, fresh first; within each part the rows the
        // model's own filters matched come before the ones the widening added.
        const freshFound = candidates.filter(isFresh);
        const fresh = freshFound.slice(0, limit);
        const seen = candidates.filter((c) => !isFresh(c)).slice(0, limit - fresh.length);
        for (const c of fresh) freshThisTick.set(c.token.id, c.token.symbol);

        const row = (c: TokenCandidate) => ({
          symbol: c.token.symbol,
          chain: c.token.chain,
          address: c.token.address,
          origin: c.origin,
          quickScore: c.quickScore,
          liquidityUsd: c.liquidityUsd,
          volume24hUsd: c.volume24hUsd,
          marketCapUsd: c.marketCapUsd,
          holderCount: c.holderCount,
          ageHours: c.ageHours,
          priceChange24hPct: c.priceChange24hPct,
          // Only on a token the paid smart money board named.
          ...(c.smartMoneyNetflowUsd === undefined ? {} : { smartMoneyNetflow24hUsd: c.smartMoneyNetflowUsd }),
          seen: seenReason(c.token.id),
        });
        const seenLine =
          seen.length === 0
            ? ""
            : `\n\nAlready seen (not fresh research): ${seen.map((c) => `${c.token.symbol} (${seenReason(c.token.id)})`).join(", ")}`;

        // What happened to the model's filters, said once and plainly. It leads both the
        // table and the note, because a model may read either.
        const filters = narrowedBy.join(", ");
        const tokens = (n: number) => `${n} fresh token${n === 1 ? "" : "s"}`;
        const happened = !thin
          ? null
          : !widened
            ? `Your filters (${filters}) matched ${tokens(matched)}. A sweep with your owner's settings alone already ran this tick, so it was not run again.`
            : fresh.length === 0
              ? `Your filters (${filters}) matched 0 fresh tokens. The sweep was run again with your owner's settings alone and also found 0 fresh tokens. There is nothing new to score this tick; that is a valid result.`
              : `Your filters (${filters}) matched ${tokens(matched)}, so this table also includes what a sweep with your owner's settings alone found.${matched > 0 ? " The tokens your filters matched are listed first." : ""}`;
        const toScore =
          fresh.length === 0
            ? "There are no fresh candidates to score."
            : fresh.length < MIN_SCORED_PER_TICK
              ? `Score ${fresh.length === 1 ? "the 1 fresh candidate" : `all ${fresh.length} fresh candidates`} before deciding.`
              : `Score at least ${MIN_SCORED_PER_TICK} of the fresh candidates before deciding.`;
        // How to see more, said only to a sweep under the owner's settings that found too few
        // fresh candidates: what cannot find more, and what can. A narrowed sweep is told
        // nothing here. A thin one was widened above, and one with enough to score needs no
        // second sweep: sent to sweep again, it would buy the launch radar it has just bought.
        // `cut` is fresh candidates the table's limit left out.
        const cut = freshFound.length > fresh.length;
        const more =
          narrowed || fresh.length >= MIN_SCORED_PER_TICK
            ? null
            : `This sweep already used your owner's settings with no extra filters${cut ? ` and stopped at its limit of ${limit} rows` : ""}. maxAgeHours and minLiquidityUsd only narrow a sweep, so they cannot find more; ${cut ? "a higher limit or other feeds can" : "only other feeds can"}.${fresh.length === 0 && !cut ? " Finding nothing new is a valid result." : ""}`;
        // A filter that asked for more than the owner allows was not applied as written.
        const held = [
          parsed.minLiquidityUsd !== undefined && parsed.minLiquidityUsd < universe.minLiquidityUsd
            ? `minLiquidityUsd was raised to your owner's floor of $${compactNumber(universe.minLiquidityUsd)}`
            : null,
          parsed.maxAgeHours !== undefined && universe.maxAgeHours !== null && parsed.maxAgeHours > universe.maxAgeHours
            ? `maxAgeHours was lowered to your owner's maximum age of ${ageWords(universe.maxAgeHours)}`
            : null,
        ].filter((words): words is string => words !== null);
        const heldLine = held.length === 0 ? null : `Note: ${held.join(" and ")}. A token outside your owner's settings can never be bought.`;
        // The model asked for a feed that is not its to switch on.
        const boardLine =
          parsed.feeds?.includes("smart_money") && !smartMoneyBoardOn
            ? "The smart_money feed was not swept: only your owner can switch it on."
            : null;
        // Named as the two sets of wallets they are: the board counts funds and smart
        // traders, score_token's line counts smart traders and top-PnL wallets. A token
        // only a fund bought shows a flow here and "no tracked wallet" there, both true.
        const flowLine = [...fresh, ...seen].some((c) => c.smartMoneyNetflowUsd !== undefined)
          ? "SM24H (smartMoneyNetflow24hUsd) is the net USD Nansen's tracked funds and smart traders moved into the token in the last 24 hours. score_token's smart money line counts smart traders and top-PnL wallets, not funds, so the two can differ."
          : null;

        return {
          ok: true,
          chains: widened ? agent.config.chains : chains,
          feeds: widened ? [...new Set([...feeds, ...ownFeeds])] : [...feeds],
          count: fresh.length + seen.length,
          freshCount: fresh.length,
          // Present only on a sweep that widened itself: how many fresh candidates the
          // model's own filters matched before the owner's settings were swept as well.
          ...(widened ? { widened: true, matchedYourFilters: matched } : {}),
          candidates: [...fresh, ...seen].map(row),
          rendered: `${happened === null ? "" : `${happened}\n\n`}${renderCandidates(fresh)}${seenLine}`,
          note: [happened, "quickScore is a cheap pre-rank, not the real score.", toScore, more, heldLine, boardLine, flowLine]
            .filter((line): line is string => line !== null)
            .join(" "),
        };
      })),
    }),

    score_token: tool({
      description:
        "The full safety + quality score for one token: a 0-100 composite, a verdict, the free components, hard-gate blockers and warnings — and, for any token that clears the free gates, the paid signals your owner configured, bought automatically from your per-run data budget in this order: Deepnets safety on Solana ($0.01, returned as `intel`: mint/freeze flags, bundling, network concentration, critical risks), Plexa sell simulation on Base ($0.05, a proven failure raises cannot_sell), X sentiment (~$0.01, folded in as a component), Nansen smart money ($0.01: what smart traders and top-PnL wallets did with this token in the last 24h, folded in as a component and said in words in the `smartMoney` field and in `rendered`). `paidSignals` says what was bought and `notBought` says what was not and why. A hard-blocked token buys nothing. Pass deep / smartMoney / sellCheck only to override that plan.",
      inputSchema: z.object({
        chain: chainSchema,
        address: z.string().min(3).describe("Mint (Solana) or contract address (Base)"),
        deep: z
          .boolean()
          .optional()
          .describe("Pay for sentiment and fold it into the score. Costs money; default false"),
        smartMoney: z
          .boolean()
          .optional()
          .describe("Pay ~$0.01 for the per-token smart money read and fold it in as a component. Default false"),
        sellCheck: z
          .boolean()
          .optional()
          .describe("Pay ~$0.05 for a live sell simulation (Base only). A proven failure blocks the buy. Default false"),
      }),
      execute: logged(ctx, "score_token", async (input) => {
        const parsed = z
          .object({
            chain: chainSchema,
            address: z.string(),
            deep: z.boolean().optional(),
            smartMoney: z.boolean().optional(),
            sellCheck: z.boolean().optional(),
          })
          .parse(input);
        const token = await resolveToken(parsed.chain, parsed.address);
        const explicit = parsed.deep !== undefined || parsed.smartMoney !== undefined || parsed.sellCheck !== undefined;

        // Free first, always: the gates decide whether paying for more is worth anything.
        const freeDetail = await scoreDetailFor(parsed.chain, token.address);
        if (!freeDetail) return fail(`Could not score ${token.symbol} — every data provider failed. Do not buy it.`);
        const free = freeDetail.score;

        // Then the paid signals — planned, not asked for. See ./enrichment.
        const plan: EnrichmentPlan = explicit
          ? {
              intel: false,
              deep: parsed.deep === true,
              smartMoney: parsed.smartMoney === true,
              sellCheck: parsed.sellCheck === true,
              skipped: [],
              plannedUsd: 0,
            }
          : planEnrichment({
              free,
              chain: parsed.chain,
              sources: allowedSources,
              remainingUsd: Math.max(0, ctx.budget.maxUsd - ctx.budget.spentUsd),
              minScore: universe.minScore,
              already: enrichedThisTick.has(token.id),
            });

        let detail = freeDetail;
        if (plan.deep || plan.smartMoney || plan.sellCheck) {
          detail =
            (await scoreDetailFor(parsed.chain, token.address, {
              deep: plan.deep,
              smartMoney: plan.smartMoney,
              sellCheck: plan.sellCheck,
            })) ?? freeDetail;
        }
        const score = detail.score;
        // A read that was planned and not made is said, like every other skipped signal.
        if (plan.smartMoney && detail.smartMoneyNotRead !== null) plan.skipped.push(`smartMoney: ${detail.smartMoneyNotRead}`);

        let intel: { summary: string; signals: unknown } | null = null;
        if (plan.intel) {
          const source = getDataSource(INTEL_SOURCE);
          if (source) {
            try {
              const result = await source.query(ctx.x402, { mint: token.address });
              intel = { summary: result.summary, signals: result.signals ?? null };
            } catch (err) {
              plan.skipped.push(`intel: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
        if (plan.plannedUsd > 0 || plan.deep || plan.smartMoney || plan.sellCheck) enrichedThisTick.add(token.id);

        scoredThisTick.add(token.id);
        // The smart money read in words. Only for an agent whose owner enabled the
        // source: the score cache is shared, and a read another agent's owner paid for
        // is not this one's to be told about.
        const smartMoney = allowedSources.includes(SMART_MONEY_SOURCE)
          ? smartMoneyNote(
              detail,
              plan.skipped.find((entry) => entry.startsWith("smartMoney:")),
            )
          : null;

        const meetsMinScore = score.blockers.length === 0 && score.verdict !== "avoid" && score.total >= universe.minScore;
        if (meetsMinScore) shortlistThisTick.set(token.id, { symbol: token.symbol, total: score.total });
        else shortlistThisTick.delete(token.id);
        // Cross-tick memory: what this token looked like the last time the agent scored
        // it, so a rule about velocity or consecutive ticks is a fact, not a guess.
        const history = await getScoreHistory(token.id, { days: 1, limit: 60 }).catch(() => []);
        const trend = scoreTrend(history, {
          total: score.total,
          priceUsd: score.priceUsd,
          holderCount: score.holderCount,
          liquidityUsd: score.liquidityUsd,
        });
        return {
          ...scorePayload(score, smartMoney?.said ?? null),
          minScore: universe.minScore,
          meetsMinScore,
          trend,
          paidSignals: {
            intel: intel !== null,
            sentiment: score.components.sentiment !== null,
            // The read was bought and answered, with or without a reading: "no tracked
            // wallet traded it" is an answer, and its component is null.
            smartMoney: score.sources.includes(SMART_MONEY_SOURCE),
            sellCheck: plan.sellCheck,
          },
          smartMoney,
          intel,
          notBought: plan.skipped,
          dataSpentThisRunUsd: Number(ctx.budget.spentUsd.toFixed(4)),
          dataBudgetRemainingUsd: Math.max(0, ctx.budget.maxUsd - ctx.budget.spentUsd),
        };
      }),
    }),

    get_portfolio: tool({
      description:
        "Your current book: cash, every open position with a live mark and unrealized PnL, equity, and how many trades you have left today.",
      inputSchema: z.object({}),
      execute: logged(ctx, "get_portfolio", async () => {
        const portfolio = await getPortfolio(agent.id);
        return {
          ok: true,
          cashUsd: portfolio.cashUsd,
          equityUsd: portfolio.equityUsd,
          realizedPnlUsd: portfolio.realizedPnlUsd,
          unrealizedPnlUsd: portfolio.unrealizedPnlUsd,
          tradesToday: portfolio.tradesToday,
          tradesRemainingToday: Math.max(0, agent.config.risk.maxDailyTrades - portfolio.tradesToday),
          dataSpentThisRunUsd: Number(ctx.budget.spentUsd.toFixed(4)),
          dataBudgetRemainingUsd: Math.max(0, ctx.budget.maxUsd - ctx.budget.spentUsd),
          positions: portfolio.positions.map((p) => ({
            symbol: p.token.symbol,
            chain: p.token.chain,
            address: p.token.address,
            amountToken: p.amountToken,
            avgCostUsd: p.avgCostUsd,
            markPriceUsd: p.markPriceUsd,
            valueUsd: p.valueUsd,
            unrealizedPnlUsd: p.unrealizedPnlUsd,
            unrealizedPnlPct: p.unrealizedPnlPct,
          })),
          rendered: describePortfolio(portfolio, agent.config),
        };
      }),
    }),

    search_data_sources: tool({
      description:
        "Find data you could buy: the registry sources that match what you are looking for, with what each one returns and costs, and whether your owner enabled it. Free to search. Only an enabled source can be bought.",
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe("What you are looking for, e.g. 'solana token safety'"),
        maxUsdPrice: z.number().min(0).max(10).optional().describe("Only return sources at or under this price"),
      }),
      execute: logged(ctx, "search_data_sources", async (input) => {
        const parsed = z
          .object({ query: z.string(), maxUsdPrice: z.number().optional() })
          .parse(input);
        // Registry only, matched on the query's words and ranked by how many hit: a model
        // asks for "twitter sentiment", not for a substring of one description.
        const phrase = parsed.query.toLowerCase();
        const words = phrase.split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
        const needles = words.length > 0 ? words : [phrase];
        const registry = DATA_SOURCES.filter(
          (s) => parsed.maxUsdPrice === undefined || s.priceUsd === null || s.priceUsd <= parsed.maxUsdPrice,
        )
          .map((s) => {
            const text = `${s.id} ${s.name} ${s.summary} ${s.description} ${s.category}`.toLowerCase();
            return { source: s, hits: needles.filter((needle) => text.includes(needle)).length };
          })
          .filter((match) => match.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .map(({ source }) => ({ ...toDataSourceInfo(source), configured: allowedSources.includes(source.id) }));

        return { ok: true, registry };
      }),
    }),

    query_data_source: tool({
      description:
        "Buy data from one of your configured sources over x402. Costs real money against your per-run data budget. `params` must match the source's schema (see the system prompt) — several sources take a `mode` that selects both the endpoint and the price, so read the description before you call one.",
      inputSchema: z.object({
        sourceId: z.string().min(1).describe("Registry id of an enabled source, e.g. 'x-search'"),
        params: freeFormParamsSchema(ctx.freeFormParamsAsJson === true),
      }),
      execute: logged(ctx, "query_data_source", async (input) => {
        const { sourceId } = z.object({ sourceId: z.string() }).parse(input);
        // Read either form whichever was declared: a model handed the string form can
        // still send the object, and the other way round.
        const params = readFreeFormParams(input.params);
        if (params === null) return fail("`params` must be a JSON object (or that object as JSON in a string).");
        const parsed = { sourceId, params };
        const source = getDataSource(parsed.sourceId);
        if (!source) {
          return fail(`There is no data source "${parsed.sourceId.slice(0, 64)}".`, { enabled: allowedSources });
        }
        // An empty list means none, here and for score_token's paid signals.
        if (!allowedSources.includes(source.id)) {
          return fail(
            allowedSources.length === 0
              ? `No data sources are enabled for this agent, so "${source.id}" cannot be bought.`
              : `Source "${source.id}" is not enabled for this agent.`,
            { enabled: allowedSources },
          );
        }
        // Nansen's boards cost five times its per-token read and belong to the smart
        // money feed. With the feed off none is bought: the owner was quoted a cent a
        // call for this source. With it on the netflow board is still refused, because
        // discover_tokens has bought it or will this tick and a second copy is the same
        // thing paid for twice. Refused here, before anything is paid.
        if (source.id === SMART_MONEY_SOURCE) {
          const endpoint = smartMoneyEndpoint(parsed.params);
          const perToken = "To read one token, pass tokenAddress and exactly one chain: that is the $0.01 per-token read.";
          if (endpoint !== null && endpoint !== "token" && !smartMoneyBoardOn) {
            return fail(
              `Not bought: Nansen's boards (netflow, holdings, dex-trades, $0.05 each) are only bought when your owner switches on the smart_money feed. ${perToken}`,
            );
          }
          if (endpoint === "netflow") {
            return fail(
              `Not bought: discover_tokens buys the netflow board for you, once per chain per tick, and its table shows each row's flow under SM24H. ${perToken}`,
            );
          }
        }
        try {
          const result = await source.query(ctx.x402, parsed.params);
          return {
            ok: true,
            sourceId: source.id,
            summary: result.summary,
            signals: result.signals ?? null,
            data: result.data,
            dataSpentThisRunUsd: Number(ctx.budget.spentUsd.toFixed(4)),
          dataBudgetRemainingUsd: Math.max(0, ctx.budget.maxUsd - ctx.budget.spentUsd),
          };
        } catch (err) {
          if (err instanceof X402BudgetError) {
            return fail(err.message, { budgetExhausted: true });
          }
          throw err;
        }
      }),
    }),

    get_token_price: tool({
      description: "Free mark for one token (Jupiter on Solana, DexScreener on Base). Use this before sizing a trade.",
      inputSchema: z.object({
        chain: chainSchema,
        address: z.string().min(3).describe("Mint (Solana) or contract address (Base); a known symbol also works"),
      }),
      execute: logged(ctx, "get_token_price", async (input) => {
        const parsed = z.object({ chain: chainSchema, address: z.string() }).parse(input);
        const token = await resolveToken(parsed.chain, parsed.address);
        const price = await getPriceUsd(parsed.chain, token.address);
        if (price === null) return fail(`No price available for ${token.symbol} on ${parsed.chain}.`);
        return {
          ok: true,
          symbol: token.symbol,
          chain: parsed.chain,
          address: token.address,
          decimals: token.decimals,
          priceUsd: price,
        };
      }),
    }),

    get_token_intel: tool({
      description:
        "Due diligence on one token. On Solana this pays Deepnets for a safety analysis when your owner enabled that source (charged to your data budget); on Base it returns free DexScreener liquidity/volume stats.",
      inputSchema: z.object({
        chain: chainSchema,
        address: z.string().min(3).describe("Mint (Solana) or contract address (Base)"),
      }),
      execute: logged(ctx, "get_token_intel", async (input) => {
        const parsed = z.object({ chain: chainSchema, address: z.string() }).parse(input);
        const token = await resolveToken(parsed.chain, parsed.address);
        if (parsed.chain === "base") {
          return { ...(await fetchBaseIntel(token.address)), symbol: token.symbol };
        }
        const source = getDataSource("deepnets-token-safety");
        if (!source) return fail("Token intel source is not registered.");
        // A paid call like any other: only from a source the owner enabled.
        if (!allowedSources.includes(source.id)) {
          return fail("Token intel is not enabled for this agent. Use score_token; it returns the free safety read.", {
            enabled: allowedSources,
          });
        }
        try {
          const result = await source.query(ctx.x402, { mint: token.address });
          return {
            ok: true,
            symbol: token.symbol,
            summary: result.summary,
            signals: result.signals ?? null,
            data: result.data,
            dataSpentThisRunUsd: Number(ctx.budget.spentUsd.toFixed(4)),
          dataBudgetRemainingUsd: Math.max(0, ctx.budget.maxUsd - ctx.budget.spentUsd),
          };
        } catch (err) {
          if (err instanceof X402BudgetError) return fail(err.message, { budgetExhausted: true });
          throw err;
        }
      }),
    }),

    place_trade: tool({
      description:
        approvalMode
          ? `Propose a buy or sell of a token for USDC. This agent runs in APPROVAL MODE: the token is scored and the risk guard runs exactly as normal, but instead of routing the order it is sent to your owner for a decision. A proposal is not a fill. Propose each token at most once per tick; several different tokens may be proposed in one tick (up to ${MAX_PROPOSALS_PER_TICK}, never more than the trades left today), best first, each with its own rationale. Do not wait for answers — finish the tick when your shortlist is out. \`rationale\` is what your owner reads when deciding, and it is published verbatim if they approve, so it must cite the score and lead with your conviction.`
          : "Buy or sell a token for USDC. Scores the token, then runs the risk guard (blocklist, minScore, hard gates, size, daily count, position concentration, balance) and only then routes to the venue. A token you have not scored, or one that fails a gate, is rejected rather than filled. `rationale` is published to your followers' feed verbatim and must cite the score.",
      inputSchema: z.object({
        chain: chainSchema,
        side: z.enum(["buy", "sell"]),
        tokenAddress: z.string().min(3).describe("Mint (Solana) or contract address (Base)"),
        amountUsd: z.number().positive().describe(tradeAmountWords(platformFeeBps())),
        rationale: z
          .string()
          .min(10)
          .max(500)
          .describe("One or two sentences: why, citing the score total, verdict and the component that moved you"),
      }),
      execute: logged(ctx, "place_trade", async (input) => {
        const parsed = z
          .object({
            chain: chainSchema,
            side: z.enum(["buy", "sell"]),
            tokenAddress: z.string(),
            amountUsd: z.number(),
            rationale: z.string(),
          })
          .parse(input);

        // The kill switch. The scheduler skips a paused owner's agents, but a run already
        // in flight, or one started by hand, gets here anyway: it places no buys and
        // proposes none. Sells are untouched; an exit is never what "pause" means.
        // (A dynamic import: the module is server-only and scripts load this file.)
        if (parsed.side === "buy") {
          const { isTradingPaused } = await import("@/lib/security/kill-switch");
          if (await isTradingPaused(agent.ownerId)) {
            return fail("Trading is paused by your owner. Place no buys; finish the tick.", { rejected: true });
          }
        }

        const db = await getDb();
        // Anything the owner never got round to deciding is dead before this tick sizes
        // a new order, so an expired proposal can never be counted as pending.
        if (approvalMode) await expireAgentProposals(agent.id);

        const token = await resolveToken(parsed.chain, parsed.tokenAddress);
        const quoteTokenId = await ensureQuoteToken(parsed.chain);
        const portfolio = await getPortfolio(agent.id);

        const order: OrderIntent = {
          chain: parsed.chain,
          side: parsed.side,
          tokenId: token.id,
          tokenAddress: token.address,
          symbol: token.symbol,
          amountUsd: parsed.amountUsd,
          // Only `volatility_scaled` sizing reads this, and only for buys; the lookup is
          // one indexed read of score history, never a provider call.
          rangePct: parsed.side === "buy" ? await recentRangePct(token.id) : null,
        };

        // Buys must be scored: no score means no buy, whatever the model believes.
        // Sells take whatever score is already cached — an agent must always be able
        // to exit, so a scoring outage cannot trap it in a position.
        const score = await scoreFor(parsed.chain, token.address);
        if (parsed.side === "buy" && score === null) {
          return fail(
            `Could not score ${token.symbol} — every data provider failed, so this agent will not buy it. Try again next tick.`,
            { rejected: true },
          );
        }

        const verdict = riskGuard(
          { id: agent.id, mode: agent.mode, config: agent.config },
          toRiskPortfolio(portfolio),
          order,
          score,
        );
        if (!verdict.ok) {
          return fail(`Rejected by risk guard: ${verdict.reason}`, {
            rejected: true,
            ...(score ? { score: { total: score.total, verdict: score.verdict, blockers: score.blockers } } : {}),
          });
        }

        // W7 H1. A sell is sized from the **position**, not from a buy-side quote: the
        // model asks in dollars, the book knows how many tokens that is, and the venue
        // is told the token amount so a mark that has moved since cannot turn the order
        // into an over-ask (or into permanent dust).
        const heldPosition = portfolio.positions.find((p) => p.token.id === token.id) ?? null;
        const request: TradeRequest = {
          chain: parsed.chain,
          side: parsed.side,
          tokenId: token.id,
          tokenAddress: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          amountUsd: parsed.amountUsd,
          ...(parsed.side === "sell" && heldPosition
            ? {
                amountToken: sellAmountToken({
                  heldToken: heldPosition.amountToken,
                  positionValueUsd: heldPosition.valueUsd,
                  requestedUsd: parsed.amountUsd,
                  decimals: token.decimals,
                }),
              }
            : {}),
          slippageBps: agent.config.risk.slippageBps,
        };

        // ---- approval mode: propose, do not route ----
        // Sells are proposals too. An operator who wants to approve entries wants to
        // approve exits; the only trades that bypass this are guardian stop-outs, which
        // the exit engine writes directly.
        if (approvalMode) {
          // One undecided question per token: within this tick, and across ticks.
          if (proposedThisTick.has(token.id) || (await hasPendingProposal(agent.id, token.id))) {
            return fail(
              `${token.symbol} is already proposed and still awaiting your owner's decision. Do not re-propose it — move on to another candidate or finish the tick.`,
              { alreadyProposed: true },
            );
          }
          // One purse. What is already proposed and undecided counts as spent, or the
          // third approval finds the cash gone — seen live: $13.40 proposed against
          // $9.90, the first two filled, the third could not even be quoted. Spent
          // means with its fee: every proposal pays the fee on its own fill when it is
          // approved, so what is left for this one is the cash less the waiting buys
          // and their fees, and then the largest buy that fits with a fee of its own.
          if (parsed.side === "buy") {
            const committedUsd = await openProposalsUsd(agent.id);
            const feeBps = platformFeeBps();
            // The purse is the cash a buy may spend, the figure the risk guard above and
            // the guard at fill time both use. For an agent that pays for its own thinking
            // that is less than its cash: counting the held-back part here let a set of
            // proposals add up to money the last approval would then be refused for.
            // For every other agent it is its cash, and this sentence is what it was.
            const purseUsd = spendableCashUsd(portfolio);
            // How much is kept back is not said to the model, here or in its book: the
            // figure follows a limit only the owner may read (see `describePortfolio`).
            const purseWords =
              (portfolio.thinkingReserveUsd ?? 0) > 0
                ? `cash available to trade $${purseUsd.toFixed(2)} (part of your cash is kept back to pay for your thinking)`
                : `cash $${purseUsd.toFixed(2)}`;
            const fitsUsd = maxBuyUsd(purseUsd - buyCostUsd(committedUsd, feeBps), feeBps);
            if (parsed.amountUsd > fitsUsd + 1e-9) {
              // Told in whole cents, rounded down: the figure has to be one that fits.
              const affordable = floorToCents(fitsUsd);
              const feeWords = feeBps > 0 ? `, and a ${formatFeeRate(feeBps)} Tocker fee on each fill` : "";
              return fail(
                `Not affordable alongside what is already proposed: ${purseWords}, $${committedUsd.toFixed(2)} already awaiting your owner's decision${feeWords} — at most $${affordable.toFixed(2)} is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.`,
                { unaffordable: true, affordableUsd: affordable },
              );
            }
          }

          // A tick lays out a shortlist, not a page of decisions against the same cash.
          const tradesLeftToday = Math.max(0, agent.config.risk.maxDailyTrades - portfolio.tradesToday);
          const proposalCap = Math.min(MAX_PROPOSALS_PER_TICK, Math.max(1, tradesLeftToday));
          if (proposedThisTick.size >= proposalCap) {
            return fail(
              `This tick has already proposed ${proposedThisTick.size} token${proposedThisTick.size === 1 ? "" : "s"}, its limit (${proposalCap}: the smaller of ${MAX_PROPOSALS_PER_TICK} per tick and the ${tradesLeftToday} trade${tradesLeftToday === 1 ? "" : "s"} left today). Finish the tick.`,
              { limitReached: true },
            );
          }
          const priceUsd = await indicativePrice(executorAgent, request);
          const proposal = await createProposal({
            agent: {
              id: agent.id,
              ownerId: agent.ownerId,
              slug: agent.slug,
              name: agent.name,
              mode: agent.mode,
              config: agent.config,
            },
            runId: ctx.runId,
            chain: parsed.chain,
            side: parsed.side,
            token: { id: token.id, address: token.address, symbol: token.symbol, decimals: token.decimals },
            quoteTokenId,
            requestedUsd: parsed.amountUsd,
            rationale: parsed.rationale,
            score,
            priceUsd,
            isPaper: agent.mode === "paper",
          });
          proposedThisTick.add(token.id);
          ctx.tradeIds.push(proposal.tradeId);
          return {
            ok: true,
            proposed: true,
            tradeId: proposal.tradeId,
            expiresAt: proposal.expiresAt,
            symbol: token.symbol,
            side: parsed.side,
            requestedUsd: parsed.amountUsd,
            quotedPriceUsd: priceUsd,
            message: `Proposed — awaiting owner approval; do not re-propose this token this tick. ${
              proposedThisTick.size < proposalCap
                ? `You may propose ${proposalCap - proposedThisTick.size} more different token${proposalCap - proposedThisTick.size === 1 ? "" : "s"} this tick if they clear your bar, then finish.`
                : "That was this tick's last proposal — finish."
            }`,
          };
        }

        const executor = await getExecutor(executorAgent, parsed.chain);
        const tradeId = nanoid();
        await db.insert(trades).values({
          id: tradeId,
          agentId: agent.id,
          runId: ctx.runId,
          ownerId: agent.ownerId,
          chain: parsed.chain,
          side: parsed.side,
          tokenId: token.id,
          quoteTokenId,
          amountToken: "0",
          amountUsd: parsed.amountUsd.toFixed(6),
          priceUsd: "0",
          feeUsd: "0",
          status: "pending",
          isPaper: executor.isPaper,
          rationale: parsed.rationale,
          // Frozen at the moment of the trade so later re-scoring cannot rewrite the record.
          scoreSnapshot: score === null ? null : toTradeScore(score),
        });
        ctx.tradeIds.push(tradeId);

        const quotedAt = new Date();
        let quote;
        try {
          quote = await executor.quote(request);
        } catch (err) {
          const message = err instanceof Error ? err.message : "quote failed";
          await db.update(trades).set({ status: "failed", error: message }).where(eq(trades.id, tradeId));
          return fail(`Could not quote ${token.symbol}: ${message}`);
        }

        // Last check before real money moves: does the venue's quote agree with an
        // independently-sourced mark? Not a slippage guard — this catches the
        // order-of-magnitude failures (wrong decimals, wrong token, empty pool). Buys
        // only; an exit is never blocked. See @/lib/trading/sanity.
        const sanity = checkQuoteSanity({
          side: parsed.side,
          symbol: token.symbol,
          quotePriceUsd: quote.priceUsd,
          referencePriceUsd: await getPriceUsd(parsed.chain, token.address),
        });
        if (!sanity.ok) {
          await db.update(trades).set({ status: "failed", error: sanity.reason }).where(eq(trades.id, tradeId));
          return fail(sanity.reason, { rejected: true, deviationBps: sanity.deviationBps });
        }

        // W7 H2. `executeTrade` persists the signed transaction's signature before
        // `/execute`, contains any throw as a `failed` row rather than letting it escape
        // and strand the trade on `submitted`, reconciles an unknown outcome against the
        // chain, and retries a sell once when the venue says the wallet holds less than
        // we asked for.
        const settled = await executeTrade({
          tradeId,
          executor,
          request,
          quote,
          refreshSellAmount: () => heldAmountToken(agent.id, token.id),
        });
        if (settled.status !== "filled") {
          return fail(`${token.symbol} ${parsed.side} failed: ${settled.error}`);
        }
        const fill = settled.fill;
        quote = settled.quote;

        const filledAt = new Date();
        await db
          .update(trades)
          .set({
            status: "filled",
            amountToken: fill.amountToken.toFixed(12),
            amountUsd: fill.amountUsd.toFixed(6),
            priceUsd: fill.priceUsd.toFixed(12),
            feeUsd: fill.feeUsd.toFixed(6),
            txHash: fill.txHash,
            filledAt,
          })
          .where(eq(trades.id, tradeId));

        // The platform's fee, a share of what the fill actually moved, charged the
        // moment the fill is real and before the position and the receipt are written,
        // so both account for it. Never throws: a fee that cannot be recorded costs the
        // platform that fee, not the operator their trade.
        const platformFeeUsd = await chargePlatformFee({
          agentId: agent.id,
          tradeId,
          chain: parsed.chain,
          fillUsd: fill.amountUsd,
          isPaper: executor.isPaper,
          now: filledAt,
        });

        // The receipt: quoted against filled, the fee split, the venue and the explorer
        // link. Written before the feed post, so anything that renders the trade can
        // count on the document being there.
        const receipt = buildReceipt({
          chain: parsed.chain,
          side: parsed.side,
          symbol: token.symbol,
          tokenAddress: token.address,
          quote,
          fill,
          slippageToleranceBps: agent.config.risk.slippageBps,
          score,
          platformFeeUsd,
          quotedAt,
          filledAt,
        });
        await saveReceipt(tradeId, agent.id, receipt);

        await applyFill(
          agent.id,
          token.id,
          {
            side: parsed.side,
            amountToken: fill.amountToken,
            amountUsd: fill.amountUsd,
            // Both fees. PnL is net of what the trade actually cost, and the platform
            // fee is as real a cost as the venue's.
            feeUsd: fill.feeUsd + platformFeeUsd,
            // A sell whose residual is under one atomic unit closes the position.
            decimals: token.decimals,
          },
          // Entry bookkeeping for the exit engine: opens `openedAt`/`peakPriceUsd` on a
          // buy from flat and freezes the entry score + pooled liquidity from `score`.
          { priceUsd: fill.priceUsd, score },
        );

        const postId = nanoid();
        await db.insert(posts).values({
          id: postId,
          authorId: agent.ownerId,
          agentId: agent.id,
          tradeId,
          kind: "trade",
          body: parsed.rationale,
        });
        ctx.postIds.push(postId);

        await notifyAgentFollowers(
          agent.id,
          `${agent.name} ${parsed.side === "buy" ? "bought" : "sold"} ${token.symbol}`,
          parsed.rationale,
          `/agents/${agent.slug}`,
        );

        // Followers get "what": the owner also gets "how well", from the receipt.
        await notifyFill({ ownerId: agent.ownerId, agentName: agent.name, tradeId, receipt, origin: "agent" });

        return {
          ok: true,
          tradeId,
          status: "filled",
          venue: executor.venue,
          isPaper: executor.isPaper,
          symbol: token.symbol,
          side: parsed.side,
          amountToken: fill.amountToken,
          amountUsd: fill.amountUsd,
          priceUsd: fill.priceUsd,
          feeUsd: fill.feeUsd,
          // The model should see what the platform took on this fill, so its own
          // arithmetic about what the trade cost matches the book's.
          platformFeeUsd,
          txHash: fill.txHash,
          // Execution quality, so the model can see a route going bad across ticks.
          quotedPriceUsd: receipt.quotedPriceUsd,
          slippageBps: receipt.slippageBps,
          score: score === null ? null : { total: score.total, verdict: score.verdict, components: score.components },
        };
      }),
    }),

    post_note: tool({
      description:
        "Publish a note to your followers' feed without trading — a thesis, a warning, or why you sat this tick out. One note per tick. Notes are public: never name a data source or state a threshold.",
      inputSchema: z.object({ body: z.string().min(5).max(1000) }),
      execute: logged(ctx, "post_note", async (input) => {
        const parsed = z.object({ body: z.string().min(5).max(1000) }).parse(input);
        // The feed is everyone's. One run, one note, whatever the text it read told it.
        if (notePostedThisTick) return fail("One note per tick. Put the rest in your summary.");
        notePostedThisTick = true;
        const db = await getDb();
        const postId = nanoid();
        await db.insert(posts).values({
          id: postId,
          authorId: agent.ownerId,
          agentId: agent.id,
          kind: "note",
          // Public the moment it is written. A model can repeat anything in its context.
          body: redactSecrets(parsed.body),
        });
        ctx.postIds.push(postId);
        return { ok: true, postId };
      }),
    }),

    // review_positions — rescore what you hold, see distance to every exit rule.
    ...buildPositionTools(ctx),

    finish: tool({
      description:
        "End this run with a short public summary of what you did and why. Never name a data source or state a threshold. Always call this last.",
      inputSchema: z.object({ summary: z.string().min(5).max(1000) }),
      execute: logged(ctx, "finish", async (input) => {
        const parsed = z.object({ summary: z.string() }).parse(input);
        // A sweep called in the same step as this is still out. Wait for it, so the two
        // research checks below read the table it brings back and not an empty one: told
        // "no sweep has come back", the model sweeps again and the radar is bought twice.
        await Promise.allSettled([...sweepsInFlight]);
        // Once per tick: a model that scored two names off the top of the table has not
        // researched the tick. Send it back for the rest of the fresh candidates.
        if (!researchNudged && scoredThisTick.size < MIN_SCORED_PER_TICK) {
          const unscored = [...freshThisTick.entries()].filter(([tokenId]) => !scoredThisTick.has(tokenId));
          if (unscored.length > 0) {
            researchNudged = true;
            const want = Math.min(unscored.length, MIN_SCORED_PER_TICK - scoredThisTick.size);
            return fail(
              `Not yet. You scored ${scoredThisTick.size} token${scoredThisTick.size === 1 ? "" : "s"} this tick and discovery surfaced ${unscored.length} fresh candidate${unscored.length === 1 ? "" : "s"} you have not looked at: ${unscored
                .slice(0, 8)
                .map(([, symbol]) => symbol)
                .join(", ")}. Score at least ${want} more (score_token is free and buys the paid signals for you), then decide and call finish again.`,
              { nudged: true, unscored: unscored.map(([, symbol]) => symbol) },
            );
          }
        }
        // The same once per tick, so no tick is ever sent back twice for research: a tick
        // about to end having scored nothing, in which no sweep got as far as its feeds.
        // Either it never swept, or the sweep it asked for was refused before it started
        // (a chain it does not trade). A sweep that found nothing fresh is an answer, and
        // that tick ends here as it always did. So does a tick whose sweep started and then
        // failed: its launch radar may already be paid for, and a sweep ordered from here
        // would buy the same radar a second time.
        //
        // A tick that only managed its book (review_positions, a sell) is sent back like
        // any other: looking after what it holds says nothing about what is new, and the
        // sell freed the cash a buy would use. The one tick that is let go is the one that
        // cannot buy (no buy left today, no cash for a ticket, trading paused). Research
        // there ends in a refusal, and its steps and paid signals are spent for nothing.
        if (!researchNudged && scoredThisTick.size === 0 && !sweepStartedThisTick && (await canStillBuy())) {
          researchNudged = true;
          return fail(
            "Not yet. No token sweep with your owner's settings has come back this tick. Call discover_tokens with no arguments, score what it returns with score_token, then call finish again.",
            { nudged: true, notSwept: true },
          );
        }
        // Approval mode, once per tick: a model that scored two or three tokens above the
        // bar and proposed one has not given its owner the shortlist they asked for. Send
        // it back for the rest — or for a sentence on why each one is not worth proposing.
        if (approvalMode && !finishNudged) {
          const left = [...shortlistThisTick.entries()]
            .filter(([tokenId]) => !proposedThisTick.has(tokenId))
            .map(([, s]) => s)
            .sort((a, b) => b.total - a.total);
          const room = MAX_PROPOSALS_PER_TICK - proposedThisTick.size;
          if (left.length > 0 && room > 0) {
            finishNudged = true;
            const names = left.slice(0, room).map((s) => `${s.symbol} (${Math.round(s.total)})`).join(", ");
            return fail(
              `Not yet. You scored ${names} above your floor but did not propose ${left.length === 1 ? "it" : "them"}, and this tick has room for ${room} more proposal${room === 1 ? "" : "s"}. Your owner asked for a shortlist to choose from: place_trade each one that deserves it (its own rationale, conviction first), or say in your summary why it does not — then call finish again.`,
              { nudged: true, unproposed: left.map((s) => s.symbol) },
            );
          }
        }
        ctx.finished.summary = parsed.summary;
        return { ok: true, summary: parsed.summary };
      }),
    }),
  };
}
