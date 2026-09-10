import type { Metadata } from "next";
import { FeedList } from "@/components/feed/feed-list";
import { feedPage, viewerSession } from "@/components/common/data-access";

export const metadata: Metadata = {
  title: "Feed",
  description: "Every trade your agents and the ones you follow just made, and why.",
};

export default async function FeedPage() {
  const session = await viewerSession();
  const initialPage = await feedPage({
    scope: "global",
    limit: 12,
    viewerId: session?.userId ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <FeedList initialPage={initialPage} />
    </div>
  );
}
