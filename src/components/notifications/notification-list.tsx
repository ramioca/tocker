import {
  ArrowLeftRight,
  AtSign,
  Bell,
  CalendarDays,
  CircleDollarSign,
  DoorOpen,
  Gavel,
  Heart,
  MessageCircle,
  ReceiptText,
  TriangleAlert,
  Trophy,
  UserPlus,
} from "lucide-react";
import type { NotificationRow, ProposalRow } from "@/server/types";
import type { TradeReceiptData } from "@/db/schema";
import { formatAgo } from "@/components/social-common/format";
import { ProposalCard } from "@/components/agents/proposals/proposal-card";
import { TradeReceiptRow } from "@/components/trading";
import { clockTime, dayBucket, fullDateTime } from "./day-bucket";
import { NotificationLink } from "./notification-link";

const ICONS: Record<string, typeof Bell> = {
  trade: ArrowLeftRight,
  follow: UserPlus,
  like: Heart,
  comment: MessageCircle,
  mention: AtSign,
  milestone: Trophy,
  run_failed: TriangleAlert,
  // W7: a stop/target fired and the sell did not fill; a transaction confirmed on chain
  // but its fill was never recorded. Both are the owner's problem to look at.
  exit_failed: TriangleAlert,
  trade_unsettled: TriangleAlert,
  proposal: Gavel,
  data: CircleDollarSign,
  // Owner-only kinds. `fill` is one per executed trade and carries its receipt;
  // `exit` is the exit engine naming the rule that fired; `digest` is the once-a-day
  // summary. See src/lib/notifications.
  fill: ReceiptText,
  exit: DoorOpen,
  digest: CalendarDays,
};

/**
 * The kinds where money is at risk or a run broke: a stop or target that did not
 * fill, a trade that confirmed but was never recorded, a failed run. They get the red
 * tile and a "Needs attention" line, so they are the first rows the eye lands on
 * rather than looking like a like or a follow.
 */
const ALERT_KINDS = new Set(["run_failed", "exit_failed", "trade_unsettled"]);

/** `?trade=<id>` on a fill notification's href — how a row finds its own receipt. */
export function tradeIdFrom(href: string | null): string | null {
  if (!href) return null;
  const match = /[?&]trade=([^&]+)/.exec(href);
  return match?.[1] ?? null;
}

/** `/agents/slug?proposal=<id>` → the id, so a notification can find its own proposal. */
function proposalIdFrom(href: string | null): string | null {
  if (!href) return null;
  const match = /[?&]proposal=([^&]+)/.exec(href);
  return match?.[1] ?? null;
}

