"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Input } from "@/components/ui/input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState } from "@/components/common/empty-state";
import { attachKeyToKeylessAgents, removeLlmKey, rotateLlmKey } from "@/server/actions/users";
import type { LlmKeyDetail } from "@/lib/security/types";
import { cn } from "@/lib/utils";
import { MORPH_FOCUS, enterSubmits, useMorphAction } from "../use-morph-action";
import { mismatchedProvider, wrongProviderOnRotate } from "@/lib/agent/key-prefix";

// The server refuses anything shorter (src/server/actions/users.ts), so the client does too.
const KEY_MIN = 16;

function agentsWithoutKey(n: number): string {
  return n === 1 ? "1 agent now has no key and cannot run." : `${n} agents now have no key and cannot run.`;
}

const PROVIDER_LABEL: Record<LlmKeyDetail["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

// Names the row's actions. Two keys from one provider otherwise gave two identical
// "Rotate" and "Hold to revoke" buttons, with nothing to say which key each one acts on.
function keyA11yName(key: LlmKeyDetail) {
  const base = `${PROVIDER_LABEL[key.provider]} key ending ${key.last4}`;
  return key.label ? `${key.label}, ${base}` : base;
}

/**
 * The inventory view of the keys the operator has handed over: what provider,
 * which four characters, when it arrived, when it last thought, and how many
 * agents depend on it.
 *
 * Rotate keeps the key's id, so every agent pointed at it keeps working across
 * the swap — rotating a leaked key costs nothing, which is the only way anyone
 * actually does it. Revoke takes a deliberate hold and says out loud how many
 * agents it will leave without a brain.
 */
export function LlmKeyInventory({
  keys: initial,
  isAdmin = false,
  keylessAgents = 0,
}: {
  keys: LlmKeyDetail[];
  isAdmin?: boolean;
  /** How many of the owner's agents have no key and so cannot run; read on the server. */
  keylessAgents?: number;
}) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  // Follow the server whenever it sends a fresh list. A key removed on the Account tab is
  // committed as that tab unmounts, so this page can render a beat before the removal
  // lands; the action's revalidation then brings the corrected list here.
  const [synced, setSynced] = useState(initial);
  if (initial !== synced) {
    setSynced(initial);
    setKeys(initial);
  }
  const [rotating, setRotating] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Bumped per key when a revoke fails, to remount its hold button idle. Its confirmed
  // state never resets on its own (`resetDelay={0}`), so without this a failed revoke
  // left the row wearing a finished check with nothing left to hold.
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const [revoking, setRevoking] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rotateRefs = useRef(new Map<string, HTMLButtonElement>());
  // Where focus goes once the row it was in has left the DOM, or its hold button has
  // remounted: resolved after the commit, when the target exists.
  const focusAfter = useRef<(() => HTMLElement | null | undefined) | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    // Only when focus actually fell with the element: someone who moved on during the
    // round trip keeps their place.
    if (document.activeElement && document.activeElement !== document.body) return;
    target()?.focus();
  });

  // To the neighbouring row's Rotate button, or the section heading once the list is empty.
  const removeRow = (key: LlmKeyDetail) => {
    const index = keys.findIndex((k) => k.id === key.id);
    const neighbour = keys[index + 1] ?? keys[index - 1];
    focusAfter.current = neighbour
      ? () => rotateRefs.current.get(neighbour.id)
      : () => rootRef.current?.closest("section")?.querySelector<HTMLElement>("h2");
    setKeys((current) => current.filter((k) => k.id !== key.id));
  };

  const revoke = (key: LlmKeyDetail) => {
    setRevoking(key.id);
    startTransition(async () => {
      // A throw here would reach the route's error boundary and replace the page.
      const result = await removeLlmKey(key.id).catch(() => ({
        ok: false as const,
        error: "Could not reach Tocker. The key is still there.",
      }));
      setRevoking(null);
      if (!result.ok) {
        // Revoked from another tab, or on the Account tab: the key is gone, which is
        // what was asked for. Say so, rather than "Not revoked" beside a row that isn't there.
        if (result.error === "Key not found") {
          removeRow(key);
          toast.info("That key was already revoked");
          router.refresh();
          return;
        }
        focusAfter.current = () =>
          rootRef.current?.querySelector<HTMLElement>(`li[data-key-id="${key.id}"] button[aria-label^="Hold to revoke"]`);
        setAttempts((current) => ({ ...current, [key.id]: (current[key.id] ?? 0) + 1 }));
        toast.error("Not revoked", { description: result.error });
        return;
      }
      removeRow(key);
      const detached = result.data.detachedAgents;
      toast.success(`Revoked the ${PROVIDER_LABEL[key.provider]} key ending ${key.last4}`, {
        description: detached > 0 ? agentsWithoutKey(detached) : "No agent was using it.",
      });
      router.refresh();
    });
  };

  // One key: attaching it is unambiguous, so offer it here. Several: each agent picks.
  const onlyKey = keys.length === 1 ? keys[0] : null;
  const attachOnlyKey = () => {
    if (!onlyKey || attaching) return;
    setAttaching(true);
    startTransition(async () => {
      const result = await attachKeyToKeylessAgents(onlyKey.id).catch(() => ({
        ok: false as const,
        error: "Could not reach Tocker. Nothing was changed.",
      }));
      setAttaching(false);
      if (!result.ok) {
        toast.error("Key not attached", { description: result.error });
        return;
      }
      // The notice leaves with the refresh; its button had focus, so hand it to the row.
      focusAfter.current = () => rotateRefs.current.get(onlyKey.id);
      const n = result.data.attached;
      toast.success(n === 1 ? "Attached to 1 agent" : `Attached to ${n} agents`);
      router.refresh();
    });
  };

  return (
    <div ref={rootRef} className="space-y-4">
      {keylessAgents > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-600/30 bg-amber-500/5 px-3 py-2.5 text-sm">
          <span className="tnum">
            {keylessAgents === 1 ? "1 agent has no key" : `${keylessAgents} agents have no key`}
            <span className="text-muted-foreground"> and can&rsquo;t run.</span>
          </span>
          {onlyKey ? (
            <button
              type="button"
              onClick={attachOnlyKey}
              disabled={attaching}
              aria-busy={attaching || undefined}
              className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium transition-[background-color,transform,opacity] duration-150 hover:bg-muted active:scale-[0.97] disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {attaching
                ? "Attaching…"
                : `Attach the key ending ${onlyKey.last4} to ${keylessAgents === 1 ? "it" : "them"}`}
            </button>
          ) : keys.length === 0 ? (
            <Link href="/settings#keys" className="rounded text-xs underline underline-offset-2 hover:text-foreground focus-ring">
              Add a key
            </Link>
          ) : (
            <Link href="/agents" className="rounded text-xs underline underline-offset-2 hover:text-foreground focus-ring">
              Pick a key in each agent&rsquo;s settings
            </Link>
          )}
        </div>
      ) : null}
      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound aria-hidden />}
          title="No keys stored"
          description="Add one from the Account tab. Nothing is encrypted here until there is something to encrypt."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
          {keys.map((key) => (
            <li key={key.id} data-key-id={key.id} className="bg-card/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground">
                  <KeyRound aria-hidden className="size-4" />
                </span>
                {/*
                  A real basis, not flex-1: with a zero basis this column never forced the
                  actions to wrap, so on a phone it shrank to nothing and hid which key the
                  revoke button belongs to.
                */}
                <div className="min-w-0 grow basis-48">
                  <p className="truncate text-sm font-medium">
                    {key.label ?? `${PROVIDER_LABEL[key.provider]} key`}
                  </p>
                  <p className="tnum mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {PROVIDER_LABEL[key.provider]} · ••••{key.last4}
                  </p>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Added</dt>
                      <dd>
                        <RelativeTime iso={key.createdAt} className="text-foreground/80" />
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Last used</dt>
                      <dd>
                        {key.lastUsedAt ? (
                          <RelativeTime iso={key.lastUsedAt} className="text-foreground/80" />
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Agents</dt>
                      <dd className="tnum text-foreground/80">{key.agentCount}</dd>
                    </div>
                  </dl>
                </div>
                {/* A named group: focus entering it announces the key, so the hold button,
                    whose own name can't carry it, is still unambiguous. */}
                <div
                  role="group"
                  aria-label={keyA11yName(key)}
                  className="ml-11 flex shrink-0 items-center gap-2 sm:ml-0"
                >
                  <button
                    ref={(el) => {
                      if (!el) return;
                      rotateRefs.current.set(key.id, el);
                      return () => {
                        rotateRefs.current.delete(key.id);
                      };
                    }}
                    type="button"
                    onClick={() => setRotating((current) => (current === key.id ? null : key.id))}
                    aria-expanded={rotating === key.id}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium",
                      "transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <RotateCcw aria-hidden className="size-3.5" />
                    {/* The visible word leads the name, so "click Rotate" still works by voice. */}
                    Rotate<span className="sr-only"> {keyA11yName(key)}</span>
                  </button>
                  {/* "Revoking…" in a neutral tone, not a green "Revoked": the hold only
                      asks, and the server has not answered yet. The row leaving is the
                      answer; a refusal remounts the button idle (see `attempts`). */}
                  <HoldToConfirmButton
                    key={`${key.id}-${attempts[key.id] ?? 0}`}
                    size="sm"
                    duration={1_500}
                    resetDelay={0}
                    label="Hold to revoke"
                    confirmedLabel="Revoking…"
                    className={cn(
                      MORPH_FOCUS,
                      revoking === key.id &&
                        "border-border bg-muted text-muted-foreground dark:border-border dark:bg-muted dark:text-muted-foreground",
                    )}
                    onConfirm={() => revoke(key)}
                  />
                </div>
              </div>

              {rotating === key.id ? (
                <RotateForm
                  keyId={key.id}
                  providerId={key.provider}
                  provider={PROVIDER_LABEL[key.provider]}
                  agentCount={key.agentCount}
                  onDone={(last4) => {
                    setKeys((current) => current.map((k) => (k.id === key.id ? { ...k, last4 } : k)));
                    setRotating(null);
                    router.refresh();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Encrypted at rest (AES-256-GCM); only the last four characters are ever shown.
            {isAdmin ? (
              <>
                {" "}
                <Link href="/settings/admin#operator" className="rounded underline underline-offset-2 hover:text-foreground focus-ring">
                  Storage details
                </Link>
              </>
            ) : null}
          </span>
        </p>
      </div>
    </div>
  );
}

function RotateForm({
  keyId,
  providerId,
  provider,
  agentCount,
  onDone,
}: {
  keyId: string;
  providerId: LlmKeyDetail["provider"];
  provider: string;
  agentCount: number;
  onDone: (last4: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const submit = async () => {
    setError(null);
    if (value.trim().length < KEY_MIN) {
      setError("That doesn’t look like a full API key — paste the whole thing.");
      throw new Error("invalid key");
    }
    // Rotation keeps the provider, so another provider's key would take every agent on
    // this one down at its next run — and be saved when that provider can't be reached.
    const other = mismatchedProvider(value, providerId);
    if (other) {
      setError(wrongProviderOnRotate(other, providerId));
      throw new Error("wrong provider");
    }
    const result = await rotateLlmKey({ id: keyId, key: value.trim() });
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    const description = `Now ending ${result.data.last4}.${
      agentCount > 0 ? ` ${agentCount} agent${agentCount === 1 ? "" : "s"} kept running.` : ""
    }`;
    if (result.data.unverified) {
      // Saved, but the provider could not be asked; a wrong key shows up on the next run.
      toast.warning(`Saved — couldn’t reach ${provider} to check it`, { description });
    } else {
      toast.success(`Rotated the ${provider} key`, { description });
    }
    setValue("");
    onDone(result.data.last4);
  };

  const { state, run, reset } = useMorphAction(submit);

  return (
    <form
      className="mt-4 space-y-3 rounded-lg border border-border/60 bg-background/40 p-3"
      noValidate
      onKeyDown={enterSubmits(() => {
        if (value.trim().length > 0) void run();
      })}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim().length > 0) void run();
      }}
    >
      <p className="text-xs leading-5 text-muted-foreground">
        Paste the replacement. The old ciphertext is overwritten in place — no previous secret is kept — and the
        key keeps its id
        {agentCount > 0
          ? agentCount === 1
            ? ", so the 1 agent pointed at it never loses a tick."
            : `, so the ${agentCount} agents pointed at it never lose a tick.`
          : "."}
      </p>
      <div>
        <label htmlFor={`rotate-${keyId}`} className="text-sm font-medium">
          New {provider} API key
        </label>
        <Input
          id={`rotate-${keyId}`}
          type="password"
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
            reset();
          }}
          className="mt-2 h-9 font-mono"
        />
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <MorphButton
        size="sm"
        state={state}
        onClick={() => void run()}
        successLabel="Rotated"
        errorLabel="Rejected"
        disabled={state === "idle" && value.trim().length === 0}
        className={MORPH_FOCUS}
      >
        Replace key
      </MorphButton>
    </form>
  );
}
