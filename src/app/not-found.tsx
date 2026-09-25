import { NotFoundContent } from "@/components/common/not-found-content";

/** An unmatched URL has no shell around it, so the message fills the screen. */
export default function NotFound() {
  return <NotFoundContent className="min-h-dvh px-6" />;
}
