"use client";

/**
 * First-run onboarding. Shows once, for a signed-in user who has no LLM key yet.
 *
 * Motion budget: this is the definition of a rarely-seen surface, so it gets a real
 * entrance (scale + fade, centered origin — modals aren't anchored to a trigger) and
 * direction-aware step transitions. Both collapse to a plain fade under reduced motion.
 *
 * UI-CORE mounts this in the app shell; the placeholder `(app)/layout.tsx` mounts it here.
 * Force it open in dev with `?onboarding=1`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Bot, KeyRound, Sparkles, X } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { AddLlmKeyForm } from "@/components/settings/add-llm-key-form";
import type { LlmKeyRow } from "@/server/types";

const STORAGE_KEY = "vibe:onboarding-dismissed";
const STEPS = ["welcome", "key", "agent"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingModal() {
  const { ready, session } = useSession();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState(1);
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
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

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      dismissed = false;
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
        if (show) setOpen(true);
      })
      .catch(() => {
        // Offline or the route isn't there — never block the app on onboarding.
      });

    return () => controller.abort();
  }, [ready, session]);

  // Escape closes; focus moves into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, dismiss]);

  function go(next: Step) {
    setDirection(STEPS.indexOf(next) > STEPS.indexOf(step) ? 1 : -1);
    setStep(next);
  }

  const travel = reduce ? 0 : 12;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          onClick={(event) => {
            if (event.target === event.currentTarget) dismiss();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            tabIndex={-1}
            initial={{ opacity: 0, transform: `scale(${reduce ? 1 : 0.96})` }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={{ opacity: 0, transform: `scale(${reduce ? 1 : 0.98})` }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
          >
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close onboarding"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-4" aria-hidden />
            </button>

            <div className="px-6 pt-6 pb-5 sm:px-7">
              <ol className="flex items-center gap-1.5" aria-label="Onboarding progress">
                {STEPS.map((id) => (
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

              <div className="relative mt-6">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, transform: `translateX(${direction * travel}px)` }}
                    animate={{ opacity: 1, transform: "translateX(0px)" }}
                    exit={{ opacity: 0, transform: `translateX(${-direction * travel}px)` }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  >
                    {step === "welcome" ? (
                      <WelcomeStep onNext={() => go("key")} onSkip={dismiss} />
                    ) : step === "key" ? (
                      <KeyStep onAdded={() => go("agent")} onSkip={() => go("agent")} />
                    ) : (
                      <AgentStep onDone={dismiss} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function StepHeader({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <>
      <span className="grid size-10 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
        {icon}
      </span>
      <h2 id="onboarding-title" className="mt-4 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </>
  );
}

const ghostButton =
  "inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
const primaryButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div>
      <StepHeader
        icon={<Sparkles className="size-5" aria-hidden />}
        title="Welcome to Vibe"
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

function KeyStep({ onAdded, onSkip }: { onAdded: () => void; onSkip: () => void }) {
  return (
    <div>
      <StepHeader
        icon={<KeyRound className="size-5" aria-hidden />}
        title="Add an LLM key"
        body="Anthropic, OpenAI or OpenRouter. You can add more later, and any agent can use any key you own."
      />
      <div className="mt-5">
        <AddLlmKeyForm submitLabel="Save key" onAdded={onAdded} />
      </div>
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
        body="Describe a strategy in a sentence, pick the chains and the risk envelope, and let it run. Or start from someone else's — every public agent is forkable."
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

export default OnboardingModal;
