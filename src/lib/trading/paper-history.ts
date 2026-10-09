/**
 * Whether an agent's paper starting balance can still be changed, and the one way it is
 * changed afterwards.
 *
 * Paper cash is the starting balance minus buys plus sells minus fees (`./paper.ts`), and
 * the book's public PnL, its chart and its place on the leaderboard are measured against
 * that balance. So the balance may change only while there is nothing to measure: no
 * paper trade and no paper position, and no real-money order either, because paper cash
 * counts every filled trade whichever mode it was made in. After the first of any of
 * them it is part of the record.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { agents, auditEvents, equitySnapshots, getDb, positions, trades, type Db } from "@/db";
import { toNumeric } from "@/lib/money";
import type { PaperBalanceLock } from "./paper-balance";

/** The database, or a transaction on it. */
type Reader = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Set by hand, as `inference-ledger.ts` does. Under REPEATABLE READ the transaction below
 * would keep the view it had before it waited for the row lock, and miss the trade it
 * waited for.
 */
const READ_COMMITTED = { isolationLevel: "read committed" } as const;

/**
 * Whether the agent has any paper history. Either of:
 *
 *  - a trade row written on paper, in any status. A proposal that expired or was turned
 *    down, an order that failed and one still on its way all count: each was sized
 *    against the balance, and where there is doubt it is history.
 *  - a position row, held or closed, in a token the agent has no filled real-money trade
 *    in. `positions` has no mode column, so this is the rule
 *    `src/lib/security/paper-positions.ts` reads them by: a token never filled live
 *    cannot be in the wallet, so the row was made on paper. A closed row counts as much
 *    as an open one, since it carries realised PnL.
 *
 * An agent that is live now can have both, from before it went live. A run that looked
 * and bought nothing is not history, and neither is a flat equity mark: the marks are
 * taken away when the balance changes ({@link changePaperBalance}).
 *
 * This is not the whole of what closes the balance: see {@link paperBalanceLock}.
 */
export async function hasPaperHistory(db: Reader, agentId: string): Promise<boolean> {
  const [traded] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.isPaper, true)))
    .limit(1);
  if (traded) return true;

  const held = await db.select({ tokenId: positions.tokenId }).from(positions).where(eq(positions.agentId, agentId));
  if (held.length === 0) return false;
  const filledLive = await db
    .selectDistinct({ tokenId: trades.tokenId })
    .from(trades)
    .where(
      and(
        eq(trades.agentId, agentId),
        eq(trades.isPaper, false),
        eq(trades.status, "filled"),
        inArray(
          trades.tokenId,
          held.map((position) => position.tokenId),
        ),
      ),
    );
  const real = new Set(filledLive.map((trade) => trade.tokenId));
  return held.some((position) => !real.has(position.tokenId));
}

/** Whether the agent has a real-money order, in any status. */
async function hasRealMoneyOrder(db: Reader, agentId: string): Promise<boolean> {
  const [order] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.isPaper, false)))
    .limit(1);
  return Boolean(order);
}

/**
 * Why the agent's paper starting balance can no longer be changed, or null while it can.
 *
 * Paper history closes it (`paper`). So does a real-money order on an agent that has
 * none (`live`). `getPaperCash` sums every filled trade and every fee the agent was
 * charged, whichever mode they were made in, so an agent that made $50 live opens its
 * paper book $50 over its balance. Were the balance still open then, its owner could
 * pick it with the result in hand: +5% on $1,000 is +500% on $10, on the card and on the
 * leaderboard. An order in any status counts, as on paper: one on its way may yet fill,
 * and one that failed may have moved money all the same (`./settle.ts`). Where there is
 * doubt it is history.
 *
 * So an open balance means no trade row of either kind and no position, and a paper book
 * worth exactly the balance. The Risk limits step measures such an agent by it.
 */
export async function paperBalanceLock(db: Reader, agentId: string): Promise<PaperBalanceLock | null> {
  if (await hasPaperHistory(db, agentId)) return "paper";
  if (await hasRealMoneyOrder(db, agentId)) return "live";
  return null;
}

/**
 * What the settings page is told: why the paper balance cannot be changed, or null when
 * it can. The page shows the answer and nothing more: a save is judged again, under a
 * lock, by {@link changePaperBalance}. A read that fails answers that it cannot, the
 * cautious way round.
 */
