import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { viewerSession } from "@/components/common/data-access";
import { PostView } from "@/components/feed/post-view";
import { withMock } from "@/lib/data";
import { mockPost } from "@/mocks/core";
import { getPost } from "@/server/queries/feed";
import { receiptsFor } from "@/server/queries/trading";
import type { TradeReceiptData } from "@/lib/trading/receipt-format";
import type { FeedItem } from "@/server/types";

type Params = { params: Promise<{ postId: string }> };

/**
 * The viewer comes from the session, never from the URL. `getPost` answers null for a
 * private agent's post unless the viewer owns the agent, and that check is only as
 * good as the viewer id it is handed. A `FeedItem` carries no strategy config and no
 * transcript, and the thread under it runs `getComments`' own visibility check.
 */
const loadPost = cache(async (postId: string): Promise<FeedItem | null> => {
  const session = await viewerSession();
  return withMock(() => getPost(postId, session?.userId ?? null), () => mockPost(postId));
});

/**
 * The fill's execution receipt, the same join the feed does. Never fails the page. The
 * viewer is the session's, as above: only the agent's owner gets the whole receipt.
 */
async function receiptFor(item: FeedItem): Promise<TradeReceiptData | null> {
  if (!item.trade) return null;
  try {
    const session = await viewerSession();
    return (await receiptsFor([item.trade.id], session?.userId ?? null)).get(item.trade.id) ?? null;
  } catch {
    return null;
  }
}

function postTitle(item: FeedItem): string {
  const who = item.agent?.name ?? `@${item.author.handle}`;
  if (item.kind === "trade" && item.trade) {
    return `${who} ${item.trade.side === "buy" ? "bought" : "sold"} ${item.trade.token.symbol}`;
  }
  return `${who} on Tocker`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { postId } = await params;
  const item = await loadPost(postId);
  if (!item) return { title: "Post not found" };
  return {
    title: postTitle(item),
    description: item.body?.slice(0, 160) ?? undefined,
  };
}

export default async function PostPage({ params }: Params) {
  const { postId } = await params;
  const item = await loadPost(postId);
  if (!item) notFound();
  const receipt = await receiptFor(item);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-8 sm:px-5">
      <Link
        href="/feed"
        className="focus-ring -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-[color,background-color] duration-150 hover:bg-muted/60 hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Feed
      </Link>
      <h1 className="sr-only">{postTitle(item)}</h1>
      <div className="mt-2">
        <PostView initialItem={item} receipt={receipt} />
      </div>
    </div>
  );
}
