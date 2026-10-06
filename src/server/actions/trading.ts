"use server";
/**
 * Manual trading and proposal decisions — the two places a human touches the book.
 *
 * A manual trade is not a bypass. It resolves the token, scores it, and goes through
 * the same `riskGuard` and the same `executor` as an agent's own order, so an operator
 * is bound by the universe rules and caps they wrote. What manual mode buys you is
 * *judgement*, not permission: you can buy the token your agent kept passing on, but
 * not one its own minimum score refuses.
 *
 * Everything here is owner-only and returns `{ ok: false, error }` for user errors.
 */
import { RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { agents, getDb, posts, trades } from "@/db";
import type { AgentConfig, AgentConfigWithSizing } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { positionSizingSchema } from "@/lib/agent/config";
import type { PositionSizingConfig } from "@/lib/trading/sizing";
import { getAgentWallets, getPortfolio, snapshotEquity, toRiskPortfolio } from "@/lib/agent/portfolio";
import { feeEnabled, platformFeeUsd } from "@/lib/platform/fee";
import { chargePlatformFee } from "@/lib/platform/fees";
import { getTokenScore, toTradeScore } from "@/lib/tokens";
import { getExecutor, type ExecutorAgent, type TradeRequest } from "@/lib/trading/executor";
import { manualSellSlippageBps } from "@/lib/trading/manual-slippage";
import { applyFill, heldAmountToken, manualSellSizing } from "@/lib/trading/positions";
import { getPriceUsd } from "@/lib/trading/prices";
import { recentRangePct } from "@/lib/trading/range";
import { checkQuoteSanity } from "@/lib/trading/sanity";
import { buildReceipt, saveReceipt, type TradeReceiptData } from "@/lib/trading/receipt";
import { notifyFill } from "@/lib/notifications";
import {
  decideProposal,
  indicativeQuote,
  notifyAgentFollowers,
  requiresApproval,
  type ProposalDecision,
} from "@/lib/trading/proposals";
import { riskGuard, type OrderIntent } from "@/lib/trading/risk";
import { ownerRiskMessage } from "@/lib/trading/risk-copy";
import { executeTrade } from "@/lib/trading/settle";
import { knownTradeError, ownerTradeError, venueErrorFacts } from "@/lib/trading/trade-error-copy";
import { ensureQuoteToken, resolveToken } from "@/lib/trading/tokens";
import type {
  ActionResult,
  Chain,
  PendingProposalsSummary,
  ProposalRow,
  TokenRef,
  TokenScore,
  TradePreview,
} from "@/server/types";
import { ACTION_LIMITS, publicErrorMessage, slowDown } from "./_shared";

/** A manual trade's note is its public rationale on the feed. */
const MAX_NOTE = 280;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

type AgentRecord = typeof agents.$inferSelect;

/** Loads an agent and asserts the caller owns it. */
async function ownedAgent(agentId: string, userId: string): Promise<AgentRecord | null> {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || agent.ownerId !== userId) return null;
  return agent;
}

async function scoreQuietly(
  chain: Chain,
  address: string,
  symbol: string,
  config: AgentConfig,
): Promise<TokenScore | null> {
  try {
    return await getTokenScore({
      chain,
      address,
      universe: config.universe,
      maxTradeUsd: config.risk.maxTradeUsd,
      dataSources: config.dataSources,
      symbolHint: symbol,
    });
  } catch {
    return null;
  }
}


// ------------------------------------------------------------------ preview

export interface PreviewTradeInput {
  agentId: string;
  chain: Chain;
  side: "buy" | "sell";
  tokenAddress: string;
  amountUsd: number;
  /**
   * The order will be "sell everything", so the preview is sized from the position at
   * the mark it reads now, not from `amountUsd`: that figure is the page's reading of
   * the position, and the guard refuses it the moment the mark falls under it.
   */
  sellAll?: boolean;
  /** As on {@link PlaceManualTradeInput}, so the preview quotes under the same tolerance. */
  maxSlippageBps?: number;
}

