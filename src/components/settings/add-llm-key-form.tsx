"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { addLlmKey } from "@/server/actions/users";
import type { LlmKeyRow } from "@/server/types";
import { MORPH_FOCUS, enterSubmits, useMorphAction } from "./use-morph-action";

type Provider = LlmKeyRow["provider"];
type Field = "key" | "label" | "workspace";

// The server refuses anything shorter (src/server/actions/users.ts), so the client does too.
const KEY_MIN = 16;

/** Which field a server error is about, so it can sit under that field. */
function fieldFor(message: string): Field {
  if (/^label/i.test(message)) return "label";
  if (/workspace id/i.test(message)) return "workspace";
  return "key";
}

const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-…" },
  { id: "openai", label: "OpenAI", hint: "sk-…" },
  { id: "openrouter", label: "OpenRouter", hint: "sk-or-…" },
];

function providerLabel(provider: Provider): string {
  return PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function AddLlmKeyForm({
  onAdded,
  onCancel,
  autoFocus = false,
  submitLabel = "Add key",
}: {
  onAdded?: (key: LlmKeyRow) => void;
  /** Set when the form was opened on demand, so there is somewhere to go back to. Escape calls it too. */
  onCancel?: () => void;
  /** Focus the first field on mount: the button that opened the form has just unmounted. */
  autoFocus?: boolean;
  submitLabel?: string;
}) {
  const uid = useId();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);

  const hint = PROVIDERS.find((p) => p.id === provider)?.hint ?? "";

  async function submit() {
    setError(null);
    if (key.trim().length < KEY_MIN) {
      setError({ field: "key", message: "That doesn’t look like a full API key — paste the whole thing." });
      throw new Error("invalid key");
    }
    const optimistic: LlmKeyRow = {
      id: `local_${Date.now()}`,
      provider,
      label: label.trim() || null,
      last4: key.trim().slice(-4),
      createdAt: new Date().toISOString(),
    };
    try {
      const result = await addLlmKey({
        provider,
        key: key.trim(),
        label: label.trim() || undefined,
        workspaceId: provider === "anthropic" && workspaceId.trim() ? workspaceId.trim() : undefined,
      });
      if (!result.ok) {
        setError({ field: fieldFor(result.error), message: result.error });
        throw new Error(result.error);
      }
      if (result.data.unverified) {
        // Saved, but the provider could not be asked (down, slow, a network in the way).
        // A toast, not the button: the form closes as soon as the key is added.
        toast.warning(`Saved — couldn’t reach ${providerLabel(provider)} to check it`, {
          description: "If the key is wrong, the agent’s next run will fail and say so.",
        });
      }
      onAdded?.({ ...optimistic, id: result.data.id, last4: result.data.last4 });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not add the key";
      // Only ever in development: in production a server error that happened to contain
      // these words would otherwise render a key row that does not exist.
      if (process.env.NODE_ENV === "production" || !message.includes("not implemented")) {
        setError((current) => current ?? { field: "key", message });
        throw e;
      }
      // Dev / mock mode: the action is still a stub, so show the row locally.
      onAdded?.(optimistic);
    }
    setKey("");
    setLabel("");
  }

  const { state, run, reset } = useMorphAction(submit);

  // Editing a field clears its error and takes the button out of "Rejected".
  const edited = (field: Field) => {
    if (error?.field === field) setError(null);
    reset();
  };

  const errorFor = (field: Field) =>
    error?.field === field ? (
      <p id={`${uid}-${field}-error`} role="alert" className="mt-1.5 text-sm text-destructive">
        {error.message}
      </p>
    ) : null;

  const invalid = (field: Field) =>
    error?.field === field ? { "aria-invalid": true, "aria-describedby": `${uid}-${field}-error` } : {};

  const submitOnEnter = enterSubmits(() => {
    if (key.trim().length > 0) void run();
  });

  return (
    <form
      className="space-y-4"
      noValidate
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCancel) {
          event.preventDefault();
          onCancel();
          return;
        }
        submitOnEnter(event);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim().length > 0) void run();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-provider`} className="text-sm font-medium">
            Provider
          </label>
          <select
            id={`${uid}-provider`}
            autoFocus={autoFocus}
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
            className="mt-2 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none md:text-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id} className="bg-card">
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${uid}-label`} className="text-sm font-medium">
            Label <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${uid}-label`}
            value={label}
            maxLength={40}
            placeholder="Personal key"
            {...invalid("label")}
            onChange={(event) => {
              setLabel(event.target.value);
              edited("label");
            }}
            className="mt-2 h-9 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none md:text-sm transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          {errorFor("label")}
        </div>
      </div>

      {/*
        Top labels and a transparent fill, like Provider and Label above — a floating label
        paints its own background, which shows as a dark box on a card.
      */}
      <div>
        <label htmlFor={`${uid}-key`} className="text-sm font-medium">
          API key <span className="font-normal text-muted-foreground">({hint})</span>
        </label>
        <div className="relative mt-2">
          <Input
            id={`${uid}-key`}
            type={revealed ? "text" : "password"}
            value={key}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={512}
            {...invalid("key")}
            onChange={(event) => {
              setKey(event.target.value);
              edited("key");
            }}
            className="h-9 pr-10 font-mono dark:bg-transparent"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? "Hide the key" : "Show the key"}
            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {errorFor("key")}
      </div>

      {provider === "anthropic" ? (
        <div>
          <label htmlFor={`${uid}-workspace`} className="text-sm font-medium">
            Workspace ID <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id={`${uid}-workspace`}
            value={workspaceId}
            autoComplete="off"
            spellCheck={false}
            {...invalid("workspace")}
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              edited("workspace");
            }}
            className="mt-2 h-9 font-mono dark:bg-transparent"
          />
          {errorFor("workspace")}
          <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
            Leave empty: Tocker detects the workspace for an organization-level key on its own. Set it only
            to force a specific one (Console → Settings → Workspaces, wrkspc_…).
          </p>
        </div>
      ) : null}

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Encrypted at rest with AES-256-GCM and decrypted only inside an agent run. It is
        never sent to the browser and never printed in a run transcript — which nobody but
        you can read anyway.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Disabled while empty: an empty submit is not a rejected key, and should not look like one. */}
        <MorphButton
          state={state}
          onClick={() => void run()}
          size="sm"
          successLabel="Added"
          errorLabel="Rejected"
          disabled={state === "idle" && key.trim().length === 0}
          className={MORPH_FOCUS}
        >
          {submitLabel}
        </MorphButton>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 text-xs text-muted-foreground"
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
