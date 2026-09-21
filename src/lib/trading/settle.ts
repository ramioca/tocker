/**
 * Getting a `trades` row to a terminal state, whatever the venue does (W7 H1/H2).
 *
 * Four places route an order — the agent's own `place_trade`, an approved proposal, a
 * manual owner trade and a guardian exit — and until now each of them called
 * `executor.execute()` bare. A throw from inside Privy or Jupiter (a policy denial, a
 * 30-second abort, a network blip) escaped past the `update(trades)` that would have
 * recorded it, and the row sat on `submitted` forever: money possibly gone, book saying
 * nothing happened. This module is the one place that cannot happen.
 *
 * What {@link executeTrade} guarantees for every caller:
 *
 *  - the row is moved to `submitted` and the **signed transaction's signature is
 *    persisted before `/execute` is called**, so an invocation that dies between signing
 *    and confirmation still leaves a thread to pull;
 *  - `execute()` runs inside a try/catch — a throw writes `failed` + the message rather
 *    than escaping;
 *  - when the outcome is unknown (a throw, or a failure with a signature on it) the
 *    signature is polled on-chain for ~20 seconds and the row is settled against what
 *    actually happened, not against what the SDK managed to say;
 *  - a sell the venue refuses because the wallet holds less than we asked for is retried
 *    exactly once against a freshly-read balance.
 *
 * The retry is why this takes a `refreshSellAmount` callback rather than a token amount:
 * the caller owns the position table, this module owns the venue conversation, and
 * `TradeRequest.amountToken` is the only contract between them. Nothing here imports an
 * executor implementation.
 */
import { nanoid } from "nanoid";
import { and, eq, lt } from "drizzle-orm";
import { agents, getDb, notifications, trades } from "@/db";
import type { Fill, Quote, TradeExecutor, TradeRequest } from "./executor";

/** How long to wait for an unknown signature to resolve on-chain. */
export const CONFIRM_TIMEOUT_MS = 20_000;
const CONFIRM_POLL_MS = 1_500;

/** A `submitted` row older than this was abandoned mid-flight; the marks cron sweeps it. */
export const SUBMITTED_STALE_MS = 2 * 60_000;

/**
 * Does this failure mean "the wallet holds less than you asked to sell"?
 *
 * Jupiter reports it as `errorCode: 1` with a still-signable transaction, which is the
 * exact shape of a stop loss sized from a mark that has moved since. Deliberately
 * narrow: a false positive here costs one wasted round trip, but widening it to every
 * mention of "balance" would retry orders that failed for unrelated reasons.
 */
export function isOverAskError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /\berror\s*code\s*[:=]?\s*1\b/i.test(message) ||
    /\(code\s*1\)/i.test(message) ||
    /insufficient\s+(?:token\s+)?(?:funds|balance|amount)/i.test(message) ||
    /exceeds\s+(?:the\s+)?(?:wallet|available|held|token)\s+balance/i.test(message)
  );
}

/**
 * Digs a transaction signature out of whatever an executor hung on `Quote.handle`.
 *
 * Deliberately defensive and deliberately shape-agnostic: the Solana executor belongs to
 * another workstream, the handle is typed `unknown` by the contract, and the cost of
 * guessing wrong is that we persist nothing — while the cost of not looking is a signed
 * transaction whose signature exists nowhere but in a variable inside a function that is
 * about to be frozen.
 */
export function signatureFromHandle(handle: unknown): string | null {
  const seen = new Set<unknown>();
  const keys = ["signature", "txSignature", "transactionSignature", "signedTransactionSignature", "txHash"];

  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 3 || value === null || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const found = record[key];
      // Base58 signatures are 86-88 chars; anything shorter is an id, not a signature.
      if (typeof found === "string" && found.length >= 32 && !found.includes(" ")) return found;
    }
    for (const nested of Object.values(record)) {
      const found = walk(nested, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };

  return walk(handle, 0);
}

export type SignatureOutcome = "succeeded" | "failed" | "unknown";

/**
 * Polls `getSignatureStatuses` over `SOLANA_RPC_URL` until the signature resolves or the
 * budget runs out. Never throws: an RPC that is down means we still do not know, which
 * is a different answer from "it failed" and is reported as such.
 */
