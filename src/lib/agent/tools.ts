/**
 * The agent's tool belt.
 *
 * Every tool is wrapped so that it writes a `tool_call` step before it runs and a
 * `tool_result` step (with `durationMs`) after, and an `error` step if it throws.
 * Tools return structured failures instead of throwing, so one bad call does not kill
 * the run — the model gets to read the reason and try something else.
 */
import { loadCachedScores } from "@/lib/trading/score-cache";
import { platformFeeUsd as flatFeeUsd } from "@/lib/platform/fee";
import { MAX_PROPOSALS_PER_TICK, MIN_SCORED_PER_TICK, SEEN_WINDOW_MS } from "./limits";
import { INTEL_SOURCE, planEnrichment, type EnrichmentPlan } from "./enrichment";

import { nanoid } from "nanoid";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, posts, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { DATA_SOURCES, getDataSource, toDataSourceInfo } from "@/lib/data-sources/registry";
import { searchDataSources } from "@/lib/x402/discovery";
import { X402BudgetError, type RunBudget, type X402Context } from "@/lib/x402/types";
import { getExecutor, type ExecutorAgent, type TradeRequest } from "@/lib/trading/executor";
import { applyFill, heldAmountToken, sellAmountToken } from "@/lib/trading/positions";
import { getPriceUsd } from "@/lib/trading/prices";
import { recentRangePct } from "@/lib/trading/range";
import { checkQuoteSanity } from "@/lib/trading/sanity";
import { buildReceipt, saveReceipt } from "@/lib/trading/receipt";
import { chargePlatformFee } from "@/lib/platform/fees";
import { notifyFill } from "@/lib/notifications";
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
  getTokenScore,
  renderCandidates,
  renderScore,
  toTradeScore,
} from "@/lib/tokens";
import type { TokenScore } from "@/server/types";
import { describePortfolio, getPortfolio, toRiskPortfolio } from "./portfolio";
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
}

const chainSchema = z.enum(["solana", "base"]);

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
      const result = await fn(input);
      await ctx.logger.log({
        kind: "tool_result",
        toolName: name,
        payload: { result },
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
]);

