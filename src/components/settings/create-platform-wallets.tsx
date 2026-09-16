"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ensurePlatformWalletsAction } from "@/server/actions/platform";

/** One button: create the platform wallets, then re-render the card that lists them. */
export function CreatePlatformWallets({ hasWallets }: { hasWallets: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 flex items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant={hasWallets ? "outline" : "default"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await ensurePlatformWalletsAction();
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Creating…" : hasWallets ? "Verify platform wallets" : "Create platform wallets"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
