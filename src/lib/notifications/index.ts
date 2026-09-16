/**
 * Notifications that matter when an agent is live.
 *
 * The existing kinds (`trade` to followers, `exit` to the owner, `proposal`,
 * `run_failed`, and the social ones) are written where they happen — the guardian, the
 * proposal module, the run loop. This module adds the two that were missing and were
 * the difference between "my agent is running" and "I know what my agent did":
 *
 *  - **`fill`** — owner-only, one per executed trade, carrying the receipt line: venue,
 *    slippage against the quote, fees. A follower's `trade` notification says *what*
 *    the agent bought; the owner's `fill` says *how well it was bought*, which is the
 *    only question that matters when real money just moved.
 *  - **`digest`** — owner-only, at most one per agent per UTC day: how many trades, what
 *    they did to the book, and what the exit engine did while nobody was watching. An
 *    agent on a fifteen-minute cadence writes ninety-six runs a day; one honest
 *    paragraph is worth more than ninety-six notifications nobody opens.
 *
 * Everything here obeys two rules:
 *  - **Never throws.** A notification is an observation about work that already
 *    happened. Losing one must never fail a fill, an exit or a cron pass.
 *  - **Nothing private.** A digest counts exits by rule and names the tokens; it never
 *    quotes the strategy prompt, the universe thresholds, the data sources or the
 *    transcript. The rule *names* (`stop_loss`, `take_profit`, …) are already published
 *    on every exit's feed post.
 */
import { nanoid } from "nanoid";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb, notifications, tokens, trades } from "@/db";
import { toNum } from "@/lib/money";
import type { ExitReason, TradeOrigin } from "@/server/types";
import { receiptSummary, type TradeReceiptData } from "@/lib/trading/receipt";

export interface NotificationInput {
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
}

