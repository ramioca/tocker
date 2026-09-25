"use client";

import { useCallback, useState } from "react";
import { CommentThread } from "./comment-sheet";
import { FeedCard } from "./feed-card";
import { useSaveLike, type LikeState } from "./use-save-like";
import type { TradeReceiptData } from "@/lib/trading/receipt-format";
import type { FeedItem } from "@/server/types";

const THREAD_ID = "comments";

/**
 * One post on its own page — what a shared link and a like or comment notification
 * open. The same card as the feed, with the thread inline under it instead of in a
 * sheet, because here the thread is what the reader came for.
 */
export function PostView({
  initialItem,
  receipt,
}: {
  initialItem: FeedItem;
  receipt: TradeReceiptData | null;
}) {
  const [item, setItem] = useState(initialItem);

  const readLike = useCallback(
    (postId: string) => (postId === item.id ? item : undefined),
    [item],
  );
  const writeLike = useCallback(
    (_postId: string, state: LikeState) => setItem((current) => ({ ...current, ...state })),
    [],
  );
  const onLike = useSaveLike({ read: readLike, write: writeLike, returnTo: `/feed/${item.id}` });

  return (
    <>
      <FeedCard
        item={item}
        receipt={receipt}
        onLike={(postId, liked) => void onLike(postId, liked)}
        // The thread is already on the page; the card's comment button takes you to it.
        onOpenComments={() => document.getElementById(THREAD_ID)?.focus()}
      />

      <section
        id={THREAD_ID}
        tabIndex={-1}
        aria-labelledby={`${THREAD_ID}-heading`}
        className="glass-card mt-3 scroll-mt-20 overflow-hidden rounded-2xl outline-none"
      >
        <h2
          id={`${THREAD_ID}-heading`}
          className="flex items-baseline gap-2 border-b border-[var(--glass-hairline)] px-5 py-3 text-sm font-semibold"
        >
          Comments
          {item.commentCount > 0 ? (
            <span className="tnum text-xs font-normal text-muted-foreground">{item.commentCount}</span>
          ) : null}
        </h2>
        <CommentThread
          postId={item.id}
          kind={item.kind}
          onCommented={() =>
            setItem((current) => ({ ...current, commentCount: current.commentCount + 1 }))
          }
        />
      </section>
    </>
  );
}
