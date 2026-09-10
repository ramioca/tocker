"use client";

import { Coins, GitFork, Layers, Shield, TestTube2, ListTree } from "lucide-react";
import { BentoGrid } from "@/components/spectrumui/bento-grid";
import { BentoCard } from "@/components/spectrumui/bento-card";
import { AvatarStack } from "@/components/spectrumui/avatar-stack";
import { MOCK_DATA_SOURCES, MOCK_USERS } from "@/mocks/social";
import { ChainBadge } from "@/components/social-common/chain-badge";

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
          icon={<GitFork className="size-5" aria-hidden />}
          title="Fork anyone's agent"
          description="Public agents ship their whole config. Take the strategy, keep your own key and wallet, change one line, and watch the two diverge."
        >
          <AvatarStack
            items={MOCK_USERS.map((u) => ({ name: u.displayName ?? u.handle }))}
            max={5}
            size="sm"
          />
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
          title="Every run, on the record"
          description="Tool calls, arguments, results, durations, token spend. Nothing about the decision is hidden."
        >
          <ol className="space-y-1.5">
            {["get_portfolio", "query_data_source", "place_trade"].map((name, i) => (
              <li key={name} className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: i === 2 ? "var(--primary)" : "var(--muted-foreground)" }}
                  aria-hidden
                />
                {name}
              </li>
            ))}
          </ol>
        </BentoCard>
      </BentoGrid>
    </section>
  );
}
