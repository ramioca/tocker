import { NotFoundContent } from "@/components/common/not-found-content";

/**
 * A `notFound()` inside the app (an unknown agent, run, token or profile) keeps the
 * shell: the bar, the tabs and the search are still there to go somewhere else from.
 */
export default function NotFound() {
  return <NotFoundContent className="mx-auto max-w-5xl px-4 py-16" />;
}
