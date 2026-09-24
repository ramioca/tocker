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
import { dayBucket, formatAgo } from "@/components/social-common/format";
import { ProposalCard } from "@/components/agents/proposals/proposal-card";
import { TradeReceiptRow } from "@/components/trading";
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
}: {
  items: NotificationRow[];
  now: number;
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
    const label = dayBucket(row.createdAt, now);
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

function Row({
  row,
  now,
  receipt = null,
  markRead,
}: {
  row: NotificationRow;
  now: number;
  receipt?: TradeReceiptData | null;
  markRead?: (id: string) => Promise<{ ok: boolean }>;
}) {
  const Icon = ICONS[row.kind] ?? Bell;
  const unread = row.readAt === null;
  const failed = row.kind === "run_failed";

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
        <p className={`text-sm ${unread ? "font-medium" : ""}`}>{row.title}</p>
        {row.body ? (
          <p className="mt-0.5 line-clamp-2 text-sm leading-6 text-muted-foreground">{row.body}</p>
        ) : null}
        {receipt ? <TradeReceiptRow receipt={receipt} className="mt-1.5" /> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <time
          dateTime={row.createdAt}
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {formatAgo(row.createdAt, now)}
        </time>
        {unread ? (
          <>
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-primary group-data-[read]/notification:hidden"
            />
            <span className="sr-only group-data-[read]/notification:hidden">Unread</span>
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
      className={`block transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-outline-offset-2 ${
        unread ? "bg-primary/[0.04]" : ""
      }`}
    >
      {content}
    </NotificationLink>
  );
}
