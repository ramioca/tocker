/**
 * Approval mode — the agent proposes, a human decides.
 *
 * When `config.execution.mode === "approve"` the runtime does everything it would do
 * for an automatic trade (resolve the token, score it, run the risk guard, get a quote)
 * and then stops: it writes a `trades` row with `status: "proposed"` and notifies the
 * owner instead of routing the order. Nothing about the book changes until someone taps
 * Approve.
 *
 * Three invariants hold this together:
 *
 * 1. **A proposal is not a promise.** `decideProposal` re-scores the token, re-runs
 *    `riskGuard` against the *current* portfolio and takes a *fresh* quote before it
 *    executes. A proposal that was valid twenty minutes ago and is not valid now is
 *    rejected with `decidedBy: "guard"` and the reason the guard gave, not filled on
 *    stale numbers.
 * 2. **One decision per proposal.** Every transition out of `proposed` is a conditional
 *    `UPDATE … WHERE status = 'proposed' … RETURNING`, so two approve taps (or an
 *    approve racing the expiry sweep) produce exactly one fill.
 * 3. **Proposals die on their own.** `expireProposals` moves anything past its
 *    per-agent TTL to `expired` with `decidedBy: "expiry"`, so a stale proposal can
 *    never be approved into a market that has moved on.
 *
 * Guardian exits are never proposals: an operator who wants to approve entries does not
 * want to approve a stop loss. The exit engine writes `origin: "guardian"` trades
 * directly and does not come through here.
 */
import { nanoid } from "nanoid";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, follows, getDb, notifications, posts, tokens, trades } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { getAgentWallets, getPortfolio, toRiskPortfolio } from "@/lib/agent/portfolio";
import { chargePlatformFee } from "@/lib/platform/fees";
import { getTokenScore, toTradeScore } from "@/lib/tokens";
import { toNum } from "@/lib/money";
import { notifyFill } from "@/lib/notifications";
import type { Chain, TokenScore, TradeStatus } from "@/server/types";
import { getExecutor, type ExecutorAgent, type TradeRequest } from "./executor";
import { applyFill, heldAmountToken, sellAmountToken } from "./positions";
import { buildReceipt, saveReceipt } from "./receipt";
import { getPriceUsd } from "./prices";
import { riskGuard, type OrderIntent } from "./risk";
import { executeTrade } from "./settle";
import { checkQuoteSanity } from "./sanity";

/** The agent fields every proposal operation needs. */
export interface ProposalAgent {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  mode: "paper" | "live";
  config: AgentConfig;
}

export interface ProposalToken {
  /** `${chain}:${address}` */
  id: string;
  address: string;
  symbol: string;
  decimals: number;
}

/** Used when a config predates approval mode or carries a nonsense TTL. */
const DEFAULT_TTL_MINUTES = 60;

export function proposalTtlMinutes(config: AgentConfig): number {
  const raw = config.execution?.proposalTtlMinutes;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MINUTES;
}

export function proposalExpiresAt(proposedAt: Date, config: AgentConfig): Date {
  return new Date(proposedAt.getTime() + proposalTtlMinutes(config) * 60_000);
}

/** True when this agent's trades must be approved by its owner before they route. */
export function requiresApproval(config: AgentConfig): boolean {
  return config.execution?.mode === "approve";
}

function usdLabel(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * One notification per follower of the agent. Shared by automatic trades, approved
 * proposals and manual trades so a fill always reads the same in the feed.
 */
export async function notifyAgentFollowers(
  agentId: string,
  title: string,
  body: string,
  href: string,
): Promise<void> {
  const db = await getDb();
  const rows = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.targetType, "agent"), eq(follows.targetId, agentId)));
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

/**
 * True when this agent already has an undecided proposal for this token.
 *
 * Without this an agent on a 15-minute cadence and a 4-hour TTL queues sixteen
 * proposals for the same token, and approving them all would spend sixteen clips. One
 * pending question per token is the whole point of asking.
 */
export async function hasPendingProposal(agentId: string, tokenId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.tokenId, tokenId), eq(trades.status, "proposed")))
    .limit(1);
  return Boolean(row);
}

// --------------------------------------------------------------- create

