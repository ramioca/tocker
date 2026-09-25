"use client";

/**
 * Which notifications reach the bell and the list. Stored server-side
 * (`users.notification_prefs`) and applied by `getNotifications` and the unread count,
 * so a switch that is off really does keep those rows out.
 *
 * Optimistic: the switch moves at once and comes back, with a toast, if the save fails.
 * Proposals and failed exits are not listed because they cannot be turned off.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import {
  NOTIFICATION_PREF_GROUPS,
  groupEnabled,
  withGroup,
  type NotificationPrefGroup,
  type NotificationPrefs as Prefs,
} from "@/lib/notifications/prefs";
import { updateNotificationPrefs } from "@/server/actions/users";

export function NotificationPrefs({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [, startTransition] = useTransition();

  const set = (group: NotificationPrefGroup, on: boolean) => {
    const previous = prefs;
    const next = withGroup(prefs, group, on);
    setPrefs(next);
    startTransition(async () => {
      const result = await updateNotificationPrefs(next).catch(() => ({
        ok: false as const,
        error: "Could not reach Tocker.",
      }));
      if (result.ok) return;
      setPrefs(previous);
      toast.error("Not saved", { description: result.error });
    });
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border/70">
        {NOTIFICATION_PREF_GROUPS.map((group) => {
          const on = groupEnabled(prefs, group);
          return (
            <li key={group.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{group.label}</p>
                <p className="text-sm text-muted-foreground">{group.description}</p>
              </div>
              <AnimatedSwitch
                checked={on}
                onCheckedChange={(value) => set(group, value)}
                label={group.label}
                size="sm"
                // The registry's off track is near-black on the dark card (well under
                // the 3:1 a control's boundary needs); a lighter track, an edge and a
                // lighter knob make "off" read as a switch rather than a gap.
                className={
                  on
                    ? undefined
                    : "dark:bg-neutral-600 dark:ring-1 dark:ring-inset dark:ring-white/25 dark:[&>span:nth-child(2)]:!bg-neutral-300"
                }
              />
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        Trades waiting for your approval and exits that failed to fill always come through.
      </p>
    </div>
  );
}
