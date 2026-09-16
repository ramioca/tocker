/**
 * Trade receipts — the document behind a fill.
 *
 * A `trades` row says *what* happened. A receipt says *how*: which venue routed it,
 * what price was quoted against what price filled, the slippage that opened up between
 * the two, what it cost in network and venue fees, how long it took, and what the token
 * scored at entry with the reasons behind that score.
 *
 * Two things make this worth its own module rather than a handful of extra columns:
 *
 *  - **It is the only honest record of execution quality.** "Bought $100 of BONK at
 *    0.0000027" is not checkable. "Quoted 0.00000265, filled 0.0000027, +19 bps against
 *    a 100 bps tolerance, $0.30 venue fee, 1.4s" is. For a first live agent this is the
 *    difference between trusting the thing and hoping.
 *  - **It is public, so it must carry nothing private.** {@link buildReceipt} takes a
 *    score and keeps the total, the verdict and the names of the components that
 *    carried it — all of which already appear on the public token page. It never takes,
 *    and has nowhere to put, the strategy prompt, the universe thresholds, the
 *    data-source list or the transcript. That is a property of the *shape*, not of
 *    the callers' discipline: see the test.
 *
 * Everything except {@link saveReceipt} is pure.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, tradeReceipts } from "@/db";
import type { ReceiptScoreReason, TradeReceiptData, TradeReceiptVenue } from "@/db/schema";
import { toNumeric } from "@/lib/money";
import type { Chain, ScoreComponents, TokenScore, TradeScore } from "@/server/types";
import type { Fill, Quote } from "./executor";

export type { TradeReceiptData, ReceiptScoreReason, TradeReceiptVenue };

/**
 * The display half lives in `./receipt-display`, which has no path to `@/db` — a
 * client component that imports one of these from here would otherwise pull the
 * `postgres` driver into its browser bundle. Re-exported so every existing import
 * site is unchanged.
 */
export {
  SIMULATED_FILL_TEXT,
  SIMULATED_TX,
  slippageText,
  exceededTolerance,
  receiptSummary,
} from "./receipt-display";
import { SIMULATED_FILL_TEXT, SIMULATED_TX, slippageText } from "./receipt-display";

const VENUE_LABELS: Record<TradeReceiptVenue, string> = {
  jupiter: "Jupiter Ultra",
  "privy-base": "Privy swap (Base)",
  paper: "Paper simulator",
};

export function venueLabel(venue: TradeReceiptVenue): string {
  return VENUE_LABELS[venue] ?? venue;
}

/** Block explorer for a transaction hash. Null when there is nothing on a chain. */
export function explorerUrl(chain: Chain, txHash: string | null): string | null {
  if (!txHash || txHash === SIMULATED_TX) return null;
  return chain === "solana" ? `https://solscan.io/tx/${txHash}` : `https://basescan.org/tx/${txHash}`;
}

/**
 * Signed slippage in basis points, from the trader's point of view.
 *
 * Positive is always *worse for us*: on a buy, paying above the quote; on a sell,
 * receiving below it. Getting the sign right matters more than the magnitude — a
 * dashboard where good and bad execution both read "+40 bps" tells you nothing.
 */
export function slippageBps(side: "buy" | "sell", quotedPriceUsd: number, filledPriceUsd: number): number {
  if (!Number.isFinite(quotedPriceUsd) || quotedPriceUsd <= 0) return 0;
  if (!Number.isFinite(filledPriceUsd) || filledPriceUsd <= 0) return 0;
  const drift = ((filledPriceUsd - quotedPriceUsd) / quotedPriceUsd) * 10_000;
  const signed = side === "buy" ? drift : -drift;
  return Math.round(signed * 100) / 100;
}

const COMPONENT_LABELS: Record<string, string> = {
  safety: "Safety",
  liquidity: "Liquidity",
  organic: "Organic demand",
  distribution: "Distribution",
  momentum: "Momentum",
  sentiment: "Sentiment",
  smartMoney: "Smart money",
};

/**
 * The two or three components that carried the score, strongest first.
 *
 * Components only — never a threshold, never a gate, never which sources were bought.
 * "Safety 92, Liquidity 88" is a fact about the token; "above your liquidity floor of
 * $15,000" is a fact about the operator's strategy and does not belong on a public
 * document.
 */
export function scoreReasons(
  components: Partial<ScoreComponents> | null | undefined,
  limit = 3,
): ReceiptScoreReason[] {
  if (!components) return [];
  return Object.entries(components)
    .flatMap(([key, value]) =>
      typeof value === "number" && Number.isFinite(value)
        ? [{ key, label: COMPONENT_LABELS[key] ?? key, value: Math.round(value) }]
        : [],
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(0, limit));
}

