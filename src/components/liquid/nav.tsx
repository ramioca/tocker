import Link from "next/link";
import { BrandLockup } from "./brand";
import { NavWaitlistPill } from "./waitlist-button";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#feed", label: "Feed" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#faq", label: "FAQ" },
] as const;

/**
 * The page bar: lockup, four section links centred, one quiet waitlist pill
 * (the one client part). It sits in the flow at the top of the page, so there
 * is nothing to blur and nothing to track on scroll. Under 900px the links go
 * and the pill shortens to "Join" under 640px, so the hero's own CTA stays the
 * loudest thing on a phone.
 */
export function Nav() {
  return (
    <>
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <header className="lp-nav">
        <Link href="/" className="lp-brand" aria-label="Tocker, home">
          <BrandLockup size={24} />
        </Link>
        <nav aria-label="Main" className="lp-nav-links">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <NavWaitlistPill />
      </header>
    </>
  );
}
