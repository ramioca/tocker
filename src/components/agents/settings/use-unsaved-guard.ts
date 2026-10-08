"use client";

import { useEffect } from "react";

/**
 * Ask before unsaved edits to an agent are dropped.
 *
 * The edits live only in the page, so leaving loses them. This asks first: on reload or
 * close, and on in-app links (the agent bar's Go live, the back link, the tab bar), which
 * navigate client-side and never fire `beforeunload`. Going live on the old caps because a
 * Save was missed is the case this exists for.
 *
 * Moving between the page's own steps is not a link click and changes no pathname, so it
 * never asks. Neither does the browser's Back button, which a page cannot refuse.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      // A modified click opens another tab; nothing here is lost.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      // Another origin unloads the page, so `beforeunload` asks; a link to this same page stays here.
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes to this agent. Leave without saving them?")) {
        // Capture phase, so this runs before Next's <Link>, which skips a prevented click.
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