export async function confirmSolanaSignature(
  signature: string,
  timeoutMs: number = CONFIRM_TIMEOUT_MS,
): Promise<SignatureOutcome> {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) return "unknown";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }],
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          result?: { value?: Array<{ err: unknown; confirmationStatus?: string } | null> };
        };
        const status = body.result?.value?.[0] ?? null;
        if (status !== null) {
          if (status.err !== null && status.err !== undefined) return "failed";
          if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
            return "succeeded";
          }
        }
      }
    } catch {
      // A blip is not an answer; keep polling until the budget is gone.
    }
    if (Date.now() + CONFIRM_POLL_MS >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_MS));
  }
  return "unknown";
}

export interface ExecuteTradeInput {
  /** The `trades` row this order belongs to. Moved to `submitted` and then settled. */
  tradeId: string;
  executor: TradeExecutor;
  request: TradeRequest;
  quote: Quote;
  /**
   * Sells only. Called after an over-ask failure to re-read what the wallet actually
   * holds, in whole units. Return `null` to give up rather than retry.
   */
  refreshSellAmount?: () => Promise<number | null>;
}

export type ExecuteTradeResult =
  | { status: "filled"; fill: Fill; quote: Quote; signature: string | null }
  | {
      status: "failed";
      error: string;
      /** A signature that confirmed on-chain while the fill was never recorded. */
      orphanSignature: string | null;
    };

/**
 * Submits one already-quoted order and settles its row. The caller keeps every
 * downstream concern — the platform fee, `applyFill`, the receipt, the feed post — and
 * only ever sees a terminal answer.
 */
export async function executeTrade(input: ExecuteTradeInput): Promise<ExecuteTradeResult> {
  const db = await getDb();
  const isSolana = input.request.chain === "solana";

  const attempt = async (quote: Quote): Promise<ExecuteTradeResult> => {
    // Before `/execute`, not after: this is the only moment at which the signature
    // exists and the row is still writable by an invocation that has not died yet.
    const signature = signatureFromHandle(quote.handle);
    await db
      .update(trades)
      .set({ status: "submitted", ...(signature === null ? {} : { txHash: signature }) })
      .where(eq(trades.id, input.tradeId));

    let fill: Fill;
    try {
      fill = await input.executor.execute(quote);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A throw is the worst case: the transaction may or may not be on chain. If we
      // captured a signature, the chain is the only witness worth asking.
      if (signature !== null && isSolana) {
        const outcome = await confirmSolanaSignature(signature);
        if (outcome === "succeeded") {
          return {
            status: "failed",
            error: `The venue threw (${message}) but transaction ${signature} confirmed on chain. The fill was not recorded — check the explorer before trading this token again.`,
            orphanSignature: signature,
          };
        }
        if (outcome === "failed") {
          return { status: "failed", error: `${message} (transaction ${signature} failed on chain)`, orphanSignature: null };
        }
        return {
          status: "failed",
          error: `${message} — transaction ${signature} did not resolve within ${Math.round(CONFIRM_TIMEOUT_MS / 1000)}s, so its outcome is unknown.`,
          orphanSignature: signature,
        };
      }
      return { status: "failed", error: message, orphanSignature: null };
    }

    if (fill.status === "filled") {
      return { status: "filled", fill, quote, signature: fill.txHash ?? signature };
    }

    const error = fill.error ?? "execution failed";
    // A reported failure that still carries a signature is not a reliable failure.
    const failureSignature = fill.txHash ?? signature;
    if (failureSignature !== null && isSolana) {
      const outcome = await confirmSolanaSignature(failureSignature);
      if (outcome === "succeeded") {
        return {
          status: "failed",
          error: `${error} — but transaction ${failureSignature} confirmed on chain, so this order may have filled. Check the explorer before trading this token again.`,
          orphanSignature: failureSignature,
        };
      }
    }
    return { status: "failed", error, orphanSignature: null };
  };

  let result = await attempt(input.quote);

  // One retry, and only for the one failure a retry can actually fix: the venue says the
  // wallet holds less than we asked to sell, which is what a stop loss sized from a mark
  // that has since moved looks like from Jupiter's side.
  if (
    result.status === "failed" &&
    result.orphanSignature === null &&
    input.request.side === "sell" &&
    input.refreshSellAmount !== undefined &&
    isOverAskError(result.error)
  ) {
    const firstError = result.error;
    const held = await input.refreshSellAmount();
    if (held !== null && held > 0 && held !== input.request.amountToken) {
      try {
        const requote = await input.executor.quote({ ...input.request, amountToken: held });
        result = await attempt(requote);
      } catch (err) {
        result = {
          status: "failed",
          error: `${firstError} (retry against the wallet's real balance could not be quoted: ${
            err instanceof Error ? err.message : String(err)
          })`,
          orphanSignature: null,
        };
      }
    }
  }

  if (result.status === "failed") {
    await db.update(trades).set({ status: "failed", error: result.error }).where(eq(trades.id, input.tradeId));
  }
  return result;
}

