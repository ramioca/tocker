"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./isotope.css";

/**
 * Waitlist modal for the Tocker landing. A short, glass qualifier form: the goal
 * is to onboard people who actually trade size (monthly volume is the gate) and
 * capture just enough to segment — email, chains, style — without turning it into
 * a survey. Provider holds the open state; any CTA calls useWaitlist().open().
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
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);
  const doClose = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus?.();
  }, []);

  return (
    <Ctx.Provider value={{ open: doOpen }}>
      {children}
      <WaitlistModal open={open} onClose={doClose} />
    </Ctx.Provider>
  );
}

function trapFocus(event: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const nodes = panel.querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function WaitlistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [volume, setVolume] = useState<string | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    document.documentElement.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => emailRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab") trapFocus(e, panelRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = "";
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = emailValid && volume !== null && status !== "sending";

  const toggleChain = (c: string) =>
    setChains((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus("sending");
    setError(null);
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
      setError("Couldn't reach the waitlist. Try again in a moment.");
    }
  };

  return (
    <div className={cx("wl-overlay", open && "wl-overlay-open")} aria-hidden={!open}>
      <button className="wl-scrim" tabIndex={-1} aria-label="Close" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wl-title"
        className="wl-panel"
      >
        <button type="button" className="wl-close" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {status === "done" ? (
          <div className="wl-done">
            <span className="wl-check" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h2 id="wl-title" className="wl-title">You&rsquo;re on the list</h2>
            <p className="wl-sub">
              We prioritize by trading size, so the biggest desks hear from us first. Watch your
              inbox for early access and a strategy teardown.
            </p>
            <button type="button" className="wl-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 id="wl-title" className="wl-title">Join the waitlist</h2>
            <p className="wl-sub">We onboard active traders first. Takes about 20 seconds.</p>

            <form className="wl-form" onSubmit={submit}>
              <div className="wl-group">
                <label htmlFor="wl-email" className="wl-label">Email</label>
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

              <div className="wl-group">
                <span className="wl-label">
                  Monthly trading volume <em className="wl-req">required</em>
                </span>
                <div className="wl-seg" role="group" aria-label="Monthly trading volume">
                  {VOLUMES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={volume === v}
                      className={cx("wl-chip", volume === v && "wl-chip-on")}
                      onClick={() => setVolume(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wl-group">
                <span className="wl-label">Where you trade</span>
                <div className="wl-seg" role="group" aria-label="Chains you trade">
                  {CHAINS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={chains.includes(c)}
                      className={cx("wl-chip", chains.includes(c) && "wl-chip-on")}
                      onClick={() => toggleChain(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wl-group">
                <span className="wl-label">Mostly</span>
                <div className="wl-seg" role="group" aria-label="What you mostly trade">
                  {STYLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={style === s}
                      className={cx("wl-chip", style === s && "wl-chip-on")}
                      onClick={() => setStyle(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {error ? <p className="wl-error">{error}</p> : null}

              <button
                type="submit"
                className="wl-submit"
                disabled={!canSubmit}
                style={{ "--reveal-delay": "0s" } as CSSProperties}
              >
                {status === "sending" ? "Joining…" : "Join the waitlist"}
              </button>
              <p className="wl-fine">Heavy hitters get early access and a free strategy teardown.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
