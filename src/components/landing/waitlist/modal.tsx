"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_OUT, SPRING_PANEL } from "@/components/spectrumui/ease";
import { cn } from "@/lib/utils";
import { WAITLIST } from "../content";
import { Button } from "../primitives";
import "./modal.css";

/**
 * The volume-gated qualifier. Email and monthly volume are required; chains
 * and style are segmentation. Posts to /api/waitlist with the shape
 * `{ email, volume, chains, style }` — do not change the shape.
 *
 * Conditionally rendered: when closed there is nothing in the DOM to tab into.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WaitlistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>{open ? <Dialog key="waitlist" onClose={onClose} /> : null}</AnimatePresence>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
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
      const inside = panelRef.current.contains(active);
      if (!inside) {
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
      className="wl-overlay ld"
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
            <span className="wl-check" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h2 id="wl-title" className="wl-title">{WAITLIST.done.title}</h2>
            <p className="wl-sub">{WAITLIST.done.sub}</p>
            <Button className="mt-6 w-full" onClick={onClose}>{WAITLIST.done.button}</Button>
          </div>
        ) : (
          <>
            <h2 id="wl-title" className="wl-title">{WAITLIST.title}</h2>
            <p className="wl-sub">{WAITLIST.sub}</p>

            <form className="wl-form" onSubmit={submit} noValidate>
              <div className="wl-group">
                <label htmlFor="wl-email" className="ld-mono">{WAITLIST.email.label}</label>
                <input
                  id="wl-email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={WAITLIST.email.placeholder}
                  className="wl-input"
                  required
                />
              </div>

              <ChipGroup
                label={WAITLIST.volume.label}
                required={WAITLIST.volume.required}
                options={WAITLIST.volume.options}
                selected={volume ? [volume] : []}
                onToggle={setVolume}
              />
              <ChipGroup
                label={WAITLIST.chains.label}
                options={WAITLIST.chains.options}
                selected={chains}
                onToggle={toggleChain}
              />
              <ChipGroup
                label={WAITLIST.style.label}
                options={WAITLIST.style.options}
                selected={style ? [style] : []}
                onToggle={setStyle}
              />

              {status === "error" ? (
                <p className="ld-caption" role="alert" style={{ color: "var(--ld-paper)" }}>
                  {WAITLIST.error}
                </p>
              ) : null}

              <Button type="submit" className="mt-1 w-full" disabled={!canSubmit}>
                {status === "sending" ? WAITLIST.submitting : WAITLIST.submit}
              </Button>
              <p className="ld-caption text-center">{WAITLIST.fine}</p>
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
  required?: string;
  options: ReadonlyArray<string>;
  selected: ReadonlyArray<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="wl-group">
      <span className="ld-mono">
        {label}
        {required ? <em className="wl-req">{required}</em> : null}
      </span>
      <div className="wl-seg" role="group" aria-label={label}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              className={cn("wl-chip", on && "wl-chip-on")}
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
