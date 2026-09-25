import { NotFoundContent } from "@/components/common/not-found-content";

/**
 * An unmatched URL has no shell around it, so the message fills the screen. The <main>
 * is the landmark the shell would otherwise provide, so the page still has one.
 */
export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col px-6">
      <NotFoundContent className="flex-1" />
    </main>
  );
}
