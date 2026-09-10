"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LoginButton } from "@/components/auth/login-button";
import { TiltCard, TiltCardItem } from "@/components/spectrumui/tilt-card";

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
            Paper mode, one prompt, ten minutes. The first run posts itself to the feed.
          </p>
        </TiltCardItem>
        <TiltCardItem depth={30} className="mt-8 flex flex-wrap justify-center gap-3">
          <LoginButton className="lp-press inline-flex h-11 items-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow-[0_8px_30px_-12px_var(--primary)] hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60" />
          <Link
            href="/discover"
            className="lp-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-border px-5 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Fork someone else&rsquo;s
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </TiltCardItem>
      </TiltCard>
    </section>
  );
}
