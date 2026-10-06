import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { ChainBadge } from "@/components/common/chain-badge";
import { modelLabel } from "@/components/social-common/chain-badge";
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
import { THINK_SOURCE_LABELS, payPerUseModelLabel, stepsAllowed } from "@/components/agents/thinking";
import { thinkSource } from "@/lib/agent/inference";
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
  editHref,
  children,
  className,
}: {
  title: string;
  /** Where Settings edits this part, when the page gave us an agent to link into. */
  editHref?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {editHref ? (
          <Link
            href={editHref}
            aria-label={`Edit ${title.toLowerCase()} in Settings`}
            className="relative rounded text-[11px] text-muted-foreground underline-offset-2 transition-colors duration-150 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-foreground hover:underline focus-ring"
          >
            Edit
          </Link>
        ) : null}
      </div>
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
  sourceNames,
  agentSlug,
  className,
}: {
  config: AgentConfig | null;
  /**
   * Display names for the ids the source catalog still carries, resolved by the page:
   * the registry reaches the database, and this module is imported by client code for
   * `intervalLabel`. An id missing from it is one the run loop drops.
   */
  sourceNames?: Readonly<Record<string, string>>;
  /** Links each section to the part of Settings that changes it. */
  agentSlug?: string;
  className?: string;
}) {
  if (!config) return null;

  // Anchors on the settings form. The universe rules (feeds, the bar, authorities and
  // the blocklist) are all one section there.
  const edit = (anchor: string) => (agentSlug ? `/agents/${agentSlug}/settings#${anchor}` : undefined);
  const dataHref = edit("data");

  const { universe } = config;
  // An agent that pays for its own thinking uses no key: its provider and key model are
  // left over from before and would name a model that is not doing the thinking.
  const usdc = thinkSource(config) === "usdc" ? (config.llm.usdc ?? null) : null;
  const verdict = verdictForScore(universe.minScore);
  const feeds = DISCOVERY_FEEDS.filter((feed) => universe.discovery.includes(feed.id));

  return (
    <div className={cn("glass-panel space-y-5 rounded-2xl p-4 sm:p-5", className)}>
      <Section title="Strategy" editHref={edit("strategy")}>
        <p className="mt-2 glass-inset rounded-xl p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground/85">
          {config.strategyPrompt}
        </p>
      </Section>

      {/* ----------------------------------------------------- hunting ground */}
      <Section title="Hunting ground" editHref={edit("universe")}>
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

      {/* Side by side from sm up, like Brain and Risk below: at full width a label and
          its value sat 900px apart. */}
      <div className="grid gap-5 sm:grid-cols-2">
        {/* ---------------------------------------------------------- the bar */}
        <Section title="The bar" editHref={edit("universe")}>
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
        <Section title="Non-negotiables" editHref={edit("universe")}>
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
      </div>

      {/* ---------------------------------------------------------- blocklist */}
      <Section title="Blocklist" editHref={edit("universe")}>
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
        <Section title="Brain &amp; schedule" editHref={edit("brain")}>
          <dl className="mt-1">
            {usdc ? (
              <>
                <Row label="Thinking">{THINK_SOURCE_LABELS.usdc}</Row>
                <Row label="Model">
                  <span title={usdc.model}>{payPerUseModelLabel(usdc.model)}</span>
                </Row>
                <Row label="Thinking limit">
                  <span className="tnum">
                    {formatUsd(usdc.maxUsdPerRun)} / run · {formatUsd(usdc.maxUsdPerDay)} / day
                  </span>
                </Row>
              </>
            ) : (
              <>
                <Row label="Provider">
                  <span className="capitalize">{config.llm.provider}</span>
                </Row>
                {/* The name the header prints; the exact id is one hover away. */}
                <Row label="Model">
                  <span title={config.llm.model}>{modelLabel(config.llm.model)}</span>
                </Row>
              </>
            )}
            <Row label="Temperature">
              <span className="tnum">{config.llm.temperature}</span>
            </Row>
            <Row label="Max steps per run">
              {/* What a run is really held to: pay-per-use stops sooner than the setting allows. */}
              <span className="tnum">{stepsAllowed(config.llm.maxSteps, usdc ? "usdc" : "key")}</span>
            </Row>
            <Row label="Schedule">{intervalLabel(config.schedule.intervalMinutes)}</Row>
          </dl>
        </Section>

        <Section title="Risk" editHref={edit("risk")}>
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

      <Section title="Data sources" editHref={dataHref}>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {config.dataSources.length === 0 ? (
            <li className="text-sm text-muted-foreground">None — it scores on free data alone.</li>
          ) : (
            // The source's own name, as Discover prints it; the id is what the transcript
            // quotes, so it stays one hover away. An id the catalog no longer carries is
            // dropped by the run loop, so it says so rather than posing as a live source.
            config.dataSources.map((source) => {
              const name = sourceNames && Object.hasOwn(sourceNames, source) ? sourceNames[source] : undefined;
              const retired = sourceNames !== undefined && name === undefined;
              return (
                <li
                  key={source}
                  title={retired ? `${source} is no longer in the catalog; runs skip it.` : source}
                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs"
                >
                  {name ?? source}
                  {retired ? (
                    <>
                      <span className="text-muted-foreground"> · retired</span>
                      {dataHref ? (
                        <>
                          <span className="text-muted-foreground"> · </span>
                          <Link
                            href={dataHref}
                            aria-label={`Remove ${source} in Settings`}
                            className="rounded text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-ring"
                          >
                            remove
                          </Link>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })
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
