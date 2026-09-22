"use client";

/**
 * The five numbers and the badge row that decide a proposal.
 *
 * One component, two surfaces: the agent page's card and the first-live-trade wizard's
 * panel both mount this, so the operator learns the layout once and the two screens can
 * never quietly disagree about what a token looks like.
 *
 * The rules it is built on:
 *
 * - **Five cells, always five cells.** Every cell renders label + one line, and a
 *   missing number is `—`. Three cards side by side keep their strips on the same
 *   baseline, which is the whole point of the compare view: you read *across*.
 * - **Never zero for absent.** A token nobody has priced has no buyers, no reserve and
 *   no GT Score — and `0` would read as a fact about the token rather than about us.
 * - **Green and red stay spoken for.** PnL owns them. Direction hints borrow them
 *   because a price move *is* PnL; safety badges use the score vocabulary's cyan and
 *   the blocker amber instead.
 */
import { Ban, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react";
import { Sparkline } from "@/components/common/sparkline";
import { formatCount, formatPriceUsd, formatSignedPct } from "@/components/common/format";
import { pnlTone } from "@/components/common/pnl-text";
import { describeBlocker } from "@/components/tokens/blocker-list";
import { formatCompactUsd } from "@/components/tokens/format";
import { VERDICT_META, effectiveVerdict, verdictTint } from "@/components/tokens/verdict";
import { cn } from "@/lib/utils";
import type { ProposalSafety, ProposalStats, TradeScore } from "@/server/types";
import {
  TREND_GLYPH,
  TREND_LABEL,
  buyersTrend,
  countdownProgress,
  countdownTone,
  deriveSafety,
  formatAgeMinutes,
  formatCountdown,
  reserveTrend,
} from "./proposal-stats";

/** The score vocabulary's "clears every gate" cyan. Never the PnL green. */
const GOOD = "oklch(0.68 0.13 215)";
/** The blocker amber the token surfaces already use. Never the PnL red. */
const BLOCKER = "oklch(0.7 0.16 45)";
/** "We could not check" — the same amber as a score warning. */
const UNKNOWN = "oklch(0.72 0.145 75)";
/** Top-10 concentration at or above this wears the warning tint. */
const TOP10_WARN_PCT = 25;

// ---------------------------------------------------------------- stat strip

export function ProposalStatStrip({
  stats,
  score,
  className,
}: {
  stats: ProposalStats;
  /** The frozen snapshot, for the composite cell. Null on a legacy row. */
  score: TradeScore | null;
  className?: string;
}) {
  const trend = buyersTrend(stats.buyers5m, stats.buyersH1);
  const move = reserveTrend(stats);
  const verdict = score ? (score.verdict ?? effectiveVerdict(score.total, score.blockers)) : null;
  const meta = verdict ? VERDICT_META[verdict] : null;

  return (
    <dl
      className={cn(
        "grid grid-cols-3 gap-x-3 gap-y-2.5 sm:grid-cols-5",
        className,
      )}
    >
      <Cell label="Age" title={stats.ageMinutes === null ? "No pool has been dated yet" : undefined}>
        {formatAgeMinutes(stats.ageMinutes)}
      </Cell>

      <Cell
        label="Buyers 5m"
        title={
          trend === null
            ? "No hourly count to compare against"
            : `${stats.buyers5m ?? "—"} in five minutes · ${stats.buyersH1 ?? "—"} in the hour — ${TREND_LABEL[trend]}`
        }
      >
        {stats.buyers5m === null ? (
          "—"
        ) : (
          <>
            {formatCount(stats.buyers5m)}
            {trend ? (
              <span
                aria-hidden
                className={cn(
                  "ml-1 text-[11px]",
                  trend === "up" ? "text-positive" : trend === "down" ? "text-negative" : "text-muted-foreground",
                )}
              >
                {TREND_GLYPH[trend]}
              </span>
            ) : null}
          </>
        )}
      </Cell>

      <Cell label="Reserve" title={move ? `Price ${formatSignedPct(move.pct, 1)} over ${move.window}` : undefined}>
        {stats.reserveUsd === null ? (
          "—"
        ) : (
          <>
            {formatCompactUsd(stats.reserveUsd)}
            {move ? (
              <span className={cn("ml-1 text-[10px]", pnlTone(move.pct))}>
                {formatSignedPct(move.pct, 0)}
                <span className="ml-0.5 opacity-60">{move.window}</span>
              </span>
            ) : null}
          </>
        )}
      </Cell>

      <Cell label="GT Score" title="GeckoTerminal's own 0-100 read on the token">
        {stats.gtScore === null ? "—" : Math.round(stats.gtScore)}
      </Cell>

      <Cell label="Score" title={meta ? `${meta.label} — ${meta.meaning}` : "This trade carries no score snapshot"}>
        {score === null || meta === null ? (
          "—"
        ) : (
          <>
            <span style={{ color: meta.color }}>{Math.round(score.total)}</span>
            <span className="ml-1 font-sans text-[10px] text-muted-foreground">{meta.label}</span>
          </>
        )}
      </Cell>
    </dl>
  );
}

function Cell({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tnum mt-0.5 truncate font-mono text-xs text-foreground/90">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- price line

/** The quoted price with its recent shape beside it. */
export function PriceLine({
  priceUsd,
  symbol,
  sparkline,
  className,
}: {
  priceUsd: number | null;
  symbol: string;
  sparkline: readonly number[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="tnum min-w-0 truncate font-mono text-xs text-muted-foreground">
        <span className="text-foreground/90">{formatPriceUsd(priceUsd)}</span>
        <span className="ml-1">/ {symbol}</span>
      </span>
      <Sparkline points={sparkline} label={`${symbol} price`} />
    </div>
  );
}

// ---------------------------------------------------------------- badges

export function SafetyBadges({
  safety,
  /** How many warnings to spell out before collapsing the rest into a count. */
  maxWarnings = 2,
  className,
}: {
  safety: ProposalSafety;
  maxWarnings?: number;
  className?: string;
}) {
  const { authoritiesRevoked, top10Pct, blockers, warnings } = safety;
  const shownWarnings = warnings.slice(0, maxWarnings);
  const hiddenWarnings = warnings.length - shownWarnings.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {authoritiesRevoked === true ? (
        <Badge color={GOOD} icon={ShieldCheck} title="Mint and freeze authorities were confirmed revoked when the agent scored it">
          Authorities revoked
        </Badge>
      ) : authoritiesRevoked === false ? (
        <Badge color={BLOCKER} icon={Ban} title="An authority was still live when the agent scored it">
          Authority live
        </Badge>
      ) : (
        <Badge color={UNKNOWN} icon={ShieldQuestion} title="No provider could confirm the authorities either way">
          Authority unknown
        </Badge>
      )}

      {top10Pct === null ? null : (
        <Badge
          color={top10Pct >= TOP10_WARN_PCT ? UNKNOWN : undefined}
          title="Share of supply held by the ten largest wallets"
        >
          <span className="tnum">Top-10 {Math.round(top10Pct)}%</span>
        </Badge>
      )}

      {blockers.length === 0 ? (
        <Badge color={GOOD} title="It cleared every hard gate in this agent's universe">
          No blockers
        </Badge>
      ) : (
        blockers.map((code) => (
          <Badge key={code} color={BLOCKER} icon={Ban} title={describeBlocker(code).detail}>
            {describeBlocker(code).title}
          </Badge>
        ))
      )}

      {shownWarnings.map((code) => (
        <Badge key={code} dim icon={TriangleAlert} title={describeBlocker(code).detail}>
          {describeBlocker(code).title}
        </Badge>
      ))}
      {hiddenWarnings > 0 ? (
        <span className="tnum text-[10px] text-muted-foreground">+{hiddenWarnings} more</span>
      ) : null}
    </div>
  );
}

function Badge({
  children,
  color,
  icon: Icon,
  dim = false,
  title,
}: {
  children: React.ReactNode;
  color?: string;
  icon?: typeof Ban;
  /** Warnings are present but recede — they are not why you would say no. */
  dim?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-4",
        dim ? "border-border/60 text-muted-foreground/70" : "border-border/70 text-muted-foreground",
      )}
      style={
        color
          ? { color, borderColor: verdictTint(color, 32), backgroundColor: verdictTint(color, 8) }
          : undefined
      }
    >
      {Icon ? <Icon aria-hidden className="size-2.5 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The panel gets its badges from the trade's own snapshot, so it derives them here. */
export function SnapshotBadges({ score, className }: { score: TradeScore | null; className?: string }) {
  return <SafetyBadges safety={deriveSafety(score)} className={className} />;
}

// ---------------------------------------------------------------- countdown

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * The clock, as a ring that empties.
 *
 * A five-minute TTL is short enough that a number alone under-reads — the ring is the
 * part you catch from across the card. It goes amber with two minutes left, which is
 * about the time it takes to look a token up, and the sweep itself transitions
 * linearly over exactly the second between ticks so it glides instead of stepping.
 */
export function CountdownPill({
  msRemaining,
  ttlMs,
  className,
}: {
  msRemaining: number;
  /** The full proposal TTL, so the ring shows a fraction and not just a number. */
  ttlMs: number;
  className?: string;
}) {
  const tone = countdownTone(msRemaining);
  const progress = countdownProgress(msRemaining, ttlMs);
  const color =
    tone === "expired" ? "var(--destructive)" : tone === "urgent" ? "oklch(0.8 0.15 75)" : "var(--muted-foreground)";

  return (
    <span
      className={cn("tnum inline-flex items-center gap-1.5 font-mono text-xs", className)}
      style={{ color }}
      title={tone === "expired" ? "This proposal has expired" : "Time left to decide"}
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
        />
      </svg>
      {formatCountdown(msRemaining)}
    </span>
  );
}
