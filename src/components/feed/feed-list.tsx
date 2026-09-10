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
import { fetchFeedPage, likePost } from "./feed-actions";
import type { FeedItem, Page } from "@/server/types";

type Scope = "global" | "following";

const PAGE_SIZE = 12;

export function FeedList({ initialPage }: { initialPage: Page<FeedItem> }) {
  const [scope, setScope] = useState<Scope>("global");
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["feed", scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchFeedPage({ scope, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last: Page<FeedItem>) => last.nextCursor,
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
      queryClient.setQueryData(key, (old: InfiniteData<Page<FeedItem>> | undefined) => {
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

  return (
    <div>
      <div className="sticky top-14 z-20 border-b border-border/70 bg-background/85 px-4 py-2 backdrop-blur-md sm:px-5">
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
          className="m-4"
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
          className="m-4"
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
          {items.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              onLike={(postId, liked) => void onLike(postId, liked)}
              onOpenComments={setCommentTarget}
            />
          ))}

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
