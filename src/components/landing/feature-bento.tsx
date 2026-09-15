"use client";

import {
  Coins,
  Lock,
  Gauge,
  Shield,
  TestTube2,
  Radar,
  TimerReset,
  Handshake,
  LineChart,
} from "lucide-react";
import { BentoGrid } from "@/components/spectrumui/bento-grid";
import { BentoCard } from "@/components/spectrumui/bento-card";
import { AvatarStack } from "@/components/spectrumui/avatar-stack";
import { MOCK_USERS } from "@/mocks/social";
import { ChainBadge } from "@/components/social-common/chain-badge";

/** The split, in the order it matters: what the crowd gets, what stays with the author. */
const PUBLIC_SIDE = ["Every fill, with its score", "PnL and equity curve", "The one-line reason"];
const PRIVATE_SIDE = ["The strategy prompt", "Universe rules and thresholds", "The run transcript"];

/** The six rules in `src/lib/trading/exits.ts`, highest priority first. */
const EXIT_RULES = [
  { rule: "stop_loss", detail: "−12% from entry" },
  { rule: "take_profit", detail: "+40%" },
  { rule: "trailing_stop", detail: "−18% off peak" },
  { rule: "max_hold", detail: "36h" },
  { rule: "score_collapse", detail: "score < 45" },
  { rule: "liquidity_collapse", detail: "depth −60%" },
];

/**
 * Four of the sixteen paid endpoints in `src/lib/data-sources/registry.ts`, with the
 * prices the runtime actually pays. The full list scrolls past in the strip above.
 */
const PAID_SOURCES = [
  { name: "Nansen smart money", price: "$0.05" },
  { name: "Plexa sell simulation", price: "$0.05" },
  { name: "DripMetrics microstructure", price: "$0.25" },
  { name: "gate402 Base radar", price: "$0.02" },
];

export function FeatureBento() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 lg:py-28">
      <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
        Everything an autonomous trader needs
      </h2>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Not a backtest toy. A wallet, a budget, a risk envelope, exits that do not need
        permission, and an audit trail.
      </p>

      <BentoGrid className="lp-view-rise mt-12 max-w-none">
        <BentoCard
          colSpan={2}
          icon={<TimerReset className="size-5" aria-hidden />}
          title="Exits that do not wait for the model"
          description="Stops and targets are code, not prompt guidance. Six rules run every five minutes and before every run, on fresh marks. One decision per position, always the full position, and a rationale published to the feed verbatim."
        >
          {/* One column until there is room for two: at 390px a two-up grid truncates
              `liquidity_collapse` to `liqui…`, which reads as a bug. */}
          <ul className="grid gap-1.5 min-[420px]:grid-cols-2">
            {EXIT_RULES.map(({ rule, detail }) => (
              <li
                key={rule}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[11px]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="truncate text-foreground/80">{rule}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            A score that comes back low-confidence because a provider is down never
            triggers an exit.
          </p>
        </BentoCard>

        <BentoCard
          icon={<Handshake className="size-5" aria-hidden />}
          title="Ask me first"
          description="Approval mode: the agent scores, sizes and explains the trade, then waits for you. Approving re-quotes first. Exits are never held for approval."
        >
          <div className="space-y-1.5 font-mono text-[11px]">
            <div className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-foreground/85">
              buy $PLNK · $120 · score 81
            </div>
            <div className="flex gap-1.5">
              <span className="flex-1 rounded-md bg-primary/90 px-2 py-1 text-center text-primary-foreground">
                approve
              </span>
              <span className="flex-1 rounded-md border border-border px-2 py-1 text-center text-muted-foreground">
                reject
              </span>
            </div>
          </div>
        </BentoCard>

        <BentoCard
          icon={<TestTube2 className="size-5" aria-hidden />}
          title="Paper first"
          description="Real quotes, simulated fills, honest PnL. Going live takes a funded wallet and a press-and-hold."
        />

        <BentoCard
          colSpan={2}
          icon={<Coins className="size-5" aria-hidden />}
          title="Sixteen feeds it pays for itself"
          description="Smart-money netflow, a live sell simulation that can veto a buy outright, BTC/ETH/SOL microstructure, launch radars on both chains. Your agent pays per call in USDC over x402 — no keys, no subscriptions — and every payment is receipted against a per-run cap."
        >
          <ul className="space-y-1.5">
            {PAID_SOURCES.map((source) => (
              <li
                key={source.name}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[11px]"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="truncate text-foreground/80">{source.name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {source.price}
                </span>
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard
          icon={<Radar className="size-5" aria-hidden />}
          title="No allowlist, ever"
          description="Any token on the agent's chains, including one minted an hour ago, if it clears the hard gates and your score floor. The only list is a blocklist."
        >
          <div className="flex flex-wrap gap-1.5">
            <ChainBadge chain="solana" />
            <ChainBadge chain="base" />
          </div>
        </BentoCard>

        <BentoCard
          icon={<Gauge className="size-5" aria-hidden />}
          title="A page for every token"
          description="The score broken down, the gates it passed, 30 days of history, who holds it — and one click to block it."
        >
          <div className="space-y-2">
            {[
              { label: "safety", value: "28/30", pct: 93 },
              { label: "liquidity", value: "16/20", pct: 80 },
              { label: "organic", value: "13/20", pct: 65 },
            ].map((row) => (
              <div key={row.label} className="font-mono text-[10px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="tabular-nums text-foreground/80">{row.value}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </BentoCard>

        <BentoCard
          colSpan={2}
          icon={<Lock className="size-5" aria-hidden />}
          title="Nobody can copy your edge"
          description="Publish the record, keep the recipe. There is no fork button on Tocker, and no screen anywhere that shows another operator's prompt, thresholds, data sources or transcript. It is enforced on the server: the strategy is simply not in the payload your browser receives."
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Public
              </p>
              <ul className="mt-1.5 space-y-1">
                {PUBLIC_SIDE.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1.5 text-[11px] leading-4 text-foreground/80"
                  >
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Yours alone
              </p>
              <ul className="mt-1.5 space-y-1">
                {PRIVATE_SIDE.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"
                  >
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
          description="Trade size, daily count, concentration, slippage, data budget — checked before every order, outside the model's reach. None of it can block a sell."
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
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </BentoCard>

        <BentoCard
          icon={<LineChart className="size-5" aria-hidden />}
          title="Is your score floor right?"
          description="The Performance tab answers it: PnL, win rate, average hold, drawdown, and the average return of every entry-score band."
        >
          <ol className="space-y-1.5">
            {[
              { band: "score 80+", value: "+14.2%" },
              { band: "score 70–79", value: "+3.1%" },
              { band: "score 60–69", value: "−6.8%" },
            ].map((row) => (
              <li
                key={row.band}
                className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"
              >
                <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                {row.band}
                <span className="ml-auto tabular-nums text-foreground/80">{row.value}</span>
              </li>
            ))}
          </ol>
        </BentoCard>
      </BentoGrid>
    </section>
  );
}
