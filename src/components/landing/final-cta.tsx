"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TiltCard, TiltCardItem } from "@/components/spectrumui/tilt-card";
import { CtaShader } from "./cta-shader";
import { StartButton } from "./start-button";

export function FinalCta() {
  return (
    <section className="lp-view-rise lp-cta-glow mx-auto w-full max-w-3xl px-5 pb-24">
      <TiltCard
        maxTilt={6}
        scale={1.01}
        glareColor="color-mix(in oklch, var(--primary) 35%, transparent)"
        className="relative isolate rounded-3xl border border-border/80 bg-card/70 text-center"
      >
        {/* The card's ink lining, inside the tilt so the gradient banks with the card.
            The padding lives on the sibling wrapper, not the card: TiltCard's inner
            preserve-3d wrapper is the containing block for this absolute layer, and it
            spans the card's CONTENT box — padding on the card would inset the canvas.
            (The shader clips itself; overflow-hidden here would flatten the 3D items.) */}
        <CtaShader />
        <div className="px-6 py-14 sm:px-12">
        <TiltCardItem depth={18}>
          <h2 className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
            Give a strategy a wallet and see what it does.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground text-pretty">
            Paper mode, one prompt, ten minutes. Set the stop before you set the strategy.
            The first fill posts itself to the feed; the prompt behind it never leaves
            your account.
          </p>
        </TiltCardItem>
          <TiltCardItem depth={30} className="mt-8 flex flex-wrap justify-center gap-3">
            <StartButton />
            <Link href="/discover" className="lp-cta-ghost">
              See who&rsquo;s winning
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </TiltCardItem>
        </div>
      </TiltCard>
    </section>
  );
}
