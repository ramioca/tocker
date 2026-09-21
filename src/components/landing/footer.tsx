import { FOOTER } from "./content";
import { Mark } from "./primitives";

/** STUB — owned by workstream C. Mono microtype, no dead links. */
export function Footer() {
  return (
    <footer className="border-t border-[var(--ld-hair)]">
      <div className="ld-container flex flex-wrap items-center justify-between gap-4 py-8">
        <p className="ld-mono flex items-center gap-3 normal-case tracking-[0.06em]">
          <Mark size={16} />
          {FOOTER.line}
        </p>
        <div className="ld-mono flex items-center gap-6">
          {FOOTER.links.map((l) => (
            <a key={l.href} href={l.href} className="ld-link">
              {l.label}
            </a>
          ))}
          <span className="flex items-center gap-2">
            <span className="ld-dot" aria-hidden />
            {FOOTER.status}
          </span>
        </div>
      </div>
    </footer>
  );
}
