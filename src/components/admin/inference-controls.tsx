"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleStop, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearInferencePauseAction,
  setInferenceHaltAction,
  testInferenceSignatureAction,
} from "@/server/actions/admin";

/**
 * The three things an admin can do about pay-per-use thinking from this page.
 *
 * Two of them are switches on money and are built to be hard to press by accident in the
 * direction that matters. Halting is one press with a reason typed: stopping is always
 * safe, and the reason is for whoever clears it. Clearing a halt, or ending a breaker's
 * pause early, lets payments move again, so each takes two presses, and the second one
 * says what it will do.
 *
 * The third signs nothing that is sent: see the note on the test itself.
 *
 * Nothing here moves. A switch that animates is a switch whose state you have to wait to
 * read.
 */

const UNREACHABLE = { ok: false as const, error: "Could not reach Tocker. Nothing was changed." };

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="break-words text-xs text-destructive">
      {children}
    </p>
  );
}

function HaltSwitch({ halted }: { halted: boolean }) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = (next: boolean) =>
    start(async () => {
      setError(null);
      // A network throw would otherwise land on the route's error boundary.
      const res = await setInferenceHaltAction({ halted: next, reason }).catch(() => UNREACHABLE);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReason("");
      setArmed(false);
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-reason`} className="text-sm font-medium">
        {halted ? "Clear the halt" : "Halt pay-per-use for every agent"}
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        {halted
          ? "Payments start again from the next step any agent asks for. Clear it only once what it was thrown for has been looked at."
          : "Stops the next signature on every server, with no deploy. A payment already signed finishes and is recorded. Nothing else about any agent changes."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${id}-reason`}
          value={reason}
          maxLength={300}
          autoComplete="off"
          placeholder={halted ? "A note on why it is safe now (optional)" : "Why (required)"}
          disabled={pending}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          className="sm:flex-1"
        />
        {halted ? (
          armed ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => send(false)}>
              <Play aria-hidden />
              {pending ? "Clearing…" : "Yes, let payments resume"}
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={() => setArmed(true)}>
              <Play aria-hidden />
              Clear the halt
            </Button>
          )
        ) : (
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 4}
            onClick={() => send(true)}
          >
            <CircleStop aria-hidden />
            {pending ? "Halting…" : "Halt pay-per-use"}
          </Button>
        )}
      </div>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

function EndPause() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">End the pause early</p>
      <p className="text-xs leading-5 text-muted-foreground">
        A pause is the ledger&rsquo;s own, set on its own evidence, and it ends by itself. Ending it now tells the ledger
        that what tripped it has been dealt with, so the same evidence does not pause the platform again.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          start(async () => {
            setError(null);
            const res = await clearInferencePauseAction().catch(() => UNREACHABLE);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setArmed(false);
            router.refresh();
          });
        }}
      >
        <Play aria-hidden />
        {pending ? "Ending…" : armed ? "Yes, let payments resume" : "End the pause now"}
      </Button>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

/** A wallet the test may sign with: one of the viewing admin's own agents', never anyone else's. */
export interface ProbeWallet {
  walletId: string;
  address: string;
  agentName: string;
  payPerUse: boolean;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

function SignatureTest({ wallets }: { wallets: ProbeWallet[] }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [walletId, setWalletId] = useState(wallets[0]?.walletId ?? "");
  const [result, setResult] = useState<{ agentName: string; checks: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-wallet`} className="text-sm font-medium">
        Test a signature (nothing is sent)
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        Asks BlockRun for a real quote on a fixed one-line prompt, checks it against the pins, has this wallet sign the
        payment under its own Privy policy, and checks the signed bytes. The signed payment is then thrown away: it
        is never sent, never recorded and expires within about a minute. Each press is one request to the gateway and
        one signature. It works with pay-per-use switched off. Only the wallets of your own agents are offered, and
        the server refuses any other: being an admin is no reason to have someone else&rsquo;s wallet sign a payment.
      </p>
      {wallets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None of your own agents has a real Solana wallet yet. Build an agent of your own with Solana among its
          chains, with Privy configured.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id={`${id}-wallet`}
            value={walletId}
            disabled={pending}
            onChange={(event) => {
              setWalletId(event.target.value);
              setResult(null);
              setError(null);
            }}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:flex-1 md:text-sm"
          >
            {wallets.map((wallet) => (
              <option key={wallet.walletId} value={wallet.walletId} className="bg-card">
                {wallet.agentName} · {shortAddress(wallet.address)}
                {wallet.payPerUse ? " · pays per use" : ""}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={pending || walletId === ""}
            onClick={() =>
              start(async () => {
                setError(null);
                setResult(null);
                const res = await testInferenceSignatureAction({ walletId }).catch(() => UNREACHABLE);
                if (res.ok) setResult(res.data);
                else setError(res.error);
              })
            }
          >
            <ShieldCheck aria-hidden />
            {pending ? "Signing…" : "Test a signature"}
          </Button>
        </div>
      )}
      {error ? <Problem>Not passed: {error}</Problem> : null}
      {result ? (
        <div role="status" className="rounded-lg border border-[var(--glass-hairline)] px-3 py-2.5">
          <p className="text-xs font-medium">Passed for {result.agentName}. Nothing was sent.</p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
            {result.checks.map((check, index) => (
              <li key={index} className="flex gap-1.5">
                <Check aria-hidden className="mt-1 size-3 shrink-0" />
                <span className="min-w-0 break-words">{check}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function InferenceControls({
  halted,
  paused,
  wallets,
}: {
  halted: boolean;
  /** A breaker's pause is in force right now. */
  paused: boolean;
  wallets: ProbeWallet[];
}) {
  return (
    <div className="space-y-6">
      <HaltSwitch halted={halted} />
      {paused ? <EndPause /> : null}
      <SignatureTest wallets={wallets} />
    </div>
  );
}
