"use client";

import { MODES } from "../content";
import { Container, Reveal, Section, SectionHeader } from "../primitives";

/** STUB — owned by workstream C. Three labelled columns: PAPER / ASK FIRST / LIVE. */
export function Modes() {
  return (
    <Section id={MODES.id}>
      <Container>
        <SectionHeader eyebrow={MODES.eyebrow} heading={MODES.heading} body={MODES.body} />
        <ul className="mt-16 grid gap-8 border-t border-[var(--ld-hair)] pt-8 md:grid-cols-3">
          {MODES.items.map((m, i) => (
            <li key={m.label}>
              <Reveal delay={i * 0.06}>
                <p className="ld-chip ld-chip-violet">{m.label}</p>
                <p className="ld-body mt-4">{m.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
