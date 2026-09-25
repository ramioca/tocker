import Link from "next/link";
import { ArrowRight, Coins, FlaskConical, Layers, Wallet } from "lucide-react";
import { Sparkline } from "@/components/social-common/sparkline";
import { PnlText } from "@/components/common/pnl-text";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd, truncateAddress } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { HomeOverview } from "@/server/queries/home";

/**
 * The one number the page exists for, and the three that explain it.
 *
 * This is a `.glass-panel` — a page module, blurred, one of two on the page. The
 * wells inside it are `.glass-inset`, which by construction carry no
 * backdrop-filter, so nothing here nests a blur inside a blur.
 *
 * Server component: nothing moves, nothing tracks the pointer. An equity number
 * that animates on every navigation would be a lie about what changed.
 */

function Well({
  icon: Icon,
  label,
  children,
  footnote,
  className,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-inset rounded-xl px-3.5 py-3", className)}>
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon aria-hidden className="size-3" />
        {label}
      </p>
      <p className="tnum mt-1.5 text-base font-medium">{children}</p>
      {footnote ? (
        <p className="tnum mt-0.5 text-[11px] leading-4 text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}

const SPAN_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function spanDate(iso: string): string {
  return SPAN_DATE.format(new Date(iso));
}

export function PortfolioHero({ overview }: { overview: HomeOverview }) {
  const { cashUsd, allocatedUsd, cashByWallet, hasWallets, counts, paper } = overview;

  // Real money and paper are never added together. An account with nothing real yet —
  // no live agent, no cash — leads with its paper book, labelled as such, rather than a
  // bare $0.00; everyone else leads with real money and sees paper in its own well.
  const paperOnly = counts.live === 0 && cashUsd === 0 && counts.paper > 0;
  const book = paperOnly
    ? paper
    : {
        equityUsd: overview.totalEquityUsd,
        pnlUsd: overview.pnlUsd,
        pnlPct: overview.pnlPct,
        realizedPnlUsd: overview.realizedPnlUsd,
        unrealizedPnlUsd: overview.unrealizedPnlUsd,
        sparkline: overview.sparkline,
      };
  const showPaperWell = !paperOnly && counts.paper > 0;

  const points = book.sparkline.map((p) => p.equityUsd);
  // Scale against what was put in, not just the curve's own range: a $20 move on a
  // $10k book should look like $20, not like the whole height of the card.
  const basis = book.equityUsd - book.pnlUsd;
  const lo = Math.min(basis, ...points);
  const hi = Math.max(basis, ...points);
  const padUsd = (hi - lo) * 0.05 || 1;
  // The series is whatever snapshots exist, not a fixed window, so the caption names
  // its real ends rather than promising "30 days". UTC, as every other date on the book.
  const range =
    book.sparkline.length > 1
      ? `${spanDate(book.sparkline[0].at)} – ${spanDate(book.sparkline[book.sparkline.length - 1].at)}`
      : null;

  return (
    <section
      aria-labelledby="portfolio-heading"
      className="glass-panel glass-grain overflow-hidden rounded-2xl"
    >
      {/* header row: title, meta, one action */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2
            id="portfolio-heading"
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {paperOnly ? "Paper equity" : "Total equity"}
            {/* Hidden from the heading's name, which already says "Paper equity". */}
            {paperOnly ? (
              <span aria-hidden className="inline-flex">
                <ModeBadge mode="paper" size="xs" />
              </span>
            ) : null}
          </h2>
          <p className="tnum mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {formatUsd(book.equityUsd)}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <PnlText usd={book.pnlUsd} pct={book.pnlPct} size="sm" />
            <span className="text-xs text-muted-foreground">
              {paperOnly ? "all time, paper agents (simulated)" : "all time, live agents"}
            </span>
          </p>
        </div>

        <Link
          href="/agents"
          className="focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--glass-hairline)] px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 active:scale-[0.97]"
        >
          Manage agents
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {/* body: the shape of the story, full-bleed under the number */}
      <div className="mt-4 px-2 sm:px-3">
        {points.length > 1 ? (
          <Sparkline
            id="home-equity"
            points={points}
            domain={[lo - padUsd, hi + padUsd]}
            pnl={book.pnlUsd}
            width={1200}
            height={96}
            stretch
            className="h-20 w-full sm:h-24"
          />
        ) : (
          <div className="mx-3 flex h-20 items-center justify-center rounded-xl border border-dashed border-[var(--glass-hairline)] px-4 text-center text-xs text-muted-foreground sm:h-24">
            {counts.total === 0
              ? "The curve starts the moment your first agent takes a snapshot."
              : !paperOnly && counts.live === 0
                ? "The curve starts when an agent goes live."
                : "Not enough snapshots yet — the curve fills in after the next run."}
          </div>
        )}
        {range ? (
          <p className="tnum mt-1 px-3 text-right text-[11px] text-muted-foreground">{range}</p>
        ) : null}
      </div>

      {/* footer: the decomposition */}
      <div
        className={cn(
          "grid grid-cols-2 gap-2 px-5 pb-5 pt-4 sm:px-6 sm:pb-6",
          showPaperWell ? "sm:grid-cols-5" : "sm:grid-cols-4",
        )}
      >
        <Well
          icon={Wallet}
          label="Cash"
          footnote={
            hasWallets
              ? cashByWallet.map((row) => (
                  <span key={row.address} className="mr-2 inline-block">
                    {row.chain} {truncateAddress(row.address, 4, 4)}
                  </span>
                ))
              : "No wallet synced yet"
          }
        >
          {formatUsd(cashUsd)}
        </Well>

        <Well
          icon={Layers}
          label="At work"
          footnote={`${counts.total} agent${counts.total === 1 ? "" : "s"} · ${counts.live} live`}
        >
          {formatUsd(allocatedUsd)}
        </Well>

        <Well icon={Coins} label="Realised" footnote={paperOnly ? "closed paper positions" : "closed positions"}>
          <PnlText usd={book.realizedPnlUsd} size="md" />
        </Well>

        <Well
          icon={Coins}
          label="Unrealised"
          footnote={paperOnly ? "open paper positions, at the last mark" : "open positions, at the last mark"}
        >
          <PnlText usd={book.unrealizedPnlUsd} size="md" />
        </Well>

        {showPaperWell ? (
          <Well
            icon={FlaskConical}
            label="Paper (simulated)"
            className="col-span-2 sm:col-span-1"
            footnote={<PnlText usd={paper.pnlUsd} size="xs" />}
          >
            <span className="flex items-center gap-1.5">
              {formatUsd(paper.equityUsd)}
              <ModeBadge mode="paper" size="xs" />
            </span>
          </Well>
        ) : null}
      </div>
    </section>
  );
}
