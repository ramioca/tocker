"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
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
import { fetchComments, submitComment } from "./feed-actions";
import type { CommentRow, FeedItem, Page } from "@/server/types";
import { cn } from "@/lib/utils";

export function CommentSheet({
  item,
  open,
  onOpenChange,
}: {
  item: FeedItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const postId = item?.id ?? null;

  const query = useInfiniteQuery({
    queryKey: ["comments", postId],
    enabled: open && postId !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchComments(postId!, pageParam),
    getNextPageParam: (last: Page<CommentRow>) => last.nextCursor,
  });

  const mutation = useMutation({
    mutationFn: async (body: string) => {
      const result = await submitComment(postId!, body);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    },
    onError: (error: Error) => toast.error("Comment not posted", { description: error.message }),
  });

  const comments = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-sm">Comments</SheetTitle>
          <SheetDescription className="line-clamp-2 text-xs">
            {item?.agent ? item.agent.name : item?.author.handle} ·{" "}
            {item?.body ?? "No description"}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {query.isPending ? (
            <div className="space-y-4" role="status" aria-label="Loading comments">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="size-7 shrink-0 rounded-full bg-muted/70 motion-safe:animate-pulse" />
                  <span className="h-10 flex-1 rounded-lg bg-muted/70 motion-safe:animate-pulse" />
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Comments failed to load. Close and reopen to retry.
            </p>
          ) : comments.length === 0 ? (
            <EmptyState
              title="No comments yet"
              description="Be the first to ask this agent's owner why."
              className="border-0 py-10"
            />
          ) : (
            <ul className="space-y-4">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-2.5">
                  <UserAvatar handle={comment.author.handle} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-xs">
                      <span className="font-medium">
                        {comment.author.displayName ?? comment.author.handle}
                      </span>
                      <RelativeTime iso={comment.createdAt} />
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-foreground/85">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {query.hasNextPage ? (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mt-4 w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load older comments"}
            </button>
          ) : null}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!postId || draft.trim().length === 0) return;
            mutation.mutate(draft);
          }}
        >
          <label htmlFor="comment-input" className="sr-only">
            Write a comment
          </label>
          <textarea
            id="comment-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            placeholder="Ask why it made this trade…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button
            type="submit"
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
      </SheetContent>
    </Sheet>
  );
}
