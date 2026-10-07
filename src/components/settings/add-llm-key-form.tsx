"use client";

import { useId, useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { addLlmKey } from "@/server/actions/users";
import type { LlmKeyRow } from "@/server/types";
import { MORPH_FOCUS, enterSubmits, useMorphAction } from "./use-morph-action";
import { ProviderHelp, ProviderPicker } from "@/components/agents/provider-picker";
import { keyNote, keyRefusal, keyShapeHint, providerHelp, shownKeyError } from "@/components/agents/provider-choice";
import { providerLabel } from "@/lib/agent/providers";

type Provider = LlmKeyRow["provider"];
type Field = "key" | "label" | "workspace";

/** Which field a server error is about, so it can sit under that field. */
function fieldFor(message: string): Field {
  if (/^label/i.test(message)) return "label";
  if (/workspace id/i.test(message)) return "workspace";
  return "key";
}

/** What the server said beyond the new row: how many of the owner's agents still have no key. */
export interface KeyAddedInfo {
  keylessAgents: number;
}

export function AddLlmKeyForm({
  onAdded,
  onCancel,
  autoFocus = false,
  submitLabel = "Add key",
  compact = false,
  haveKeysFor = [],
  aboveDialog = false,
}: {
  onAdded?: (key: LlmKeyRow, info: KeyAddedInfo) => void;
  /** Set when the form was opened on demand, so there is somewhere to go back to. Escape calls it too. */
  onCancel?: () => void;
  /** Focus the first field on mount: the button that opened the form has just unmounted. */
  autoFocus?: boolean;
  submitLabel?: string;
  /**
   * First-run use (onboarding): the optional Anthropic Workspace ID folds behind an
   * "Advanced" disclosure, since almost nobody needs it and the console path is jargon
   * to someone adding their first key.
   */
  compact?: boolean;
  /**
   * The providers the account already holds a key for. For any other provider the form
   * links to the page where its keys are made: someone adding their first key for it
   * usually has to go and create one.
   */
  haveKeysFor?: readonly string[];
  /** Set where the form sits inside the onboarding dialog, so the provider list opens over it. */
  aboveDialog?: boolean;
}) {
  const uid = useId();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  // The compact form's "Advanced" disclosure. Tracked, not left to the DOM, so an error
  // that opened it does not snap it shut again as soon as typing clears that error.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const providerRef = useRef<HTMLButtonElement>(null);

  const hint = keyShapeHint(provider);
  const hasKeyFor = haveKeysFor.includes(provider);
  // The chooser defaults to Anthropic and keeps the pasted key when it changes, so a key
  // under the wrong provider is easy to end up with — and, when that provider can't be
  // reached to check it, it would be saved and only fail on the agent's next run. The
  // note says whose key it looks like, and offers the switch when that provider is one
  // that can be chosen.
  const note = keyNote(provider, key);
  const otherProvider = note?.switchTo ?? null;

  /**
   * The checks that need no request. Kept out of `submit()` on purpose: a throw there
   * turns the button into "Rejected", which reads as the provider refusing a key that
   * was never sent.
   */
  function validate(): boolean {
    const refuse = (message: string) => {
      setError({ field: "key", message });
      // By id, not a ref: `validate` is reached from a handler built during render.
      document.getElementById(`${uid}-key`)?.focus();
      return false;
    };
    // Too short, another provider's key, or one without the prefix this provider puts on
    // every key. That includes pressing Add past the note below: refused here, not by
    // disabling the button, so the reason is said rather than hidden. Nothing has been
    // sent anywhere at this point.
    const refusal = keyRefusal(provider, key);
    return refusal ? refuse(refusal) : true;
  }

  async function submit() {
    setError(null);
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
        // The key is still in the field, so it can be taken out of whatever came back.
        const message = shownKeyError(result.error, key);
        setError({ field: fieldFor(message), message });
        throw new Error(message);
      }
      if (result.data.unverified) {
        // Saved, but the provider could not be asked (down, slow, a network in the way).
        // A toast, not the button: the form closes as soon as the key is added.
        toast.warning(`Saved — couldn’t reach ${providerLabel(provider)} to check it`, {
          description: "If the key is wrong, the agent’s next run will fail and say so.",
        });
      }
      onAdded?.(
        { ...optimistic, id: result.data.id, last4: result.data.last4 },
        { keylessAgents: result.data.keylessAgents ?? 0 },
      );
    } catch (e) {
      const message = shownKeyError(e instanceof Error ? e.message : "Could not add the key", key);
      // Only ever in development: in production a server error that happened to contain
      // these words would otherwise render a key row that does not exist.
      if (process.env.NODE_ENV === "production" || !message.includes("not implemented")) {
        setError((current) => current ?? { field: "key", message });
        throw e;
      }
      // Dev / mock mode: the action is still a stub, so show the row locally.
      onAdded?.(optimistic, { keylessAgents: 0 });
    }
    setKey("");
    setLabel("");
  }

  const { state, run, reset } = useMorphAction(submit);

  // Every submit path goes through here, so only a real server or probe refusal says "Rejected".
  const attempt = () => {
    if (validate()) void run();
  };

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

  // Under a key error the note would only repeat it, so just its button stays.
  const showKeyNote = note !== null && error?.field !== "key";
  const keyDescribedBy =
    [error?.field === "key" ? `${uid}-key-error` : null, showKeyNote ? `${uid}-key-note` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const switchProvider = (next: Provider) => {
    setProvider(next);
    edited("key");
    // The button leaves with the mismatch. The chooser is where the change shows, and
    // landing there reads it back ("Provider, OpenAI").
    providerRef.current?.focus();
  };

  const submitOnEnter = enterSubmits(() => {
    if (key.trim().length > 0) attempt();
  });

  const workspaceField = (
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
  );

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
        if (key.trim().length > 0) attempt();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-provider`} className="text-sm font-medium">
            Provider
          </label>
          <ProviderPicker
            triggerRef={providerRef}
            id={`${uid}-provider`}
            autoFocus={autoFocus}
            value={provider}
            // Only while there is a line under the chooser to read out with it.
            describedBy={providerHelp(provider, { hasKey: hasKeyFor }) ? `${uid}-provider-help` : undefined}
            aboveDialog={aboveDialog}
            onChange={(next) => {
              setProvider(next);
              // A key error is about this key under that provider; a new provider moots it.
              edited("key");
            }}
            // As tall as the fields beside it, and as transparent: this form sits on a card.
            className="mt-2 h-9 dark:bg-transparent"
          />
        </div>

        {/* What the registry notes about this provider, and where its keys are made while
            the account has none for it. Straight under the chooser on a phone; under the
            row, across both columns, where Provider and Label sit side by side. */}
        <ProviderHelp
          id={`${uid}-provider-help`}
          provider={provider}
          hasKey={hasKeyFor}
          className="-mt-2 sm:order-last sm:col-span-2"
        />

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
          API key{hint ? <span className="font-normal text-muted-foreground"> ({hint})</span> : null}
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
            aria-describedby={keyDescribedBy}
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
        {/* Always mounted, so the note is announced when it appears. */}
        <div aria-live="polite">
          {note && (showKeyNote || otherProvider) ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-amber-700 dark:text-amber-400">
              {showKeyNote ? <span id={`${uid}-key-note`}>{note.text}</span> : null}
              {/* Offered only for a provider that can be chosen. A key that belongs to
                  none of them has nowhere to switch to, and the note says so alone. */}
              {otherProvider ? (
                <button
                  type="button"
                  onClick={() => switchProvider(otherProvider)}
                  className="inline-flex h-8 items-center rounded-md border border-amber-600/40 px-2.5 text-xs font-medium transition-[background-color,transform] duration-150 hover:bg-amber-500/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-7 dark:border-amber-400/30"
                >
                  Switch to {providerLabel(otherProvider)}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {provider === "anthropic" ? (
        compact ? (
          <details
            className="group"
            // Opened by a workspace error too, so the message under the field is never hidden.
            open={advancedOpen || error?.field === "workspace"}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Advanced: workspace ID
            </summary>
            <div className="mt-3">{workspaceField}</div>
          </details>
        ) : (
          workspaceField
        )
      ) : null}

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Encrypted at rest with AES-256-GCM. Decrypted only on our servers, when an agent runs
        and when the model list for this key is loaded. It is never sent to the browser and
        never printed in a run transcript — which nobody but you can read anyway.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Disabled while empty: an empty submit is not a rejected key, and should not look like one. */}
        <MorphButton
          state={state}
          onClick={attempt}
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
