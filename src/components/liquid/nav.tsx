"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { Mark } from "./mark";
import { useWaitlist } from "./waitlist";

/**
 * The page bar. Transparent over the hero; once the visitor scrolls past the
 * first 48px it becomes the one blurred surface on the page — a thin bar
 * tinted from the ground, so content is visibly still moving underneath.
 * Fixed rather than inside the hero, so it exists for the whole page.
 */
const subscribe = (cb: () => void) => {
  window.addEventListener("scroll", cb, { passive: true });
  return () => window.removeEventListener("scroll", cb);
};
const getScrolled = () => window.scrollY > 48;
const getServerScrolled = () => false;

export function Nav() {
  const scrolled = useSyncExternalStore(subscribe, getScrolled, getServerScrolled);
  const { open } = useWaitlist();

  return (
    <header className={`nav reveal${scrolled ? " nav-scrolled" : ""}`} style={{ "--reveal-delay": "0.55s" } as CSSProperties}>
      <div className="nav-inner">
        <Link href="/" className="nav-brand" aria-label="Tocker home">
          <Mark size={22} />
          <span>tocker</span>
        </Link>
        <nav aria-label="Main" className="nav-links">
          <a className="nav-link" href="#signals">
            Data
          </a>
          <a className="nav-link" href="#mechanics">
            How it works
          </a>
        </nav>
        <button type="button" className="nav-cta" onClick={open}>
          Join the waitlist
        </button>
      </div>
    </header>
  );
}
