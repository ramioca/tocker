"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { FloatingLabelInput } from "@/components/spectrumui/floating-label-input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState } from "@/components/common/empty-state";
import { removeLlmKey, rotateLlmKey } from "@/server/actions/users";
import type { LlmKeyDetail } from "@/lib/security/types";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<LlmKeyDetail["provider"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

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
export function LlmKeyInventory({ keys: initial, encryptionOk }: { keys: LlmKeyDetail[]; encryptionOk: boolean }) {
  const router = useRouter();
  const [keys, setKeys] = useState(initial);
  const [rotating, setRotating] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const revoke = (key: LlmKeyDetail) => {
    startTransition(async () => {
      const result = await removeLlmKey(key.id);
      if (!result.ok) {
        toast.error("Not revoked", { description: result.error });
        return;
      }
      setKeys((current) => current.filter((k) => k.id !== key.id));
      toast.success(`Revoked the ${PROVIDER_LABEL[key.provider]} key ending ${key.last4}`, {
        description:
          key.agentCount > 0
            ? `${key.agentCount} agent${key.agentCount === 1 ? "" : "s"} now has no key and cannot run.`
            : "No agent was using it.",
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
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
            <li key={key.id} className="bg-card/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground">
                  <KeyRound aria-hidden className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
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
                <div className="flex shrink-0 items-center gap-2">
                  <button
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
                    Rotate
                  </button>
                  <HoldToConfirmButton
                    size="sm"
                    duration={1_500}
                    resetDelay={0}
                    label="Hold to revoke"
                    confirmedLabel="Revoked"
                    onConfirm={() => revoke(key)}
                  />
                </div>
              </div>

              {rotating === key.id ? (
                <RotateForm
                  keyId={key.id}
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
            <span className="font-medium text-foreground">How these are stored.</span> AES-256-GCM at rest, as{" "}
            <code className="font-mono">base64(iv|tag|ciphertext)</code>, keyed by the deployment&rsquo;s{" "}
            <code className="font-mono">ENCRYPTION_KEY</code>
            {encryptionOk ? " (configured)" : " — which is NOT configured on this deployment"}. The plaintext is
            decrypted in exactly one place, inside the agent run loop, and never reaches a server component, an
            action result, a run transcript or your browser. Only these last four characters are ever rendered.
          </span>
        </p>
      </div>
    </div>
  );
}

function RotateForm({
  keyId,
  provider,
  agentCount,
  onDone,
}: {
  keyId: string;
  provider: string;
  agentCount: number;
  onDone: (last4: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const result = await rotateLlmKey({ id: keyId, key: value.trim() });
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    toast.success(`Rotated the ${provider} key`, {
      description: `Now ending ${result.data.last4}. ${agentCount} agent${agentCount === 1 ? "" : "s"} kept running.`,
    });
    setValue("");
    onDone(result.data.last4);
  };

  return (
    <form
      className="mt-4 space-y-3 rounded-lg border border-border/60 bg-background/40 p-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="text-xs leading-5 text-muted-foreground">
        Paste the replacement. The old ciphertext is overwritten in place — no previous secret is kept — and the
        key keeps its id, so the {agentCount} agent{agentCount === 1 ? "" : "s"} pointed at it never loses a tick.
      </p>
      <FloatingLabelInput
        id={`rotate-${keyId}`}
        label={`New ${provider} API key`}
        type="password"
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        className="font-mono"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <MorphButton size="sm" onAction={submit} successLabel="Rotated" errorLabel="Rejected">
        Replace key
      </MorphButton>
    </form>
  );
}