/** Shrinks a score to the fields worth spending the model's context on. */
function scorePayload(score: TokenScore): ToolOutcome {
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
    rendered: renderScore(score),
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
  /** Tokens whose paid signals were already bought this tick — the score cache holds them. */
  const enrichedThisTick = new Set<string>();
  /** Every token scored this tick, and the fresh candidates discovery surfaced — `finish` compares the two, once. */
  const scoredThisTick = new Set<string>();
  const freshThisTick = new Map<string, string>();
  let researchNudged = false;

  /** Scores a token for this agent. Returns `null` only when scoring itself blew up. */
  const scoreFor = async (
    chain: "solana" | "base",
    address: string,
    paid: { deep?: boolean; smartMoney?: boolean; sellCheck?: boolean } = {},
  ): Promise<TokenScore | null> => {
    const wantsPaid = paid.deep === true || paid.smartMoney === true || paid.sellCheck === true;
    try {
      return await getTokenScore({
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

  return {
    discover_tokens: tool({
      description:
        "Sweep your discovery feeds for tradeable candidates on your chains. Free — with one exception: the `paid_launches` feed buys a pre-screened launch radar per chain (SolEnrich on Solana, gate402 on Base, about $0.02 a chain) and only runs when your config or this call asks for it. `gecko_launches` is free but narrow: it reads GeckoTerminal's new and trending pools on either chain and keeps only the tokens GeckoTerminal's own GT Score rates 50 or better, so it surfaces few names and skips anything minutes old that nobody has rated yet. Returns a ranked table already filtered on the gates that can be checked for free (age, liquidity, holders, blocklist); safety gates are applied later by score_token.",
      inputSchema: z.object({
        chain: chainSchema.optional().describe("Restrict to one chain; omit to sweep every chain you trade"),
        feeds: z
          .array(discoveryFeedSchema)
          .min(1)
          .max(6)
          .optional()
          .describe("Override your configured feeds for this sweep only"),
        maxAgeHours: z.number().positive().max(87_600).optional().describe("Only tokens younger than this"),
        minLiquidityUsd: z.number().min(0).max(100_000_000).optional().describe("Raise your liquidity floor for this sweep"),
        limit: z.number().int().min(1).max(50).optional().describe("How many candidates to return (default 20)"),
      }),
      execute: logged(ctx, "discover_tokens", async (input) => {
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
        const candidates = await discoverCandidates({
          chains,
          universe,
          // Only used by the `paid_launches` feed; every other feed ignores both.
          x402: ctx.x402,
          dataSources: allowedSources,
          alwaysPaidLaunches: true,
          feeds: [...feeds] as typeof universe.discovery,
          // Wider than the old 20 by default: the fresh part of the table is what
          // matters, and a held, proposed or recently scored name takes a slot otherwise.
          limit: parsed.limit ?? 30,
          ...(parsed.minLiquidityUsd === undefined ? {} : { minLiquidityUsd: parsed.minLiquidityUsd }),
          ...(parsed.maxAgeHours === undefined ? {} : { maxAgeHours: parsed.maxAgeHours }),
        });

        // What the agent has already dealt with: held, proposed and undecided, or scored
        // within the seen window. Those stay visible, flagged and at the bottom, so the
        // top of the table is research the agent has not done yet — the same three names
        // re-scored every five minutes was the whole complaint.
        const ids = candidates.map((c) => c.token.id);
        const [portfolio, proposed, cached] = await Promise.all([
          getPortfolio(agent.id),
          pendingProposalTokenIds(agent.id),
          loadCachedScores(ids),
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
        const fresh = candidates.filter((c) => seenReason(c.token.id) === null);
        const seen = candidates.filter((c) => seenReason(c.token.id) !== null);
        for (const c of fresh) freshThisTick.set(c.token.id, c.token.symbol);

        const row = (c: (typeof candidates)[number]) => ({
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
          seen: seenReason(c.token.id),
        });
        const seenLine =
          seen.length === 0
            ? ""
            : `\n\nAlready seen (not fresh research): ${seen.map((c) => `${c.token.symbol} (${seenReason(c.token.id)})`).join(", ")}`;

        return {
          ok: true,
          chains,
          feeds: [...feeds],
          count: candidates.length,
          freshCount: fresh.length,
          candidates: [...fresh, ...seen].map(row),
          rendered: `${renderCandidates(fresh)}${seenLine}`,
          note: `quickScore is a cheap pre-rank, not the real score. Score at least ${MIN_SCORED_PER_TICK} of the fresh candidates before deciding — widen with maxAgeHours or minLiquidityUsd, or a different feed, when fewer than ${MIN_SCORED_PER_TICK} are fresh.`,
        };
      }),
    }),

    score_token: tool({
      description:
        "The full safety + quality score for one token: a 0-100 composite, a verdict, the free components, hard-gate blockers and warnings — and, for any token that clears the free gates, the paid signals your owner configured, bought automatically from your per-run data budget in this order: Deepnets safety on Solana ($0.01, returned as `intel`: mint/freeze flags, bundling, network concentration, critical risks), Plexa sell simulation on Base ($0.05, a proven failure raises cannot_sell), X sentiment (~$0.01, folded in as a component), Nansen smart-money netflow ($0.05, folded in, only on borderline-or-better scores). `paidSignals` says what was bought and `notBought` says what was not and why. A hard-blocked token buys nothing. Pass deep / smartMoney / sellCheck only to override that plan.",
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
          .describe("Pay ~$0.05 for smart-money netflow and fold it in as a sixth component. Default false"),
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
        const free = await scoreFor(parsed.chain, token.address);
        if (!free) return fail(`Could not score ${token.symbol} — every data provider failed. Do not buy it.`);

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

        let score = free;
        if (plan.deep || plan.smartMoney || plan.sellCheck) {
          score =
            (await scoreFor(parsed.chain, token.address, {
              deep: plan.deep,
              smartMoney: plan.smartMoney,
              sellCheck: plan.sellCheck,
            })) ?? free;
        }

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
        const meetsMinScore = score.blockers.length === 0 && score.verdict !== "avoid" && score.total >= universe.minScore;
        if (meetsMinScore) shortlistThisTick.set(token.id, { symbol: token.symbol, total: score.total });
        else shortlistThisTick.delete(token.id);
        return {
          ...scorePayload(score),
          minScore: universe.minScore,
          meetsMinScore,
          paidSignals: {
            intel: intel !== null,
            sentiment: score.components.sentiment !== null,
            smartMoney: score.components.smartMoney !== null,
            sellCheck: plan.sellCheck,
          },
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
        "Find data you could buy: matches from your configured registry sources plus live results from the x402 Bazaar. Returns ids/URLs and prices; it costs nothing to search.",
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe("What you are looking for, e.g. 'solana token safety'"),
        maxUsdPrice: z.number().min(0).max(10).optional().describe("Only return resources at or under this price"),
      }),
      execute: logged(ctx, "search_data_sources", async (input) => {
        const parsed = z
          .object({ query: z.string(), maxUsdPrice: z.number().optional() })
          .parse(input);
        const needle = parsed.query.toLowerCase();
        const registry = DATA_SOURCES.filter(
          (s) =>
            s.id !== "bazaar" &&
            (s.id.includes(needle) ||
              s.name.toLowerCase().includes(needle) ||
              s.description.toLowerCase().includes(needle) ||
              s.category.includes(needle)),
        ).map((s) => ({ ...toDataSourceInfo(s), configured: allowedSources.includes(s.id) }));

        let discovered: Array<Record<string, unknown>> = [];
        try {
          const found = await searchDataSources({
            query: parsed.query,
            ...(parsed.maxUsdPrice !== undefined ? { maxUsdPrice: parsed.maxUsdPrice } : {}),
            limit: 6,
          });
          discovered = found.map((r) => ({
            resourceUrl: r.resource,
            name: r.serviceName,
            description: r.description,
            network: r.network,
            priceUsd: r.priceUsd,
            callVia: "query_data_source with sourceId 'bazaar' and params { resourceUrl }",
          }));
        } catch (err) {
          discovered = [{ error: err instanceof Error ? err.message : "Bazaar search unavailable" }];
        }

        return { ok: true, registry, bazaar: discovered };
      }),
    }),

    query_data_source: tool({
      description:
        "Buy data from one of your configured sources over x402. Costs real money against your per-run data budget. `params` must match the source's schema (see the system prompt) — several sources take a `mode` that selects both the endpoint and the price, so read the description before you call one.",
      inputSchema: z.object({
        sourceId: z.string().min(1).describe("Registry id, e.g. 'sentimentalpha', or 'bazaar' for a discovered resource"),
        params: z.record(z.string(), z.unknown()).default({}).describe("Source-specific parameters"),
      }),
      execute: logged(ctx, "query_data_source", async (input) => {
        const parsed = z.object({ sourceId: z.string(), params: z.record(z.string(), z.unknown()).default({}) }).parse(input);
        const source = getDataSource(parsed.sourceId);
        if (!source) {
          return fail(`Unknown data source "${parsed.sourceId}".`, {
            available: DATA_SOURCES.map((s) => s.id),
          });
        }
        if (allowedSources.length > 0 && !allowedSources.includes(source.id)) {
          return fail(`Source "${source.id}" is not enabled for this agent.`, { enabled: allowedSources });
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
        "Due diligence on one token. On Solana this pays Deepnets for a safety analysis (charged to your data budget); on Base it returns free DexScreener liquidity/volume stats.",
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
        amountUsd: z.number().positive().describe("USD notional to buy, or USD worth of the position to sell"),
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
          // $9.90, the first two filled, the third could not even be quoted.
          if (parsed.side === "buy") {
            const committedUsd = await openProposalsUsd(agent.id);
            const feeUsd = flatFeeUsd();
            const affordable = portfolio.cashUsd - committedUsd - feeUsd;
            if (parsed.amountUsd > affordable + 1e-9) {
              return fail(
                `Not affordable alongside what is already proposed: cash $${portfolio.cashUsd.toFixed(2)}, $${committedUsd.toFixed(2)} already awaiting your owner's decision, $${feeUsd.toFixed(2)} fee per fill — at most $${Math.max(0, affordable).toFixed(2)} is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.`,
                { unaffordable: true, affordableUsd: Math.max(0, affordable) },
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

        // The platform's flat fee, charged the moment the fill is real and before the
        // position and the receipt are written, so both account for it. Never throws:
        // a fee that cannot be recorded costs the platform ten cents, not the operator
        // their trade.
        const platformFeeUsd = await chargePlatformFee({
          agentId: agent.id,
          tradeId,
          chain: parsed.chain,
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
          // The model should see what the platform took, so its own arithmetic about
          // what a small ticket is worth matches the book's.
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
        "Publish a note to your followers' feed without trading — a thesis, a warning, or why you sat this tick out.",
      inputSchema: z.object({ body: z.string().min(5).max(1000) }),
      execute: logged(ctx, "post_note", async (input) => {
        const parsed = z.object({ body: z.string() }).parse(input);
        const db = await getDb();
        const postId = nanoid();
        await db.insert(posts).values({
          id: postId,
          authorId: agent.ownerId,
          agentId: agent.id,
          kind: "note",
          body: parsed.body,
        });
        ctx.postIds.push(postId);
        return { ok: true, postId };
      }),
    }),

    // review_positions — rescore what you hold, see distance to every exit rule.
    ...buildPositionTools(ctx),

    finish: tool({
      description: "End this run with a short summary of what you did and why. Always call this last.",
      inputSchema: z.object({ summary: z.string().min(5).max(1000) }),
      execute: logged(ctx, "finish", async (input) => {
        const parsed = z.object({ summary: z.string() }).parse(input);
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
              `Not yet. You scored ${names} above your ${universe.minScore} floor but did not propose ${left.length === 1 ? "it" : "them"}, and this tick has room for ${room} more proposal${room === 1 ? "" : "s"}. Your owner asked for a shortlist to choose from: place_trade each one that deserves it (its own rationale, conviction first), or say in your summary why it does not — then call finish again.`,
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
