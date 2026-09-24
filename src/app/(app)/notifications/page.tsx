import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getNotifications } from "@/server/queries/users";
import { listMyProposals } from "@/server/queries/proposals";
import { receiptsFor } from "@/server/queries/trading";
import { withMock } from "@/lib/data";
import { NOW, mockNotifications, mockSession } from "@/mocks/social";
import { referenceNow } from "@/components/social-common/format";
import { NotificationList, tradeIdFrom } from "@/components/notifications/notification-list";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { markNotificationRead } from "@/server/actions/users";

export const metadata: Metadata = { title: "Notifications" }; // the root layout appends " · Tocker"

export default async function NotificationsPage() {
  const session = await withMock(getSession, mockSession);
  if (!session) redirect(`/login?next=${encodeURIComponent("/notifications")}`);

  const page = await withMock(
    () => getNotifications(session.userId),
    () => mockNotifications(),
  );

  // Proposals still awaiting a decision, so a "proposal" notification is a card with
  // Approve / Reject on it rather than a link to somewhere else. Fill rows get their
  // receipt inline, so how the trade actually went is on the row, not a page away.
  // Fills are only ever written to the trade owner, so every id here is the viewer's own.
  const fillTradeIds = page.items
    .filter((item) => item.kind === "fill")
    .map((item) => tradeIdFrom(item.href))
    .filter((id): id is string => id !== null);
  const [proposals, receipts] = await Promise.all([
    withMock(
      () => listMyProposals(session.userId),
      () => [],
    ),
    withMock(
      () => receiptsFor(fillTradeIds),
      () => new Map(),
    ),
  ]);

  // Mock fixtures are anchored to a fixed clock so relative times stay stable in dev.
  const now = referenceNow(process.env.MOCK_DATA === "1" ? NOW : undefined);
  const unread = page.items.filter((item) => item.readAt === null).length;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : "Everything read"}
          </p>
        </div>
        <MarkAllRead unreadCount={unread} />
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
          proposals={proposals}
          receipts={receipts}
          markRead={markNotificationRead}
        />
      </div>
    </div>
  );
}