/** Writes notification rows. Never throws. */
export async function notify(rows: readonly NotificationInput[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = await getDb();
    await db.insert(notifications).values(rows.map((r) => ({ id: nanoid(), ...r })));
  } catch (err) {
    console.warn(`[notifications] write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Deep link to one trade's receipt. The token page is the public record of the token
 * and the only surface that renders a full receipt today, so a fill notification points
 * at the trade *in context* rather than at a modal with no surroundings.
 */
export function receiptHref(receipt: Pick<TradeReceiptData, "chain" | "tokenAddress">, tradeId: string): string {
  return `/tokens/${receipt.chain}/${receipt.tokenAddress}?trade=${tradeId}`;
}

export interface FillNotificationInput {
  ownerId: string;
  agentName: string;
  tradeId: string;
  receipt: TradeReceiptData;
  /** Set for a guardian exit, so the title can name the rule that fired. */
  exitReason?: ExitReason | null;
  origin?: TradeOrigin;
}

/** The title line of a fill notification. Pure, so the phrasing is testable. */
export function fillTitle(input: Pick<FillNotificationInput, "agentName" | "receipt" | "origin">): string {
  const { receipt } = input;
  const verb = receipt.side === "buy" ? "bought" : "sold";
  const size = `$${receipt.amountUsd.toFixed(2)}`;
  const who = input.origin === "manual" ? `${input.agentName} (your manual order)` : input.agentName;
  return `${who} ${verb} ${size} of ${receipt.symbol}${receipt.simulated ? " (paper)" : ""}`;
}

/**
 * Tells the owner their trade filled, and how well. Written *after* the ledger row and
 * the receipt, so the notification can never point at a trade that does not exist.
 */
export async function notifyFill(input: FillNotificationInput): Promise<void> {
  const { receipt } = input;
  const body = input.exitReason
    ? `${input.exitReason.replace(/_/g, " ")} · ${receiptSummary(receipt)}`
    : receiptSummary(receipt);
  await notify([
    {
      userId: input.ownerId,
      kind: "fill",
      title: fillTitle(input),
      body,
      href: receiptHref(receipt, input.tradeId),
    },
  ]);
}

// ------------------------------------------------------------------ digest

export interface DigestTrade {
  side: "buy" | "sell";
  symbol: string;
  amountUsd: number;
  feeUsd: number;
  origin: TradeOrigin;
  exitReason: ExitReason | null;
  status: string;
}

export interface DigestInput {
  agentName: string;
  agentSlug: string;
  /** The UTC day being summarised, as `YYYY-MM-DD`. */
  day: string;
  trades: readonly DigestTrade[];
  /** Realized PnL booked over the day, and equity at the close of it. */
  realizedPnlUsd: number;
  equityUsd: number | null;
  /** Equity at the start of the day, for the day's percentage move. */
  openingEquityUsd: number | null;
  /** Runs that failed during the day — the one thing a quiet digest still has to say. */
  failedRuns: number;
}

export interface Digest {
  title: string;
  body: string;
  href: string;
}

function usd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The day in one paragraph. Pure.
 *
 * Returns `null` for a day in which literally nothing happened — no fills, no exits, no
 * failures. A digest that arrives every day saying "nothing happened" trains its reader
 * to ignore the one that says something did.
 */
export function buildDigest(input: DigestInput): Digest | null {
  const filled = input.trades.filter((t) => t.status === "filled");
  const buys = filled.filter((t) => t.side === "buy");
  const sells = filled.filter((t) => t.side === "sell");
  const exits = filled.filter((t) => t.origin === "guardian" && t.exitReason !== null);
  const failed = input.trades.filter((t) => t.status === "failed");

  if (filled.length === 0 && failed.length === 0 && input.failedRuns === 0) return null;

  const dayPct =
    input.openingEquityUsd !== null && input.openingEquityUsd > 0 && input.equityUsd !== null
      ? ((input.equityUsd - input.openingEquityUsd) / input.openingEquityUsd) * 100
      : null;

  const title =
    filled.length === 0
      ? `${input.agentName}: no fills today`
      : `${input.agentName}: ${plural(filled.length, "trade")} today, ${usd(input.realizedPnlUsd)} realized`;

  const lines: string[] = [];

  if (filled.length > 0) {
    const fees = filled.reduce((sum, t) => sum + t.feeUsd, 0);
    const volume = filled.reduce((sum, t) => sum + t.amountUsd, 0);
    lines.push(
      `${plural(buys.length, "buy")}, ${plural(sells.length, "sell")} · $${volume.toFixed(2)} traded · $${fees.toFixed(2)} in fees.`,
    );
  } else {
    lines.push("No trades filled.");
  }

  if (exits.length > 0) {
    // Grouped by rule, because "three stop losses" and "three take profits" are
    // opposite days and both read as "three exits" if you only count them.
    const byReason = new Map<ExitReason, string[]>();
    for (const exit of exits) {
      if (!exit.exitReason) continue;
      byReason.set(exit.exitReason, [...(byReason.get(exit.exitReason) ?? []), exit.symbol]);
    }
    const parts = [...byReason.entries()].map(
      ([reason, symbols]) => `${reason.replace(/_/g, " ")} × ${symbols.length} (${symbols.join(", ")})`,
    );
    lines.push(`Exit engine: ${parts.join("; ")}.`);
  } else if (filled.length > 0) {
    lines.push("Exit engine: no rule fired.");
  }

  if (input.equityUsd !== null) {
    lines.push(
      dayPct === null
        ? `Equity $${input.equityUsd.toFixed(2)}.`
        : `Equity $${input.equityUsd.toFixed(2)} (${dayPct >= 0 ? "+" : "−"}${Math.abs(dayPct).toFixed(2)}% on the day).`,
    );
  }

  if (failed.length > 0) lines.push(`${plural(failed.length, "trade")} failed to execute.`);
  if (input.failedRuns > 0) lines.push(`${plural(input.failedRuns, "run")} failed.`);

  return { title, body: lines.join(" "), href: digestHref(input.agentSlug, input.day) };
}

/** `/agents/<slug>?digest=YYYY-MM-DD` — also the dedupe key, so one day yields one row. */
export function digestHref(agentSlug: string, day: string): string {
  return `/agents/${agentSlug}?digest=${day}`;
}

/** `YYYY-MM-DD` for a date, in UTC. Days are UTC everywhere in this codebase. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC that starts the given day string. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export interface SendDigestInput {
  agentId: string;
  ownerId: string;
  agentName: string;
  agentSlug: string;
  /** The UTC day to summarise. Callers normally pass yesterday. */
  day: string;
  equityUsd: number | null;
  openingEquityUsd: number | null;
  failedRuns?: number;
}

/**
 * Builds and sends one day's digest, at most once per agent per day.
 *
 * The dedupe is a lookup on the exact `href`, which carries the day — so a cron that
 * fires twelve times an hour, a manual guardian pass and a redeploy all converge on one
 * notification. Never throws.
 */
/**
 * Whether the digest for this agent-day already went out. Cheap on purpose: the
 * guardian asks this every pass before it spends three queries assembling a digest
 * that `sendDailyDigest` would then discard as a duplicate.
 */
export async function hasDigest(ownerId: string, agentSlug: string, day: string): Promise<boolean> {
  const db = await getDb();
  const href = digestHref(agentSlug, day);
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, ownerId), eq(notifications.kind, "digest"), eq(notifications.href, href)))
    .limit(1);
  return Boolean(existing);
}

export async function sendDailyDigest(input: SendDigestInput): Promise<Digest | null> {
  try {
    const db = await getDb();
    const href = digestHref(input.agentSlug, input.day);

    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, input.ownerId), eq(notifications.kind, "digest"), eq(notifications.href, href)))
      .limit(1);
    if (existing) return null;

    const from = dayStart(input.day);
    const to = new Date(from.getTime() + 86_400_000);
    const rows = await db
      .select()
      .from(trades)
      .where(and(eq(trades.agentId, input.agentId), gte(trades.createdAt, from), lt(trades.createdAt, to)));

    const symbols = await symbolsFor(rows.map((r) => r.tokenId));

    const digest = buildDigest({
      agentName: input.agentName,
      agentSlug: input.agentSlug,
      day: input.day,
      trades: rows.map((r) => ({
        side: r.side,
        symbol: symbols.get(r.tokenId) ?? r.tokenId.split(":")[1]?.slice(0, 6) ?? r.tokenId,
        amountUsd: toNum(r.amountUsd),
        feeUsd: toNum(r.feeUsd),
        origin: r.origin,
        exitReason: (r.exitReason as ExitReason | null) ?? null,
        status: r.status,
      })),
      realizedPnlUsd: realizedFrom(rows),
      equityUsd: input.equityUsd,
      openingEquityUsd: input.openingEquityUsd,
      failedRuns: input.failedRuns ?? 0,
    });
    if (!digest) return null;

    await notify([{ userId: input.ownerId, kind: "digest", title: digest.title, body: digest.body, href: digest.href }]);
    return digest;
  } catch (err) {
    console.warn(`[digest] ${input.agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Cash booked over the window: sells in, buys out, fees off both. A same-day round trip
 * therefore shows its true profit; a buy with no matching sell shows as the outflow it
 * is, which is honest for a *daily* number even though it is not lifetime realized PnL.
 */
function realizedFrom(rows: ReadonlyArray<typeof trades.$inferSelect>): number {
  let total = 0;
  for (const row of rows) {
    if (row.status !== "filled") continue;
    total += (row.side === "sell" ? 1 : -1) * toNum(row.amountUsd);
    total -= toNum(row.feeUsd);
  }
  return total;
}

/** Symbols for the tokens a digest mentions, so a raw token id never reaches a sentence. */
async function symbolsFor(tokenIds: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(tokenIds)].filter(Boolean);
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  try {
    const db = await getDb();
    const rows = await db.select().from(tokens).where(inArray(tokens.id, unique));
    for (const row of rows) out.set(row.id, row.symbol);
  } catch {
    // The caller falls back to a truncated address.
  }
  return out;
}
