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
import { addComment, setFollow, setLike } from "@/server/actions/social";
import { receiptsFor } from "@/server/queries/trading";
import { mockComments, mockPost } from "@/mocks/core";
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

/**
 * Look up receipts for the fills on one page. Never fails the page. `viewerId` is the
 * session's: `receiptsFor` hands the whole receipt only to the owner of the trade's agent.
 */
async function withReceipts(page: Page<FeedItem>, viewerId: string | null): Promise<FeedPage> {
  const tradeIds = page.items
    .map((item) => item.trade?.id)
    .filter((id): id is string => Boolean(id));
  if (tradeIds.length === 0) return { ...page, receipts: {} };
  try {
    return { ...page, receipts: Object.fromEntries(await receiptsFor(tradeIds, viewerId)) };
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
  const viewerId = session?.userId ?? null;
  return withReceipts(await feedPage({ ...input, viewerId }), viewerId);
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
  const viewerId = session?.userId ?? null;
  return withReceipts(await feedPage({ scope: input.scope, limit: input.limit, viewerId }), viewerId);
}

export async function fetchComments(
  postId: string,
  cursor?: string | null,
): Promise<Page<CommentRow>> {
  return commentsPage(postId, cursor);
}

/**
 * Set the viewer's like on a post to `liked`, rather than flipping it.
 *
 * The card sends the state it is showing, so a card that went stale (liked in another
 * tab, a tap racing a refetch) cannot flip the server the wrong way. `setLike` is
 * idempotent at the source: a repeat like inserts nothing and notifies nobody.
 */
export async function likePost(
  postId: string,
  liked: boolean,
): Promise<ActionResult<{ liked: boolean; likeCount: number }>> {
  // A public endpoint: the arguments are whatever the caller sent.
  if (typeof postId !== "string" || typeof liked !== "boolean") {
    return { ok: false, error: "Post not found" };
  }
  return withMock(
    () => setLike(postId, liked),
    () => {
      const post = mockPost(postId);
      const others = Math.max(0, (post?.likeCount ?? 0) - (post?.likedByViewer ? 1 : 0));
      return { ok: true, data: { liked, likeCount: others + (liked ? 1 : 0) } };
    },
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

/** Set the viewer's follow to `following` (the state the button shows), never flip it. */
export async function followUser(
  targetType: "user" | "agent",
  targetId: string,
  following: boolean,
): Promise<ActionResult<{ following: boolean; followerCount: number }>> {
  return withMock(
    () => setFollow(targetType, targetId, following),
    () => ({ ok: true, data: { following, followerCount: following ? 1 : 0 } }),
  );
}
