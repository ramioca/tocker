import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, Ban, Gavel, ShieldCheck, TriangleAlert } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ModeBadge } from "@/components/common/mode-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { EmptyState } from "@/components/common/empty-state";
import { formatSignedUsd, formatUsd } from "@/components/common/format";
import { PnlText } from "@/components/common/pnl-text";
import { cn } from "@/lib/utils";
import type { HomeActivityItem, HomeActivityKind } from "@/server/queries/home";

/**
 * The query's kind, corrected by status. Home lists trades that never filled too,
 * and read as a fill a declined "Buy BONK $400" would come back as "Bought BONK".
 */
type RowKind = HomeActivityKind | "declined" | "blocked" | "failed";

const KIND: Record<
  RowKind,
  { icon: React.ElementType; label: string; tone: string; ring: string }
> = {
  buy: { icon: ArrowUpRight, label: "Bought", tone: "text-positive", ring: "bg-positive/12" },
  sell: { icon: ArrowDownRight, label: "Sold", tone: "text-negative", ring: "bg-negative/12" },
  exit: { icon: ShieldCheck, label: "Exit", tone: "text-foreground", ring: "bg-muted" },
  proposal: { icon: Gavel, label: "Awaiting you", tone: "text-primary", ring: "bg-primary/15" },
  declined: { icon: Ban, label: "Declined", tone: "text-muted-foreground", ring: "bg-muted" },
  blocked: { icon: Ban, label: "Blocked", tone: "text-muted-foreground", ring: "bg-muted" },
  failed: { icon: TriangleAlert, label: "Failed", tone: "text-destructive", ring: "bg-destructive/12" },
};

function rowKind({ kind, trade }: HomeActivityItem): RowKind {
  // Only a "no" from the owner is a decline. The approval-time guard and the
  // guardian's bad-mark check reject too, and the owner may have said yes to those.
  if (trade.status === "rejected") return trade.decidedBy === "owner" ? "declined" : "blocked";
  if (trade.status === "failed") return "failed";
  return kind;
}

