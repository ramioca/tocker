"use server";

/**
 * Server-action bridge for the feed's client components.
 *
 * The real queries are `server-only`, so the client cannot import them; these
 * thin actions are the seam. They stay in the UI workstream's own tree so no
 * other branch has to touch a file to make the feed fetch.
 */
import { withMock } from "@/lib/data";
import { commentsPage, feedPage, viewerSession } from "@/components/common/data-access";
import { addComment, toggleFollow, toggleLike } from "@/server/actions/social";
import { receiptsFor } from "@/server/queries/trading";
import { mockComments } from "@/mocks/core";
import type { TradeReceiptData } from "@/lib/trading/receipt-format";
import type { ActionResult, CommentRow, FeedItem, Page } from "@/server/types";

/**
 * A page of the feed, plus the execution receipts for the fills on it.
 *
 * `FeedItem` carries no receipt of its own — receipts are the trading
 * workstream's table, keyed by trade id — so the join happens at this seam
 * rather than widening the shared view model. A trade older than receipts simply
 * has no entry, and `TradeReceiptRow` renders nothing for it.
 */
export interface FeedPage extends Page<FeedItem> {
  receipts: Record<string, TradeReceiptData>;
}

/** Look up receipts for the fills on one page. Never fails the page. */
async function withReceipts(page: Page<FeedItem>): Promise<FeedPage> {
  const tradeIds = page.items
    .map((item) => item.trade?.id)
    .filter((id): id is string => Boolean(id));
  if (tradeIds.length === 0) return { ...page, receipts: {} };
  try {
    return { ...page, receipts: Object.fromEntries(await receiptsFor(tradeIds)) };
  } catch {
    // A receipt is an enrichment on top of a fill. The feed still reads without one.
    return { ...page, receipts: {} };
  }
}

export async function fetchFeedPage(input: {
  scope: "global" | "following";
  cursor?: string | null;
  limit?: number;
}): Promise<FeedPage> {
  const session = await viewerSession();
  return withReceipts(await feedPage({ ...input, viewerId: session?.userId ?? null }));
}

/**
 * The server-rendered first page for `/feed`. Same shape as the action returns.
 *
 * The viewer comes from the session, never from an argument: this file is "use
 * server", so every export is a public endpoint, and a caller-supplied `viewerId`
 * would let anyone read the feed as someone else — private agents' posts included.
 */
export async function initialFeedPage(input: {
  scope: "global" | "following";
  limit?: number;
}): Promise<FeedPage> {
  const session = await viewerSession();
  return withReceipts(
    await feedPage({ scope: input.scope, limit: input.limit, viewerId: session?.userId ?? null }),
  );
}

export async function fetchComments(
  postId: string,
  cursor?: string | null,
): Promise<Page<CommentRow>> {
  return commentsPage(postId, cursor);
}

export async function likePost(
  postId: string,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  return withMock(
    () => toggleLike(postId),
    () => ({ ok: true, data: { liked: true, likeCount: 1 } }),
  );
}

export async function submitComment(
  postId: string,
  body: string,
): Promise<ActionResult<{ id: string }>> {
  const trimmed = body.trim();
  if (trimmed.length === 0) return { ok: false, error: "Write something first." };
  if (trimmed.length > 1_000) return { ok: false, error: "Comments are capped at 1,000 characters." };
  return withMock(
    () => addComment(postId, trimmed),
    () => ({ ok: true, data: { id: `${postId}_local_${mockComments(postId).items.length}` } }),
  );
}

export async function followUser(
  targetType: "user" | "agent",
  targetId: string,
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  return withMock(
    () => toggleFollow(targetType, targetId),
    () => ({ ok: true, data: { following: true, followerCount: 1 } }),
  );
}
