"use client";

import Link from "next/link";
import { NAV } from "./content";
import { Mark } from "./primitives";
import { useWaitlist } from "./waitlist/context";

/**
 * STUB — owned by workstream A (hero). Replace with the final nav: sticky
 * `.ld-bar` after the fold, mark + wordmark left, three links + the
 * `Request access` pill right, collapsed to mark + pill under 640px.
 */
export function Nav() {
  const { open } = useWaitlist();
  return (
    <header className="ld-container flex h-16 items-center justify-between">
      <Link href="/" className="flex items-center gap-2.5 text-[17px] font-medium tracking-[-0.02em]">
        <Mark size={22} />
        {NAV.brand}
      </Link>
      <nav aria-label="Main" className="flex items-center gap-7">
        <div className="hidden items-center gap-7 text-sm sm:flex">
          {NAV.links.map((l) => (
            <a key={l.href} href={l.href} className="ld-link">
              {l.label}
            </a>
          ))}
        </div>
        <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" onClick={open}>
          {NAV.cta}
        </button>
      </nav>
    </header>
  );
}