export interface CreateProposalInput {
  agent: ProposalAgent;
  /** Null for a proposal that did not come from a run (there is no such path today). */
  runId: string | null;
  chain: Chain;
  side: "buy" | "sell";
  token: ProposalToken;
  quoteTokenId: string;
  requestedUsd: number;
  rationale: string;
  /** Frozen onto the row so the record survives re-scoring. */
  score: TokenScore | null;
  /** The venue quote at proposal time — indicative, re-quoted at approval. */
  priceUsd: number | null;
  isPaper: boolean;
  now?: Date;
}

export interface CreatedProposal {
  tradeId: string;
  expiresAt: string;
  proposedAt: string;
}

/**
 * Writes the `proposed` row and tells the owner. The returned `expiresAt` is what the
 * model is told, so it knows not to re-propose the same token this tick.
 */
export async function createProposal(input: CreateProposalInput): Promise<CreatedProposal> {
  const db = await getDb();
  const proposedAt = input.now ?? new Date();
  const expiresAt = proposalExpiresAt(proposedAt, input.agent.config);
  const tradeId = nanoid();

  await db.insert(trades).values({
    id: tradeId,
    agentId: input.agent.id,
    runId: input.runId,
    ownerId: input.agent.ownerId,
    chain: input.chain,
    side: input.side,
    tokenId: input.token.id,
    quoteTokenId: input.quoteTokenId,
    // Nothing filled, so there is no token amount yet; `requestedUsd` is the ask and
    // `amountUsd` mirrors it until a real fill overwrites it.
    amountToken: "0",
    amountUsd: input.requestedUsd.toFixed(6),
    requestedUsd: input.requestedUsd.toFixed(6),
    priceUsd: (input.priceUsd ?? 0).toFixed(12),
    feeUsd: "0",
    status: "proposed",
    origin: "agent",
    isPaper: input.isPaper,
    rationale: input.rationale,
    scoreSnapshot: input.score === null ? null : toTradeScore(input.score),
    proposedAt,
  });

  await db.insert(notifications).values({
    id: nanoid(),
    userId: input.agent.ownerId,
    kind: "proposal",
    title: `Approve: ${input.side} ${usdLabel(input.requestedUsd)} of ${input.token.symbol}?`,
    body: input.rationale,
    href: `/agents/${input.agent.slug}?proposal=${tradeId}`,
  });

  return {
    tradeId,
    expiresAt: expiresAt.toISOString(),
    proposedAt: proposedAt.toISOString(),
  };
}

// --------------------------------------------------------------- expire

/**
 * Moves every proposal past its TTL to `expired`. The TTL is per agent (it lives in
 * `config.execution`), so this loads the candidates and their agents and computes the
 * cutoff per row rather than in SQL.
 *
 * Cheap and idempotent: safe to call at the top of every run and on every read.
 * Returns how many rows it expired.
 */
export async function expireProposals(now: Date = new Date(), opts?: { agentId?: string }): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({
      id: trades.id,
      proposedAt: trades.proposedAt,
      createdAt: trades.createdAt,
      config: agents.config,
    })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .where(
      opts?.agentId
        ? and(eq(trades.status, "proposed"), eq(trades.agentId, opts.agentId))
        : eq(trades.status, "proposed"),
    );

  const stale = rows.filter((r) => proposalExpiresAt(r.proposedAt ?? r.createdAt, r.config).getTime() <= now.getTime());
  if (stale.length === 0) return 0;

  // Conditional on `proposed` so an approval that lands in the same instant wins.
  const updated = await db
    .update(trades)
    .set({
      status: "expired",
      decidedAt: now,
      decidedBy: "expiry",
      error: "Expired before the owner decided.",
    })
    .where(
      and(
        inArray(
          trades.id,
          stale.map((r) => r.id),
        ),
        eq(trades.status, "proposed"),
      ),
    )
    .returning({ id: trades.id });
  return updated.length;
}

/** A single-agent sweep, for the runtime to call before it proposes anything new. */
export function expireAgentProposals(agentId: string, now?: Date): Promise<number> {
  return expireProposals(now ?? new Date(), { agentId });
}

// --------------------------------------------------------------- decide

export type ProposalDecision = "approve" | "reject";

export type DecideProposalResult =
  | {
      ok: true;
      tradeId: string;
      status: Extract<TradeStatus, "filled" | "rejected">;
      symbol: string;
      side: "buy" | "sell";
      agentSlug: string;
      message: string;
      amountUsd: number | null;
      amountToken: number | null;
      priceUsd: number | null;
    }
  | { ok: false; error: string; status?: TradeStatus };

