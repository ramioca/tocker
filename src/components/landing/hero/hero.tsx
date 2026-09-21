"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import mark from "../../../../public/brand/tocker/master/tocker-mark-3d-transparent.png";
import { HERO } from "../content";
import { LiquidCta } from "../liquid-cta";
import { ButtonLink, Eyebrow } from "../primitives";
import { useWaitlist } from "../waitlist/context";

/**
 * STUB — owned by workstream A. A legible, server-renderable hero: headline
 * left, the dimensional mark right as the single lit object on true black.
 *
 * The entrance is CSS keyframes (`.ld-enter*`), not motion: the fold must paint
 * before hydration. Keep that property in the final version — the h1, sub and
 * CTAs must be in the SSR HTML and visible without JavaScript.
 */
const delay = (ms: number) => ({ "--enter-delay": `${ms}ms` }) as CSSProperties;

export function Hero() {
  const { open } = useWaitlist();
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div className="ld-bloom left-1/2 top-[-10%] -translate-x-1/4" aria-hidden />
      <div className="ld-grain" aria-hidden />
      <div className="ld-container relative grid min-h-[calc(100svh-4rem)] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-[40rem]">
          <Eyebrow className="ld-enter" style={delay(200)}>
            {HERO.eyebrow}
          </Eyebrow>
          <h1 id="hero-title" className="ld-h1 mt-6">
            {HERO.headline.map((line, i) => (
              <span key={line} className="ld-line">
                <span className="ld-line-inner ld-enter-line" style={delay(260 + i * 60)}>
                  {line}
                </span>
              </span>
            ))}
          </h1>
          <p className="ld-lead ld-enter mt-7 max-w-[34rem]" style={delay(520)}>
            {HERO.sub}
          </p>
          <div className="ld-enter mt-9 flex flex-wrap items-center gap-3" style={delay(640)}>
            <LiquidCta onClick={open}>{HERO.primary}</LiquidCta>
            <ButtonLink href="#loop" variant="secondary">
              {HERO.secondary}
            </ButtonLink>
          </div>
        </div>
        <div className="ld-enter-scale relative mx-auto w-full max-w-[520px]" style={delay(120)}>
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
