"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";

/**
 * Sign out, in one click — as it is in the account menu. It used to be a hold-to-confirm
 * inside a red "Danger zone": signing out loses nothing, so the ceremony only made it
 * cost more here than one menu away, and the red frame claimed a risk that isn't there.
 *
 * The copy points at the kill switch because "signing out stops my agents" is the
 * belief worth correcting at this exact moment.
 */
export function SignOutSection() {
  const { logout } = useSession();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Your agents keep running on their schedules. To stop them all, use{" "}
        <Link
          href="/settings/security#kill-switch"
          className="rounded text-foreground underline underline-offset-2 focus-ring"
        >
          Stop everything
        </Link>{" "}
        on the Security tab.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Normally the page is gone before this settles; if it throws, give the button back.
          logout().catch(() => setBusy(false));
        }}
      >
        <LogOut aria-hidden />
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
