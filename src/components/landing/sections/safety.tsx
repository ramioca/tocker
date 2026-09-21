"use client";

import { SAFETY } from "../content";
import { Container, Reveal, RevealLine, Section, SectionHeader } from "../primitives";

/**
 * STUB — owned by workstream C. Gates as mono chips, exits as a priority list,
 * and the line "Entry rules never block an exit." set as the largest type in
 * the section.
 */
export function Safety() {
  return (
    <Section id={SAFETY.id}>
      <Container>
        <SectionHeader eyebrow={SAFETY.eyebrow} heading={SAFETY.heading} body={SAFETY.body} />

        <div className="mt-16 grid gap-10 lg:grid-cols-2">
          <Reveal>
            <p className="ld-th">{SAFETY.gatesTitle}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {SAFETY.gates.map((g) => (
                <li key={g} className="ld-chip">{g}</li>
              ))}
            </ul>
            <p className="ld-caption mt-4 max-w-[40ch]">{SAFETY.gatesCaption}</p>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="ld-th">{SAFETY.exitsTitle}</p>
            <ol className="mt-4 divide-y divide-[var(--ld-hair)] border-y border-[var(--ld-hair)]">
              {SAFETY.exits.map(([n, name]) => (
                <li key={name} className="ld-code flex items-center gap-4 py-2.5">
                  <span className="text-[var(--ld-paper-45)]">{n}</span>
                  <span className="text-[var(--ld-paper)]">{name}</span>
                </li>
              ))}
            </ol>
            <p className="ld-caption mt-4 max-w-[40ch]">{SAFETY.exitsCaption}</p>
          </Reveal>
        </div>

        <div className="mt-24 max-w-[52rem]">
          <p className="ld-h2">
            <RevealLine>{SAFETY.line}</RevealLine>
          </p>
          <Reveal delay={0.12}>
            <p className="ld-lead mt-6 max-w-[40rem]">{SAFETY.lineSub}</p>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
