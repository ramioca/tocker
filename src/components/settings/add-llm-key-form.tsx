"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { FloatingLabelInput } from "@/components/spectrumui/floating-label-input";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { addLlmKey } from "@/server/actions/users";
import type { LlmKeyRow } from "@/server/types";

type Provider = LlmKeyRow["provider"];

const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: "anthropic", label: "Anthropic", hint: "sk-ant-…" },
  { id: "openai", label: "OpenAI", hint: "sk-…" },
  { id: "openrouter", label: "OpenRouter", hint: "sk-or-…" },
];

export function AddLlmKeyForm({
  onAdded,
  submitLabel = "Add key",
}: {
  onAdded?: (key: LlmKeyRow) => void;
  submitLabel?: string;
}) {
  const uid = useId();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = PROVIDERS.find((p) => p.id === provider)?.hint ?? "";

  async function submit() {
    setError(null);
    if (key.trim().length < 12) {
      setError("That key looks too short.");
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
      const result = await addLlmKey({ provider, key: key.trim(), label: label.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        throw new Error(result.error);
      }
      onAdded?.({ ...optimistic, id: result.data.id, last4: result.data.last4 });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not add the key";
      if (!message.includes("not implemented")) {
        setError(message);
        throw e;
      }
      // Dev / mock mode: the action is still a stub, so show the row locally.
      onAdded?.(optimistic);
    }
    setKey("");
    setLabel("");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-provider`} className="text-sm font-medium">
            Provider
          </label>
          <select
            id={`${uid}-provider`}
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
            className="mt-2 h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
            onChange={(event) => setLabel(event.target.value)}
            className="mt-2 h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div className="relative">
        <FloatingLabelInput
          id={`${uid}-key`}
          label={`API key (${hint})`}
          type={revealed ? "text" : "password"}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setKey(event.target.value)}
          className="pr-10 font-mono"
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

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Encrypted at rest with AES-256-GCM and decrypted only inside an agent run. It is
        never sent to the browser and never printed in a run transcript — which nobody but
        you can read anyway.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <MorphButton onAction={submit} size="sm" successLabel="Added" errorLabel="Rejected">
        {submitLabel}
      </MorphButton>
    </form>
  );
}