interface ProposalRowJoin {
  trade: typeof trades.$inferSelect;
  agent: typeof agents.$inferSelect;
  token: typeof tokens.$inferSelect;
}

async function loadProposal(tradeId: string): Promise<ProposalRowJoin | null> {
  const db = await getDb();
  const [row] = await db
    .select({ trade: trades, agent: agents, token: tokens })
    .from(trades)
    .innerJoin(agents, eq(agents.id, trades.agentId))
    .innerJoin(tokens, eq(tokens.id, trades.tokenId))
    .where(eq(trades.id, tradeId))
    .limit(1);
  return row ?? null;
}

/**
 * The row is already out of `proposed`. For a failed or guard-rejected one the stored
 * reason is the whole point: a second tap (or the client's retry after a slow first
 * attempt) must show why the venue said no, not just that it did.
 */
function alreadyDecided(status: TradeStatus, error?: string | null): string {
  const reason = error?.trim() ? ` ${error.trim()}` : "";
  switch (status) {
    case "filled":
      return "This proposal was already approved and filled.";
    case "rejected":
      return `This proposal was already rejected.${reason}`;
    case "expired":
      return "This proposal expired before it was decided.";
    case "failed":
      return `This proposal was approved but the trade failed.${reason}`;
    default:
      return `This proposal is already ${status}.`;
  }
}

/**
 * Approve or reject one proposal.
 *
 * Approve is the interesting path: claim the row, re-score, re-guard against the live
 * portfolio, re-quote, execute, then apply the fill, publish the post and notify
 * followers exactly as an automatic trade does. Any failure between the claim and the
 * fill leaves the row in a terminal state with `error` set — never back in `proposed`,
 * which would let the same proposal be approved twice.
 */
