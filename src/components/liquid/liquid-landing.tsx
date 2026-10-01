"use client";

import { useEffect, useRef } from "react";
import { Contact } from "./contact";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES, type LandingSource } from "./signals-data";
import { WaitlistProvider } from "./waitlist";

/**
 * Tocker waitlist landing. Quiet and fast on purpose: no canvas, no custom
 * cursor, no smooth-scroll library, no full-screen overlays. Light comes from
 * static CSS gradients (the hero's horizon, the closing section's mirror of
 * it), motion is limited to the entrance, the hero's sample-agent feed and
 * scroll-linked reveals that run on the compositor. One typeface in two
 * registers, near-black grounds, violet as the only signal colour.
 */

const OFF = "#f4f4f1";

/** Verified against `DEFAULT_AGENT_CONFIG` by src/lib/agent/config.ts; keep in step. */
const DEFAULTS = [
  ["score floor", "62 / 100"],
  ["per trade", "$100"],
  ["per day", "10 trades"],
  ["stop loss", "15%"],
  ["take profit", "40%"],
  ["data per run", `$${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`],
] as const;

const FEATURES = [
  {
    i: "01",
    label: "Any strategy",
    body: "Spin up separate agents for momentum, sentiment or fresh-launch hunting, each with its own mandate and its own Solana and Base wallet.",
  },
  {
    i: "02",
    label: "Public record, private edge",
    body: "Every trade posts to a public feed. Your prompt, thresholds and data sources stay yours: there is no fork button, and there never was one.",
  },
  {
    i: "03",
    label: "Exits in code",
    body: "Stop-loss, take-profit and trailing stops fire on a five-minute clock, whether or not the model is awake. Not on your nerve.",
  },
  {
    i: "04",
    label: "Ten hard gates",
    body: "Mint and freeze authority, honeypot, tax, liquidity, holders, age, top-ten concentration. A high score cannot override any of them.",
  },
  {
    i: "05",
    label: "Paper, then live",
    body: "A new agent starts on a simulated book against real quotes and asks before every entry. Going live is a separate screen with a hold-to-confirm.",
  },
  {
    i: "06",
    label: "No allowlist",
    body: "It scores every launch on Solana and Base, the whole field, not a curated shortlist. The only list is a blocklist, and it only subtracts.",
  },
];

export function LiquidLanding() {
  return (
    <WaitlistProvider>
      <Nav />
      <main className="liquid-main relative w-full bg-[#040407] text-[#f4f4f1]">
        <Hero />
        <Signals />
        <Mechanics />
        <Contact />
      </main>
    </WaitlistProvider>
  );
}

