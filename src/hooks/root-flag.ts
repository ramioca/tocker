/**
 * Flags on `<html>` that a page part holds while it is mounted, for the few rules
 * that have to style the document by what is on the page — today the scroll padding
 * that keeps focused controls clear of a sticky sub-nav or action bar (globals.css).
 *
 * This replaced `html:has(#main [data-sticky-…])`. A `:has()` on the root is
 * re-matched on every DOM insert or removal anywhere in the document, and with
 * Tailwind's preflight in the cascade each one became a full-document style recalc
 * (about 4,900 elements and 25-40ms on the landing page, which has no sticky bars at
 * all). An attribute selector on `<html>` costs nothing until the flag flips.
 *
 * Counted, so two mounted parts that want the same flag never clear it for each other,
 * and a remount (Strict Mode, a keyed re-render) nets out.
 */
export type RootFlag = "data-sticky-subnav" | "data-sticky-actionbar";

const holders = new Map<RootFlag, number>();

/** Set `flag` on `root` and return the release. Releasing twice is a no-op. */
export function holdRootFlag(root: Element, flag: RootFlag): () => void {
  const count = (holders.get(flag) ?? 0) + 1;
  holders.set(flag, count);
  if (count === 1) root.setAttribute(flag, "");

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holders.get(flag) ?? 1) - 1;
    if (left > 0) {
      holders.set(flag, left);
      return;
    }
    holders.delete(flag);
    root.removeAttribute(flag);
  };
}

/**
 * A ref callback that holds `flag` on `<html>` for exactly as long as its element is
 * mounted. React 19 calls the returned cleanup on detach. It runs in the commit, before
 * paint, so a client navigation never paints a frame without the flag.
 */
export function rootFlagRef(flag: RootFlag) {
  return (node: Element | null) => (node ? holdRootFlag(node.ownerDocument.documentElement, flag) : undefined);
}

/** For a bar pinned under the top bar (the feed's Global / Following tabs). */
export const stickySubnavRef = rootFlagRef("data-sticky-subnav");
/** For a bar pinned to the bottom of the viewport (the builder's Create, an agent's Save). */
export const stickyActionbarRef = rootFlagRef("data-sticky-actionbar");
