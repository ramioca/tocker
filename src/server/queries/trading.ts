import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { agents, getDb, trades } from "@/db";
import type { TradeReceiptData } from "@/db/schema";
import { getReceipts } from "@/lib/trading/receipt";
import { toNum } from "@/lib/money";
import type { Chain, ExitReason, TradeOrigin } from "@/server/types";

/**
 * Read-only queries for the trading surfaces: receipts, and the viewer's own footprint
 * on a token.
 *
 * ## The privacy line on this file
 *
 * A **receipt** is as public as the trade it documents — same rule as the feed card:
 * token, size, price, time and the one-line rationale are the public record. That is
 * why {@link receiptsFor} takes trade ids and does not filter by viewer: the caller has
 * already decided which trades it may show (`getTokenPage` restricts to public agents
 * plus the viewer's own), and re-deriving that here would mean two places to get it
 * wrong.
 *
 * **Chart markers are the opposite** and {@link myTokenMarkers} enforces it itself. A
 * marker says "*you* entered here and exited there" — it is only ever computed for the
 * signed-in viewer's own agents, and the function returns `[]` for an anonymous viewer
 * rather than the aggregate. The public page shows how many agents hold a token; it
 * never shows anyone else's entries and exits, because a position's timing is the one
 * public-looking fact from which a strategy can actually be reverse-engineered.
 */

export type { TradeReceiptData };

/**
 * Receipts for a set of trades, keyed by trade id, in one round trip. Trades with no
 * receipt (they failed, or they predate receipts) are simply absent from the map, and
 * every consumer renders that case as "no receipt" rather than as an error.
 */
export async function receiptsFor(tradeIds: readonly string[]): Promise<Map<string, TradeReceiptData>> {
  const unique = [...new Set(tradeIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  return getReceipts(unique);
}

/** One of the viewer's own fills, positioned on a price chart. */
export interface TokenMarker {
  tradeId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  side: "buy" | "sell";
  /** ISO timestamp of the fill — the x position. */
  at: string;
  /** Fill price — the y position. */
  priceUsd: number;
  amountUsd: number;
  origin: TradeOrigin;
  /** Set when the exit engine, not the model, closed this. Names the rule. */
  exitReason: ExitReason | null;
  chain: Chain;
}

/**
 * The signed-in viewer's own entries and exits on one token, oldest first.
 *
 * Owner-only by construction: every row is joined to `agents` and filtered on
 * `agents.ownerId = viewerId`. There is no parameter that relaxes it.
 *
 * @param days how far back to look; defaults to the 30 the token page charts.
 */
export async function myTokenMarkers(
  tokenId: string,
  viewerId: string | null | undefined,
  days = 30,
): Promise<TokenMarker[]> {
  if (!viewerId || !tokenId) return [];
  try {
    const db = await getDb();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .select({ trade: trades, agentName: agents.name, agentSlug: agents.slug })
      .from(trades)
      .innerJoin(agents, eq(agents.id, trades.agentId))
      .where(
        and(
          eq(trades.tokenId, tokenId),
          eq(trades.status, "filled"),
          eq(agents.ownerId, viewerId),
          gte(trades.createdAt, since),
        ),
      )
      .orderBy(asc(trades.createdAt));

    return rows.flatMap(({ trade, agentName, agentSlug }) => {
      const priceUsd = toNum(trade.priceUsd);
      if (!(priceUsd > 0)) return [];
      return [
        {
          tradeId: trade.id,
          agentId: trade.agentId,
          agentName,
          agentSlug,
          side: trade.side,
          at: (trade.filledAt ?? trade.createdAt).toISOString(),
          priceUsd,
          amountUsd: toNum(trade.amountUsd),
          origin: trade.origin,
          exitReason: (trade.exitReason as ExitReason | null) ?? null,
          chain: trade.chain as Chain,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * How many agents' fills a token page is summarising, without naming any of them.
 *
 * The aggregate the *public* page may show. `getTokenPage` already lists holders by
 * name (that is the agent's public record); this is the number for the chart caption,
 * where naming anyone would be putting their entry timing on a price axis.
 */
export async function tokenActivityCount(tokenId: string, days = 30): Promise<number> {
  try {
    const db = await getDb();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .selectDistinct({ agentId: trades.agentId })
      .from(trades)
      .innerJoin(agents, eq(agents.id, trades.agentId))
      .where(
        and(
          eq(trades.tokenId, tokenId),
          eq(trades.status, "filled"),
          eq(agents.isPublic, true),
          gte(trades.createdAt, since),
        ),
      );
    return rows.length;
  } catch {
    return 0;
  }
}