export async function readPaperBalanceLock(agentId: string): Promise<PaperBalanceLock | null> {
  try {
    return await paperBalanceLock(await getDb(), agentId);
  } catch (err) {
    console.warn(`[paper-history] ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return "paper";
  }
}

/**
 * Whether anything shows the agent was ever live: a live mark, a real-money order, or the
 * switch itself. The order is asked for although an agent with one is refused before this
 * is reached ({@link paperBalanceLock}): it is one read, and it keeps the answer right by
 * itself.
 */
async function wasEverLive(db: Reader, agentId: string): Promise<boolean> {
  const [mark] = await db
    .select({ id: equitySnapshots.id })
    .from(equitySnapshots)
    .where(and(eq(equitySnapshots.agentId, agentId), eq(equitySnapshots.mode, "live")))
    .limit(1);
  if (mark) return true;
  if (await hasRealMoneyOrder(db, agentId)) return true;
  const [flip] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.agentId, agentId), eq(auditEvents.kind, "go_live")))
    .limit(1);
  return Boolean(flip);
}

/**
 * `changed`, or why not: the agent is not this owner's (or is gone), or its balance is
 * closed, for the reason given.
 */
export type PaperBalanceChange = "changed" | "gone" | PaperBalanceLock;

/**
 * Sets the paper starting balance, together with the rest of the same save, if and only
 * if the balance is still open ({@link paperBalanceLock}). One transaction:
 *
 *  1. The agent's row is locked `FOR UPDATE`. Every row that could close the balance
 *     (`trades` in either mode, `positions`) has a foreign key to it, and inserting one
 *     takes a `KEY SHARE` lock on this row, which `FOR UPDATE` conflicts with. So an
 *     insert already under way is waited for, and none can start until this commits. A
 *     plain `UPDATE ... WHERE NOT EXISTS (...)` would not do: it takes the weaker lock an
 *     update takes, which lets an insert through after its `NOT EXISTS` was answered.
 *  2. The book is read after the lock is held, in statements of their own, so under
 *     READ COMMITTED they see whatever the lock waited for.
 *  3. The balance and the rest of the save are written.
 *  4. The book's paper marks are deleted. Each is a flat point at the old balance; left in
 *     place they would draw a cliff on the chart and a drawdown that never happened. A
 *     mark stamped `paper` is one, on any agent. A mark with no stamp is from before the
 *     stamp existed and is read as the agent's current mode, so it is a paper mark only on
 *     an agent that is on paper and was never live. Live marks are never touched.
 *
 * What the lock cannot see is a buy, or a mark, that read the old balance and has not
 * written its row yet. Those check for themselves as they write: `paperBalanceMoved` in
 * `./paper.ts`, and `snapshotEquity`. A real-money order in that gap needs no check: it
 * was not sized against the paper balance, and it has no result yet for the balance to
 * have been chosen against.
 */
export async function changePaperBalance(input: {
  agentId: string;
  ownerId: string;
  paperStartingUsd: number;
  /** Everything else the same save writes to the agent's row. */
  patch: Partial<typeof agents.$inferInsert>;
}): Promise<PaperBalanceChange> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [book] = await tx
      .select({ mode: agents.mode })
      .from(agents)
      .where(and(eq(agents.id, input.agentId), eq(agents.ownerId, input.ownerId)))
      .limit(1)
      .for("update");
    if (!book) return "gone";
    const lock = await paperBalanceLock(tx, input.agentId);
    if (lock) return lock;

    await tx
      .update(agents)
      .set({ ...input.patch, paperStartingUsd: toNumeric(input.paperStartingUsd, 2) })
      .where(eq(agents.id, input.agentId));

    const onlyEverPaper = book.mode === "paper" && !(await wasEverLive(tx, input.agentId));
    await tx
      .delete(equitySnapshots)
      .where(
        and(
          eq(equitySnapshots.agentId, input.agentId),
          onlyEverPaper
            ? or(eq(equitySnapshots.mode, "paper"), isNull(equitySnapshots.mode))
            : eq(equitySnapshots.mode, "paper"),
        ),
      );
    return "changed";
  }, READ_COMMITTED);
}
