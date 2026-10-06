import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getNotifications } from "@/server/queries/users";
import { listMyProposals } from "@/server/queries/proposals";
import { receiptsFor } from "@/server/queries/trading";
import { mockDataForced, withMock } from "@/lib/data";
import { NOW, mockNotifications, mockSession } from "@/mocks/social";
import { referenceNow } from "@/components/social-common/format";
import { unreadNotifications } from "@/components/common/data-access";
import { NotificationList, tradeIdFrom } from "@/components/notifications/notification-list";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { resolveTimeZone } from "@/components/notifications/day-bucket";
import { MAX_NOTIFICATION_PAGES, collectPages, pagesParam } from "@/components/notifications/older-pages";
import { ShowOlder } from "@/components/notifications/show-older";
import { markNotificationRead } from "@/server/actions/users";

export const metadata: Metadata = { title: "Notifications" }; // the root layout appends " · Tocker"

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ pages?: string | string[] }>;
}) {
  const session = await withMock(getSession, mockSession);
  if (!session) redirect(`/login?next=${encodeURIComponent("/notifications")}`);

  // "Show older" asks for one more page each time (see ShowOlder); the rows so far are
  // re-read with it so the list stays one list, grouped by day, in one render.
  const pages = pagesParam((await searchParams).pages);
  // The header counts every unread row, as the bell does — not just the ones on screen,
  // which left "Everything read" beside a bell still showing a badge.
  const [page, unread] = await Promise.all([
    collectPages(
      (cursor) =>
        withMock(
          () => getNotifications(session.userId, cursor),
          () => mockNotifications(cursor),
        ),
      pages,
    ),
    unreadNotifications(session.userId),
  ]);

  // Proposals still awaiting a decision, so a "proposal" notification is a card with
  // Approve / Reject on it rather than a link to somewhere else. Fill and exit rows get
  // their receipt inline, so how the trade actually went is on the row, not a page away.
  // Both are only ever written to the trade owner, so every id here is the viewer's own.
  const fillTradeIds = page.items
    .filter((item) => item.kind === "fill" || item.kind === "exit")
    .map((item) => tradeIdFrom(item.href))
    .filter((id): id is string => id !== null);
  const [proposals, receipts] = await Promise.all([
    withMock(
      () => listMyProposals(session.userId),
      () => [],
    ),
    withMock(
      // The viewer is passed so `receiptsFor` checks that claim itself and gives the
      // owner the whole receipt.
      () => receiptsFor(fillTradeIds, session.userId),
      () => new Map(),
    ),
  ]);

  // Mock fixtures are anchored to a fixed clock so relative times stay stable in dev.
  const now = referenceNow(mockDataForced() ? NOW : undefined);
  // Days are the viewer's, not UTC's; AppShell writes the zone. UTC until it has.
  const timeZone = resolveTimeZone((await cookies()).get("tz")?.value);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {/* Focusable from script only: MarkAllRead hands it the focus when it goes away. */}
          <h1 id="notifications-title" tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
            Notifications
          </h1>
          {/* Always there, so marking everything read does not shift the list up; and live,
              so the answer is announced once the button that asked has gone. */}
          <p aria-live="polite" className="mt-1.5 text-sm text-muted-foreground tabular-nums">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MarkAllRead unreadCount={unread} />
          {/* Too many fill or exit pushes is a reason to be on this page; the switches for
              them should be one tap away, not behind the avatar menu and a scroll. */}
          <Link
            href="/settings#notifications"
            aria-label="Notification settings"
            className="inline-flex size-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Settings className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      {/*
        No wrapper surface: `NotificationList` (owned by another workstream)
        already groups its rows into their own panels, and a panel of panels is
        one material too many. The page composition is the header and the
        spacing; the list keeps its own anatomy.
      */}
      <div className="mt-8">
        <NotificationList
          items={page.items}
          now={now}
          timeZone={timeZone}
          proposals={proposals}
          receipts={receipts}
          markRead={markNotificationRead}
        />
        {page.nextCursor ? (
          pages < MAX_NOTIFICATION_PAGES ? (
            <div className="mt-6 flex justify-center">
              <ShowOlder nextPages={pages + 1} />
            </div>
          ) : (
            <p className="mt-6 text-center text-xs text-muted-foreground tabular-nums">
              Showing your latest {page.items.length} notifications.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}
