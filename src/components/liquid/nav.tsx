import Link from "next/link";
import { LOGIN_HREF } from "@/lib/contact";
import { APP_HREF } from "./app-link";
import { BrandLockup } from "./brand";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#feed", label: "Feed" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#faq", label: "FAQ" },
] as const;

/**
 * The page bar: lockup, four section links centred, one quiet pill. The pill is
 * the way back in for someone who has an account: "Sign in", or "Open the app"
 * when the request came with a session cookie. Starting is the hero's button,
 * directly beneath it. All of it is server rendered; the bar has no client part.
 *
 * It sits in the flow at the top of the page, so there is nothing to blur and
 * nothing to track on scroll. Under 900px the links go and the pill stays, the
 * same label at every width.
 */
export function Nav({ hasSession }: { hasSession: boolean }) {
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
        {/* A plain anchor, not `Link`: sign-in and the app are entered by a full page load (see app-link.tsx). */}
        <a href={hasSession ? APP_HREF : LOGIN_HREF} className="lp-nav-cta lp-btn-ghost">
          {hasSession ? "Open the app" : "Sign in"}
        </a>
      </header>
    </>
  );
}
