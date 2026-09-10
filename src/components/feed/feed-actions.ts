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
import { mockComments } from "@/mocks/core";
import type { ActionResult, CommentRow, FeedItem, Page } from "@/server/types";

export async function fetchFeedPage(input: {
  scope: "global" | "following";
  cursor?: string | null;
  limit?: number;
}): Promise<Page<FeedItem>> {
  const session = await viewerSession();
  return feedPage({ ...input, viewerId: session?.userId ?? null });
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
