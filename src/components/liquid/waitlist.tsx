"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_PANEL } from "@/components/spectrumui/ease";
import "./landing.css";

/**
 * Waitlist modal for the Tocker landing. A short qualifier: email and
 * monthly volume are required (volume is how we prioritise onboarding), chains
 * and style are segmentation. Provider holds the open state; any CTA calls
 * `useWaitlist().open()`.
 *
 * Posts `{ email, volume, chains, style }` to /api/waitlist — do not change
 * the shape. Conditionally rendered: when closed, nothing is in the DOM to tab
 * into.
 */

type WaitlistCtx = { open: () => void };
const Ctx = createContext<WaitlistCtx>({ open: () => {} });
export const useWaitlist = () => useContext(Ctx);

const VOLUMES = ["Under $10k", "$10k–100k", "$100k–1M", "$1M+"] as const;
const CHAINS = ["Solana", "Base", "Ethereum", "Hyperliquid", "Other"] as const;
const STYLES = ["Memecoins", "Majors", "Perps", "Bit of everything"] as const;

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const doOpen = useCallback(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const doClose = useCallback(() => {
    setOpen(false);
    const el = triggerRef.current;
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, []);

  return (
    <Ctx.Provider value={{ open: doOpen }}>
      {children}
      <AnimatePresence>{open ? <WaitlistModal key="waitlist" onClose={doClose} /> : null}</AnimatePresence>
    </Ctx.Provider>
  );
}

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [volume, setVolume] = useState<string | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  // Lock the page, focus the first field, trap Tab, close on Escape.
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const t = window.setTimeout(() => emailRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
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
      document.documentElement.style.overflow = prev;
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && volume !== null && status !== "sending";

  const toggleChain = (c: string) =>
    setChains((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), volume, chains, style }),
      });
      if (!res.ok) throw new Error("bad status");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <motion.div
      className="wl-overlay"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      <div className="wl-scrim" onClick={onClose} aria-hidden />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wl-title"
        className="wl-panel"
        initial={reduced ? false : { opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } }}
        transition={SPRING_PANEL}
      >
        <button type="button" className="wl-close" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

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
            <h2 id="wl-title" className="wl-title">
              You&rsquo;re in the queue
            </h2>
            <p className="wl-sub">
              We work down the list by size. When your turn comes you get early access and a read of your
              strategy before you fund anything.
            </p>
            <button type="button" className="wl-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="wl-eyebrow">Private beta</p>
            <h2 id="wl-title" className="wl-title">
              Join the waitlist
            </h2>
            <p className="wl-sub">We onboard by trading size, largest books first. Twenty seconds.</p>

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
                  required
                />
              </div>

              <ChipGroup
                label="Monthly volume"
                required
                options={VOLUMES}
                selected={volume ? [volume] : []}
                onToggle={setVolume}
              />
              <ChipGroup label="Where you trade" options={CHAINS} selected={chains} onToggle={toggleChain} />
              <ChipGroup label="Mostly" options={STYLES} selected={style ? [style] : []} onToggle={setStyle} />

              {status === "error" ? (
                <p className="wl-error" role="alert">
                  Couldn&rsquo;t reach the waitlist. Try again in a moment.
                </p>
              ) : null}

              <button type="submit" className="wl-submit" disabled={!canSubmit}>
                {status === "sending" ? "Sending…" : "Join the waitlist"}
              </button>
              <p className="wl-fine">
                Solana and Base at launch. Tell us the rest anyway — it decides what we build next.
              </p>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function ChipGroup({
  label,
  required,
  options,
  selected,
  onToggle,
}: {
  label: string;
  required?: boolean;
  options: ReadonlyArray<string>;
  selected: ReadonlyArray<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="wl-group">
      <span className="wl-label">
        {label}
        {required ? <em className="wl-req">required</em> : null}
      </span>
      <div className="wl-seg" role="group" aria-label={label}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              className={cx("wl-chip", on && "wl-chip-on")}
              onClick={() => onToggle(o)}
            >
              {on ? (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 6.5l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
