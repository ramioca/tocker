"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRunStatus } from "@/components/providers/run-status";
import { cn } from "@/lib/utils";

/**
 * A notification row's link: opening an unread row marks it read.
 *
 * The write is fire-and-forget — navigation never waits on it — and the row's dot goes
 * the moment it is clicked (`data-read` drives `group-data-[read]/notification:hidden`
 * on the dot, which stays a server-rendered child). Afterwards the page is refreshed and
 * the bell's poll re-read, which is what brings its count down. A failed write puts the
 * dot back.
 *
 * Without `markRead` this is a plain link.
 */
export function NotificationLink({
  id,
  href,
  unread,
  markRead,
  labelledBy,
  unreadId,
  describedBy,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  /** Ids of the parts that name the link: the title and time, not the whole row. */
  labelledBy?: string;
  /**
   * The row's "Unread" text. Added to the name only while unread: accessible-name
   * computation still reads a `display: none` element that `aria-labelledby` points at,
   * so leaving it in would keep saying "Unread" after the row was opened.
   */
  unreadId?: string;
  describedBy?: string;
  /** A server action; resolves `{ ok: false }` rather than throwing when the write fails. */
  markRead?: (id: string) => Promise<{ ok: boolean }>;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { refreshProposals } = useRunStatus();
  const [read, setRead] = useState(!unread);

  return (
    <Link
      href={href}
      data-read={read ? "" : undefined}
      aria-labelledby={labelledBy ? (read || !unreadId ? labelledBy : `${labelledBy} ${unreadId}`) : undefined}
      aria-describedby={describedBy}
      className={cn("group/notification", className)}
      onClick={() => {
        if (read || !markRead) return;
        setRead(true);
        const restore = () => setRead(false);
        void markRead(id).then((result) => {
          if (!result.ok) return restore();
          router.refresh();
          refreshProposals();
        }, restore);
      }}
    >
      {children}
    </Link>
  );
}
