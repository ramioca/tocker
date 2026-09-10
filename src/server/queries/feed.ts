import "server-only";
import type { FeedItem, Page, CommentRow } from "@/server/types";

export async function getFeed(_opts: { scope: "global" | "following"; cursor?: string | null; limit?: number; viewerId?: string | null }): Promise<Page<FeedItem>> { throw new Error("not implemented: foundation workstream"); }
export async function getPost(_postId: string, _viewerId?: string | null): Promise<FeedItem | null> { throw new Error("not implemented: foundation workstream"); }
export async function getComments(_postId: string, _cursor?: string | null): Promise<Page<CommentRow>> { throw new Error("not implemented: foundation workstream"); }
