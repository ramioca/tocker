"use client";

import { CLOSE } from "../content";
import { LiquidCta } from "../liquid-cta";
import { Container, Reveal, RevealLine, Section } from "../primitives";
import { useWaitlist } from "../waitlist/context";

/** STUB — owned by workstream C. One question, one button. */
export function Close() {
  const { open } = useWaitlist();
  return (
    <Section id={CLOSE.id} className="text-center">
      <Container className="flex flex-col items-center">
        <h2 className="ld-h2 max-w-[22ch]">
          <RevealLine>{CLOSE.heading}</RevealLine>
        </h2>
        <Reveal delay={0.1}>
          <p className="ld-lead mt-6">{CLOSE.sub}</p>
        </Reveal>
        <Reveal delay={0.18} className="mt-9">
          <LiquidCta onClick={open}>{CLOSE.cta}</LiquidCta>
        </Reveal>
      </Container>
    </Section>
  );
}
