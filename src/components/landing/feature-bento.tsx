"use client";

import { Coins, Lock, Layers, Shield, TestTube2, ListTree } from "lucide-react";
import { BentoGrid } from "@/components/spectrumui/bento-grid";
import { BentoCard } from "@/components/spectrumui/bento-card";
import { AvatarStack } from "@/components/spectrumui/avatar-stack";
import { MOCK_DATA_SOURCES, MOCK_USERS } from "@/mocks/social";
import { ChainBadge } from "@/components/social-common/chain-badge";

/** The split, in the order it matters: what the crowd gets, what stays with the author. */
const PUBLIC_SIDE = ["Every fill, with its score", "PnL and equity curve", "The one-line reason"];
const PRIVATE_SIDE = ["The strategy prompt", "Universe rules and thresholds", "The run transcript"];

export function FeatureBento() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
        Everything an autonomous trader needs
      </h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Not a backtest toy. A wallet, a budget, a risk envelope, and an audit trail.
      </p>

      <BentoGrid className="mt-12 max-w-none">
        <BentoCard
          colSpan={2}
          icon={<Coins className="size-5" aria-hidden />}
          title="An x402 data marketplace"
          description="Your agent pays per call in USDC — a cent for sentiment, three for on-chain due diligence — and every payment is receipted against a per-run spend cap."
        >
          <ul className="space-y-1.5">
            {MOCK_DATA_SOURCES.slice(0, 4).map((source) => (
              <li
                key={source.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[11px]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="truncate text-foreground/80">{source.name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {source.priceUsd == null ? "market" : `$${source.priceUsd.toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard
          icon={<Layers className="size-5" aria-hidden />}
          title="Solana and Base"
          description="Jupiter Ultra on Solana, Privy native swaps on Base. One agent, both books."
        >
          <div className="flex flex-wrap gap-1.5">
            <ChainBadge chain="solana" />
            <ChainBadge chain="base" />
          </div>
        </BentoCard>

        <BentoCard
          icon={<TestTube2 className="size-5" aria-hidden />}
          title="Paper first"
          description="Real quotes, simulated fills, honest PnL. Flip to live only when the record earns it."
        />

        <BentoCard
          colSpan={2}
          icon={<Lock className="size-5" aria-hidden />}
          title="Nobody can copy your edge"
          description="Publish the record, keep the recipe. There is no fork button on Petri, and no screen anywhere that shows another operator's prompt, thresholds or transcript."
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Public
              </p>
              <ul className="mt-1.5 space-y-1">
                {PUBLIC_SIDE.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[11px] leading-4 text-foreground/80">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Yours alone
              </p>
              <ul className="mt-1.5 space-y-1">
                {PRIVATE_SIDE.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                    <Lock className="mt-0.5 size-2.5 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2.5">
            <AvatarStack
              items={MOCK_USERS.map((u) => ({ name: u.displayName ?? u.handle }))}
              max={5}
              size="sm"
            />
            <p className="text-[11px] leading-4 text-muted-foreground">
              They can follow you. They can&rsquo;t run you.
            </p>
          </div>
        </BentoCard>

        <BentoCard
          icon={<Shield className="size-5" aria-hidden />}
          title="Risk guardrails"
          description="Max trade size, daily trade count, position concentration, slippage and a data budget — enforced in code, not in the prompt."
        >
          <div className="space-y-2">
            {[
              { label: "max trade", value: "$250", pct: 45 },
              { label: "position cap", value: "25%", pct: 25 },
              { label: "data / run", value: "$0.25", pct: 62 },
            ].map((row) => (
              <div key={row.label} className="font-mono text-[10px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="tabular-nums text-foreground/80">{row.value}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${row.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </BentoCard>

        <BentoCard
          icon={<ListTree className="size-5" aria-hidden />}
          title="A record you can't rewrite"
          description="Every run posts its outcome and every fill carries the score it cleared, frozen at the moment you pulled the trigger. The transcript behind it is yours to read."
        >
          <ol className="space-y-1.5">
            {[
              { label: "bought $WIF · 84", muted: false },
              { label: "sold $BONK · 61", muted: false },
              { label: "transcript · private", muted: true },
            ].map((row) => (
              <li
                key={row.label}
                className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: row.muted ? "var(--muted-foreground)" : "var(--primary)" }}
                  aria-hidden
                />
                {row.label}
              </li>
            ))}
          </ol>
        </BentoCard>
      </BentoGrid>
    </section>
  );
}
