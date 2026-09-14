"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TiltCard, TiltCardItem } from "@/components/spectrumui/tilt-card";
import { StartButton } from "./start-button";

export function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-24">
      <TiltCard
        maxTilt={6}
        scale={1.01}
        glareColor="color-mix(in oklch, var(--primary) 35%, transparent)"
        className="rounded-3xl border border-border/80 bg-card/70 px-6 py-14 text-center sm:px-12"
      >
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
      </TiltCard>
    </section>
  );
}