export async function decideProposal(input: {
  tradeId: string;
  ownerId: string;
  decision: ProposalDecision;
  now?: Date;
}): Promise<DecideProposalResult> {
  const db = await getDb();
  const now = input.now ?? new Date();

  const row = await loadProposal(input.tradeId);
  if (!row) return { ok: false, error: "That proposal no longer exists." };
  if (row.trade.ownerId !== input.ownerId || row.agent.ownerId !== input.ownerId) {
    return { ok: false, error: "You do not own this agent." };
  }
  if (row.trade.status !== "proposed") {
    return { ok: false, error: alreadyDecided(row.trade.status, row.trade.error), status: row.trade.status };
  }

  const proposedAt = row.trade.proposedAt ?? row.trade.createdAt;
  const expiresAt = proposalExpiresAt(proposedAt, row.agent.config);

  if (input.decision === "reject") {
    const rejected = await db
      .update(trades)
      .set({ status: "rejected", decidedAt: now, decidedBy: "owner", error: "Declined by the owner." })
      .where(and(eq(trades.id, input.tradeId), eq(trades.status, "proposed")))
      .returning({ id: trades.id });
    if (rejected.length === 0) {
      const fresh = await loadProposal(input.tradeId);
      return { ok: false, error: alreadyDecided(fresh?.trade.status ?? "rejected", fresh?.trade.error) };
    }
    return {
      ok: true,
      tradeId: input.tradeId,
      status: "rejected",
      symbol: row.token.symbol,
      side: row.trade.side,
      agentSlug: row.agent.slug,
      message: `Rejected — ${row.token.symbol} was not traded.`,
      amountUsd: null,
      amountToken: null,
      priceUsd: null,
    };
  }

  if (expiresAt.getTime() <= now.getTime()) {
    await db
      .update(trades)
      .set({ status: "expired", decidedAt: now, decidedBy: "expiry", error: "Expired before the owner decided." })
      .where(and(eq(trades.id, input.tradeId), eq(trades.status, "proposed")));
    return {
      ok: false,
      error: `This proposal expired ${Math.round((now.getTime() - expiresAt.getTime()) / 60_000)} minutes ago. The agent will re-propose if it still likes the trade.`,
      status: "expired",
    };
  }

  // THE CLAIM. Exactly one caller can move a row out of `proposed`, so a double tap
  // (or an approve racing the expiry sweep) cannot fill twice.
  const claimed = await db
    .update(trades)
    .set({ status: "pending", decidedAt: now, decidedBy: "owner" })
    .where(and(eq(trades.id, input.tradeId), eq(trades.status, "proposed")))
    .returning({ id: trades.id });
  if (claimed.length === 0) {
    const fresh = await loadProposal(input.tradeId);
    return { ok: false, error: alreadyDecided(fresh?.trade.status ?? "filled", fresh?.trade.error), status: fresh?.trade.status };
  }

  const config: AgentConfig = row.agent.config;
  const chain = row.trade.chain as Chain;
  const requestedUsd = toNum(row.trade.requestedUsd ?? row.trade.amountUsd);
  const order: OrderIntent = {
    chain,
    side: row.trade.side,
    tokenId: row.token.id,
    tokenAddress: row.token.address,
    symbol: row.token.symbol,
    amountUsd: requestedUsd,
  };

  const settleRejected = async (reason: string): Promise<DecideProposalResult> => {
    await db
      .update(trades)
      .set({ status: "rejected", decidedAt: now, decidedBy: "guard", error: reason })
      .where(eq(trades.id, input.tradeId));
    return { ok: false, error: reason, status: "rejected" };
  };

  const settleFailed = async (reason: string): Promise<DecideProposalResult> => {
    await db
      .update(trades)
      .set({ status: "failed", decidedAt: now, decidedBy: "owner", error: reason })
      .where(eq(trades.id, input.tradeId));
    return { ok: false, error: reason, status: "failed" };
  };

  // Re-score (free) and re-guard. The guard, not the click, decides whether this fills.
  let score: TokenScore | null = null;
  try {
    score = await getTokenScore({
      chain,
      address: row.token.address,
      universe: config.universe,
      maxTradeUsd: config.risk.maxTradeUsd,
      dataSources: config.dataSources,
      symbolHint: row.token.symbol,
    });
  } catch {
    score = null;
  }
  if (row.trade.side === "buy" && score === null) {
    return settleRejected(
      `Could not re-score ${row.token.symbol} — every data provider failed, so this agent will not buy it. Approve again once scoring recovers.`,
    );
  }

  const portfolio = await getPortfolio(row.agent.id);
  const verdict = riskGuard(
    { id: row.agent.id, mode: row.agent.mode, config },
    toRiskPortfolio(portfolio),
    order,
    score,
  );
  if (!verdict.ok) {
    return settleRejected(`No longer allowed: ${verdict.reason}`);
  }

  const executorAgent: ExecutorAgent = {
    id: row.agent.id,
    mode: row.agent.mode,
    wallets: await getAgentWallets(row.agent.id),
  };
  // W7 H1: an approved sell is sized from the position, not from a buy-side quote.
  const heldPosition = portfolio.positions.find((p) => p.token.id === row.token.id) ?? null;
  const request: TradeRequest = {
    chain,
    side: row.trade.side,
    tokenId: row.token.id,
    tokenAddress: row.token.address,
    symbol: row.token.symbol,
    decimals: row.token.decimals,
    amountUsd: requestedUsd,
    ...(row.trade.side === "sell" && heldPosition
      ? {
          amountToken: sellAmountToken({
            heldToken: heldPosition.amountToken,
            positionValueUsd: heldPosition.valueUsd,
            requestedUsd,
            decimals: row.token.decimals,
          }),
        }
      : {}),
    slippageBps: config.risk.slippageBps,
  };

  let executor;
  try {
    executor = await getExecutor(executorAgent, chain);
  } catch (err) {
    return settleFailed(err instanceof Error ? err.message : "No executor available for this chain.");
  }

  const quotedAt = new Date();
  let quote;
  try {
    quote = await executor.quote(request);
  } catch (err) {
    return settleFailed(`Could not quote ${row.token.symbol}: ${err instanceof Error ? err.message : "quote failed"}`);
  }

  // Same last check as the automatic path: an approved proposal is a trade, and a
  // human tapping Approve is not a reason to skip the sanity comparison. Buys only.
  const sanity = checkQuoteSanity({
    side: row.trade.side,
    symbol: row.token.symbol,
    quotePriceUsd: quote.priceUsd,
    referencePriceUsd: await getPriceUsd(chain, row.token.address),
  });
  if (!sanity.ok) return settleRejected(sanity.reason);

  await db
    .update(trades)
    .set({ scoreSnapshot: score === null ? row.trade.scoreSnapshot : toTradeScore(score) })
    .where(eq(trades.id, input.tradeId));

  // W7 H2: signature persisted before `/execute`, throws contained, unknown outcomes
  // reconciled against the chain, one over-ask retry on a sell.
  const settled = await executeTrade({
    tradeId: input.tradeId,
    executor,
    request,
    quote,
    refreshSellAmount: () => heldAmountToken(row.agent.id, row.token.id),
  });
  if (settled.status !== "filled") {
    return settleFailed(`${row.token.symbol} ${row.trade.side} failed: ${settled.error}`);
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
      error: null,
      filledAt,
    })
    .where(eq(trades.id, input.tradeId));

  // An approved proposal is a fill like any other, so it pays the same flat fee.
  const platformFeeUsd = await chargePlatformFee({
    agentId: row.agent.id,
    tradeId: input.tradeId,
    chain,
    isPaper: executor.isPaper,
    now: filledAt,
  });

  await applyFill(
    row.agent.id,
    row.token.id,
    {
      side: row.trade.side,
      amountToken: fill.amountToken,
      amountUsd: fill.amountUsd,
      feeUsd: fill.feeUsd + platformFeeUsd,
      decimals: row.token.decimals,
    },
    { priceUsd: fill.priceUsd, score, now: filledAt },
  );

  // An approved proposal is a trade, so it gets the same receipt. The quote here is the
  // *fresh* one taken at approval, not the indicative price from when it was proposed —
  // slippage is measured against what we were actually offered.
  const receipt = buildReceipt({
    chain,
    side: row.trade.side,
    symbol: row.token.symbol,
    tokenAddress: row.token.address,
    quote,
    fill,
    slippageToleranceBps: config.risk.slippageBps,
    score,
    platformFeeUsd,
    quotedAt,
    filledAt,
  });
  await saveReceipt(input.tradeId, row.agent.id, receipt);

  // The feed post and the follower notifications are identical to an auto trade's —
  // an approved trade is a trade, and the record must not read differently.
  await db.insert(posts).values({
    id: nanoid(),
    authorId: row.agent.ownerId,
    agentId: row.agent.id,
    tradeId: input.tradeId,
    kind: "trade",
    body: row.trade.rationale,
  });

  await notifyAgentFollowers(
    row.agent.id,
    `${row.agent.name} ${row.trade.side === "buy" ? "bought" : "sold"} ${row.token.symbol}`,
    row.trade.rationale ?? "",
    `/agents/${row.agent.slug}`,
  );

  await notifyFill({
    ownerId: row.agent.ownerId,
    agentName: row.agent.name,
    tradeId: input.tradeId,
    receipt,
    origin: "agent",
  });

  return {
    ok: true,
    tradeId: input.tradeId,
    status: "filled",
    symbol: row.token.symbol,
    side: row.trade.side,
    agentSlug: row.agent.slug,
    message: `Filled — ${row.trade.side === "buy" ? "bought" : "sold"} ${usdLabel(Number(fill.amountUsd.toFixed(2)))} of ${row.token.symbol}.`,
    amountUsd: fill.amountUsd,
    amountToken: fill.amountToken,
    priceUsd: fill.priceUsd,
  };
}

