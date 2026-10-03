"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommentSheet } from "./comment-sheet";
import { FeedCard } from "./feed-card";
import { FeedSkeleton } from "./feed-skeleton";
import { fetchFeedPage, type FeedPage } from "./feed-actions";
import { useSaveLike, type LikeState } from "./use-save-like";
import type { FeedItem } from "@/server/types";
import { stickySubnavRef } from "@/hooks/root-flag";

type Scope = "global" | "following";

const PAGE_SIZE = 12;

/**
 * Patch one post in every loaded scope, in place. A post can sit in Global and
 * Following at once, and switching tabs must not show it in two states. Patching
 * rather than invalidating keeps every loaded page where it is — a refetch of an
 * infinite query re-requests all of them, one after another.
 */
function patchPost(
  queryClient: QueryClient,
  postId: string,
  patch: (item: FeedItem) => Partial<FeedItem>,
) {
  queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === postId ? { ...item, ...patch(item) } : item)),
      })),
    };
  });
}

export function FeedList({
  initialPage,
  initialScope,
}: {
  initialPage: FeedPage;
  /** The scope the server rendered `initialPage` for — the `?tab=` of the request. */
  initialScope: Scope;
}) {
  // The scope lives in `?tab=`, so Back from a post or an agent lands on the list
  // it was opened from. Read with `useSearchParams` rather than handed down by the
  // page: Back restores the page from the router cache, while the hook follows the entry.
  const searchParams = useSearchParams();
  const scope: Scope = searchParams.get("tab") === "following" ? "following" : "global";
  const scrollOnSwitch = useRef(false);
  const [commentTarget, setCommentTarget] = useState<FeedItem | null>(null);
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["feed", scope],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchFeedPage({ scope, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (last: FeedPage) => last.nextCursor,
    // Seeds whichever list the server rendered, so a shared `?tab=following` link
    // paints its first page instead of a skeleton and a second round trip.
    initialData:
      scope === initialScope
        ? { pages: [initialPage], pageParams: [null as string | null] }
        : undefined,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = query;

  function selectScope(next: Scope) {
    if (next === scope) return;
    scrollOnSwitch.current = true;
    // Native `replaceState` is synced into the Next router without a server round
    // trip, and replacing rather than pushing keeps Back meaning "the page before".
    window.history.replaceState(null, "", next === "following" ? "/feed?tab=following" : "/feed");
  }

  // The strip is sticky, so a switch from deep in one list would land just as deep
  // in the other, with the sentinel quietly fetching pages to fill the gap. Start
  // the new list at its first post instead — after the commit, before the paint, so
  // the old list is never seen jumping. Only on a switch: a Back must keep its place.
  useLayoutEffect(() => {
    if (!scrollOnSwitch.current) return;
    scrollOnSwitch.current = false;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
  }, [scope]);

  // Infinite scroll. No animation on the appended rows: the feed is scrolled
  // dozens of times a session and motion on arrival reads as jank, not polish.
  // After a failed page the sentinel stands down — it is still on screen, and
  // re-observing it would retry in a loop; the Retry row below hands that to the user.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);

  // The card renders straight from this cache, so this is the only copy of the heart.
  const readLike = useCallback(
    (postId: string) =>
      queryClient
        .getQueryData<InfiniteData<FeedPage>>(["feed", scope])
        ?.pages.flatMap((page) => page.items)
        .find((item) => item.id === postId),
    [queryClient, scope],
  );
  const writeLike = useCallback(
    (postId: string, state: LikeState) => patchPost(queryClient, postId, () => state),
    [queryClient],
  );
  const onLike = useSaveLike({ read: readLike, write: writeLike, returnTo: "/feed" });
  // Stable, so the memoized cards that did not change skip the re-render a like causes.
  const handleLike = useCallback(
    (postId: string, liked: boolean) => void onLike(postId, liked),
    [onLike],
  );

  /** A posted comment counts on the card straight away, not after the next refetch. */
  const onCommented = useCallback(
    (postId: string) => {
      patchPost(queryClient, postId, (item) => ({ commentCount: item.commentCount + 1 }));
      setCommentTarget((target) =>
        target?.id === postId ? { ...target, commentCount: target.commentCount + 1 } : target,
      );
    },
    [queryClient],
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
      <div
        data-sticky-subnav
        // Holds the flag on <html> that adds this bar to the scroll padding (globals.css),
        // so a focused card scrolls clear of it.
        ref={stickySubnavRef}
        className="glass-bar sticky top-14 z-20 -mx-4 border-b border-b-[var(--glass-hairline)] px-4 py-2 sm:-mx-5 sm:px-5">
        <Tabs value={scope} onValueChange={(value) => selectScope(value as Scope)}>
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
      ) : query.isError && items.length === 0 ? (
        // Only when there is nothing to show. A failed older page, or a failed
        // background refetch, must never take away the cards already on screen.
        <ErrorState
          className="mt-4"
          title="The feed did not load"
          description="Check your connection and try again."
          action={
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-colors duration-150 hover:bg-muted"
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
                onLike={handleLike}
                onOpenComments={setCommentTarget}
              />
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden className="h-px" />

          {isFetchingNextPage ? (
            <FeedSkeleton count={2} />
          ) : isFetchNextPageError ? (
            <div role="alert" className="flex items-center justify-center gap-3 py-8">
              <p className="text-xs text-muted-foreground">Couldn&rsquo;t load older posts</p>
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
              >
                Retry
              </button>
            </div>
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
        onCommented={onCommented}
      />
    </div>
  );
}