/**
 * Everything the manual sheet needs to show before anyone commits: the score, the
 * guard's verdict at this exact size, and a quote price. Executes nothing.
 */
export async function previewTrade(input: PreviewTradeInput): Promise<ActionResult<TradePreview>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  const limited = slowDown("preview", session.userId, ACTION_LIMITS.preview);
  if (limited) return fail(limited);

  const agent = await ownedAgent(input.agentId, session.userId);
  if (!agent) return fail("You do not own this agent");

  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return fail("Enter an amount greater than zero.");

  let token: TokenRef & { fallbackPriceUsd: number | null };
  try {
    token = await resolveToken(input.chain, input.tokenAddress);
  } catch (err) {
    // `resolveToken`'s own refusal is a sentence worth reading; a lookup or DB failure is not.
    console.error("[trading] resolveToken", err);
    // The resolver's text names both chains and the raw chain id (the agent tools share
    // it); a person pasting into the trade sheet gets one sentence for their chain.
    if (err instanceof Error && err.message.startsWith("Could not resolve")) {
      return fail(
        `Couldn't find "${input.tokenAddress}" on ${input.chain === "solana" ? "Solana" : "Base"}. ${
          input.chain === "solana"
            ? "Paste the full mint — a symbol only works for a token Tocker has already seen."
            : "Paste the 0x contract address."
        }`,
      );
    }
    return fail(publicErrorMessage(err, "Could not look that token up right now. Try again in a minute."));
  }

  const config: AgentConfig = agent.config;
  const score = await scoreQuietly(input.chain, token.address, token.symbol, config);
  const portfolio = await getPortfolio(agent.id);
  const held = portfolio.positions.find((p) => p.token.id === token.id) ?? null;
  // Sized by the same function the order uses, so the preview answers for the order that
  // will be sent. "Everything" is the position at this mark: the typed figure is a mark
  // or two old, and checking it against a fresh, lower mark is how a falling token got
  // "more than the position is worth" on its own Sell button.
  const sizing =
    input.side === "sell"
      ? manualSellSizing({
          sellAll: input.sellAll === true,
          requestedUsd: amountUsd,
          heldTokenRow: await heldAmountToken(agent.id, token.id),
          position: held,
          decimals: token.decimals,
        })
      : null;
  const sizedUsd = sizing?.sizedUsd ?? amountUsd;
  const slippageBps = manualSellSlippageBps({
    side: input.side,
    agentBps: config.risk.slippageBps,
    requestedBps: input.maxSlippageBps,
  });
  const order: OrderIntent = {
    chain: input.chain,
    side: input.side,
    tokenId: token.id,
    tokenAddress: token.address,
    symbol: token.symbol,
    amountUsd: sizedUsd,
    // The preview must be sized by the same rule the real order will be, or it will
    // say "allowed" for a ticket the guard is about to refuse.
    rangePct: input.side === "buy" ? await recentRangePct(token.id) : null,
  };
  const verdict = riskGuard({ id: agent.id, mode: agent.mode, config }, toRiskPortfolio(portfolio), order, score);

  // A sell is quoted for the tokens the order will send, not for dollars at a buy-side
  // price: on a thin pool those are different numbers, and only one of them is paid.
  const indicative = await indicativeQuote(
    { id: agent.id, mode: agent.mode, wallets: await getAgentWallets(agent.id) },
    {
      chain: input.chain,
      side: input.side,
      tokenId: token.id,
      tokenAddress: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      amountUsd: sizedUsd,
      ...(sizing?.amountToken === undefined ? {} : { amountToken: sizing.amountToken }),
      slippageBps,
    },
  );
  const { priceUsd, venueFeeUsd } = indicative;
  // Only the venue's own answer for this size counts as a quote. Without one the price
  // above is the last mark, and the preview has to say so instead of calling it quoted.
  const quoted = indicative.amountUsd !== null;
  const venue = indicative.venue ?? (agent.mode === "paper" ? "paper" : input.chain === "solana" ? "jupiter" : "privy-base");
  const quoteNote = quoted
    ? null
    : ((indicative.error instanceof Error
        ? knownTradeError({
            stage: "quote",
            side: input.side,
            symbol: token.symbol,
            limitPct: slippageBps / 100,
            limitWidened: slippageBps !== config.risk.slippageBps,
            message: indicative.error.message,
            venue,
            ...venueErrorFacts(indicative.error),
          })
        : null) ??
      (venue === "jupiter"
        ? "Jupiter didn't return a quote just now."
        : venue === "privy-base"
          ? "The swap on Base didn't return a quote just now."
          : "No price came back for the simulator just now."));

  return {
    ok: true,
    data: {
      token: {
        id: token.id,
        chain: token.chain,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        logoUrl: token.logoUrl,
        decimals: token.decimals,
        lastPriceUsd: priceUsd ?? token.lastPriceUsd,
      },
      score,
      allowed: verdict.ok,
      // The guard's `reason` is written for the model (`maxTradeUsd`, gate codes, which
      // tool to call next); the owner gets the same fact in their own words.
      reason: verdict.ok ? null : ownerRiskMessage(verdict),
      priceUsd,
      estimatedToken: priceUsd && priceUsd > 0 ? sizedUsd / priceUsd : null,
      cashUsd: portfolio.cashUsd,
      equityUsd: portfolio.equityUsd,
      positionValueUsd: held?.valueUsd ?? null,
      isPaper: agent.mode === "paper",
      requiresApproval: requiresApproval(config),
      fees: { tockerUsd: feeEnabled() ? platformFeeUsd() : 0, venueUsd: venueFeeUsd },
      quoted,
      quoteNote,
      slippageLimitBps: config.risk.slippageBps,
      sell:
        sizing === null
          ? null
          : {
              amountToken: indicative.amountToken ?? sizing.amountToken ?? null,
              proceedsUsd: indicative.amountUsd,
              minProceedsUsd:
                indicative.amountUsd !== null && indicative.appliedSlippageBps !== null
                  ? indicative.amountUsd * (1 - indicative.appliedSlippageBps / 10_000)
                  : null,
              fullExit: sizing.fullExit,
            },
    },
  };
}

