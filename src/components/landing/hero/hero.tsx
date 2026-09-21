"use client";

import Image from "next/image";
import mark from "../../../../public/brand/tocker/master/tocker-mark-3d-transparent.png";
import { HERO } from "../content";
import { LiquidCta } from "../liquid-cta";
import { ButtonLink, Eyebrow, RevealLine } from "../primitives";
import { useWaitlist } from "../waitlist/context";

/**
 * STUB — owned by workstream A. A legible, server-renderable hero: headline
 * left, the dimensional mark right as the single lit object on true black.
 * The final version keeps this DOM (the h1 and CTAs must be in the SSR HTML)
 * and layers the treatment on top.
 */
export function Hero() {
  const { open } = useWaitlist();
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div className="ld-bloom left-1/2 top-[-10%] -translate-x-1/4" aria-hidden />
      <div className="ld-grain" aria-hidden />
      <div className="ld-container relative grid min-h-[calc(100svh-4rem)] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-[40rem]">
          <Eyebrow>{HERO.eyebrow}</Eyebrow>
          <h1 id="hero-title" className="ld-h1 mt-6">
            {HERO.headline.map((line, i) => (
              <RevealLine key={line} inView={false} delay={0.26 + i * 0.06}>
                {line}
              </RevealLine>
            ))}
          </h1>
          <p className="ld-lead mt-7 max-w-[34rem]">{HERO.sub}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <LiquidCta onClick={open}>{HERO.primary}</LiquidCta>
            <ButtonLink href="#loop" variant="secondary">
              {HERO.secondary}
            </ButtonLink>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[520px]">
          <Image
            src={mark}
            alt={HERO.markAlt}
            priority
            sizes="(min-width: 1024px) 520px, 70vw"
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}
