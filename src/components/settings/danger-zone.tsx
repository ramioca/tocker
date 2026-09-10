"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { useSession } from "@/hooks/use-session";

export function DangerZone() {
  const { logout } = useSession();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Signing out leaves your agents running on their schedules. Pause them from each
        agent&rsquo;s settings first if you want everything to stop.
      </p>
      <HoldToConfirmButton
        label="Hold to sign out"
        confirmedLabel="Signing out"
        icon={<LogOut className="size-4" aria-hidden />}
        duration={900}
        disabled={busy}
        onConfirm={() => {
          setBusy(true);
          void logout();
        }}
      />
    </div>
  );
}