export interface BuildReceiptInput {
  chain: Chain;
  side: "buy" | "sell";
  symbol: string;
  tokenAddress: string;
  quote: Pick<Quote, "venue" | "priceUsd" | "feeUsd">;
  fill: Pick<Fill, "priceUsd" | "amountToken" | "amountUsd" | "feeUsd" | "txHash">;
  /** The agent's configured tolerance, so the receipt can show the fill against it. */
  slippageToleranceBps: number;
  /** Frozen entry score. `TokenScore` and `TradeScore` both fit. */
  score?: Pick<TokenScore, "total" | "verdict" | "components"> | TradeScore | null;
  /** Network / gas cost in USD when the venue reports one. */
  networkFeeUsd?: number | null;
  quotedAt: Date;
  filledAt: Date;
}

function positive(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Assembles the receipt. Pure: give it the same quote and fill and it produces the same
 * document, which is what makes it testable and what makes the number on screen the
 * same number the run loop saw.
 */
export function buildReceipt(input: BuildReceiptInput): TradeReceiptData {
  const venue = input.quote.venue as TradeReceiptVenue;
  const simulated = venue === "paper";
  const quotedPriceUsd = positive(input.quote.priceUsd);
  const filledPriceUsd = positive(input.fill.priceUsd) || quotedPriceUsd;
  const venueFeeUsd = positive(input.fill.feeUsd);
  const networkFeeUsd = input.networkFeeUsd === undefined ? null : input.networkFeeUsd;
  const txHash = simulated ? SIMULATED_TX : (input.fill.txHash ?? "");
  const quotedAt = input.quotedAt.getTime();
  const filledAt = input.filledAt.getTime();

  return {
    chain: input.chain,
    side: input.side,
    venue,
    venueLabel: venueLabel(venue),
    simulated,
    txHash,
    explorerUrl: explorerUrl(input.chain, txHash),
    symbol: input.symbol,
    tokenAddress: input.tokenAddress,
    quotedPriceUsd,
    filledPriceUsd,
    slippageBps: slippageBps(input.side, quotedPriceUsd, filledPriceUsd),
    slippageToleranceBps: input.slippageToleranceBps,
    amountToken: positive(input.fill.amountToken),
    amountUsd: positive(input.fill.amountUsd),
    networkFeeUsd,
    venueFeeUsd,
    totalFeeUsd: Math.round((venueFeeUsd + positive(networkFeeUsd)) * 1e6) / 1e6,
    scoreTotal: typeof input.score?.total === "number" ? input.score.total : null,
    scoreVerdict: input.score?.verdict ?? null,
    scoreReasons: scoreReasons(input.score?.components),
    quotedAt: input.quotedAt.toISOString(),
    filledAt: input.filledAt.toISOString(),
    latencyMs: Number.isFinite(filledAt - quotedAt) ? Math.max(0, filledAt - quotedAt) : 0,
  };
}

/**
 * Writes the receipt. Never throws: a receipt is a record *of* a trade that already
 * happened, and losing the document must not turn a filled trade into a failed one.
 */
export async function saveReceipt(tradeId: string, agentId: string, receipt: TradeReceiptData): Promise<void> {
  try {
    const db = await getDb();
    await db
      .insert(tradeReceipts)
      .values({
        tradeId,
        agentId,
        venue: receipt.venue,
        simulated: receipt.simulated,
        txHash: receipt.simulated ? null : receipt.txHash || null,
        slippageBps: toNumeric(receipt.slippageBps, 2),
        totalFeeUsd: toNumeric(receipt.totalFeeUsd, 6),
        data: receipt,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn(`[receipt] ${tradeId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** One receipt by trade id. Null when the trade was never filled (or predates receipts). */
export async function getReceipt(tradeId: string): Promise<TradeReceiptData | null> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(tradeReceipts).where(eq(tradeReceipts.tradeId, tradeId)).limit(1);
    return row?.data ?? null;
  } catch {
    return null;
  }
}

/** Receipts for a set of trades, keyed by trade id. Missing ids are simply absent. */
export async function getReceipts(tradeIds: readonly string[]): Promise<Map<string, TradeReceiptData>> {
  const unique = [...new Set(tradeIds)].filter(Boolean);
  const out = new Map<string, TradeReceiptData>();
  if (unique.length === 0) return out;
  try {
    const db = await getDb();
    const rows = await db.select().from(tradeReceipts).where(inArray(tradeReceipts.tradeId, unique));
    for (const row of rows) out.set(row.tradeId, row.data);
  } catch {
    // A receipt is a nice-to-have on the read path too.
  }
  return out;
}

