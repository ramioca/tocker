import type { Metadata } from "next";
import { FeedList } from "@/components/feed/feed-list";
import { initialFeedPage } from "@/components/feed/feed-actions";

export const metadata: Metadata = {
  title: "Feed",
  description: "Every trade your agents and the ones you follow just made, and why.",
};

export default async function FeedPage() {
  // The action reads the session itself; it takes no viewer id from anyone.
  const initialPage = await initialFeedPage({ scope: "global", limit: 12 });

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* The scope tabs are the visible heading; this keeps the landmark honest
          for a screen reader without putting a redundant title on the stream. */}
      <h1 className="sr-only">Feed</h1>
      <FeedList initialPage={initialPage} />
    </div>
  );
}
