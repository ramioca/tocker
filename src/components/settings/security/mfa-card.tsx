"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
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
 * that something changed and ask the server to look again — a client that lied
 * about being enrolled would still be refused by `goLiveAction`.
 *
 * When the Privy app has no MFA methods turned on there is nothing to enrol in,
 * and a disabled button with no explanation is the worst version of that. The
 * exact dashboard path is printed instead.
 */
export function MfaCard({ initial }: { initial: MfaStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { ready, authenticated } = usePrivy();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const sync = useCallback(() => {
    startTransition(async () => {
      const result = await noteMfaChangeAction();
      if (result.ok) {
        setStatus(result.data);
        router.refresh();
      } else {
        const refreshed = await refreshMfaStatusAction();
        if (refreshed.ok) setStatus(refreshed.data);
        toast.error("Could not confirm your second factor", { description: result.error });
      }
    });
  }, [router]);

  const enrol = useCallback(() => {
    if (!ready || !authenticated) {
      toast.error("Sign in with Privy first");
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
  const canEnrol = status.available && status.appMethods.length > 0;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "glass flex items-start gap-3 rounded-xl border p-4",
          enrolled ? "border-positive/30 bg-positive/5" : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <span className="mt-0.5 shrink-0">
          {enrolled ? (
            <ShieldCheck aria-hidden className="size-5 text-positive" />
          ) : (
            <ShieldAlert aria-hidden className="size-5 text-amber-500" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {enrolled ? "A second factor is enrolled" : "No second factor enrolled"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {enrolled ? (
              <>
                Privy reports{" "}
                <span className="text-foreground">
                  {status.userMethods.map((m) => METHOD_LABEL[m] ?? m).join(", ")}
                </span>
                . It is optional — nothing was ever blocked on it — but it is on the account that moves your money.
              </>
            ) : (
              (status.blockedReason ??
              "Optional: nothing is blocked without one. Enrol a second factor if you want it on the account that moves your money.")
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={enrol}
          disabled={!canEnrol || pending}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium",
            "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <KeyRound aria-hidden className="size-4" />
          {enrolled ? "Manage factors" : "Enrol a second factor"}
        </button>
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pending ? "Checking…" : "Re-check with Privy"}
        </button>
      </div>

      {/* Saying exactly how far the guarantee goes is the point of a security screen. */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium text-foreground">What this does and does not do.</span> The check is
            server-side: Tocker asks Privy whether your account has a factor enrolled and refuses live mode and
            withdrawals when it does not, even if the browser claims otherwise. It is a check on{" "}
            <em>enrolment</em>, not a fresh challenge for each action — your agent&rsquo;s wallet is signed
            server-side by the app&rsquo;s authorization key, so there is no user-side signing step to attach a
            challenge to. It stops an account protected by an email code alone from ever reaching live mode; it
            does not stop someone who already holds a live session on your device.
          </span>
        </p>
      </div>
    </div>
  );
}
