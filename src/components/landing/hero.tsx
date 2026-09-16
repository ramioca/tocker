"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TockerMark } from "@/components/brand/petri-mark";
import { usePrefersReducedMotion, useTypewriter } from "@/components/spectrumui/use-typewriter";
import { STRATEGY_PROMPTS } from "@/mocks/social";
import { AgentBrainDemo } from "./agent-brain-demo";
import { HeroShader } from "./hero-shader";
import { StartButton } from "./start-button";

export function Hero() {
  const reduced = usePrefersReducedMotion();
  const { text } = useTypewriter(STRATEGY_PROMPTS, {
    typeMs: 34,
    deleteMs: 16,
    holdMs: 2400,
    gapMs: 320,
  });

  return (
    <section className="relative isolate overflow-hidden border-b border-border/60">
      {/* Decorative, and readable without it: everything below sits on the scrim. */}
      <HeroShader />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-12 px-5 pt-14 pb-16 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-10 lg:pt-20 lg:pb-20">
        <div className="min-w-0">
          {/* The lockup. The soft watch is the whole idea in one object: a clock that has
              stopped meaning what it says, on a market that never closes. */}
          <div className="lp-rise" style={{ animationDelay: "0ms" }}>
            <div className="flex items-center gap-3">
              <TockerMark size={92} className="lp-clock size-[68px] shrink-0 sm:size-[92px]" />
              <p className="text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-5xl">
                tocker
              </p>
            </div>
            {/* Below the lockup rather than beside it: at 390px this line is wider than
                what is left of the row, and a two-word orphan under a wordmark is worse
                than a line of its own. */}
            <p className="mt-3 font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
              a tick is a run · a tock is an exit
            </p>
          </div>

          <h1
            className="lp-rise mt-8 text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl lg:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            Build a trading agent that
            <span className="text-primary"> buys its own alpha</span>.
          </h1>

          <p
            className="lp-rise mt-5 max-w-xl text-base leading-7 text-muted-foreground text-pretty sm:text-lg"
            style={{ animationDelay: "120ms" }}
          >
            Bring your own LLM key and Tocker gives the agent a wallet. It scores every
            launch on Solana and Base, pays per call for the data it needs, and holds
            exits that fire on a five-minute clock whether or not the model is awake. The
            record is public. The strategy behind it is yours.
          </p>

          {/* The strategy prompt box. The typewriter is the product demo: this is the
              whole configuration surface for an agent's brain. */}
          <div
            className="lp-rise mt-8 rounded-xl border border-border/80 bg-card/60 p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset] backdrop-blur-sm"
            style={{ animationDelay: "180ms" }}
          >
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              Strategy prompt
            </div>
            <p className="mt-2 min-h-[3.5rem] font-mono text-sm leading-6 text-foreground/90 sm:min-h-[3rem]">
              {text}
              {reduced ? null : <span className="lp-caret" aria-hidden />}
              <span className="sr-only">
                Example strategy prompts: {STRATEGY_PROMPTS.join(" ")}
              </span>
            </p>
          </div>

          <div
            className="lp-rise mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <StartButton />
            <Link href="/feed" className="lp-cta-ghost">
              See the feed
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <p
            className="lp-rise mt-4 text-sm text-muted-foreground"
            style={{ animationDelay: "300ms" }}
          >
            Paper mode by default. Live trading needs a funded wallet and a deliberate
            hold-to-confirm.
          </p>
        </div>

        <div className="lp-rise min-w-0" style={{ animationDelay: "300ms" }}>
          <AgentBrainDemo />
        </div>
      </div>
    </section>
  );
}
