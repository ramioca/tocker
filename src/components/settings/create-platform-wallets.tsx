"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ensurePlatformWalletsAction } from "@/server/actions/platform";

/** One button: create the platform wallets, then re-render the card that lists them. */
export function CreatePlatformWallets({
  hasWallets,
  privyConfigured,
}: {
  hasWallets: boolean;
  /** Without Privy there is nothing to create the wallets with, so the button says why instead of failing. */
  privyConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Stacked, not side by side: the error is a sentence, and beside the button on a phone
  // it wrapped into a five-line column.
  return (
    <div className="mt-3 flex flex-col items-start gap-2">
      <Button
        type="button"
        size="sm"
        variant={hasWallets ? "outline" : "default"}
        disabled={pending || !privyConfigured}
        onClick={() =>
          start(async () => {
            setError(null);
            // A network throw would otherwise land on the route's error boundary.
            const res = await ensurePlatformWalletsAction().catch(() => ({
              ok: false as const,
              error: "Could not reach Tocker.",
            }));
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Creating…" : hasWallets ? "Verify platform wallets" : "Create platform wallets"}
      </Button>
      {privyConfigured ? null : (
        <p className="text-xs text-muted-foreground">
          Needs Privy: set <code className="font-mono break-words text-foreground/80">NEXT_PUBLIC_PRIVY_APP_ID</code> and{" "}
          <code className="font-mono break-words text-foreground/80">PRIVY_APP_SECRET</code>.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
