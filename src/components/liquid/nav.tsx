import Link from "next/link";
import { createAgentHref } from "./app-link";
import { CreateAgentLink } from "./create-agent-link";
import { BrandLockup } from "./brand";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#feed", label: "Feed" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#faq", label: "FAQ" },
] as const;

/**
 * The page bar: lockup, four section links centred, and "Create your agent" in
 * the app's liquid-metal chrome (the builder with a session, sign-in first
 * without one; sign-in also creates the account). Server rendered, except the
 * metal button's small client island.
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
        <CreateAgentLink href={createAgentHref(hasSession)} size="sm" className="lp-nav-cta" />
      </header>
    </>
  );
}
