import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { positions, tokens, trades, type Db } from "@/db";

/**
 * The paper positions that stop an agent going live, counted in one place.
 *
 * Two callers ask the same question and must get the same answer: `goLiveAction`, which
 * refuses the switch, and the live checklist, which has to say so before the owner has
 * funded the agent and held the button. When the count lived only in the action, the
 * checklist could be all green above a refusal.
 */

export interface SimulatedPosition {
  tokenId: string;
  /** For the checklist's sentence. Null only if the token row is somehow missing. */
  symbol: string | null;
}

/**
 * An agent's open positions that can only be simulated: held, in a token the agent has
 * no filled real-money trade in.
 *
 * `positions` has no mode column, so a row does not say whether a wallet backs it. The
 * trade rows do: a token the agent never filled a live order in cannot be in its wallet.
 * A token it has traded live is left out on purpose. That position may be real tokens
 * bought before a switch back to paper, and calling those simulated would send the owner
 * to sell them in paper mode, which empties the book and leaves the tokens in the wallet
 * with no way to sell them.
 */
export async function listSimulatedOpenPositions(db: Db, agentId: string): Promise<SimulatedPosition[]> {
  // A left join: the symbol is decoration, and a missing token row must never make a
  // held position disappear from a count that gates real money.
  const open = await db
    .select({ tokenId: positions.tokenId, symbol: tokens.symbol })
    .from(positions)
    .leftJoin(tokens, eq(tokens.id, positions.tokenId))
    .where(and(eq(positions.agentId, agentId), gt(positions.amountToken, "0")));
  if (open.length === 0) return [];

  const tradedLive = await db
    .selectDistinct({ tokenId: trades.tokenId })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.isPaper, false),
        eq(trades.status, "filled"),
        inArray(
          trades.tokenId,
          open.map((position) => position.tokenId),
        ),
      ),
    );
  const real = new Set(tradedLive.map((trade) => trade.tokenId));
  return open.filter((position) => !real.has(position.tokenId));
}

/** How many there are. What `goLiveAction` refuses on. */
export async function simulatedOpenPositions(db: Db, agentId: string): Promise<number> {
  return (await listSimulatedOpenPositions(db, agentId)).length;
}
