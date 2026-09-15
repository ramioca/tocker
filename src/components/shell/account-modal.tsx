"use client";

import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopy } from "@/components/common/address";
import type { Session } from "@/server/types";

/**
 * The "Manage account" card: who you are logged in as, in copyable rows. Wallet
 * addresses are deliberately absent — funds live with each agent, and each agent
 * page carries its own funding drawer with the real addresses.
 */
export function AccountModal({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage account</DialogTitle>
          <DialogDescription>
            Your login and identity. Agent wallets live on each agent&rsquo;s page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Row label="Login email" value={session.email ?? "—"} copyable={Boolean(session.email)} />
          <Row label="Handle" value={`@${session.handle}`} copyable />
          {session.displayName ? <Row label="Display name" value={session.displayName} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const { copied, copy } = useCopy();

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
      {copyable ? (
        <button
          type="button"
          onClick={() => void copy(value)}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        </button>
      ) : null}
    </div>
  );
}
