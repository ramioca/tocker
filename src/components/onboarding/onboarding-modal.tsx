"use client";

/**
 * First-run onboarding. Shows once, for a signed-in user who has no LLM key yet.
 * An account that already owns agents (a returning owner on a new device, or after
 * clearing storage) gets only the key step, framed as what those agents are missing —
 * never "Welcome" or "Create your first agent".
 *
 * Motion budget: this is the definition of a rarely-seen surface, so it gets a real
 * entrance (scale + fade, centered origin — modals aren't anchored to a trigger) and
 * direction-aware step transitions. Both collapse to a plain fade under reduced motion.
 *
 * The shell is Base UI's Dialog, which owns the focus trap, Escape, outside press, scroll
 * lock and focus return; the entrance is CSS transitions on its starting/ending styles,
 * so a close mid-entrance reverses from where it is instead of restarting.
 *
 * UI-CORE mounts this in the app shell; the placeholder `(app)/layout.tsx` mounts it here.
 * Force it open in dev with `?onboarding=1`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Bot, Compass, KeyRound, Sparkles, X } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { AddLlmKeyForm } from "@/components/settings/add-llm-key-form";
import { cn } from "@/lib/utils";
import type { LlmKeyRow } from "@/server/types";

const STORAGE_KEY = "tocker:onboarding-dismissed";
const STEPS = ["welcome", "key", "agent"] as const;
type Step = (typeof STEPS)[number];
const KEY_ONLY: readonly Step[] = ["key"];

export function OnboardingModal({ ownedAgentCount = 0 }: { ownedAgentCount?: number }) {
  const { ready, session } = useSession();
  const [open, setOpen] = useState(false);
  // In-memory dismissal so the modal never reopens mid-session even when
  // localStorage is unavailable (private mode, sandboxed webviews).
  const dismissedRef = useRef(false);
  const [step, setStep] = useState<Step>("welcome");
  // Decided once, when the modal opens, so a key saved mid-flow can't reshape it.
  const [steps, setSteps] = useState<readonly Step[]>(STEPS);
  // Whether the key step ended with a key. Skipped, the last step cannot say "Create
  // your first agent": the builder refuses to create one without a key.
  const [keySaved, setKeySaved] = useState(false);
  const [direction, setDirection] = useState(1);
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  // Whatever had focus when the app (not the user) opened this; usually nothing.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Non-fatal — the modal simply shows again next time.
    }
  }, []);

  // Decide whether to show: signed in, not dismissed, and no key on file.
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get("onboarding") === "1";
    if (!forced && (!ready || !session)) return;

    let dismissed = dismissedRef.current;
    try {
      dismissed = dismissed || localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // localStorage unavailable — fall back to the in-memory flag
    }
    if (!forced && dismissed) return;

    const controller = new AbortController();

    async function shouldOpen() {
      if (forced) return true;
      const response = await fetch("/api/me/llm-keys", { signal: controller.signal });
      if (!response.ok) return false;
      const data = (await response.json()) as { keys: LlmKeyRow[] };
      return !data.keys?.length;
    }

    shouldOpen()
      .then((show) => {
        if (!show) return;
        // `?onboarding=1` always forces the full flow; otherwise an owner skips straight
        // to the key their agents need.
        if (!forced && ownedAgentCount > 0) {
          setSteps(KEY_ONLY);
          setStep("key");
        }
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      })
      .catch(() => {
        // Offline or the route isn't there — never block the app on onboarding.
      });

    return () => controller.abort();
  }, [ready, session, ownedAgentCount]);

  // There is no trigger to hand focus back to. Return it to what had it, and when that
  // was nothing, to the start of the page's content (Base UI lands on the first
  // tabbable element inside <main>) rather than dropping it on <body>.
  const finalFocus = useCallback((): HTMLElement | null => {
    const previous = returnFocusRef.current;
    if (previous && previous !== document.body && previous.isConnected) return previous;
    return document.getElementById("main");
  }, []);

  function go(next: Step) {
    setDirection(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    setStep(next);
  }

  const travel = reduce ? 0 : 12;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:opacity-0 data-starting-style:opacity-0" />
        {/* The viewport centres the panel; the panel caps itself at the screen and
            scrolls inside, so a tall step on a small phone never pushes the close
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
              {/* pr-10 keeps the track clear of the close button beside it. A single
                  step has no progress to show, so the track goes with it. */}
              {steps.length > 1 ? (
                <ol className="flex items-center gap-1.5 pr-10" aria-label="Onboarding progress">
                  {steps.map((id) => (
                    <li
                      key={id}
                      aria-current={id === step ? "step" : undefined}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                        style={{ width: STEPS.indexOf(id) <= STEPS.indexOf(step) ? "100%" : "0%" }}
                      />
                    </li>
                  ))}
                </ol>
              ) : null}

              <div className={cn("relative", steps.length > 1 && "mt-6")}>
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, transform: `translateX(${direction * travel}px)` }}
                    animate={{ opacity: 1, transform: "translateX(0px)" }}
                    exit={{ opacity: 0, transform: `translateX(${-direction * travel}px)` }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {step === "welcome" ? (
                      <WelcomeStep handle={session?.handle} onNext={() => go("key")} onSkip={dismiss} />
                    ) : step === "key" && steps.length === 1 ? (
                      <KeyStep
                        title="Your agents need an LLM key to run"
                        body="They think on your provider account. Add a key from the provider each agent's model runs on: Anthropic, OpenAI or OpenRouter."
                        onAdded={dismiss}
                        onSkip={dismiss}
                      />
                    ) : step === "key" ? (
                      <KeyStep
                        onAdded={() => {
                          setKeySaved(true);
                          go("agent");
                        }}
                        onSkip={() => go("agent")}
                      />
                    ) : keySaved ? (
                      <AgentStep onDone={dismiss} />
                    ) : (
                      <LookAroundStep onDone={dismiss} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StepHeader({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <>
      <span className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
        {icon}
      </span>
      <Dialog.Title className="mt-4 text-lg font-semibold tracking-tight">{title}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{body}</Dialog.Description>
    </>
  );
}

const ghostButton =
  "inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const primaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const inlineLink =
  "rounded-sm text-foreground underline decoration-muted-foreground/50 underline-offset-2 transition-colors duration-150 hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function WelcomeStep({
  handle,
  onNext,
  onSkip,
}: {
  /** The signed-in account's public name. Absent only when the modal was forced open signed out. */
  handle?: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <StepHeader
        icon={<Sparkles className="size-5" aria-hidden />}
        title="Welcome to Tocker"
        body="Two minutes from here to an agent with its own wallet, its own data budget and a public track record."
      />
      <ul className="mt-5 space-y-2.5 text-sm">
        {[
          "Add an LLM key — your agent thinks on your provider account.",
          "We create its Solana and Base wallets automatically.",
          "It starts in paper mode. Live trading is a separate, deliberate choice.",
        ].map((line) => (
          <li key={line} className="flex gap-2.5 text-muted-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            {line}
          </li>
        ))}
      </ul>
      {/* The handle was picked for them at sign-in: their X username, or `user` and six
          characters (an account older than that rule may hold the front of its email
          address). It goes on their profile and on every post their agents make. Say so
          before the first one does, not after, and say where to choose a real one. */}
      {handle ? (
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          You&rsquo;re <span className="font-medium text-foreground">@{handle}</span> here, and that name
          is public. Pick your own in Settings.
        </p>
      ) : null}
      <div className="mt-7 flex items-center justify-between">
        <button type="button" onClick={onSkip} className={ghostButton}>
          Not now
        </button>
        <button type="button" onClick={onNext} className={primaryButton}>
          Add a key
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function KeyStep({
  title = "Add an LLM key",
  // Not "any agent can use any key you own": the builder refuses a key from a provider
  // other than the one the agent's model runs on, and a run made with one fails there.
  body = "Anthropic, OpenAI or OpenRouter. You can add more later; an agent uses a key from the provider its model runs on.",
  onAdded,
  onSkip,
}: {
  title?: string;
  body?: string;
  onAdded: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <StepHeader icon={<KeyRound className="size-5" aria-hidden />} title={title} body={body} />
      <div className="mt-5">
        <AddLlmKeyForm compact submitLabel="Save key" onAdded={onAdded} />
      </div>
      {/* Someone arriving without a key has nowhere to go from a paste field. After the
          form in the DOM, so the tab order is form, these links, then "I'll do this later". */}
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        No key yet? The quickest is OpenRouter: create one at{" "}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className={inlineLink}>
          openrouter.ai/keys
        </a>{" "}
        and paste it here.{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className={inlineLink}>
          Anthropic
        </a>{" "}
        and{" "}
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className={inlineLink}>
          OpenAI
        </a>{" "}
        keys work too.
      </p>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onSkip} className={ghostButton}>
          I&rsquo;ll do this later
        </button>
      </div>
    </div>
  );
}

function AgentStep({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <StepHeader
        icon={<Bot className="size-5" aria-hidden />}
        title="Now build something"
        body="Describe a strategy in a sentence, pick the chains and the risk envelope, and let it run. It stays yours — the fills go on the feed, the strategy never leaves your account."
      />
      <div className="mt-7 flex flex-wrap items-center justify-end gap-2">
        <Link href="/discover" onClick={onDone} className={ghostButton}>
          Explore first
        </Link>
        <Link href="/agents/new" onClick={onDone} className={primaryButton}>
          Create your first agent
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/**
 * The last step for someone who skipped the key. They cannot build yet, so this sends
 * them to what needs no key instead of to a form whose Create button will refuse them.
 */
function LookAroundStep({ onDone }: { onDone: () => void }) {
  return (
    <div>
      <StepHeader
        icon={<Compass className="size-5" aria-hidden />}
        title="Look around first"
        body="You need a key to build an agent, but everything public is open without one: every agent’s trades, the leaderboard, and the token radar, which scores tokens from 0 to 100. Add a key in Settings when you’re ready."
      />
      <div className="mt-7 flex flex-wrap items-center justify-end gap-2">
        <Link href="/feed" onClick={onDone} className={ghostButton}>
          Open the feed
        </Link>
        <Link href="/discover" onClick={onDone} className={primaryButton}>
          Open Discover
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export default OnboardingModal;
