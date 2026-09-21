"use client";

import { SIGNALS, type Signal } from "../content";
import { Container, Reveal, Section, SectionHeader } from "../primitives";

/**
 * STUB — owned by workstream B. The eight verified x402 endpoints as a
 * responsive grid of unblurred `.ld-card`s (never a scroll-jacked gallery),
 * with a running cost line. Keep provider/name/price verbatim.
 */
export function Signals() {
  return (
    <Section id={SIGNALS.id}>
      <Container>
        <SectionHeader eyebrow={SIGNALS.eyebrow} heading={SIGNALS.heading} body={SIGNALS.body} />
        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SIGNALS.items.map((s, i) => (
            <li key={`${s.provider}-${s.name}`}>
              <Reveal delay={(i % 4) * 0.05} className="h-full">
                <SignalCard s={s} />
              </Reveal>
            </li>
          ))}
        </ul>
        <Reveal delay={0.1}>
          <p className="ld-code mt-6 flex flex-wrap items-center gap-x-3 text-[var(--ld-paper-55)]">
            <span>{SIGNALS.runningCost.calls} calls</span>
            <span aria-hidden>·</span>
            <span className="text-[var(--ld-paper)]">{SIGNALS.runningCost.usd}</span>
            <span aria-hidden>·</span>
            <span>{SIGNALS.runningCost.settle}</span>
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}

export function SignalCard({ s }: { s: Signal }) {
  return (
    <article className="ld-card ld-card-hover flex h-full flex-col p-5">
      <header className="flex items-center justify-between">
        <span className="text-[13px] font-medium tracking-[-0.01em]">{s.provider}</span>
        {s.tag ? <span className="ld-chip ld-chip-violet h-6 px-2.5 text-[10px]">{s.tag}</span> : null}
      </header>
      <h3 className="ld-h3 mt-4">{s.name}</h3>
      <p className="ld-caption mt-2">{s.desc}</p>
      <div className="ld-inset mt-5 px-3 py-2.5">
        <div className="ld-mono flex items-center justify-between text-[10px]">
          <span>{SIGNALS.labels.returns}</span>
          <span className="flex items-center gap-1.5 text-[var(--ld-violet)]">
            <span className="ld-dot ld-dot-pulse" aria-hidden />
            {SIGNALS.labels.live}
          </span>
        </div>
        <dl className="mt-2">
          {s.fields.map(([k, v]) => (
            <div key={k} className="ld-code flex justify-between gap-3 border-t border-[var(--ld-hair)] py-1 first:border-t-0 first:pt-0">
              <dt className="text-[var(--ld-paper-55)]">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <footer className="mt-auto flex items-baseline justify-between gap-3 pt-5">
        <span className="ld-num text-2xl font-medium tracking-[-0.02em]">
          {s.price}
          <span className="ld-mono ml-1.5 whitespace-nowrap">{SIGNALS.labels.per}</span>
        </span>
        <span className="ld-mono truncate normal-case tracking-[0.04em]">
          {SIGNALS.labels.via} · {s.host}
        </span>
      </footer>
    </article>
  );
}
