import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import {
  VERDICT_META,
  formatCompactUsd,
  formatHolders,
  formatHours,
  formatMinutes,
  verdictForScore,
} from "@/components/tokens";
import { DISCOVERY_FEEDS } from "@/components/agents/builder/types";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function intervalLabel(minutes: number): string {
  if (minutes === 0) return "Manual only";
  if (minutes < 60) return `Every ${minutes} min`;
  if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
  return `Every ${minutes} min`;
}

/**
 * The config as an owner reads it back.
 *
 * This is the operator's IP — the universe rules, the bar and the prompt are the
 * whole recipe — so it is rendered only when the viewer owns the agent. The
 * caller decides that (`AgentDetail.config` is `null` for everyone else); this
 * component simply refuses to render without a config rather than inventing one.
 */
export function AgentConfigSummary({
  config,
  className,
}: {
  config: AgentConfig | null;
  className?: string;
}) {
  if (!config) return null;

  const { universe } = config;
  const verdict = verdictForScore(universe.minScore);
  const feeds = DISCOVERY_FEEDS.filter((feed) => universe.discovery.includes(feed.id));

  return (
    <div className={cn("space-y-5", className)}>
      <Section title="Strategy">
        <p className="mt-2 glass-inset rounded-xl p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
          {config.strategyPrompt}
        </p>
      </Section>

      {/* ----------------------------------------------------- hunting ground */}
      <Section title="Hunting ground">
        <div className="mt-2 flex flex-wrap gap-1.5">
          {config.chains.map((chain) => (
            <ChainBadge key={chain} chain={chain} />
          ))}
        </div>
        <ul className="mt-2 space-y-1.5">
          {feeds.map((feed) => (
            <li
              key={feed.id}
              className="glass-inset rounded-lg px-2.5 py-1.5"
            >
              <p className="text-xs font-medium">{feed.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {feed.description}
              </p>
            </li>
          ))}
          {feeds.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              No discovery feeds — it will never see a candidate.
            </li>
          ) : null}
        </ul>
      </Section>

      {/* ---------------------------------------------------------- the bar */}
      <Section title="The bar">
        <div className="mt-2 flex items-center gap-2.5 glass-inset rounded-xl px-3 py-2.5">
          <ScoreBadge total={universe.minScore} verdict={verdict} size="md" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nothing below {Math.round(universe.minScore)} is eligible —{" "}
            {VERDICT_META[verdict].label.toLowerCase()} and up.
          </p>
        </div>

        <dl className="mt-1">
          <Row label="Minimum liquidity">
            <span className="tnum">{formatCompactUsd(universe.minLiquidityUsd)}</span>
          </Row>
          <Row label="Minimum holders">
            <span className="tnum">
              {universe.minHolderCount === 0 ? "Any" : formatHolders(universe.minHolderCount)}
            </span>
          </Row>
          <Row label="Age window">
            <span className="tnum">
              {universe.minAgeMinutes === 0
                ? "From birth"
                : `From ${formatMinutes(universe.minAgeMinutes)}`}
              {" · "}
              {universe.maxAgeHours === null ? "no ceiling" : `up to ${formatHours(universe.maxAgeHours)}`}
            </span>
          </Row>
          <Row label="Top-10 wallet share">
            <span className="tnum">under {Math.round(universe.maxTop10HolderPct)}%</span>
          </Row>
          <Row label="Buy tax">
            <span className="tnum">under {Math.round(universe.maxBuyTaxPct)}%</span>
          </Row>
        </dl>
      </Section>

      {/* ------------------------------------------------- non-negotiables */}
      <Section title="Non-negotiables">
        <ul className="mt-2 space-y-1.5">
          <Authority
            on={universe.requireMintRevoked}
            onLabel="Mint authority must be revoked"
            offLabel="Mint authority may still be live — the deployer can print supply"
          />
          <Authority
            on={universe.requireFreezeRevoked}
            onLabel="Freeze authority must be revoked"
            offLabel="Freeze authority may still be live — the agent could be stopped from selling"
          />
        </ul>
      </Section>

      {/* ---------------------------------------------------------- blocklist */}
      <Section title="Blocklist">
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {universe.blocklist.length === 0 ? (
            <li className="text-sm text-muted-foreground">
              Empty. Everything else on its chains is fair game if it clears the bar.
            </li>
          ) : (
            universe.blocklist.map((entry) => (
              <li
                key={`${entry.chain}:${entry.address}`}
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium"
                title={`${entry.chain} · ${entry.address}`}
              >
                {entry.symbol}
              </li>
            ))
          )}
        </ul>
      </Section>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="Brain &amp; schedule">
          <dl className="mt-1">
            <Row label="Provider">
              <span className="capitalize">{config.llm.provider}</span>
            </Row>
            <Row label="Model">
              <span className="font-mono text-xs">{config.llm.model}</span>
            </Row>
            <Row label="Temperature">
              <span className="tnum">{config.llm.temperature}</span>
            </Row>
            <Row label="Max steps per run">
              <span className="tnum">{config.llm.maxSteps}</span>
            </Row>
            <Row label="Schedule">{intervalLabel(config.schedule.intervalMinutes)}</Row>
          </dl>
        </Section>

        <Section title="Risk">
          <dl className="mt-1">
            <Row label="Max per trade">
              <span className="tnum">{formatUsd(config.risk.maxTradeUsd)}</span>
            </Row>
            <Row label="Max trades / day">
              <span className="tnum">{config.risk.maxDailyTrades}</span>
            </Row>
            <Row label="Max position size">
              <span className="tnum">{config.risk.maxPositionPct}% of equity</span>
            </Row>
            <Row label="Data spend cap">
              <span className="tnum">{formatUsd(config.risk.maxDataSpendUsdPerRun)} / run</span>
            </Row>
            <Row label="Stop / take profit">
              <span className="tnum">
                {config.risk.stopLossPct === null ? "—" : `−${config.risk.stopLossPct}%`} /{" "}
                {config.risk.takeProfitPct === null ? "—" : `+${config.risk.takeProfitPct}%`}
              </span>
            </Row>
            <Row label="Slippage">
              <span className="tnum">{config.risk.slippageBps} bps</span>
            </Row>
          </dl>
        </Section>
      </div>

      <Section title="Data sources">
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {config.dataSources.length === 0 ? (
            <li className="text-sm text-muted-foreground">None — it scores on free data alone.</li>
          ) : (
            config.dataSources.map((source) => (
              <li
                key={source}
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px]"
              >
                {source}
              </li>
            ))
          )}
        </ul>
      </Section>
    </div>
  );
}

function Authority({
  on,
  onLabel,
  offLabel,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
}) {
  const warn = "oklch(0.72 0.145 75)";
  const Icon = on ? ShieldCheck : ShieldAlert;
  return (
    <li
      className="flex items-start gap-2 rounded-lg border px-2.5 py-1.5"
      style={
        on
          ? { borderColor: "var(--border)" }
          : {
              borderColor: `color-mix(in oklab, ${warn} 45%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${warn} 7%, transparent)`,
            }
      }
    >
      <Icon
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0"
        style={{ color: on ? "var(--primary)" : warn }}
      />
      <span className="text-xs leading-relaxed" style={on ? undefined : { color: warn }}>
        {on ? onLabel : offLabel}
      </span>
    </li>
  );
}
