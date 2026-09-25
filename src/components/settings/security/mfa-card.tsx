"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Shield, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { useMfaEnrollment, usePrivy } from "@privy-io/react-auth";
import { noteMfaChangeAction, refreshMfaStatusAction } from "@/server/actions/security";
import type { MfaStatus } from "@/lib/security/types";
import { cn } from "@/lib/utils";

const METHOD_LABEL: Record<string, string> = {
  totp: "Authenticator app",
  passkey: "Passkey",
  sms: "SMS",
  email: "Email code",
};

/**
 * Second factor, enrolled through Privy's own modal.
 *
 * The status shown here comes from the **server**, which asks Privy's API for the
 * user's `mfa_methods`. The browser's own `user.mfaMethods` is used only to notice
 * that something changed and ask the server to look again.
 *
 * It is **optional**, and this card has to say so plainly: `secondFactorBlock` returns
 * null in every case, so nothing in the product is refused for want of a factor. A
 * security screen that overstates its own guarantee is the one place where good copy
 * does real harm — it is what someone reads before deciding they do not need to be
 * careful about anything else. See the module doc in `src/lib/security/mfa.ts`.
 *
 * When there is nothing to enroll in (no Privy on this deployment, or no MFA methods
 * turned on), the card is one quiet line and no controls: a disabled Enroll, a Re-check
 * that can only fail and a paragraph about signing keys were all describing a feature
 * the user cannot have. The operator's version of that lives on the admin page.
 */
export function MfaCard({ initial }: { initial: MfaStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { ready, authenticated } = usePrivy();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const sync = useCallback(() => {
    startTransition(async () => {
      // A throw inside the transition would reach the route's error boundary and take
      // the kill switch above down with this card.
      try {
        const result = await noteMfaChangeAction();
        if (result.ok) {
          setStatus(result.data);
          router.refresh();
        } else {
          const refreshed = await refreshMfaStatusAction();
          if (refreshed.ok) setStatus(refreshed.data);
          toast.error("Could not confirm your second factor", { description: result.error });
        }
      } catch {
        toast.error("Could not confirm your second factor", {
          description: "Could not reach Tocker. Nothing changed.",
        });
      }
    });
  }, [router]);

  const enroll = useCallback(() => {
    if (!ready || !authenticated) {
      toast.error("Sign in first");
      return;
    }
    showMfaEnrollmentModal();
    // The modal is not a promise. Re-ask the server when it hands focus back —
    // whatever the browser thinks happened, the server checks with Privy.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      sync();
    };
    window.addEventListener("focus", onFocus);
  }, [authenticated, ready, showMfaEnrollmentModal, sync]);

  const enrolled = status.enrolled;
  const canEnroll = status.available && status.appMethods.length > 0;

  if (!enrolled && !canEnroll) {
    // `operatorNote` is set only when the deployment itself has no factor to offer; a
    // null one with `available: false` is a failed read, which is worth one more try.
    const transient = !status.available && status.operatorNote === null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/70 bg-muted/20 p-4">
        <Shield aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 basis-56 text-sm leading-6 text-muted-foreground">
          {transient && status.blockedReason
            ? status.blockedReason
            : "Two-factor sign-in isn’t available yet. Nothing in Tocker needs it today."}
        </p>
        {transient ? (
          <button
            type="button"
            onClick={sync}
            disabled={pending}
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {pending ? "Checking…" : "Re-check"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Not-enrolled is drawn neutral, not amber. An alert colour is a claim that
          something is wrong, and nothing is: the factor is genuinely optional and
          refuses nothing. Amber here would be the same overstatement as the old copy,
          made with colour instead of words. */}
      <div
        className={cn(
          "glass flex items-start gap-3 rounded-xl border p-4",
          enrolled ? "border-positive/30 bg-positive/5" : "border-border/70 bg-muted/20",
        )}
      >
        <span className="mt-0.5 shrink-0">
          {enrolled ? (
            <ShieldCheck aria-hidden className="size-5 text-positive" />
          ) : (
            <Shield aria-hidden className="size-5 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {enrolled ? "A second factor is enrolled" : "No second factor enrolled — optional"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {enrolled ? (
              <>
                Your sign-in has{" "}
                <span className="text-foreground">
                  {status.userMethods.map((m) => METHOD_LABEL[m] ?? m).join(", ")}
                </span>
                . Tocker does not require it, and never refused anything without it — but it is on your Tocker
                sign-in, which holds your money. That is where it counts.
              </>
            ) : (
              (status.blockedReason ??
              "Nothing in Tocker is blocked without one. Enroll a second factor to protect the sign-in that holds your money.")
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={enroll}
          disabled={!canEnroll || pending}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium",
            "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <KeyRound aria-hidden className="size-4" />
          {enrolled ? "Manage factors" : "Enroll a second factor"}
        </button>
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pending ? "Checking…" : "Re-check"}
        </button>
      </div>

      {/* Saying exactly how far the guarantee goes is the point of a security screen —
          in two sentences, not a paragraph about signing keys. */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Optional:</span> going live and withdrawing work without
            it. It protects your sign-in, not individual actions.
          </span>
        </p>
      </div>
    </div>
  );
}
