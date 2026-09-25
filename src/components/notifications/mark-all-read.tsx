"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { useRunStatus } from "@/components/providers/run-status";
import { markNotificationsRead } from "@/server/actions/users";

/** The page's h1, which takes the focus when this button goes away under it. */
const TITLE_ID = "notifications-title";

/**
 * Nothing unread renders nothing: the page's own subtitle says "All caught up", so the
 * header keeps its height and the answer is said once.
 */
export function MarkAllRead({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const { refreshProposals } = useRunStatus();
  const [refreshing, startRefresh] = useTransition();
  // Resolves the button's action once the refreshed page has landed. Resolving on the
  // write alone put "Marked read" beside a header, bell and rows still showing unread,
  // and then the list jumped when the refresh caught up.
  const settle = useRef<(() => void) | null>(null);
  // The button when a press left the focus on it (keyboard, or a click that focuses).
  const pressed = useRef<Element | null>(null);

  useEffect(() => {
    if (refreshing || !settle.current) return;
    settle.current();
    settle.current = null;
  }, [refreshing]);

  // At zero this component renders nothing, so the focused button is gone and the focus
  // would drop to <body>. Hand it to the heading instead, where the next Tab carries on.
  useEffect(() => {
    const button = pressed.current;
    if (unreadCount > 0 || !button) return;
    pressed.current = null;
    const active = document.activeElement;
    if (!button.isConnected && (active === null || active === document.body)) {
      document.getElementById(TITLE_ID)?.focus();
    }
  }, [unreadCount]);

  if (unreadCount === 0) return null;

  return (
    <MorphButton
      size="sm"
      className={MORPH_FOCUS}
      successLabel="Marked read"
      errorLabel="Failed"
      onAction={async () => {
        const active = document.activeElement;
        pressed.current = active instanceof HTMLButtonElement ? active : null;
        try {
          const result = await markNotificationsRead();
          if (!result.ok) throw new Error(result.error);
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          // Foundation's action is still a stub — don't show a failure in dev.
          if (!message.includes("not implemented")) throw error;
        }
        refreshProposals();
        await new Promise<void>((resolve) => {
          settle.current = resolve;
          startRefresh(() => router.refresh());
        });
      }}
    >
      Mark all read ({unreadCount})
    </MorphButton>
  );
}