/* ---------------------------------------------------- signals (horizontal) */
function Signals() {
  const outer = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);

  // Under 768px the track is a native horizontal snap row. A finger swipes it;
  // a mouse (a narrow desktop window, a tablet with a trackpad) grabs and drags
  // it, and the row reports its position to the progress line beneath.
  useEffect(() => {
    const tr = track.current;
    if (!tr) return;
    const narrow = window.matchMedia("(max-width: 767px)");

    const onTrackScroll = () => {
      const bar = thumb.current;
      if (!bar || !narrow.matches) return;
      const max = tr.scrollWidth - tr.clientWidth;
      const frac = max > 0 ? tr.scrollLeft / max : 0;
      const vis = tr.scrollWidth > 0 ? tr.clientWidth / tr.scrollWidth : 1;
      bar.style.width = `${vis * 100}%`;
      bar.style.transform = `translateX(${vis > 0 ? ((frac * (1 - vis)) / vis) * 100 : 0}%)`;
    };

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    const down = (e: PointerEvent) => {
      if (!narrow.matches || e.pointerType !== "mouse" || e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startLeft = tr.scrollLeft;
      tr.classList.add("sig-dragging");
      tr.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      tr.scrollLeft = startLeft - dx;
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      tr.classList.remove("sig-dragging");
      if (tr.hasPointerCapture(e.pointerId)) tr.releasePointerCapture(e.pointerId);
    };
    // A drag must not count as a click on whatever card it ended over.
    const click = (e: MouseEvent) => {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    };

    tr.addEventListener("scroll", onTrackScroll, { passive: true });
    tr.addEventListener("pointerdown", down);
    tr.addEventListener("pointermove", move);
    tr.addEventListener("pointerup", up);
    tr.addEventListener("pointercancel", up);
    tr.addEventListener("click", click, true);
    narrow.addEventListener("change", onTrackScroll);
    window.addEventListener("resize", onTrackScroll);
    onTrackScroll();
    return () => {
      tr.removeEventListener("scroll", onTrackScroll);
      tr.removeEventListener("pointerdown", down);
      tr.removeEventListener("pointermove", move);
      tr.removeEventListener("pointerup", up);
      tr.removeEventListener("pointercancel", up);
      tr.removeEventListener("click", click, true);
      narrow.removeEventListener("change", onTrackScroll);
      window.removeEventListener("resize", onTrackScroll);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    // Under 768px the gallery is a native horizontal snap row (see .sig-section
    // in landing.css); the scroll-driven transform must not touch it.
    const narrow = window.matchMedia("(max-width: 767px)");
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sec = outer.current;
        const tr = track.current;
        if (!sec || !tr) return;
        if (narrow.matches) {
          tr.style.transform = "";
          if (word.current) word.current.style.transform = "";
          return;
        }
        const vh = window.innerHeight;
        const total = sec.offsetHeight - vh;
        const scrolled = Math.min(Math.max(-sec.getBoundingClientRect().top, 0), total);
        const progress = total > 0 ? scrolled / total : 0;
        const travel = Math.max(tr.scrollWidth - window.innerWidth, 0);
        tr.style.transform = `translate3d(${-progress * travel}px,0,0)`;
        if (word.current) word.current.style.transform = `translate3d(${-progress * travel * 0.35}px,0,0)`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const defaults = LANDING_SOURCES.filter((s) => s.tier === "default").length;

  return (
    <section id="signals" ref={outer} className="sig-section relative w-full bg-[#050506]">
      <div className="sig-stage sticky top-0 h-svh w-full overflow-hidden">
        <p className="sig-label absolute left-[clamp(20px,4vw,64px)] top-8 z-20 font-mono text-[11px] tracking-[0.16em] text-[rgba(244,244,241,0.5)] uppercase">
          02 — Data / what the agent pays for, per call, over x402
        </p>
        <div
          ref={word}
          className="sig-word pointer-events-none absolute top-1/2 left-0 z-0 -translate-y-1/2 whitespace-nowrap font-semibold uppercase"
          style={{ fontSize: "24vw", lineHeight: 0.8, letterSpacing: "-0.04em", color: "rgba(244,244,241,0.06)" }}
        >
          Signals
        </div>
        <div className="sig-rail absolute top-1/2 left-0 z-10 -translate-y-1/2">
                    <div
            ref={track}
            className="sig-track flex items-center gap-6 pl-[clamp(20px,4vw,64px)] pr-[30vw] will-change-transform"
          >
            <div className="sig-intro shrink-0">
              <h2 className="sig-intro-title">It buys its own research.</h2>
              <p className="sig-intro-body">
                Sell simulations, smart-money flow, token safety, market regime. The agent picks the source
                for the question in front of it, pays per call in USDC, and folds the answer into the score.
                Inside a data budget you set — ${DEFAULT_DATA_BUDGET_USD.toFixed(2)} a run by default.
              </p>
              <p className="sig-intro-meta">
                {LANDING_SOURCES.length} sources in the registry · {defaults} on by default
              </p>
            </div>
            {LANDING_SOURCES.map((s, i) => (
              <SignalCard key={s.id} s={s} index={i + 1} />
            ))}
          </div>
        </div>
        <div className="sig-swipe" aria-hidden>
          <span className="sig-swipe-hint">( swipe )</span>
          <div className="sig-swipe-rail">
            <div ref={thumb} className="sig-swipe-thumb" />
          </div>
        </div>
        <div className="sig-rule absolute bottom-6 left-0 h-px w-full bg-[rgba(244,244,241,0.08)]" />
      </div>
    </section>
  );
}

function SignalCard({ s, index }: { s: LandingSource; index: number }) {
  return (
    <article className="sig-card" data-tier={s.tier}>
      <header className="sig-top">
        <span className="sig-provider">
          <span className="sig-index">{String(index).padStart(2, "0")}</span>
          {s.provider}
        </span>
        <span className="sig-pills">
          {s.tier === "default" ? <span className="sig-pill sig-pill-accent">default</span> : null}
          {s.tier === "experimental" ? <span className="sig-pill sig-pill-dim">experimental</span> : null}
          <span className="sig-pill">{s.network}</span>
        </span>
      </header>

      <div className="sig-namerow">
        <h3 className="sig-name">{s.name}</h3>
        {s.guard ? <span className="sig-tagpill">Guard</span> : null}
      </div>
      <p className="sig-desc">{s.desc}</p>

      <div className="sig-preview">
        <div className="sig-preview-head">
          <span>Returns</span>
          <span className="sig-live">live</span>
        </div>
        {s.returns.map(([k, v]) => (
          <div key={k} className="sig-row">
            <span className="sig-key">{k}</span>
            <span className="sig-val">{v}</span>
          </div>
        ))}
      </div>

      <footer className="sig-foot">
        <span className="sig-price">
          {s.price}
          <span className="sig-per">/ call</span>
        </span>
        <span className="sig-src">x402 · {s.host}</span>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------- mechanics */
function Mechanics() {
  return (
    <section id="mechanics" className="mech relative w-full bg-[#050506]">
      <div className="mech-inner">
        <p className="mech-eyebrow">03 — Mechanics</p>
        <h2 className="mech-title rise" style={{ color: OFF }}>
          Build the agent that trades like you.
        </h2>

        <div className="mech-grid">
          {FEATURES.map((f) => (
            <div key={f.i} className="mech-item rise">
              <div className="mech-item-head">
                <span className="mech-item-index">{f.i}</span>
                <span className="mech-item-label">{f.label}</span>
              </div>
              <p className="mech-item-body">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mech-statement rise">
          <span className="mech-statement-rule" aria-hidden />
          <p className="mech-statement-line">Entry rules never block an exit.</p>
          <p className="mech-statement-sub">
            Blocklist a token you hold, spend the day&rsquo;s trade quota, hit the kill switch — the sell still goes
            through. A guard that traps you is not a guard.
          </p>
        </div>

        <dl className="mech-defaults" aria-label="Defaults a new agent starts with">
          <div className="mech-defaults-head">Defaults you can change</div>
          {DEFAULTS.map(([k, v]) => (
            <div key={k} className="mech-default">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
