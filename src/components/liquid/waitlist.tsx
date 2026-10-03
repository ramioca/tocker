"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT, SPRING_PANEL } from "@/components/spectrumui/ease";
import { MorphButton, type MorphButtonState } from "@/components/spectrumui/morph-button";
import { useSafeReducedMotion } from "./motion";

/**
 * Waitlist modal for the Tocker landing. A short qualifier: email and
 * monthly volume are required (volume is how we prioritise onboarding), chains
 * and style are segmentation. Provider holds the open state; any CTA calls
 * `useWaitlist().open()`.
 *
 * Posts `{ email, volume, chains, style }` to /api/waitlist — do not change
 * the shape. Conditionally rendered: when closed, nothing is in the DOM to tab
 * into; while open, the page behind is inert. A centred dialog on wide
 * screens, a bottom sheet under 640px. The submit is Spectrum's MorphButton,
 * driven as a controlled state machine: idle -> loading -> success (held
 * briefly, then the thank-you view) or error (shakes, then back to idle with
 * the message kept).
 */

/** How long the button's success state shows before the thank-you view. */
const SUCCESS_HOLD_MS = 900;
/** How long the button's error state shows before it accepts another try. */
const ERROR_HOLD_MS = 1600;

type WaitlistCtx = { open: () => void };
const Ctx = createContext<WaitlistCtx>({ open: () => {} });
export const useWaitlist = () => useContext(Ctx);

const VOLUMES = ["Under $10k", "$10k–100k", "$100k–1M", "$1M+"] as const;
const CHAINS = ["Solana", "Base", "Ethereum", "Hyperliquid", "Other"] as const;
const STYLES = ["Memecoins", "Majors", "Perps", "Bit of everything"] as const;

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The landing root; inert while the dialog is open so nothing behind it is reachable. */
const pageRoot = () => document.querySelector<HTMLElement>(".lp");

