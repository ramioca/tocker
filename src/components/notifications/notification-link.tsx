"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A notification row's link: opening an unread row marks it read.
 *
 * The write is fire-and-forget — navigation never waits on it — and the row's dot goes
 * the moment it is clicked (`data-read` drives `group-data-[read]/notification:hidden`
 * on the dot, which stays a server-rendered child). The refresh afterwards is what
 * brings the bell's count down. A failed write puts the dot back.
 *
 * Without `markRead` this is a plain link.
 */
export function NotificationLink({
  id,
  href,
  unread,
  markRead,
  className,
  children,
}: {
  id: string;
  href: string;
  unread: boolean;
  /** A server action; resolves `{ ok: false }` rather than throwing when the write fails. */
  markRead?: (id: string) => Promise<{ ok: boolean }>;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [read, setRead] = useState(!unread);

  return (
    <Link
      href={href}
      data-read={read ? "" : undefined}
      className={cn("group/notification", className)}
      onClick={() => {
        if (read || !markRead) return;
        setRead(true);
        const restore = () => setRead(false);
        void markRead(id).then((result) => (result.ok ? router.refresh() : restore()), restore);
      }}
    >
      {children}
    </Link>
  );
}
