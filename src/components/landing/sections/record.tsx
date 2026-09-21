"use client";

import { RECORD } from "../content";
import { Container, Reveal, Section, SectionHeader } from "../primitives";

/**
 * STUB — owned by workstream C. The final version is the "redaction" moment:
 * a feed column on the left showing the public half of three trades, and a
 * transcript on the right whose lines black out into violet-black bars as the
 * section scrolls, leaving only the `private edge` label. Then the two-column
 * Public / Owner-only list and the kicker.
 */
export function Record() {
  return (
    <Section id={RECORD.id}>
      <Container>
        <SectionHeader eyebrow={RECORD.eyebrow} heading={RECORD.heading} body={RECORD.body} />

        <div className="mt-16 grid gap-4 lg:grid-cols-2">
          <Reveal className="ld-card p-5">
            <p className="ld-th">{RECORD.columns.public.title}</p>
            <ul className="mt-4 space-y-4">
              {RECORD.feed.map((t) => (
                <li key={`${t.handle}-${t.token}`} className="ld-inset p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{t.agent}</span>
                    <span className="ld-mono">{t.minutesAgo}m ago</span>
                  </div>
                  <p className="ld-code mt-2">
                    <span className={t.side === "buy" ? "ld-up" : "ld-down"}>
                      {t.side === "buy" ? "▲ buy" : "▼ sell"}
                    </span>{" "}
                    ${t.usd.toFixed(2)} · {t.token} · {t.chain} · score {t.score}
                    {t.pnlPct !== null ? <span className="ld-up"> · +{t.pnlPct}%</span> : null}
                  </p>
                  <p className="ld-body mt-2 text-[15px]">{t.rationale}</p>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.08} className="ld-card p-5">
            <p className="ld-th">{RECORD.columns.private.title}</p>
            <ul className="ld-code mt-4 space-y-2 text-[var(--ld-paper-55)]">
              {RECORD.transcript.map((line) => (
                <li key={line} className="truncate">{line}</li>
              ))}
            </ul>
            <p className="ld-chip ld-chip-violet mt-5">{RECORD.redactedLabel}</p>
          </Reveal>
        </div>

        <div className="mt-10 grid gap-8 border-t border-[var(--ld-hair)] pt-8 md:grid-cols-2">
          {[RECORD.columns.public, RECORD.columns.private].map((col) => (
            <Reveal key={col.title}>
              <p className="ld-th">{col.title}</p>
              <ul className="mt-3 space-y-2">
                {col.rows.map((r) => (
                  <li key={r} className="ld-body">{r}</li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.1}>
          <p className="ld-h3 mt-10">{RECORD.kicker}</p>
        </Reveal>
      </Container>
    </Section>
  );
}
