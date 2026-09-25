import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shell every admin table lives in.
 *
 * Two rules it enforces so no individual table has to remember them:
 *
 *  1. **The page never scrolls sideways.** Overflow is owned by this component's inner
 *     `div`, which is the only element allowed to scroll on either axis. A table that
 *     widens the document instead is the single worst failure mode of a dense admin
 *     page on a phone, and it is invisible on a desktop while you build it.
 *  2. **The header stays put.** `thead` is sticky against this container, with an opaque
 *     background rather than the glass tint — a translucent header with rows sliding
 *     under it is unreadable, and the material system's own rule is that repeating rows
 *     get the unblurred weight.
 *
 * `.glass-card`, not `.glass-panel`: a table is a repeating surface, and there are four
 * of them on this page (rule 2 of the material system caps blurred surfaces per view).
 */
export function TableShell({
  title,
  hint,
  action,
  notice,
  children,
  className,
  maxHeightClass = "max-h-[26rem]",
  scrollPadLeft,
}: {
  title: string;
  /** One short line: what the limit is, what the ordering is. */
  hint?: string;
  action?: ReactNode;
  /**
   * Caveats about the whole table. Outside the scroll container on purpose: inside it,
   * they scrolled off sideways with the columns and left a blank band above the header.
   */
  notice?: ReactNode;
  children: ReactNode;
  className?: string;
  maxHeightClass?: string;
  /**
   * The pinned column's width. Focus scrolling stops that far from the left edge, so a
   * link tabbed to lands beside the pinned column instead of underneath it.
   */
  scrollPadLeft?: string;
}) {
  return (
    <section className={cn("glass-card min-w-0 overflow-hidden rounded-2xl", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--glass-hairline)] px-4 py-3">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        {action}
      </header>
      {notice}
      <div
        className={cn("w-full overflow-auto overscroll-x-contain", maxHeightClass)}
        style={scrollPadLeft ? { scrollPaddingLeft: scrollPadLeft } : undefined}
      >
        {children}
      </div>
    </section>
  );
}

/** The `<table>` itself. `min-w` is what makes the inner container scroll rather than squash. */
export function DataTable({
  children,
  minWidth = "44rem",
  label,
}: {
  children: ReactNode;
  minWidth?: string;
  label: string;
}) {
  return (
    <table className="tnum w-full border-collapse text-left text-[13px]" style={{ minWidth }} aria-label={label}>
      {children}
    </table>
  );
}

/**
 * `sticky` pins the column to the left edge of the scroll container. Each table pins its
 * first column, so on a phone the row's identity stays in view while the money columns
 * scroll under it — without it, a 300px window onto a 900px table showed three columns
 * of names and no hint that anything else existed. The hairline on its right edge is the
 * cue that the rest of the row slides beneath; from `lg` every table fits, so it goes.
 */
/** What the pinned compact Time cell ("Sep 25, 06:38" plus its padding) takes under `lg`. */
export const PINNED_TIME_WIDTH = "7rem";

const STICKY_COLUMN = "sticky left-0 max-lg:shadow-[inset_-1px_0_0_var(--glass-hairline)]";

export function Th({
  children,
  className,
  numeric,
  sticky,
}: {
  children: ReactNode;
  className?: string;
  numeric?: boolean;
  sticky?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-1 bg-[var(--card)] px-3 py-2 text-[10px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase",
        "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[var(--glass-hairline)] after:content-['']",
        numeric && "text-right",
        // Above both the other headers and the pinned cells it scrolls over.
        sticky && cn(STICKY_COLUMN, "z-2"),
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  numeric,
  muted,
  sticky,
}: {
  children: ReactNode;
  className?: string;
  numeric?: boolean;
  muted?: boolean;
  sticky?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle whitespace-nowrap",
        numeric && "font-mono text-right",
        muted && "text-muted-foreground",
        // Opaque so the scrolled cells do not show through; the row's hover tint is
        // mixed in by hand, since a translucent one would let them show through again.
        sticky &&
          cn(STICKY_COLUMN, "z-1 bg-[var(--card)] [tr:hover_&]:bg-[color-mix(in_oklch,var(--card),var(--muted)_25%)]"),
        className,
      )}
    >
      {children}
    </td>
  );
}

/** One row spanning every column, for a table with nothing in it. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
