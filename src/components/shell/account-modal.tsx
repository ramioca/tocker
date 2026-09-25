"use client";

import Link from "next/link";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopy } from "@/components/common/address";
import type { Session } from "@/server/types";

/**
 * The "Account details" card: who you are signed in as, in copyable rows, and the way
 * to Settings → Profile, where the handle and display name are actually changed. Money
 * is deliberately absent — your cash, with Deposit and Withdraw, hangs off the balance
 * in the top bar, and each agent page carries its own funding drawer.
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
          <DialogTitle>Account details</DialogTitle>
          <DialogDescription>
            How you sign in and how others see you. Deposit and withdraw from the cash balance in the top bar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Row label="Login email" value={session.email ?? "—"} copyable={Boolean(session.email)} />
          <Row label="Handle" value={`@${session.handle}`} copyable />
          {session.displayName ? <Row label="Display name" value={session.displayName} /> : null}
        </div>
        <DialogFooter>
          <Link
            href="/settings#profile"
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: "outline" })}
          >
            Edit profile
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const { copied, failed, copy } = useCopy();

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
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : failed ? (
            <TriangleAlert aria-hidden className="size-4 text-destructive" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
        </button>
      ) : null}
      {/* The icon swap is silent; this says what happened, including a refused clipboard. */}
      {copyable ? (
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied" : failed ? "Couldn't copy — select the text instead" : ""}
        </span>
      ) : null}
    </div>
  );
}