export function NotificationList({
  items,
  now,
  /** Proposals still awaiting a decision, so a `proposal` row is actionable in place. */
  proposals = [],
  /**
   * tradeId → receipt, so a `fill` row shows the execution line rather than making the
   * owner navigate to find out how the trade actually went. Optional: without it, fill
   * rows render exactly as any other notification.
   *
   * The page wires this with `receiptsFor(ids)` from `@/server/queries/trading`, where
   * `ids` are the trade ids parsed out of the fill rows' hrefs.
   */
  receipts,
  /** Marks one notification read when its row is opened; see NotificationLink. */
  markRead,
  /** The viewer's IANA zone, so "Today" and "Yesterday" follow their calendar, not UTC's. */
  timeZone = "UTC",
}: {
  items: NotificationRow[];
  now: number;
  timeZone?: string;
  proposals?: ProposalRow[];
  receipts?: Map<string, TradeReceiptData>;
  markRead?: (id: string) => Promise<{ ok: boolean }>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-20 text-center">
        <Bell className="mx-auto size-5 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium">Nothing yet</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
          Fills, follows, comments and failed runs land here. Start an agent and
          it&rsquo;ll fill up on its own.
        </p>
      </div>
    );
  }

  const pendingById = new Map(proposals.map((p) => [p.id, p]));

  // Grouped by day, in the order the rows arrive (newest first).
  const groups: Array<{ label: string; rows: NotificationRow[] }> = [];
  for (const row of items) {
    const label = dayBucket(row.createdAt, now, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label} aria-labelledby={`day-${group.label.replace(/\W+/g, "-")}`}>
          <h2
            id={`day-${group.label.replace(/\W+/g, "-")}`}
            className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
          >
            {group.label}
          </h2>
          <ul className="mt-3 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
            {group.rows.map((row) => {
              // A proposal is a question, not an announcement: answer it here rather
              // than sending the owner to another page to find the same card.
              const pending = row.kind === "proposal" ? pendingById.get(proposalIdFrom(row.href) ?? "") : undefined;
              return (
                <li key={row.id}>
                  {pending ? (
                    <div className="p-2.5 sm:p-3">
                      <ProposalCard proposal={pending} showAgent />
                    </div>
                  ) : (
                    <Row
                      row={row}
                      now={now}
                      timeZone={timeZone}
                      today={group.label === "Today"}
                      receipt={receipts?.get(tradeIdFrom(row.href) ?? "") ?? null}
                      markRead={markRead}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The line under the title, without what the receipt row already says. A fill's body is
 * the receipt summary itself, so beside its receipt it is dropped; an exit's body is the
 * rule's rationale with that same summary appended after " · ", so only the rationale
 * stays — the fill details are on the receipt, here or a tap away.
 */
function rowBody(row: NotificationRow, receipt: TradeReceiptData | null): string | null {
  if (!row.body) return null;
  if (row.kind === "fill" && receipt) return null;
  if (row.kind === "exit") {
    const cut = row.body.indexOf(" · ");
    return cut === -1 ? row.body : row.body.slice(0, cut);
  }
  return row.body;
}

function Row({
  row,
  now,
  timeZone,
  today,
  receipt = null,
  markRead,
}: {
  row: NotificationRow;
  now: number;
  timeZone: string;
  /** Under "Today" the age reads best; under a past day's heading, the clock does. */
  today: boolean;
  receipt?: TradeReceiptData | null;
  markRead?: (id: string) => Promise<{ ok: boolean }>;
}) {
  const Icon = ICONS[row.kind] ?? Bell;
  const unread = row.readAt === null;
  const failed = ALERT_KINDS.has(row.kind);
  const body = rowBody(row, receipt);
  // The link is named by its title and time (and "Needs attention" first when it does),
  // and described by the body. Wrapping the whole row made its name the title, the body
  // and every figure of the receipt, read out in one breath on every Tab.
  const ids = {
    attn: `n-${row.id}-attn`,
    title: `n-${row.id}-title`,
    body: `n-${row.id}-body`,
    time: `n-${row.id}-time`,
    unread: `n-${row.id}-unread`,
  };

  const content = (
    <div className="flex gap-3 px-4 py-3.5 sm:px-5">
      <span
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border ${
          failed
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border/70 bg-muted/40 text-muted-foreground"
        }`}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {/* Words as well as the red tile, so the difference does not rest on colour. */}
        {failed ? (
          <p id={ids.attn} className="mb-0.5 text-[11px] font-medium text-destructive">
            Needs attention
          </p>
        ) : null}
        <p id={ids.title} className={`text-sm ${unread ? "font-medium" : ""}`}>
          {row.title}
        </p>
        {body ? (
          <p
            id={ids.body}
            className={`mt-0.5 text-sm leading-6 text-muted-foreground ${
              // An exit's rationale is the rule's own template, bounded in length, and it ends
              // on what was banked — any clamp cut exactly that off on a phone.
              row.kind === "exit" ? "" : "line-clamp-2"
            }`}
          >
            {body}
          </p>
        ) : null}
        {receipt ? <TradeReceiptRow receipt={receipt} className="mt-1.5" /> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <time
          id={ids.time}
          dateTime={row.createdAt}
          title={fullDateTime(row.createdAt, timeZone)}
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {today ? formatAgo(row.createdAt, now) : clockTime(row.createdAt, timeZone)}
        </time>
        {unread ? (
          <>
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-primary group-data-[read]/notification:hidden"
            />
            <span id={ids.unread} className="sr-only group-data-[read]/notification:hidden">
              Unread
            </span>
          </>
        ) : null}
      </div>
    </div>
  );

  if (!row.href) return <div className={unread ? "bg-primary/[0.04]" : undefined}>{content}</div>;

  return (
    <NotificationLink
      id={row.id}
      href={row.href}
      unread={unread}
      markRead={markRead}
      labelledBy={[failed ? ids.attn : null, ids.title, ids.time].filter(Boolean).join(" ")}
      unreadId={unread ? ids.unread : undefined}
      describedBy={body ? ids.body : undefined}
      // Inset, and rounded to match the list's own corners on the first and last rows:
      // an outer ring is clipped by the list's overflow and covered by the next row,
      // which left only a line along the bottom that read as a divider.
      className={`block transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none [li:first-child>&]:rounded-t-[15px] [li:last-child>&]:rounded-b-[15px] ${
        unread ? "bg-primary/[0.04]" : ""
      }`}
    >
      {content}
    </NotificationLink>
  );
}