function Row({ item }: { item: HomeActivityItem }) {
  const kind = rowKind(item);
  const meta = KIND[kind];
  const Icon = meta.icon;
  const { agent } = item;
  // The sell's booked result, once the query attaches it to `TradeRow` (see feed-card).
  const trade: HomeActivityItem["trade"] & { realizedPnlUsd?: number | null; realizedPnlPct?: number | null } =
    item.trade;
  const unfilled = kind === "declined" || kind === "blocked" || kind === "failed";
  const usd = kind === "proposal" || unfilled ? (trade.requestedUsd ?? trade.amountUsd) : trade.amountUsd;
  // A trade lives in its agent's ledger, next to the run that placed it; the token
  // page is one click on from there. Proposals open straight onto their decision.
  const href =
    kind === "proposal"
      ? `/agents/${agent.slug}?proposal=${trade.id}`
      : `/agents/${agent.slug}?tab=trades`;
  // A trade that never filled says why instead of why it was wanted. Home is the
  // owner's own agents only, so the error is theirs to read.
  const note = unfilled ? trade.error : trade.rationale;
  const verb = unfilled ? `${meta.label} ${trade.origin === "guardian" ? "exit" : trade.side}` : meta.label;
  // The link is named by a one-line summary and the time, and the rationale is only its
  // description: named by its contents, one row read out as a 330-character paragraph
  // to anyone moving through the page by links.
  const summaryId = `act-${item.id}`;
  // Proceeds say what was sold; this says whether it made money. Filled sells only.
  const realizedUsd =
    trade.side === "sell" && trade.status === "filled" && typeof trade.realizedPnlUsd === "number"
      ? trade.realizedPnlUsd
      : null;
  const hasNote = Boolean(trade.exitReason || note);

  return (
    <li className="relative">
      <Link
        href={href}
        aria-labelledby={`${summaryId} ${summaryId}-time`}
        aria-describedby={hasNote ? `${summaryId}-note` : undefined}
        className={cn(
          "focus-ring-inset flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5",
          "transition-colors duration-150",
          kind === "proposal" ? "bg-primary/[0.06] hover:bg-primary/10" : "hover:bg-muted/40",
          unfilled && "opacity-70",
        )}
      >
        <span
          aria-hidden
          className={cn("grid size-7 shrink-0 place-items-center rounded-lg", meta.ring, meta.tone)}
        >
          <Icon className="size-3.5" />
        </span>
        <span id={summaryId} className="sr-only">
          {`${agent.name}, ${agent.mode}, ${verb} ${trade.token.symbol}, ${formatUsd(usd)}`}
          {realizedUsd !== null ? `, realised ${formatSignedUsd(realizedUsd)}` : ""}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="sm" />
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <ModeBadge mode={agent.mode} size="xs" />
        </span>

        {/*
          Below `sm` the fill wraps onto its own line under the agent (`w-full`,
          indented to the avatar), because five things — agent, verb, token, size
          and time — do not fit across 390px without colliding. From `sm` up the
          order flips back so it reads as one dense line.
        */}
        <span
          id={`${summaryId}-time`}
          className="tnum ml-auto shrink-0 text-[11px] text-muted-foreground sm:order-3"
        >
          {kind === "proposal" && item.expiresAt ? (
            <span className="text-primary">
              expires <RelativeTime iso={item.expiresAt} className="text-[11px]" />
            </span>
          ) : (
            <RelativeTime iso={item.at} className="text-[11px]" />
          )}
        </span>

        <span className="flex w-full min-w-0 items-center gap-1.5 pl-10 text-sm sm:order-2 sm:w-auto sm:flex-1 sm:pl-0">
          <span className={cn("shrink-0 font-medium", meta.tone)}>
            {/* The verb carries the side, since the icon no longer does. */}
            {verb}
          </span>
          <TokenIcon token={trade.token} size="xs" />
          <span className="truncate font-medium">{trade.token.symbol}</span>
          <span
            className={cn(
              "tnum shrink-0 text-muted-foreground",
              unfilled && "line-through decoration-muted-foreground/60",
            )}
          >
            {formatUsd(usd)}
          </span>
          {realizedUsd !== null ? (
            <PnlText
              usd={realizedUsd}
              pct={trade.realizedPnlPct ?? null}
              dp={1}
              size="xs"
              className="shrink-0 whitespace-nowrap"
            />
          ) : null}
        </span>

        {/*
          Inside the link and last in order, so the whole row is one target with one
          hover and one focus ring. Indented to the avatar at every width.
        */}
        {hasNote ? (
          <span
            id={`${summaryId}-note`}
            className="block w-full basis-full pl-10 text-xs leading-5 text-muted-foreground sm:order-4"
          >
            {/* A real space after the chip, or it and the note are read as one word. */}
            {trade.exitReason ? (
              <>
                <span className="mr-1 rounded border border-border/70 px-1.5 py-px text-[10px] uppercase tracking-wide">
                  {trade.exitReason.replace(/_/g, " ")}
                </span>{" "}
              </>
            ) : null}
            {note}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * What happened while you were away: your own fills, the exits the guardian took
 * for you, and anything still waiting on a decision.
 *
 * Proposals are lifted to the top and tinted, because they are the only rows with
 * a clock on them — everything else is a receipt.
 *
 * This is your own activity only. The feed next door is everyone's, yours included.
 */
export function ActivityStrip({
  items,
  pendingCount,
}: {
  items: HomeActivityItem[];
  pendingCount: number;
}) {
  return (
    <section aria-labelledby="home-activity-heading" id="activity" className="scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2
            id="home-activity-heading"
            className="flex items-center gap-2 text-lg font-medium tracking-tight"
          >
            <Activity aria-hidden className="size-4.5 text-primary" />
            Recent activity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} trade${pendingCount === 1 ? "" : "s"} waiting on your decision.`
              : "Your own fills and exits, newest first."}
          </p>
        </div>
        <Link
          href="/feed"
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
        >
          Open the feed
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={<Activity />}
          title="Nothing has happened yet"
          description="Trigger a run from an agent's page, or give one a schedule and it will start on its own. Every fill, exit and proposal lands here."
        />
      ) : (
        <ul className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
