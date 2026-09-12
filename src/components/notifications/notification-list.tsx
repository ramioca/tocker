import Link from "next/link";
import {
  ArrowLeftRight,
  AtSign,
  Bell,
  CircleDollarSign,
  Heart,
  MessageCircle,
  TriangleAlert,
  Trophy,
  UserPlus,
} from "lucide-react";
import type { NotificationRow } from "@/server/types";
import { dayBucket, formatAgo } from "@/components/social-common/format";

const ICONS: Record<string, typeof Bell> = {
  trade: ArrowLeftRight,
  follow: UserPlus,
  like: Heart,
  comment: MessageCircle,
  mention: AtSign,
  milestone: Trophy,
  run_failed: TriangleAlert,
  data: CircleDollarSign,
};

export function NotificationList({ items, now }: { items: NotificationRow[]; now: number }) {
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
            {group.rows.map((row) => (
              <li key={row.id}>
                <Row row={row} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ row, now }: { row: NotificationRow; now: number }) {
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
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <time
          dateTime={row.createdAt}
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {formatAgo(row.createdAt, now)}
        </time>
        {unread ? (
          <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" role="status" />
        ) : null}
      </div>
    </div>
  );

  if (!row.href) return <div className={unread ? "bg-primary/[0.04]" : undefined}>{content}</div>;

  return (
    <Link
      href={row.href}
      className={`block transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-outline-offset-2 ${
        unread ? "bg-primary/[0.04]" : ""
      }`}
    >
      {content}
    </Link>
  );
}