/**
 * Settles `trades` rows left on `submitted` by an invocation that never came back
 * (W7 H2). Runs from the marks cron, which is the loop that keeps going when everything
 * else is wedged.
 *
 * `submitted` is a transient state that lasts milliseconds in the happy case, so a row
 * still in it two minutes later belongs to a function that was frozen or killed between
 * signing and confirming. Every such row is taken to a terminal state, and the text says
 * exactly which of the three things happened — never "failed" when the chain says
 * otherwise. A transaction that confirmed while the fill went unrecorded gets an owner
 * notification, because the position is then understated and only a human can square it.
 *
 * Never throws: it is called from a loop whose real job is stop losses.
 */
export async function sweepSubmittedTrades(now: Date = new Date(), limit = 50): Promise<number> {
  try {
    const db = await getDb();
    const stale = await db
      .select({
        id: trades.id,
        agentId: trades.agentId,
        ownerId: trades.ownerId,
        chain: trades.chain,
        side: trades.side,
        txHash: trades.txHash,
      })
      .from(trades)
      .where(and(eq(trades.status, "submitted"), lt(trades.createdAt, new Date(now.getTime() - SUBMITTED_STALE_MS))))
      .limit(limit);
    if (stale.length === 0) return 0;

    const pending: Array<typeof notifications.$inferInsert> = [];
    for (const row of stale) {
      let error: string;
      let orphaned = false;

      if (row.txHash === null) {
        error =
          "Submitted but never confirmed: no transaction signature was recorded, so this order did not reach the chain.";
      } else if (row.chain !== "solana") {
        error = `Submitted but never confirmed. Transaction ${row.txHash} was signed — check the explorer before trading this token again.`;
        orphaned = true;
      } else {
        // One short poll, not the full 20s budget: this runs inside a cron pass that has
        // a book of stop losses waiting behind it.
        const outcome = await confirmSolanaSignature(row.txHash, 5_000);
        if (outcome === "succeeded") {
          error = `Transaction ${row.txHash} confirmed on chain but the fill was never recorded, so this position is not in the book. Check the explorer and reconcile before trading this token again.`;
          orphaned = true;
        } else if (outcome === "failed") {
          error = `Transaction ${row.txHash} failed on chain.`;
        } else {
          error = `Submitted but never confirmed: transaction ${row.txHash} has no on-chain status. It may still land — check the explorer.`;
          orphaned = true;
        }
      }

      await db.update(trades).set({ status: "failed", error }).where(eq(trades.id, row.id));

      if (orphaned) {
        const [agent] = await db.select({ slug: agents.slug, name: agents.name }).from(agents).where(eq(agents.id, row.agentId)).limit(1);
        pending.push({
          id: nanoid(),
          userId: row.ownerId,
          kind: "trade_unsettled",
          title: `${agent?.name ?? "An agent"} has a ${row.side} that never settled`,
          body: error.slice(0, 500),
          href: agent ? `/agents/${agent.slug}` : null,
        });
      }
    }

    if (pending.length > 0) await db.insert(notifications).values(pending);
    return stale.length;
  } catch (err) {
    console.warn(`[settle] submitted sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
