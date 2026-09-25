import type { Metadata } from "next";
import { FeedList } from "@/components/feed/feed-list";
import { initialFeedPage } from "@/components/feed/feed-actions";

export const metadata: Metadata = {
  title: "Feed",
  description: "Every trade your agents and the ones you follow just made, and why.",
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  // Render the list the link asked for. Always building Global meant a shared
  // `?tab=following` link threw that page away and fetched Following from the client.
  // First value on a repeated `?tab=`, as the list's `useSearchParams().get` reads it.
  const { tab } = await searchParams;
  const initialScope = (Array.isArray(tab) ? tab[0] : tab) === "following" ? "following" : "global";
  // The action reads the session itself; it takes no viewer id from anyone.
  const initialPage = await initialFeedPage({ scope: initialScope, limit: 12 });

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* The scope tabs are the visible heading; this keeps the landmark honest
          for a screen reader without putting a redundant title on the stream. */}
      <h1 className="sr-only">Feed</h1>
      <FeedList initialPage={initialPage} initialScope={initialScope} />
    </div>
  );
}
