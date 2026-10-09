"use client";

/**
 * "Your agents have no key." Shown to an account that owns agents and has no LLM key on
 * file: a returning owner on a new device, or one whose key was removed. It asks for the
 * one thing those agents are missing and nothing else.
 *
 * It is what is left of the old first-run modal, whose welcome and "create an agent"
 * steps are now the first-run screens (`first-run.tsx`). The gate mounts it only for an
 * account that is through those and owns an agent (`gate-decision.ts`); whether that
 * account has a key is asked here.
 *
 * The shell is Base UI's Dialog, which owns the focus trap, Escape, outside press, scroll
 * lock and focus return; the entrance is CSS transitions on its starting/ending styles,
 * so a close mid-entrance reverses from where it is instead of restarting.
 *
 * `payPerUseAllowed` is the server's answer to "may this viewer build an agent that pays
 * for its own thinking?". When it is true a key is still asked for, because it is the
 * cheaper way to run, but the words that used to say a key is required offer pay-per-use
 * as the other way. When it is false, which is the default, every word here is what it was.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { KeyRound, X } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { AddLlmKeyForm } from "@/components/settings/add-llm-key-form";
import { providerNames } from "@/components/agents/provider-choice";
import { KeyPageLink } from "@/components/agents/provider-picker";
import { providerLabel } from "@/lib/agent/providers";
import { cn } from "@/lib/utils";
import type { LlmKeyRow } from "@/server/types";
import { APP_BACKDROP } from "./backdrop";

/** Written when the prompt is dismissed; the gate reads the same key before mounting it. */
const STORAGE_KEY = "tocker:onboarding-dismissed";

export function KeyPrompt({
  payPerUseAllowed = false,
  suppressed = false,
}: {
  payPerUseAllowed?: boolean;
  /** True on a page that asks for the key itself (the builder): do not open over it. */
  suppressed?: boolean;
}) {
  const { ready, session } = useSession();
  const [open, setOpen] = useState(false);
  // Read when the key check answers, which can be a page later than when it was asked.
  // A ref, not a dependency: moving to another page must not ask again, and a prompt
  // that is already open stays open.
  const suppressedRef = useRef(suppressed);
  useEffect(() => {
    suppressedRef.current = suppressed;
  }, [suppressed]);
  // In-memory dismissal so the prompt never reopens mid-session even when
  // localStorage is unavailable (private mode, sandboxed webviews).
  const dismissedRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the app (not the user) opened this; usually nothing.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Non-fatal — the prompt simply shows again next time.
    }
  }, []);

  // Decide whether to show: signed in, not dismissed, and no key on file.
  useEffect(() => {
    if (!ready || !session) return;

    let dismissed = dismissedRef.current;
    try {
      dismissed = dismissed || localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage unavailable — fall back to the in-memory flag
    }
    if (dismissed) return;

    const controller = new AbortController();

    async function hasNoKey() {
      const response = await fetch("/api/me/llm-keys", { signal: controller.signal });
      if (!response.ok) return false;
      const data = (await response.json()) as { keys: LlmKeyRow[] };
      return !data.keys?.length;
    }

    hasNoKey()
      .then((show) => {
        if (!show || suppressedRef.current) return;
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      })
      .catch(() => {
        // Offline or the route isn't there — never block the app on a prompt.
      });

    return () => controller.abort();
  }, [ready, session]);

  // There is no trigger to hand focus back to. Return it to what had it, and when that
  // was nothing, to the start of the page's content (Base UI lands on the first
  // tabbable element inside <main>) rather than dropping it on <body>.
  const finalFocus = useCallback((): HTMLElement | null => {
    const previous = returnFocusRef.current;
    if (previous && previous !== document.body && previous.isConnected) return previous;
    return document.getElementById("main");
  }, []);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // The provider list in the key form opens over this dialog and closes on Escape.
        // An Escape it has already used must not close the prompt as well: once
        // dismissed it does not come back.
        if (details.reason === "escape-key" && details.event.defaultPrevented) {
          details.cancel();
          return;
        }
        dismiss();
      }}
    >
      <Dialog.Portal>
        {/* The same dimmed, softly blurred app the first-run card opens over. */}
        <Dialog.Backdrop className={cn(APP_BACKDROP, "duration-[180ms]")} />
        {/* The viewport centres the panel; the panel caps itself at the screen and
            scrolls inside, so a tall form on a small phone never pushes the close
            button or the last action off-screen while the page behind is locked. */}
        <Dialog.Viewport className="fixed inset-0 z-[100] grid place-items-center p-4">
          <Dialog.Popup
            ref={panelRef}
            initialFocus={panelRef}
            finalFocus={finalFocus}
            className={cn(
              "relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card shadow-2xl outline-none",
              "transition-[opacity,scale] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)]",
              "data-ending-style:opacity-0 data-starting-style:opacity-0",
              "motion-safe:data-ending-style:scale-[0.98] motion-safe:data-starting-style:scale-[0.96]",
            )}
          >
            <Dialog.Close
              aria-label="Close onboarding"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </Dialog.Close>

            <div className="px-6 pt-6 pb-5 sm:px-7">
              <KeyStep
                title={payPerUseAllowed ? "Add an LLM key for your agents" : "Your agents need an LLM key to run"}
                // Not "any agent can use any key you own": the builder refuses a key from
                // a provider other than the one the agent's model runs on, and a run made
                // with one fails there. The providers are named from the registry, so
                // this cannot fall behind the chooser.
                body={
                  payPerUseAllowed
                    ? `An agent on your own key thinks on your provider account. Add a key from the provider its model runs on: ${providerNames()}. An agent set to pay per use needs none.`
                    : `They think on your provider account. Add a key from the provider each agent's model runs on: ${providerNames()}.`
                }
                payPerUseAllowed={payPerUseAllowed}
                onAdded={dismiss}
                onSkip={dismiss}
              />
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const ghostButton =
  "inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function KeyStep({
  title,
  body,
  payPerUseAllowed = false,
  onAdded,
  onSkip,
}: {
  title: string;
  body: string;
  /** Adds the line that says a key is not the only way, for a viewer who may pay per use. */
  payPerUseAllowed?: boolean;
  onAdded: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <span className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
        <KeyRound className="size-5" aria-hidden />
      </span>
      <Dialog.Title className="mt-4 text-lg font-semibold tracking-tight">{title}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{body}</Dialog.Description>
      <div className="mt-5">
        {/* `aboveDialog`: the provider list is drawn beside this dialog, not inside it,
            and has to open over it. */}
        <AddLlmKeyForm compact aboveDialog submitLabel="Save key" onAdded={onAdded} />
      </div>
      {/* Someone arriving without a key has nowhere to go from a paste field. The form
          links to the chosen provider's key page under its chooser, since nobody here has
          a key yet; this says so, and keeps the one-press way to the quickest start. The
          name and the address are read from OpenRouter's row in the registry. */}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        No key yet? Choose a provider above: the link under it opens the page where its keys are made. If you
        have no account with any of them, {providerLabel("openrouter")} is the quickest to start with: create a
        key at <KeyPageLink provider="openrouter" />, choose {providerLabel("openrouter")} above and paste it
        here.
      </p>
      {payPerUseAllowed ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          No key at all? An agent can pay per use instead: it buys each step of thinking in USDC from its own
          Solana wallet. You choose that when you build it, or in its settings. Your own key is usually cheaper.
        </p>
      ) : null}
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onSkip} className={ghostButton}>
          I&rsquo;ll do this later
        </button>
      </div>
    </div>
  );
}
