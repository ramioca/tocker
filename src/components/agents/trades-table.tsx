"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GeckoTerminalLink } from "@/components/common/chart-link";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronRight, Receipt } from "lucide-react";
import { SkeletonReveal } from "@/components/spectrumui/skeleton-reveal";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { fetchAgentTrades } from "./agent-actions";
import { LoadMoreFailed } from "./load-more-failed";
import { tradeRowView, type StatusTone } from "./trade-row-view";
import { cn } from "@/lib/utils";
import type { Page, TradeRow } from "@/server/types";

/** The frame the table arrives in, so nothing jumps when the trades land. */
function TableSkeleton() {
  return (
    <div className="glass-card overflow-hidden rounded-xl" role="status" aria-label="Loading trades">
      <span aria-hidden className="block h-9" />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} aria-hidden className="flex h-11 items-center border-t border-border/60 px-4">
          <span className="h-3 w-full rounded bg-muted/60 motion-safe:animate-pulse" />
        </span>
      ))}
    </div>
  );
}

/**
 * One grid, two arrangements, chosen by the room the table really has (a container
 * query, not the viewport). From a 56rem container it is a table: eight fixed or
 * flexible tracks, used by the header and every row. Below that each trade is a card.
 * Every track is a fixed width or can shrink and every sentence wraps, so nothing
 * overflows and nothing scrolls sideways at any width.
 */
const COLS = "@4xl:grid-cols-[5.25rem_8.75rem_minmax(0,1fr)_6.5rem_7rem_5.75rem_4.75rem_5.5rem]";

const HEAD = `hidden h-9 items-center gap-x-3 px-4 text-xs font-medium text-muted-foreground @4xl:grid ${COLS}`;

/**
 * A trade and its note are one block, so hover and the `?trade=` tint cover both. The
 * block is the grid; the two rows inside it are `display: contents`, so their cells are
 * placed on it directly.
 */
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-3 " +
  "transition-[background-color,box-shadow] duration-150 ease-out hover:bg-muted/40 " +
  `@4xl:gap-y-0 @4xl:px-4 @4xl:py-0 ${COLS}`;

/** Every cell in the table arrangement: back to automatic placement, 44px tall, centred. */
const CELL =
  "@4xl:col-auto @4xl:row-auto @4xl:flex @4xl:min-h-11 @4xl:min-w-0 @4xl:items-center @4xl:justify-self-auto";
const RIGHT = "@4xl:justify-end @4xl:text-right";

/**
 * Where each piece sits on a card. The left track can shrink and holds what can
 * truncate or wrap; the right one is as wide as its widest item. `left` and `right`
 * wrap the cells that share a line on a card, and are `display: contents` in the table
 * arrangement, where their cells fall into tracks 4-5 and 7-8 by source order.
 */
const AT = {
  side: "col-start-1 row-start-1 flex min-w-0 items-center gap-1.5",
  when: "col-start-2 row-start-1 justify-self-end",
  token: "col-start-1 row-start-2 flex min-w-0 items-center gap-1.5",
  value: "col-start-2 row-start-2 justify-self-end",
  /** Amount and price: one line that wraps, so a long price drops under the amount. */
  left: "col-start-1 row-start-3 flex min-w-0 flex-wrap items-baseline gap-x-1.5 @4xl:contents",
  /** Score and transaction. */
  right: "col-start-2 row-start-3 flex items-center gap-3 justify-self-end @4xl:contents",
  note: "col-[1/-1] row-start-4 @4xl:col-[2/-1] @4xl:row-auto @4xl:-mt-1 @4xl:pb-3",
} as const;

const NUMBER = "tnum text-xs text-muted-foreground @4xl:text-sm";

/** Characters each number track holds at 14px. A longer figure is set one size down, never cut. */
const FITS = { amount: 12, price: 13, value: 10 } as const;
const snug = (text: string | null, max: number) =>
  text !== null && text.length > max ? "@4xl:text-xs @4xl:tracking-tight" : null;

