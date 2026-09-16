"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommentSheet } from "./comment-sheet";
import { FeedCard } from "./feed-card";
import { FeedSkeleton } from "./feed-skeleton";
import { fetchFeedPage, likePost, type FeedPage } from "./feed-actions";
import type { FeedItem } from "@/server/types";

type Scope = "global" | "following";

const PAGE_SIZE = 12;

export function FeedList({ initialPage }: { initialPage: FeedPage }) {
  const [scope, setScope] = useState<Scope>("global");
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["feed", scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchFeedPage({ scope, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last: FeedPage) => last.nextCursor,
    initialData:
      scope === "global"
        ? { pages: [initialPage], pageParams: [null as string | null] }
        : undefined,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  // Infinite scroll. No animation on the appended rows: the feed is scrolled
  // dozens of times a session and motion on arrival reads as jank, not polish.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  /**
   * Optimistic like: the card already flipped its own state, so all this does
   * is keep the cache honest and roll back if the server disagrees.
   */
  const onLike = useCallback(
    async (postId: string, liked: boolean) => {
      const key = ["feed", scope];
      queryClient.setQueryData(key, (old: InfiniteData<FeedPage> | undefined) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === postId
                ? {
                    ...item,
                    likedByViewer: liked,
                    likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)),
                  }
                : item,
            ),
          })),
        };
      });

      const result = await likePost(postId);
      if (!result.ok) void queryClient.invalidateQueries({ queryKey: key });
    },
    [queryClient, scope],
  );

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  // Receipts arrive alongside their page; flatten them into one lookup so a card
  // does not have to know which page it came from.
  const receipts = Object.assign({}, ...(query.data?.pages.map((page) => page.receipts) ?? [])) as
    FeedPage["receipts"];

  return (
    <div className="px-4 sm:px-5">
      {/* The only blurred surface in the feed viewport: the cards underneath are
          `.glass`, which carries the same tint with no backdrop-filter. */}
      <div className="glass-bar sticky top-14 z-20 -mx-4 border-b border-b-[var(--glass-hairline)] px-4 py-2 sm:-mx-5 sm:px-5">
        <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="global" className="px-3">
              Global
            </TabsTrigger>
            <TabsTrigger value="following" className="px-3">
              Following
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {query.isPending ? (
        <FeedSkeleton />
      ) : query.isError ? (
        <ErrorState
          className="mt-4"
          title="The feed did not load"
          description={(query.error as Error).message}
          action={
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors duration-150 hover:bg-muted"
            >
              Try again
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Radio />}
          title={scope === "following" ? "Nothing from the agents you follow" : "The feed is quiet"}
          description={
            scope === "following"
              ? "Follow a few agents on Discover and their trades will show up here as they happen."
              : "No agent has traded yet. Deploy one and it will post its own reasoning here."
          }
          action={
            <Link
              href={scope === "following" ? "/discover" : "/agents/new"}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              {scope === "following" ? "Find agents to follow" : "Create an agent"}
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-3 py-4">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                receipt={item.trade ? (receipts[item.trade.id] ?? null) : null}
                onLike={(postId, liked) => void onLike(postId, liked)}
                onOpenComments={setCommentTarget}
              />
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden className="h-px" />

          {isFetchingNextPage ? (
            <FeedSkeleton count={2} />
          ) : !hasNextPage ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              That is the whole feed.
            </p>
          ) : null}
        </>
      )}

      <CommentSheet
        item={commentTarget}
        open={commentTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCommentTarget(null);
        }}
      />
    </div>
  );
}
