/**
 * Paper executor — the default mode.
 *
 * It quotes against the real price path (Jupiter Ultra with no `taker` for Solana,
 * DexScreener/Jupiter price for Base) and falls back to `prices.getMarks` when the
 * quote API is down, so paper fills track reality. Fills are instant with a flat
 * 0.3% simulated fee.
 *
 * Paper cash is never stored: it is recomputed from the trade ledger as
 *   `paperStartingUsd − Σ buys + Σ sells − Σ fees`.
 */
import { and, eq } from "drizzle-orm";
import { agents, getDb, trades } from "@/db";
import { chargedFeesUsd } from "@/lib/platform/fees";
import type { Chain } from "@/server/types";
import { getPriceUsd } from "./prices";
import { jupiterQuotePrice } from "./jupiter";
import type { Fill, Quote, TradeExecutor, TradeRequest } from "./executor";

export const PAPER_FEE_BPS = 30; // 0.30%

/**
 * Best-effort mark for a paper fill: the venue quote first (it includes route impact),
 * then the cached price feeds, then the token's constant.
 */
export async function paperPrice(chain: Chain, address: string, decimals: number, amountUsd: number): Promise<number | null> {
  if (chain === "solana") {
    const routed = await jupiterQuotePrice(address, decimals, amountUsd);
    if (routed !== null) return routed;
  }
  return getPriceUsd(chain, address);
}

export class PaperExecutor implements TradeExecutor {
  readonly venue = "paper" as const;
  readonly isPaper = true;

  async quote(req: TradeRequest): Promise<Quote> {
    const price = await paperPrice(req.chain, req.tokenAddress, req.decimals, req.amountUsd);
    if (price === null || price <= 0) {
      throw new Error(`No price available for ${req.symbol} on ${req.chain} — cannot simulate a fill.`);
    }
    // W7 H1: the contract says an executor prefers `amountToken` when the caller knows
    // it. The simulator honours it too, or a paper agent's exits would leave dust that a
    // live agent's would not, and the two books would stop telling the same story.
    const amountToken =
      req.side === "sell" && typeof req.amountToken === "number" && req.amountToken > 0
        ? req.amountToken
        : req.amountUsd / price;
    const amountUsd = amountToken * price;
    const feeUsd = (amountUsd * PAPER_FEE_BPS) / 10_000;
    return {
      request: req,
      venue: "paper",
      priceUsd: price,
      amountToken,
      amountUsd,
      feeUsd,
      handle: { simulated: true },
    };
  }

  async execute(quote: Quote): Promise<Fill> {
    return {
      status: "filled",
      txHash: null,
      priceUsd: quote.priceUsd,
      amountToken: quote.amountToken,
      amountUsd: quote.amountUsd,
      feeUsd: quote.feeUsd,
    };
  }
}

/**
 * Recomputes an agent's paper cash from its filled trades. Never trusts a stored
 * balance, so a replayed or repaired ledger always produces the right number.
 *
 * `platformFeesUsd` is every Tocker fee the agent has been charged (W5). It is a
 * separate argument rather than part of the ledger because it is a separate table:
 * `trades.feeUsd` stays the *venue's* fee, and the receipt shows the split. A paper
 * agent that did not pay the platform fee would quietly outperform the same strategy
 * run live, which is the one thing paper mode must never do.
 */
export function computePaperCash(
  paperStartingUsd: number,
  ledger: ReadonlyArray<{ side: "buy" | "sell"; amountUsd: number; feeUsd: number }>,
  platformFeesUsd = 0,
): number {
  let cash = paperStartingUsd;
  for (const t of ledger) {
    cash += t.side === "buy" ? -t.amountUsd : t.amountUsd;
    cash -= t.feeUsd;
  }
  return cash - (Number.isFinite(platformFeesUsd) && platformFeesUsd > 0 ? platformFeesUsd : 0);
}

/** Database-backed version of {@link computePaperCash}. */
export async function getPaperCash(agentId: string): Promise<number> {
  const db = await getDb();
  const agent = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent[0]) throw new Error(`Agent ${agentId} not found`);
  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.status, "filled")));
  return computePaperCash(
    Number(agent[0].paperStartingUsd),
    rows.map((r) => ({ side: r.side, amountUsd: Number(r.amountUsd), feeUsd: Number(r.feeUsd) })),
    await chargedFeesUsd(agentId),
  );
}