/** Always beside a word: the colour is never the only thing telling two states apart. */
const STATUS_TONE: Record<StatusTone, string> = {
  danger: "border-destructive/40 text-destructive",
  quiet: "border-border text-muted-foreground",
  wait: "border-primary/40 text-primary",
};

/** The text is 11px; the invisible `after` gives a thumb 44px to find. */
const QUIET_LINK =
  "relative rounded font-mono text-[11px] text-muted-foreground transition-colors duration-150 " +
  "hover:text-foreground focus-ring after:absolute after:-inset-x-1.5 after:-inset-y-3.5 after:content-['']";

/** Characters past which a card folds the text. Never folded in the table arrangement. */
const NOTE_FOLD = 140;
const REASON_FOLD = 280;

/**
 * A sentence that can be long: the agent's note, or the reason a trade did not happen.
 * Whole in the table arrangement; on a card it folds behind a "More" button. The fold
 * is a character count, so a wide card can offer "More" for text that already fits.
 */
function Folded({
  text,
  lead = null,
  after = null,
  foldAt,
  lines,
  className,
  what,
}: {
  text: string;
  lead?: string | null;
  /** Kept outside the fold, so it is never the part that is cut. */
  after?: ReactNode;
  foldAt: number;
  /** The whole class, so Tailwind sees it: "@max-4xl:line-clamp-3" or "@max-4xl:line-clamp-6". */
  lines: string;
  className: string;
  /** Which text this is and whose, for the button's name: every row has the same "More". */
  what: string;
}) {
  const [open, setOpen] = useState(false);
  const long = (lead?.length ?? 0) + text.length > foldAt;
  return (
    <div className="max-w-[88ch]">
      <p className={cn(className, "[overflow-wrap:anywhere]", long && !open && lines)}>
        {lead ? <span className="text-foreground/60">{lead}</span> : null}
        {text}
      </p>
      {after ? <p className={cn(className, "[overflow-wrap:anywhere]")}>{after}</p> : null}
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Less" : "More"} of ${what}`}
          onClick={() => setOpen((value) => !value)}
          className="-mb-2 inline-flex min-h-11 items-center rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring @4xl:hidden"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

/** How many older pages a `?trade=` link may pull in looking for its fill before giving up. */
const MAX_FOCUS_PAGES = 4;
/** How long the linked fill stays tinted: long enough to find it, short enough not to linger. */
const FOCUS_FLASH_MS = 1800;

export function TradesTable({
  agentId,
  agentSlug,
  initialPage,
  isOwner = false,
}: {
  agentId: string;
  /** For the link from each trade to the run that placed it. */
  agentSlug: string;
  initialPage?: Page<TradeRow>;
  /**
   * Chooses words only; the server decides what is sent. Off unless the page says so,
   * so a caller that forgets it shows the visitor's view.
   */
  isOwner?: boolean;
}) {
  const query = useInfiniteQuery({
    queryKey: ["agent-trades", agentId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchAgentTrades(agentId, pageParam),
    getNextPageParam: (last: Page<TradeRow>) => last.nextCursor,
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [null as string | null] }
      : undefined,
  });

  const trades = query.data?.pages.flatMap((page) => page.items) ?? [];

  // `?trade=<id>` is where a Home activity row points: the fill it named, not the whole
  // list. Once that row is loaded it is brought to the middle of the screen and tinted
  // for a moment. Not loaded yet: a few older pages are fetched, then it gives up
  // silently — the list is still the right place to be.
  const focusId = useSearchParams().get("trade");
  const focusLoaded = focusId !== null && trades.some((trade) => trade.id === focusId);
  const pageCount = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (!focusId || focusLoaded || pageCount === 0 || pageCount >= MAX_FOCUS_PAGES) return;
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    void fetchNextPage();
  }, [focusId, focusLoaded, pageCount, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const [flashId, setFlashId] = useState<string | null>(null);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !focusLoaded || scrolledTo.current === focusId) return;
    scrolledTo.current = focusId;
    // An instant jump, not a glide: the viewer did not scroll, so there is no motion of theirs to follow.
    document.getElementById(`trade-${focusId}`)?.scrollIntoView({ block: "center" });
    setFlashId(focusId);
  }, [focusId, focusLoaded]);
  useEffect(() => {
    if (!flashId) return;
    const id = window.setTimeout(() => setFlashId(null), FOCUS_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flashId]);

  // Offline before the first page arrived: React Query pauses rather than fails, so
  // without this the skeleton would pulse until the connection came back.
  if (query.fetchStatus === "paused" && !query.data) {
    return (
      <ErrorState
        title="You're offline"
        description="Trade history loads when you reconnect."
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Try again
          </button>
        }
      />
    );
  }

  // Only when there is nothing to show. `isError` is also true when just an older page
  // failed, and the pages already loaded are still in `query.data` — those must stay.
  if (query.isError && !query.data) {
    return (
      <ErrorState
        title="Trade history did not load"
        description="Try again in a moment."
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] motion-reduce:active:scale-100"
          >
            Try again
          </button>
        }
      />
    );
  }

  return (
    <SkeletonReveal loading={query.isPending} skeleton={<TableSkeleton />}>
      {/* Nothing behind the skeleton while it loads: the skeleton is aria-hidden, so an
          empty state rendered under it was read out as "No trades yet" mid-load. */}
      {query.isPending ? null : trades.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No trades yet"
          description="Every trade this agent places lands here with the reasoning behind it."
        />
      ) : (
        <div className="space-y-3">
          <div className="@container glass-card overflow-hidden rounded-xl">
            {/*
              Not a <table>: a table cell cannot give the reason its own line under the
              row, and a sentence in one sets the width of its whole column. The roles
              keep it reading as a table. On a card the header row is not rendered, so
              the cells there say their own words ("asked", "at", "Nothing traded").
            */}
            <div role="table" aria-label="Trades" aria-colcount={8}>
              <div role="rowgroup">
                <div role="row" className={HEAD}>
                  <span role="columnheader" aria-colindex={1}>When</span>
                  <span role="columnheader" aria-colindex={2}>Side</span>
                  <span role="columnheader" aria-colindex={3}>Token</span>
                  <span role="columnheader" aria-colindex={4} className="text-right">
                    Amount
                  </span>
                  <span role="columnheader" aria-colindex={5} className="text-right">
                    Price
                  </span>
                  <span role="columnheader" aria-colindex={6} className="text-right">
                    Value
                  </span>
                  <span role="columnheader" aria-colindex={7} className="text-right">
                    Entry score
                  </span>
                  <span role="columnheader" aria-colindex={8} className="text-right">
                    Tx
                  </span>
                </div>
              </div>

              <div role="rowgroup" className="divide-y divide-border/60 @4xl:border-t @4xl:border-border/60">
                {trades.map((trade) => {
                  // Approval mode puts non-fills in the ledger: a proposal nobody approved,
                  // or one that expired, must never read as a trade. The view decides which
                  // of the stored numbers are facts.
                  const view = tradeRowView(trade, { isOwner });
                  const tokenHref = `/tokens/${trade.token.chain}/${trade.token.address}`;
                  // Which row a button belongs to, for the buttons that every row repeats.
                  const rowName = `${trade.side} of ${trade.token.symbol}`;
                  const focused = trade.id === focusId;
                  const flashing = trade.id === flashId;
                  return (
                    <div
                      key={trade.id}
                      role="none"
                      id={`trade-${trade.id}`}
                      className={cn(
                        ROW,
                        focused && "duration-700",
                        flashing && "bg-primary/8 shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/8",
                      )}
                    >
                      <div role="row" aria-current={focused ? "true" : undefined} className="contents">
                        <div role="cell" aria-colindex={1} className={cn(AT.when, CELL, "whitespace-nowrap text-xs")}>
                          {trade.runId ? (
                            <Link
                              href={`/agents/${agentSlug}/runs/${trade.runId}`}
                              // The text is 16px tall; the invisible `after` reaches 44px around
                              // it so a thumb can find it.
                              className="relative rounded underline decoration-muted-foreground/50 decoration-dotted underline-offset-2 transition-colors duration-150 after:absolute after:-inset-x-3 after:-inset-y-3.5 after:content-[''] hover:decoration-foreground hover:decoration-solid focus-ring"
                              title="Open the run that placed this trade"
                            >
                              <RelativeTime iso={trade.createdAt} />
                            </Link>
                          ) : (
                            <RelativeTime iso={trade.createdAt} />
                          )}
                        </div>

                        <div role="cell" aria-colindex={2} className={cn(AT.side, CELL)}>
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              trade.side === "buy" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
                            )}
                          >
                            {trade.side}
                          </span>
                          {view.status ? (
                            <span
                              className={cn(
                                "rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
                                STATUS_TONE[view.status.tone],
                              )}
                            >
                              {view.status.label}
                            </span>
                          ) : null}
                        </div>

                        {/* One line: the symbol gives way, the icon and the chart link never do. */}
                        <div role="cell" aria-colindex={3} className={cn(AT.token, CELL)}>
                          <Link
                            href={tokenHref}
                            className="relative inline-flex min-w-0 items-center gap-1.5 rounded hover:underline focus-ring @max-4xl:after:absolute @max-4xl:after:inset-x-0 @max-4xl:after:-inset-y-3 @max-4xl:after:content-['']"
                          >
                            <TokenIcon token={trade.token} size="xs" />
                            <span className="truncate font-medium" title={trade.token.symbol}>
                              {trade.token.symbol}
                            </span>
                          </Link>
                          <GeckoTerminalLink
                            chain={trade.token.chain}
                            address={trade.token.address}
                            symbol={trade.token.symbol}
                            size="xs"
                            roomy
                          />
                        </div>

                        {/* Layout only (`role="none"`), so the two cells stay children of the row. */}
                        <div role="none" className={AT.left}>
                          <div
                            role="cell"
                            aria-colindex={4}
                            title={view.amountTitle ?? undefined}
                            className={cn(CELL, RIGHT, NUMBER, snug(view.amount, FITS.amount))}
                          >
                            {/* Nothing filled: a dash in the table, the words on a card. */}
                            {view.amount ?? (
                              <>
                                <span aria-hidden className="@max-4xl:hidden">
                                  —
                                </span>
                                <span className="@4xl:sr-only">{view.priceQuoted ? "Quoted" : "Nothing traded"}</span>
                              </>
                            )}
                          </div>

                          {/* On a card it reads "at $0.00114"; with no price the card leaves it out. */}
                          <div
                            role="cell"
                            aria-colindex={5}
                            title={view.priceTitle ?? undefined}
                            className={cn(
                              CELL,
                              RIGHT,
                              NUMBER,
                              snug(view.price, FITS.price),
                              view.price === null && "@max-4xl:hidden",
                            )}
                          >
                            {view.price === null ? (
                              <>
                                <span aria-hidden>—</span>
                                <span className="sr-only">No price</span>
                              </>
                            ) : (
                              <>
                                <span className="@4xl:hidden">at&nbsp;</span>
                                {view.price}
                              </>
                            )}
                          </div>
                        </div>

                        {/* What traded, or (quietly) what was asked for when nothing did. */}
                        <div
                          role="cell"
                          aria-colindex={6}
                          className={cn(
                            AT.value,
                            CELL,
                            RIGHT,
                            "tnum whitespace-nowrap text-sm",
                            view.valueAsked ? "text-muted-foreground" : "font-medium",
                            snug(view.value, FITS.value),
                          )}
                        >
                          {view.valueAsked ? <span className="@4xl:sr-only">asked&nbsp;</span> : null}
                          {view.value}
                        </div>

                        <div role="none" className={AT.right}>
                          {/*
                            The score frozen onto the row, never a live one: a re-score after
                            the fact must not be able to flatter or damn a decision already made.
                            Rows from before scoring existed link out to score the token now.
                          */}
                          <div role="cell" aria-colindex={7} className={cn(CELL, RIGHT)}>
                            {trade.entryScore === null ? (
                              <Link href={tokenHref} className={cn(QUIET_LINK, "whitespace-nowrap")}>
                                score now
                              </Link>
                            ) : (
                              <ScoreBadge
                                total={trade.entryScore}
                                verdict={trade.score?.verdict}
                                blockers={trade.score?.blockers}
                                size="xs"
                                numberOnly
                              />
                            )}
                          </div>

                          {/* "Paper" only for a paper trade: a live order that failed before signing has no transaction. */}
                          <div
                            role="cell"
                            aria-colindex={8}
                            className={cn(CELL, RIGHT, "font-mono text-[11px] text-muted-foreground")}
                          >
                            {view.tx.kind === "link" ? (
                              <a
                                href={view.tx.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Transaction ${view.tx.label} on the explorer`}
                                className={cn(QUIET_LINK, "inline-flex items-center gap-0.5 whitespace-nowrap")}
                              >
                                {/* The first four characters on a card, both ends in the table. */}
                                <span className="@4xl:hidden">{view.tx.short}</span>
                                <span className="@max-4xl:hidden">{view.tx.label}</span>
                                <ArrowUpRight aria-hidden className="size-3" />
                              </a>
                            ) : view.tx.kind === "paper" ? (
                              "Paper"
                            ) : (
                              <>
                                <span aria-hidden>—</span>
                                <span className="sr-only">No transaction</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/*
                        Its own full-width line under the row, wrapped: why the trade did
                        not happen, then the one line the agent wrote for it. That line
                        is public, like the trade; never the transcript that led to it.
                        To a screen reader it is a second row with one cell across
                        columns 2 to 8, which is where it sits.
                      */}
                      {view.reason || view.rationale ? (
                        <div role="row" className="contents">
                          <div
                            role="cell"
                            aria-colindex={2}
                            aria-colspan={7}
                            className={cn(AT.note, "min-w-0 space-y-1")}
                          >
                            {view.reason ? (
                              <Folded
                                text={view.reason.text}
                                foldAt={REASON_FOLD}
                                lines="@max-4xl:line-clamp-6"
                                className="text-[13px] leading-5 text-foreground/80"
                                what={`why the ${rowName} did not happen`}
                                after={
                                  view.reason.failingSince ? (
                                    <span className="text-muted-foreground">
                                      First failed <RelativeTime iso={view.reason.failingSince} />.
                                    </span>
                                  ) : null
                                }
                              />
                            ) : null}
                            {/* The stored text, one tap away whenever the sentence above is not it. */}
                            {view.reason?.raw ? (
                              <details className="group max-w-[88ch]">
                                {/* The browser's own marker is hidden; the chevron stands in for it. */}
                                <summary
                                  aria-label={`Details of why the ${rowName} did not happen`}
                                  className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring @4xl:min-h-0 @4xl:py-0.5 [&::-webkit-details-marker]:hidden"
                                >
                                  <ChevronRight
                                    aria-hidden
                                    className="size-3 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
                                  />
                                  Details
                                </summary>
                                <p className="pb-1 font-mono text-[11px] leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">
                                  {view.reason.raw}
                                </p>
                              </details>
                            ) : null}
                            {view.rationale ? (
                              <Folded
                                text={view.rationale}
                                lead={view.reason ? "Agent's note: " : null}
                                foldAt={NOTE_FOLD}
                                lines="@max-4xl:line-clamp-3"
                                className="text-xs leading-[18px] text-muted-foreground"
                                what={`the agent's note on the ${rowName}`}
                              />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {query.isFetchNextPageError && !query.isFetchingNextPage ? (
            <LoadMoreFailed what="trades" onRetry={() => void query.fetchNextPage()} />
          ) : query.hasNextPage ? (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50 focus-ring"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more trades"}
            </button>
          ) : null}
        </div>
      )}
    </SkeletonReveal>
  );
}
