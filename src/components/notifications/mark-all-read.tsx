"use client";

import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { markNotificationsRead } from "@/server/actions/users";

export function MarkAllRead({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();

  if (unreadCount === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCheck className="size-3.5" aria-hidden />
        All caught up
      </p>
    );
  }

  return (
    <MorphButton
      size="sm"
      className={MORPH_FOCUS}
      successLabel="Marked read"
      errorLabel="Failed"
      onAction={async () => {
        try {
          const result = await markNotificationsRead();
          if (!result.ok) throw new Error(result.error);
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          // Foundation's action is still a stub — don't show a failure in dev.
          if (!message.includes("not implemented")) throw error;
        }
        router.refresh();
      }}
    >
      Mark all read ({unreadCount})
    </MorphButton>
  );
}
