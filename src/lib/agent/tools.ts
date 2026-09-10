/**
 * The agent's tool belt.
 *
 * Every tool is wrapped so that it writes a `tool_call` step before it runs and a
 * `tool_result` step (with `durationMs`) after, and an `error` step if it throws.
 * Tools return structured failures instead of throwing, so one bad call does not kill
 * the run — the model gets to read the reason and try something else.
 */
import { nanoid } from "nanoid";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { follows, getDb, notifications, posts, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { DATA_SOURCES, getDataSource, toDataSourceInfo } from "@/lib/data-sources/registry";
import { searchDataSources } from "@/lib/x402/discovery";
import { X402BudgetError, type RunBudget, type X402Context } from "@/lib/x402/types";
import { getExecutor, type ExecutorAgent, type TradeRequest } from "@/lib/trading/executor";
import { applyFill } from "@/lib/trading/positions";
import { getPriceUsd } from "@/lib/trading/prices";
import { riskGuard, type OrderIntent } from "@/lib/trading/risk";
import { ensureQuoteToken, resolveToken } from "@/lib/trading/tokens";
import { describePortfolio, getPortfolio, toRiskPortfolio } from "./portfolio";
import type { RunLogger } from "./logger";

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

async function notifyFollowers(agent: RunAgentRecord, title: string, body: string, href: string): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.targetType, "agent"), eq(follows.targetId, agent.id)));
  if (rows.length === 0) return;
  await db.insert(notifications).values(
    rows.map((r) => ({
      id: nanoid(),
      userId: r.followerId,
      kind: "trade",
      title,
      body,
      href,
    })),
  );
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

export function buildTools(ctx: RunContext): ToolSet {
  const { agent } = ctx;
  const executorAgent: ExecutorAgent = { id: agent.id, mode: agent.mode, wallets: ctx.x402.wallets };
  const allowedSources = agent.config.dataSources;

  return {
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
        "Buy data from one of your configured sources over x402. Costs real money against your per-run data budget. `params` must match the source's schema (see the system prompt).",
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
        "Buy or sell a token for USDC. Runs the risk guard first (allowlist, size, daily count, position concentration, balance) and only then routes to the venue. `rationale` is published to your followers' feed verbatim.",
      inputSchema: z.object({
        chain: chainSchema,
        side: z.enum(["buy", "sell"]),
        tokenAddress: z.string().min(3).describe("Mint (Solana) or contract address (Base)"),
        amountUsd: z.number().positive().describe("USD notional to buy, or USD worth of the position to sell"),
        rationale: z.string().min(10).max(500).describe("One or two sentences: why, naming the signal"),
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
        };
        const verdict = riskGuard({ id: agent.id, mode: agent.mode, config: agent.config }, toRiskPortfolio(portfolio), order);
        if (!verdict.ok) {
          return fail(`Rejected by risk guard: ${verdict.reason}`, { rejected: true });
        }

        const executor = await getExecutor(executorAgent, parsed.chain);
        const request: TradeRequest = {
          chain: parsed.chain,
          side: parsed.side,
          tokenId: token.id,
          tokenAddress: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          amountUsd: parsed.amountUsd,
          slippageBps: agent.config.risk.slippageBps,
        };

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
        });
        ctx.tradeIds.push(tradeId);

        let quote;
        try {
          quote = await executor.quote(request);
        } catch (err) {
          const message = err instanceof Error ? err.message : "quote failed";
          await db.update(trades).set({ status: "failed", error: message }).where(eq(trades.id, tradeId));
          return fail(`Could not quote ${token.symbol}: ${message}`);
        }

        await db.update(trades).set({ status: "submitted" }).where(eq(trades.id, tradeId));
        const fill = await executor.execute(quote);

        if (fill.status !== "filled") {
          await db
            .update(trades)
            .set({ status: "failed", error: fill.error ?? "execution failed" })
            .where(eq(trades.id, tradeId));
          return fail(`${token.symbol} ${parsed.side} failed: ${fill.error ?? "execution failed"}`);
        }

        await db
          .update(trades)
          .set({
            status: "filled",
            amountToken: fill.amountToken.toFixed(12),
            amountUsd: fill.amountUsd.toFixed(6),
            priceUsd: fill.priceUsd.toFixed(12),
            feeUsd: fill.feeUsd.toFixed(6),
            txHash: fill.txHash,
            filledAt: new Date(),
          })
          .where(eq(trades.id, tradeId));

        await applyFill(agent.id, token.id, {
          side: parsed.side,
          amountToken: fill.amountToken,
          amountUsd: fill.amountUsd,
          feeUsd: fill.feeUsd,
        });

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

        await notifyFollowers(
          agent,
          `${agent.name} ${parsed.side === "buy" ? "bought" : "sold"} ${token.symbol}`,
          parsed.rationale,
          `/agents/${agent.slug}`,
        );

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
          txHash: fill.txHash,
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

    finish: tool({
      description: "End this run with a short summary of what you did and why. Always call this last.",
      inputSchema: z.object({ summary: z.string().min(5).max(1000) }),
      execute: logged(ctx, "finish", async (input) => {
        const parsed = z.object({ summary: z.string() }).parse(input);
        ctx.finished.summary = parsed.summary;
        return { ok: true, summary: parsed.summary };
      }),
    }),
  };
}
