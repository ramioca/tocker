"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Loader2, SendHorizontal } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserAvatar } from "@/components/common/agent-avatar";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState } from "@/components/common/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { fetchComments, submitComment } from "./feed-actions";
import type { CommentRow, FeedItem, Page } from "@/server/types";
import { cn } from "@/lib/utils";

/** The server's cap (`submitComment`), enforced here so Send never offers a doomed post. */
const MAX_COMMENT = 1_000;
/** The counter stays out of the way until the cap is close enough to matter. */
const SHOW_COUNT_FROM = 800;

const SIGNED_OUT = "Sign in to comment";

/**
 * The thread under a post and the box to add to it — in the feed's sheet, or inline
 * on the post's own page. Key it by post id: the draft and any error belong to the
 * post they were written for, and must not follow the reader to the next one.
 */
export function CommentThread({
  postId,
  kind,
  enabled = true,
  scrollable = false,
  listRef,
  onCommented,
}: {
  postId: string;
  /** Only a trade has a "why" to ask about; notes and milestones get a plain prompt. */
  kind: FeedItem["kind"];
  enabled?: boolean;
  /** In the sheet the list scrolls and the composer stays pinned under it. */
  scrollable?: boolean;
  listRef?: RefObject<HTMLDivElement | null>;
  onCommented?: (postId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const { session } = useSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const inputId = useId();
  const countId = useId();

  const query = useInfiniteQuery({
    queryKey: ["comments", postId],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchComments(postId, pageParam),
    getNextPageParam: (last: Page<CommentRow>) => last.nextCursor,
  });

  const mutation = useMutation({
    mutationFn: async (body: string) => {
      let result: Awaited<ReturnType<typeof submitComment>>;
      try {
        result = await submitComment(postId, body);
      } catch {
        // A thrown action is the network or a deploy, never the comment itself; its raw
        // message is framework text, not something to show a person.
        throw new Error("Your comment was not posted. Check your connection and try again.");
      }
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data, body) => {
      setDraft("");
      // In the list at once, where the reader is looking (the bottom), rather than after a
      // refetch. Pages are newest first, so the new comment heads the first page; the
      // refetch then replaces it with the server's row.
      if (session) {
        const comment: CommentRow = {
          id: data.id,
          body: body.trim(),
          author: {
            id: session.userId,
            handle: session.handle,
            displayName: session.displayName,
            avatarUrl: session.avatarUrl,
          },
          createdAt: new Date().toISOString(),
        };
        queryClient.setQueryData<InfiniteData<Page<CommentRow>, string | null>>(["comments", postId], (current) => {
          const first = current?.pages[0];
          if (!current || !first || first.items.some((row) => row.id === comment.id)) return current;
          return { ...current, pages: [{ ...first, items: [comment, ...first.items] }, ...current.pages.slice(1)] };
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      onCommented?.(postId);
      requestAnimationFrame(() => {
        const list = listRef?.current;
        if (scrollable && list) list.scrollTo({ top: list.scrollHeight });
        // Send goes disabled while posting, which drops a keyboard user's focus: give it
        // back to the box, ready for the next comment.
        const active = document.activeElement;
        if (active === null || active === document.body) inputRef.current?.focus({ preventScroll: true });
      });
    },
  });

  // The newest comments are at the bottom, so that is where the sheet opens — once, on
  // the first load, not on every refetch under a reader who has scrolled up.
  const openedAtEnd = useRef(false);
  useEffect(() => {
    if (!scrollable || openedAtEnd.current || !query.isSuccess) return;
    openedAtEnd.current = true;
    const list = listRef?.current;
    list?.scrollTo({ top: list.scrollHeight });
  }, [scrollable, query.isSuccess, listRef]);

  // Pages arrive newest first, and each page newest first: reversed, the thread reads
  // oldest at the top, down to the newest just above the composer.
  const comments =
    query.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => [...page.items].reverse()) ?? [];
  const showCount = draft.length >= SHOW_COUNT_FROM;

  return (
    <>
      <div
        ref={listRef}
        // Focus lands here when the sheet opens: inside the dialog for keyboard and
        // screen-reader users, without raising a phone keyboard over the thread
        // the reader came to read.
        tabIndex={-1}
        className={cn("px-5 py-4 outline-none", scrollable && "min-h-0 flex-1 overflow-y-auto")}
      >
        {/* Above the thread, since that is where older comments go. */}
        {query.hasNextPage ? (
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="focus-ring mb-4 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          >
            {query.isFetchingNextPage
              ? "Loading…"
              : query.isFetchNextPageError
                ? "Older comments did not load — retry"
                : "Load older comments"}
          </button>
        ) : null}

        {query.isPending ? (
          <div className="space-y-4" role="status" aria-label="Loading comments">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="size-7 shrink-0 rounded-full bg-muted/70 motion-safe:animate-pulse" />
                <span className="h-10 flex-1 rounded-lg bg-muted/70 motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : query.isError && comments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">Comments did not load.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] disabled:opacity-50"
            >
              {query.isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : comments.length === 0 ? (
          <EmptyState
            title="No comments yet"
            description="Questions and replies about this post land here."
            className="border-0 py-10"
          />
        ) : (
          <ul className="space-y-4">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2.5">
                <UserAvatar handle={comment.author.handle} size="sm" />
                <div className="min-w-0 flex-1">
                  {/* Linked and with the @handle, as a card header is: beside an agent
                      called "Nova", a commenter shown only as "Nova" is ambiguous. */}
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
                    <Link
                      href={`/u/${comment.author.handle}`}
                      className="focus-ring rounded font-medium hover:underline"
                    >
                      {comment.author.displayName ?? comment.author.handle}
                    </Link>
                    <span className="text-muted-foreground">@{comment.author.handle}</span>
                    <RelativeTime iso={comment.createdAt} />
                  </p>
                  <p className="mt-0.5 break-words text-sm leading-relaxed text-foreground/85">
                    {comment.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-5 py-3">
        {/* Inline, not a toast: on a phone a toast lands on top of this very box. */}
        {mutation.isError ? (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {mutation.error.message === SIGNED_OUT ? (
              <>
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="focus-ring rounded font-medium underline underline-offset-2"
                >
                  Sign in
                </Link>{" "}
                to comment.
              </>
            ) : (
              mutation.error.message
            )}
          </p>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            // Mirrors Send's disabled state: Cmd/Ctrl+Enter submits past a disabled button.
            if (mutation.isPending || draft.trim().length === 0) return;
            mutation.mutate(draft);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="sr-only">
              Write a comment
            </label>
            {/*
              The shared primitive: 16px below `md` so iOS does not zoom the page on
              focus, and `field-sizing` grows it with the draft up to `max-h-40`.
            */}
            <Textarea
              ref={inputRef}
              id={inputId}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                // The error was about the text that was there; editing it retires it.
                if (mutation.isError) mutation.reset();
              }}
              onKeyDown={(event) => {
                // Enter stays a newline; Cmd/Ctrl+Enter sends, as in most comment boxes.
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={MAX_COMMENT}
              aria-describedby={showCount ? countId : undefined}
              placeholder={kind === "trade" ? "Ask why it made this trade…" : "Write a comment…"}
              className="block max-h-40 min-h-10 resize-none py-2"
            />
            {showCount ? (
              <p
                id={countId}
                className={cn(
                  "tnum mt-1 text-right text-[11px]",
                  draft.length >= MAX_COMMENT ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {draft.length.toLocaleString("en-US")}/{MAX_COMMENT.toLocaleString("en-US")}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            // A pointer press keeps the caret in the box, as a chat composer does.
            onMouseDown={(event) => event.preventDefault()}
            disabled={mutation.isPending || draft.trim().length === 0}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground",
              "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.95]",
              "disabled:pointer-events-none disabled:opacity-40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {mutation.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <SendHorizontal aria-hidden className="size-4" />
            )}
            <span className="sr-only">Post comment</span>
          </button>
        </form>
      </div>
    </>
  );
}

export function CommentSheet({
  item,
  open,
  onOpenChange,
  onCommented,
}: {
  item: FeedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a comment is saved, so the card's count can move with it. */
  onCommented?: (postId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // The parent clears `item` the moment the sheet starts closing. Keep painting the
  // last post until the exit animation is done, rather than an empty header.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        initialFocus={listRef}
        // The primitive's own `w-3/4` is scoped to data-side, so only a width scoped the
        // same way replaces it: full width on a phone, a comfortable column above.
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-sm">Comments</SheetTitle>
          <SheetDescription className="line-clamp-2 text-xs">
            {shown?.agent ? shown.agent.name : shown?.author.handle} ·{" "}
            {shown?.body ?? "No description"}
          </SheetDescription>
        </SheetHeader>

        {shown ? (
          <CommentThread
            key={shown.id}
            postId={shown.id}
            kind={shown.kind}
            enabled={open}
            scrollable
            listRef={listRef}
            onCommented={onCommented}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
