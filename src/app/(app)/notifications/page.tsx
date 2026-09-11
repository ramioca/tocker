import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { getNotifications } from "@/server/queries/users";
import { withMock } from "@/lib/data";
import { NOW, mockNotifications, mockSession } from "@/mocks/social";
import { referenceNow } from "@/components/social-common/format";
import { SignedOut } from "@/components/settings/signed-out";
import { NotificationList } from "@/components/notifications/notification-list";
import { MarkAllRead } from "@/components/notifications/mark-all-read";

export const metadata: Metadata = { title: "Notifications · Petri" };

export default async function NotificationsPage() {
  const session = await withMock(getSession, mockSession);
  if (!session) {
    return (
      <SignedOut
        title="Sign in for your notifications"
        body="Fills, follows, forks and failed runs — all in one list."
      />
    );
  }

  const page = await withMock(
    () => getNotifications(session.userId),
    () => mockNotifications(),
  );

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

      <div className="mt-8">
        <NotificationList items={page.items} now={now} />
      </div>
    </div>
  );
}
