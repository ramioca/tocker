"use client";

import { useEffect, useRef } from "react";

/**
 * Brings the table row it sits in (or, outside a table, itself) to the middle of the
 * screen, once, on mount. For a page opened from a link that names one row
 * (`?trade=<id>`): that row is why the page was opened, and it can be twenty rows down.
 *
 * An instant jump, not a smooth scroll — the viewer did not scroll, so there is no
 * motion of theirs to follow, and a page that glides on load reads as a glitch.
 */
export function ScrollIntoView() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    (node?.closest("tr") ?? node)?.scrollIntoView({ block: "center" });
  }, []);
  return <span ref={ref} aria-hidden />;
}