// --------------------------------------------------------------- shared helpers

/**
 * Best-effort indicative price for a proposal or a preview: the venue quote when we can
 * get one, otherwise the free price feed. Never throws.
 */
export async function indicativePrice(
  executorAgent: ExecutorAgent,
  request: TradeRequest,
): Promise<number | null> {
  try {
    const executor = await getExecutor(executorAgent, request.chain);
    const quote = await executor.quote(request);
    if (quote.priceUsd > 0) return quote.priceUsd;
  } catch {
    // fall through to the free feed
  }
  return getPriceUsd(request.chain, request.tokenAddress);
}

/** How many proposals are waiting on this user right now, across every agent they own. */
export async function countPendingProposals(ownerId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(eq(trades.ownerId, ownerId), eq(trades.status, "proposed")));
  return Number(row?.n ?? 0);
}

/**
 * Sweep expired proposals before a read path lists them, so the UI never offers an
 * Approve button for something the runtime would refuse. Skips the join entirely when
 * nothing is pending, which is the common case.
 */
export async function sweepBeforeRead(scope?: { ownerId?: string; agentId?: string }): Promise<void> {
  const db = await getDb();
  const filters = [eq(trades.status, "proposed" as const)];
  if (scope?.ownerId) filters.push(eq(trades.ownerId, scope.ownerId));
  if (scope?.agentId) filters.push(eq(trades.agentId, scope.agentId));
  const [pending] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(...filters))
    .limit(1);
  if (!pending) return;
  await expireProposals(new Date(), scope?.agentId ? { agentId: scope.agentId } : undefined);
}