// ------------------------------------------------------------- manual trade

export interface PlaceManualTradeInput {
  agentId: string;
  chain: Chain;
  side: "buy" | "sell";
  tokenAddress: string;
  amountUsd: number;
  note?: string;
  /**
   * Sell every token held, whatever `amountUsd` says. A dollar figure is a reading of
   * the position a mark or two old; "everything" is not a dollar figure.
   */
  sellAll?: boolean;
  /**
   * Sells only: a wider slippage tolerance for this one order, in basis points. Honoured
   * when it is a whole number between the agent's own Slippage tolerance and 1500;
   * anything else is ignored and the agent's setting applies (`manual-slippage.ts`).
   */
  maxSlippageBps?: number;
}

export interface ManualTradeResult {
  tradeId: string;
  symbol: string;
  side: "buy" | "sell";
  amountUsd: number;
  amountToken: number;
  priceUsd: number;
  isPaper: boolean;
  /** The document behind the fill, so the sheet can show it without a round trip. */
  receipt: TradeReceiptData;
}

export async function placeManualTrade(
  input: PlaceManualTradeInput,
): Promise<ActionResult<ManualTradeResult>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  if (!limiter.consume(`trade:${session.userId}`, RATE_LIMITS.trade).ok) {
    return fail("Too many trades in a minute — give it a moment.");
  }

  const agent = await ownedAgent(input.agentId, session.userId);
  if (!agent) return fail("You do not own this agent");
  if (agent.status === "draft") return fail("Activate the agent before trading on its book.");

  const amountUsd = Number(input.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return fail("Enter an amount greater than zero.");
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.trim().length > MAX_NOTE)) {
    return fail(`Keep the note to ${MAX_NOTE} characters or fewer.`);
  }

  const db = await getDb();
  const config: AgentConfig = agent.config;

  let token: Awaited<ReturnType<typeof resolveToken>>;
  try {
    token = await resolveToken(input.chain, input.tokenAddress);
  } catch (err) {
    // `resolveToken`'s own refusal is a sentence worth reading; a lookup or DB failure is not.
    console.error("[trading] resolveToken", err);
    // The resolver's text names both chains and the raw chain id (the agent tools share
    // it); a person pasting into the trade sheet gets one sentence for their chain.
    if (err instanceof Error && err.message.startsWith("Could not resolve")) {
      return fail(
        `Couldn't find "${input.tokenAddress}" on ${input.chain === "solana" ? "Solana" : "Base"}. ${
          input.chain === "solana"
            ? "Paste the full mint — a symbol only works for a token Tocker has already seen."
            : "Paste the 0x contract address."
        }`,
      );
    }
    return fail(publicErrorMessage(err, "Could not look that token up right now. Try again in a minute."));
  }
  const quoteTokenId = await ensureQuoteToken(input.chain);

  const score = await scoreQuietly(input.chain, token.address, token.symbol, config);
  if (input.side === "buy" && score === null) {
    return fail(
      `Could not score ${token.symbol} — every data provider failed. This agent never buys a token it has not scored, and that holds for you too.`,
    );
  }

  const portfolio = await getPortfolio(agent.id);
  const heldPosition = portfolio.positions.find((p) => p.token.id === token.id) ?? null;
  // W7 H1: the owner's own sell is sized from the position too — the venue is told how
  // many tokens to send, not a dollar figure to convert at a price that has moved. And
  // "sell all" is the whole balance, full stop: the balance from the row, not from the
  // book (the book hides dust, and a position the owner can still see must be emptied
  // either way), valued at the mark read just now. Not the larger of that and the typed
  // figure: the typed one is the page's reading, and keeping it is what refused "sell
  // everything" as an oversell whenever the price had fallen since the page rendered.
  const sizing =
    input.side === "sell"
      ? manualSellSizing({
          sellAll: input.sellAll === true,
          requestedUsd: amountUsd,
          heldTokenRow: await heldAmountToken(agent.id, token.id),
          position: heldPosition,
          decimals: token.decimals,
        })
      : null;
  const sizedUsd = sizing?.sizedUsd ?? amountUsd;
  const order: OrderIntent = {
    chain: input.chain,
    side: input.side,
    tokenId: token.id,
    tokenAddress: token.address,
    symbol: token.symbol,
    amountUsd: sizedUsd,
    rangePct: input.side === "buy" ? await recentRangePct(token.id) : null,
  };
  const verdict = riskGuard({ id: agent.id, mode: agent.mode, config }, toRiskPortfolio(portfolio), order, score);
  if (!verdict.ok) return fail(ownerRiskMessage(verdict));

  const rationale = input.note?.trim() || "Manual trade by the owner.";
  const executorAgent: ExecutorAgent = {
    id: agent.id,
    mode: agent.mode,
    wallets: await getAgentWallets(agent.id),
  };
  // The agent's own Slippage tolerance, unless the owner widened it for this one sell.
  // It is the number the venue is given and the number the receipt records.
  const slippageBps = manualSellSlippageBps({
    side: input.side,
    agentBps: config.risk.slippageBps,
    requestedBps: input.maxSlippageBps,
  });
  // The venue clamps the token amount to what the wallet really holds and retries once
  // on an over-ask.
  const request: TradeRequest = {
    chain: input.chain,
    side: input.side,
    tokenId: token.id,
    tokenAddress: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    amountUsd: sizedUsd,
    ...(sizing?.amountToken === undefined ? {} : { amountToken: sizing.amountToken }),
    slippageBps,
  };

  let executor;
  try {
    executor = await getExecutor(executorAgent, input.chain);
  } catch (err) {
    // A missing live wallet (`LiveWalletError`) explains itself; anything else stays in the log.
    console.error("[placeManualTrade] getExecutor", err);
    return fail(publicErrorMessage(err, "No venue available for this chain right now."));
  }
  // What every failure sentence below needs to know about this order.
  const failure = {
    side: input.side,
    symbol: token.symbol,
    limitPct: slippageBps / 100,
    limitWidened: slippageBps !== config.risk.slippageBps,
    venue: executor.venue,
  };

  const tradeId = nanoid();
  await db.insert(trades).values({
    id: tradeId,
    agentId: agent.id,
    runId: null,
    ownerId: agent.ownerId,
    chain: input.chain,
    side: input.side,
    tokenId: token.id,
    quoteTokenId,
    amountToken: "0",
    amountUsd: amountUsd.toFixed(6),
    requestedUsd: amountUsd.toFixed(6),
    priceUsd: "0",
    feeUsd: "0",
    status: "pending",
    origin: "manual",
    isPaper: executor.isPaper,
    rationale,
    scoreSnapshot: score === null ? null : toTradeScore(score),
    decidedAt: new Date(),
    decidedBy: "owner",
  });

  const quotedAt = new Date();
  let quote;
  try {
    quote = await executor.quote(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : "quote failed";
    // The venue's own words stay on the row, which is the owner-only audit trail. What
    // comes back to the person says whether anything moved and what to do next.
    await db.update(trades).set({ status: "failed", error: message }).where(eq(trades.id, tradeId));
    return fail(ownerTradeError({ ...failure, stage: "quote", message, ...venueErrorFacts(err) }));
  }

  // A manual trade is often somebody's first live one, so it gets the same last check
  // the agent's own orders get. Buys only; an exit is never blocked.
  const sanity = checkQuoteSanity({
    side: input.side,
    symbol: token.symbol,
    quotePriceUsd: quote.priceUsd,
    referencePriceUsd: await getPriceUsd(input.chain, token.address),
  });
  if (!sanity.ok) {
    await db.update(trades).set({ status: "failed", error: sanity.reason }).where(eq(trades.id, tradeId));
    return fail(sanity.reason);
  }

  // W7 H2: the signature is persisted before `/execute`, a throw becomes a `failed` row
  // instead of escaping this action, an unknown outcome is reconciled against the chain,
  // and a sell the venue calls an over-ask is retried once against the real balance.
  const settled = await executeTrade({
    tradeId,
    executor,
    request,
    quote,
    refreshSellAmount: () => heldAmountToken(agent.id, token.id),
  });
  if (settled.status !== "filled") {
    // `executeTrade` already wrote the raw text to the row. Its own sentences about an
    // order that may have filled pass through the mapper word for word.
    return fail(ownerTradeError({ ...failure, stage: "execute", message: settled.error }));
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

  // The owner's own trade pays the same flat fee the agent's does. "Manual" is a
  // judgement call, not a discount.
  const platformFeeUsd = await chargePlatformFee({
    agentId: agent.id,
    tradeId,
    chain: input.chain,
    isPaper: executor.isPaper,
    now: filledAt,
  });

  await applyFill(
    agent.id,
    token.id,
    {
      side: input.side,
      amountToken: fill.amountToken,
      amountUsd: fill.amountUsd,
      feeUsd: fill.feeUsd + platformFeeUsd,
      decimals: token.decimals,
    },
    // A manual buy opens a position like any other, so the exit engine needs the same
    // entry facts frozen onto it — otherwise the stop loss has nothing to measure from.
    { priceUsd: fill.priceUsd, score, now: filledAt },
  );

  // As after an approved proposal: the chart, the cards and the Cash row read snapshots,
  // and without one here they keep the pre-fill book until the next run. Best effort —
  // the fill is already real.
  try {
    await snapshotEquity(await getPortfolio(agent.id));
  } catch (err) {
    console.warn(`[trading] post-fill snapshot failed for ${agent.id}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const receipt = buildReceipt({
    chain: input.chain,
    side: input.side,
    symbol: token.symbol,
    tokenAddress: token.address,
    quote,
    fill,
    slippageToleranceBps: slippageBps,
    score,
    platformFeeUsd,
    quotedAt,
    filledAt,
  });
  await saveReceipt(tradeId, agent.id, receipt);

  // A manual fill is as public as an automatic one: the record is the product.
  await db.insert(posts).values({
    id: nanoid(),
    authorId: agent.ownerId,
    agentId: agent.id,
    tradeId,
    kind: "trade",
    body: rationale,
  });

  await notifyAgentFollowers(
    agent.id,
    `${agent.name} ${input.side === "buy" ? "bought" : "sold"} ${token.symbol}`,
    rationale,
    `/agents/${agent.slug}`,
  );

  await notifyFill({
    ownerId: agent.ownerId,
    agentName: agent.name,
    tradeId,
    receipt,
    origin: "manual",
  });

  revalidatePath(`/agents/${agent.slug}`);
  revalidatePath("/feed");

  return {
    ok: true,
    data: {
      tradeId,
      symbol: token.symbol,
      side: input.side,
      amountUsd: fill.amountUsd,
      amountToken: fill.amountToken,
      priceUsd: fill.priceUsd,
      isPaper: executor.isPaper,
      receipt,
    },
  };
}

// ---------------------------------------------------------------- proposals

export async function decideProposalAction(
  tradeId: string,
  decision: ProposalDecision,
): Promise<ActionResult<{ status: "filled" | "rejected"; message: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  if (decision !== "approve" && decision !== "reject") return fail("Unknown decision");
  if (decision === "approve" && !limiter.consume(`trade:${session.userId}`, RATE_LIMITS.trade).ok) {
    return fail("Too many trades in a minute — give it a moment.");
  }

  const result = await decideProposal({ tradeId, ownerId: session.userId, decision });
  if (!result.ok) return fail(result.error);

  revalidatePath(`/agents/${result.agentSlug}`);
  revalidatePath("/notifications");
  if (result.status === "filled") revalidatePath("/feed");

  return { ok: true, data: { status: result.status, message: result.message } };
}

/**
 * The read side lives in `@/server/queries/proposals`, which is `server-only`. It is
 * imported lazily so the query module (and its `server-only` guard) is pulled in only
 * when a read actually happens.
 */
const proposalQueries = () => import("@/server/queries/proposals");

/** Owner-only list for one agent. Returns `[]` rather than throwing for anyone else. */
export async function listProposals(agentId: string): Promise<ProposalRow[]> {
  const session = await getSession();
  if (!session) return [];
  return (await proposalQueries()).listProposals(agentId, session.userId);
}

/** Every proposal waiting on the signed-in user, across their agents. */
export async function listMyPendingProposals(): Promise<ProposalRow[]> {
  const session = await getSession();
  if (!session) return [];
  return (await proposalQueries()).listMyProposals(session.userId);
}

export async function pendingProposalsSummary(): Promise<PendingProposalsSummary> {
  const session = await getSession();
  if (!session) return { count: 0, latest: null };
  return (await proposalQueries()).getPendingProposalsSummary(session.userId);
}

// ------------------------------------------------------------------ sizing

/**
 * Change how big this agent's tickets are.
 *
 * Its own action rather than a field in the settings form, for one reason: sizing is the
 * setting most likely to be changed in a hurry, on a live agent, in the middle of a bad
 * day. It should be one owner-checked write that touches nothing else — not a
 * round trip through a whole config form that could carry a stale universe with it.
 *
 * `maxTradeUsd` is deliberately not editable here. It is the hard ceiling, it lives in
 * the risk form, and halving your exposure should never be a side effect of picking a
 * different sizing mode.
 */
export async function setPositionSizing(
  agentId: string,
  sizing: PositionSizingConfig,
): Promise<ActionResult<{ sizing: PositionSizingConfig }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const agent = await ownedAgent(agentId, session.userId);
  if (!agent) return fail("You do not own this agent");

  const parsed = positionSizingSchema.safeParse(sizing);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "That sizing configuration is not valid.");
  }

  const db = await getDb();
  const current = agent.config as AgentConfigWithSizing;
  const next: AgentConfigWithSizing = {
    ...current,
    risk: { ...current.risk, sizing: parsed.data },
  };

  await db.update(agents).set({ config: next, updatedAt: new Date() }).where(eq(agents.id, agentId));
  revalidatePath(`/agents/${agent.slug}`);
  revalidatePath(`/agents/${agent.slug}/settings`);

  return { ok: true, data: { sizing: parsed.data } };
}