export function WaitlistProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const doOpen = useCallback(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const doClose = useCallback(() => {
    setOpen(false);
    // Lift inert now, not when the exit animation unmounts the dialog, so focus can go home.
    pageRoot()?.removeAttribute("inert");
    const el = triggerRef.current;
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, []);

  // Inert lands a frame after the click, not in it: it restyles the whole page,
  // and the press should paint first. The Tab trap and the focus move cover the gap.
  useEffect(() => {
    if (!open) return;
    const root = pageRoot();
    let t = 0;
    const raf = requestAnimationFrame(() => {
      t = window.setTimeout(() => root?.setAttribute("inert", ""), 0);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      root?.removeAttribute("inert");
    };
  }, [open]);

  const value = useMemo(() => ({ open: doOpen }), [doOpen]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>{open ? <WaitlistModal key="waitlist" onClose={doClose} /> : null}</AnimatePresence>
    </Ctx.Provider>
  );
}

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const reduced = useSafeReducedMotion();
  // Mounted only after a click, so the viewport is known on the first render.
  const [sheet] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [volume, setVolume] = useState<string | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "done" | "error">("idle");
  const [failed, setFailed] = useState(false);
  const phaseTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (phaseTimer.current !== null) window.clearTimeout(phaseTimer.current);
    },
    [],
  );
  const after = (ms: number, next: typeof status) => {
    if (phaseTimer.current !== null) window.clearTimeout(phaseTimer.current);
    phaseTimer.current = window.setTimeout(() => {
      phaseTimer.current = null;
      setStatus(next);
    }, ms);
  };

  // Lock the page, move focus in, trap Tab, close on Escape. On a touch screen
  // focus goes to the dialog itself: focusing the email would raise the
  // keyboard over the fields the visitor has not read yet. The lock is on
  // <body> (it reaches the viewport the same way): a style change on <html>
  // restyles the whole document.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const t = window.setTimeout(() => {
      if (coarse) panelRef.current?.focus({ preventScroll: true });
      else emailRef.current?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),[tabindex]"),
      ).filter((n) => n.tabIndex >= 0);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active) || active === panelRef.current) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && volume !== null && status === "idle";
  const [missing, setMissing] = useState(false);
  const showMissing = missing && !canSubmit && status === "idle";
  // The thank-you view replaces the focused button; move focus to its heading.
  const doneRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (status === "done") doneRef.current?.focus();
  }, [status]);
  const buttonState: MorphButtonState =
    status === "sending" ? "loading" : status === "sent" ? "success" : status === "error" ? "error" : "idle";

  const toggleChain = (c: string) =>
    setChains((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) {
      // The button stays focusable (a disabled one vanishes from the tab order),
      // so an early press says what is missing instead of doing nothing.
      if (status === "idle") setMissing(true);
      return;
    }
    setMissing(false);
    setFailed(false);
    setStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), volume, chains, style }),
      });
      if (!res.ok) throw new Error("bad status");
      setStatus("sent");
      after(reduced ? 300 : SUCCESS_HOLD_MS, "done");
    } catch {
      setFailed(true);
      setStatus("error");
      after(ERROR_HOLD_MS, "idle");
    }
  };

  const panelMotion = reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.12 } } }
    : sheet
      ? {
          initial: { y: "100%" },
          animate: { y: 0, transition: { duration: 0.36, ease: EASE_OUT } },
          exit: { y: "100%", transition: { duration: 0.22, ease: EASE_OUT } },
        }
      : {
          initial: { opacity: 0, y: 14, scale: 0.97 },
          animate: { opacity: 1, y: 0, scale: 1, transition: SPRING_PANEL },
          exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } },
        };

  return (
    <motion.div
      className="wl-overlay"
      data-sheet={sheet || undefined}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: sheet ? 0.22 : 0.18 } }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      <div className="wl-scrim" onClick={onClose} aria-hidden />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wl-title"
        tabIndex={-1}
        className="wl-panel lp-frame"
        {...panelMotion}
      >
        <div className="wl-bar">
          <p className="wl-eyebrow">Private beta</p>
          <button type="button" className="wl-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {status === "done" ? (
          <div className="wl-done">
            <motion.span
              className="wl-check"
              aria-hidden
              initial={reduced ? false : { scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.span>
            <h2 id="wl-title" className="wl-title" ref={doneRef} tabIndex={-1}>
              You&rsquo;re on the list
            </h2>
            <p className="wl-sub">
              We&rsquo;ll email you when your seat opens. Your first agent runs on paper, so you can watch it before you
              fund anything.
            </p>
            <button type="button" className="wl-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 id="wl-title" className="wl-title">
              Join the waitlist
            </h2>
            <p className="wl-sub">Takes twenty seconds. We open seats in batches.</p>

            <form className="wl-form" onSubmit={submit} noValidate>
              <div className="wl-group">
                <label htmlFor="wl-email" className="wl-label">
                  Email
                </label>
                <input
                  id="wl-email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@fund.xyz"
                  className="wl-input"
                  aria-invalid={(showMissing && !emailValid) || undefined}
                  aria-describedby={showMissing ? "wl-missing" : undefined}
                  required
                />
              </div>

              <ChipGroup
                label="Monthly volume"
                required
                single
                options={VOLUMES}
                selected={volume ? [volume] : []}
                onToggle={setVolume}
                invalid={showMissing && volume === null}
              />
              <ChipGroup label="Where you trade" options={CHAINS} selected={chains} onToggle={toggleChain} />
              <ChipGroup
                label="What you trade most"
                single
                options={STYLES}
                selected={style ? [style] : []}
                onToggle={setStyle}
              />

              {showMissing ? (
                <p id="wl-missing" className="wl-error" role="alert">
                  Add your email and pick a monthly volume to join.
                </p>
              ) : null}
              {/* Not an alert: the button's own status already says "Couldn’t send". */}
              {failed ? <p className="wl-error">Couldn&rsquo;t reach the waitlist. Try again in a moment.</p> : null}

              <div className="wl-actions">
                {/* Enter in the email field still submits: a form with one text input submits implicitly. */}
                <MorphButton
                  state={buttonState}
                  onClick={() => void submit()}
                  loadingLabel="Sending…"
                  successLabel="You’re on the list"
                  errorLabel="Couldn’t send"
                  size="lg"
                  className={cx("wl-morph", `wl-morph-${buttonState}`, !canSubmit && status === "idle" && "wl-morph-incomplete")}
                >
                  Join the waitlist
                </MorphButton>
              </div>
              <p className="wl-fine">Solana and Base at launch. Tell us the rest anyway: it decides what we build next.</p>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/**
 * A row of chips. Single-choice rows are radio groups (one tab stop, arrow
 * keys move the choice); multi-choice rows are toggle buttons. The selected
 * chip is the only filled one, and it never changes width.
 */
function ChipGroup({
  label,
  required,
  single,
  options,
  selected,
  onToggle,
  invalid,
}: {
  label: string;
  required?: boolean;
  single?: boolean;
  options: ReadonlyArray<string>;
  selected: ReadonlyArray<string>;
  onToggle: (value: string) => void;
  /** Still missing after a submit: tied to the message that says so. */
  invalid?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = options.findIndex((o) => selected.includes(o));
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (!single) return;
    const n = options.length;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : step ? (i + step + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    onToggle(options[next]);
    refs.current[next]?.focus();
  };

  return (
    <div className="wl-group">
      <span className="wl-label" id={labelId}>
        {label}
        {required ? <em className="wl-req">required</em> : null}
      </span>
      <div
        className="wl-seg"
        role={single ? "radiogroup" : "group"}
        aria-labelledby={labelId}
        aria-required={(single && required) || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "wl-missing" : undefined}
      >
        {options.map((o, i) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role={single ? "radio" : undefined}
              aria-checked={single ? on : undefined}
              aria-pressed={single ? undefined : on}
              tabIndex={single ? (i === tabStop ? 0 : -1) : undefined}
              className={cx("wl-chip", on && "wl-chip-on")}
              onClick={() => onToggle(o)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
