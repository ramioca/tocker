"use client";

import { useEffect } from "react";

/**
 * Make `/agents/[slug]/settings#budget` actually land on the budget card.
 *
 * The browser resolves a hash once, at the moment it parses the document. Half of this
 * page is client cards that mount after that and then grow again when their balance
 * query resolves, so by the time `#budget` exists the browser has long since given up,
 * and the deep links that readiness and the live checklist hand the operator ("fix this
 * in Settings → Budget") silently do nothing — the worst kind of broken link, because it
 * looks like the page simply has no such section.
 *
 * So re-apply it ourselves, twice: once on mount, once a beat later for the cards whose
 * height depends on a fetch. `scroll-margin-top` on the targets is what keeps the
 * heading clear of the sticky top bar; this only decides *when* to scroll.
 *
 * Deliberately inert when there is no hash, and it never writes one — a page that
 * scrolls somewhere on its own is a page you cannot get back to the top of.
 */
export function HashScroll() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;

    let cancelled = false;
    const jump = () => {
      if (cancelled) return;
      const el = document.getElementById(id);
      // `auto`, not `smooth`: this is an arrival, not a gesture. Smooth-scrolling a
      // page the reader has not touched yet reads as the page moving under them.
      el?.scrollIntoView({ behavior: "auto", block: "start" });
    };

    const frame = requestAnimationFrame(jump);
    const timer = window.setTimeout(jump, 400);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
