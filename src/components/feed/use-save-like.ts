"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { likePost } from "./feed-actions";
import type { FeedItem } from "@/server/types";

export type LikeState = Pick<FeedItem, "likedByViewer" | "likeCount">;

/** What `toggleLike` answers a signed-out viewer. /feed is public, so this is common. */
const SIGNED_OUT = "Sign in to like";

/**
 * The heart, saved optimistically, for whichever store the card renders from.
 *
 * The heart moves on tap. A save that does not stick — signed out, rate limited, a post
 * that went private, an action that threw offline — puts back the last state the server
 * confirmed and says why in a toast; one that does replaces the guessed count with the
 * server's. Two quick taps are two saves in flight, and only the newest one's answer
 * may repaint the card, or an older reply would flip the heart back mid-way.
 *
 * `read` and `write` should be stable (useCallback), or the returned handler is not.
 */
export function useSaveLike({
  read,
  write,
  returnTo,
}: {
  read: (postId: string) => LikeState | undefined;
  write: (postId: string, state: LikeState) => void;
  /** Where sign-in comes back to. */
  returnTo: string;
}) {
  const router = useRouter();
  const inflight = useRef(new Map<string, { seq: number; confirmed: LikeState }>());

  return useCallback(
    async (postId: string, liked: boolean) => {
      const current = read(postId);
      if (!current) return;
      const entry = inflight.current.get(postId);
      const seq = (entry?.seq ?? 0) + 1;
      // Only the two like fields: `read` may hand back the whole post, and writing a
      // stale copy of it back would undo anything else that changed meanwhile.
      const confirmed = entry?.confirmed ?? {
        likedByViewer: current.likedByViewer,
        likeCount: current.likeCount,
      };
      inflight.current.set(postId, { seq, confirmed });

      const delta = liked === current.likedByViewer ? 0 : liked ? 1 : -1;
      write(postId, { likedByViewer: liked, likeCount: Math.max(0, current.likeCount + delta) });

      let result: Awaited<ReturnType<typeof likePost>> | null = null;
      try {
        result = await likePost(postId, liked);
      } catch {
        result = null;
      }

      const latest = inflight.current.get(postId);
      if (!latest) return;
      if (result?.ok) {
        latest.confirmed = { likedByViewer: result.data.liked, likeCount: result.data.likeCount };
      } else {
        const error = result?.error ?? "Couldn't save your like";
        toast.error(error, {
          // One toast per reason, however many times the heart was tapped.
          id: `like-failed:${error}`,
          action:
            error === SIGNED_OUT
              ? {
                  label: "Sign in",
                  onClick: () => router.push(`/login?next=${encodeURIComponent(returnTo)}`),
                }
              : undefined,
        });
      }
      if (latest.seq !== seq) return;
      inflight.current.delete(postId);
      write(postId, latest.confirmed);
    },
    [read, write, returnTo, router],
  );
}
