import Link from "next/link";
import { createAgentHref } from "./app-link";
import { CreateAgentLink } from "./create-agent-link";
import { BrandLockup } from "./brand";

/** Each link carries its section's number, as the section heads print it. */
const LINKS = [
  { href: "#how", label: "How it works", num: "01" },
  { href: "#feed", label: "Feed", num: "02" },
  { href: "#guardrails", label: "Guardrails", num: "05" },
  { href: "#faq", label: "FAQ", num: "06" },
] as const;

/**
 * The page bar: lockup, four section links centred, and "Create your agent" in
 * the app's liquid-metal chrome (the builder with a session, sign-in first
 * without one; sign-in also creates the account). Server rendered, except the
 * metal button's small client island.
 *
 * It sits in the flow at the top of the page, so there is nothing to blur and
 * nothing to track on scroll; a hairline that fades out at both ends closes it.
 * Each link carries its section's number in small mono, and an underline that
 * draws from the left on hover. Under 900px the links go and the pill stays,
 * the same label at every width.
 */
export function Nav({ hasSession }: { hasSession: boolean }) {
  return (
    <>
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <header className="lp-nav-bar">
        <div className="lp-nav">
          <Link href="/" className="lp-brand" aria-label="Tocker, home">
            <BrandLockup size={24} />
          </Link>
          <nav aria-label="Main" className="lp-nav-links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                <span className="lp-nav-num lp-mono" aria-hidden>
                  {l.num}
                </span>
                <span className="lp-nav-label">{l.label}</span>
              </a>
            ))}
          </nav>
          <CreateAgentLink href={createAgentHref(hasSession)} size="sm" className="lp-nav-cta" />
        </div>
      </header>
    </>
  );
}
