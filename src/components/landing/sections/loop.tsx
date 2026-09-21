"use client";

import { LOOP } from "../content";
import { Container, Reveal, Section, SectionHeader } from "../primitives";

/**
 * STUB — owned by workstream B. The final version is the page's one pinned
 * section (<= 200vh): a terminal on the left types the four log lines plus the
 * guardian line as you scroll, while a card assembles on the right (prompt →
 * score with gates → fill receipt → feed post).
 */
export function Loop() {
  return (
    <Section id={LOOP.id}>
      <Container>
        <SectionHeader eyebrow={LOOP.eyebrow} heading={LOOP.heading} body={LOOP.body} />
        <ol className="mt-16 grid gap-px overflow-hidden rounded-[var(--ld-radius)] border border-[var(--ld-hair)] bg-[var(--ld-hair)] md:grid-cols-2 xl:grid-cols-4">
          {LOOP.steps.map((s, i) => (
            <li key={s.n} className="bg-[var(--ld-l2)] p-6">
              <Reveal delay={i * 0.06}>
                <div className="flex items-baseline gap-3">
                  <span className="ld-mono">{s.n}</span>
                  <h3 className="ld-h3">{s.label}</h3>
                </div>
                <p className="ld-body mt-3">{s.body}</p>
                <p className="ld-code ld-inset mt-5 px-3 py-2">{s.log}</p>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal delay={0.2}>
          <p className="ld-code mt-4 px-1 text-[var(--ld-paper-55)]">{LOOP.guardian}</p>
        </Reveal>
      </Container>
    </Section>
  );
}
