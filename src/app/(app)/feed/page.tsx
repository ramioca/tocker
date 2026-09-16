import type { Metadata } from "next";
import { FeedList } from "@/components/feed/feed-list";
import { initialFeedPage } from "@/components/feed/feed-actions";
import { viewerSession } from "@/components/common/data-access";

export const metadata: Metadata = {
  title: "Feed",
  description: "Every trade your agents and the ones you follow just made, and why.",
};

export default async function FeedPage() {
  const session = await viewerSession();
  const initialPage = await initialFeedPage({
    scope: "global",
    limit: 12,
    viewerId: session?.userId ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* The scope tabs are the visible heading; this keeps the landmark honest
          for a screen reader without putting a redundant title on the stream. */}
      <h1 className="sr-only">Feed</h1>
      <FeedList initialPage={initialPage} />
    </div>
  );
}
