"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ReactLenis } from "lenis/react";
import { CursorTrailContact } from "./cursor-trail-contact";
import { IsotopeHero } from "./isotope-hero";
import { WaitlistProvider } from "./waitlist";

/**
 * Tocker waitlist landing. The hero and contact sections are Paper-Shaders /
 * WebGPU pieces (Isotope Hero + Cursor-Trail Contact); the middle two sections
 * (Signals gallery, Mechanics grid) are DOM. Two type registers, 99% monochrome,
 * Lenis smooth scroll, a lagging custom cursor, and a universal film grain.
 *
 * The hero and contact copy are server-rendered; only their `<Shader>` subtrees
 * are client-only chunks, and those mount solely on devices that can draw them
 * (see use-shader-gate.ts). Phones get the same page with static art.
 */

const OFF = "#f4f4f1";

// Real, live endpoints from the open x402 Bazaar (Coinbase CDP facilitator
// discovery list, 16k+ services). Every provider/host/price below is verified —
// each URL returns HTTP 402 and the amount is its on-chain USDC price on Base.
// Field rows are the response shape each service advertises in its listing.
type Signal = {
  i: string;
  provider: string;
  host: string;
  name: string;
  price: string;
  desc: string;
  fields: string[][];
  per?: string;
  accent?: boolean; // magenta = signals / intelligence / guardrail tier
  tag?: string; // category pill (Guard, Swap, …)
};

const SIGNALS: Signal[] = [
  {
    i: "01", provider: "CoinGecko", host: "coingecko.com", name: "DEX Token Price", price: "$0.01",
    desc: "Onchain DEX price & market data by contract",
    fields: [["price_usd", "spot"], ["volume_24h", "live"], ["networks", "base · eth"]],
  },
  {
    i: "02", provider: "Kronos", host: "kronossignals.com", name: "Derivatives Signals", price: "$0.02", accent: true,
    desc: "Funding, OI & market-regime, realtime",
    fields: [["funding", "rate"], ["open_interest", "Δ"], ["regime", "squeeze…"]],
  },
  {
    i: "03", provider: "Nansen", host: "nansen.ai", name: "Smart-Money Balances", price: "$0.01",
    desc: "Address holdings & labels from Nansen",
    fields: [["token", "holdings"], ["usd_value", "live"], ["labels", "smart money"]],
  },
  {
    i: "04", provider: "agentpay", host: "agentpay.tools", name: "Pre-Trade Risk", price: "$0.01", accent: true, tag: "Guard",
    desc: "Live orderbook slippage at YOUR size",
    fields: [["slippage", "@ size"], ["funding", "side-aware"], ["verdict", "ok / block"]],
  },
  {
    i: "05", provider: "Hyperliquid", host: "x402atlas.com", name: "Perps Universe", price: "$0.005",
    desc: "Tradeable perps: symbols & max leverage",
    fields: [["symbol", "BTC · SOL…"], ["maxLeverage", "≤ 50x"], ["szDecimals", "n"]],
  },
  {
    i: "06", provider: "Kronos", host: "kronossignals.com", name: "ML Price Forecast", price: "$0.05", accent: true,
    desc: "Deep-learning BTC forecast + up-probability",
    fields: [["up_prob", "0–1"], ["expected", "close"], ["horizon", "N h"]],
  },
  {
    i: "07", provider: "Ozmium", host: "ozmium.org", name: "Morpho Markets", price: "$0.001",
    desc: "Every Morpho Blue market on Base — rates & LTV",
    fields: [["marketId", "all"], ["loan+collat", "pairs"], ["lltv", "per market"]],
  },
  {
    i: "08", provider: "lionx402", host: "lionx402.com", name: "AML Wallet Screen", price: "$0.001", accent: true, tag: "Guard",
    desc: "OFAC / SDN screen before you trade",
    fields: [["status", "pass / block"], ["sanctions", "checked"], ["risk", "score"]],
  },
  {
    i: "09", provider: "apitoll", host: "apitoll.cloud", name: "Perp Mark & Funding", price: "$0.001",
    desc: "Hyperliquid mark price + hourly funding",
    fields: [["mark", "live"], ["funding_1h", "rate"], ["coin", "any"]],
  },
  {
    i: "10", provider: "OnRamperX", host: "mudko.com", name: "Value Router", price: "$0.005", accent: true, tag: "Swap",
    desc: "Fiat ↔ crypto & cross-chain, one quote",
    fields: [["route", "best"], ["quote", "live"], ["settle", "non-custodial"]],
  },
  {
    i: "11", provider: "IXS", host: "ixs.finance", name: "RWA Vaults", price: "$0.001",
    desc: "Tokenized real-world assets, ~6% yield",
    fields: [["apy", "~6%"], ["exposure", "BlackRock"], ["asset", "tokenized"]],
  },
  {
    i: "12", provider: "Lone Star", host: "lonestaroracle.xyz", name: "Options Flow", price: "$0.01", accent: true,
    desc: "Unusual options activity & put/call ratios",
    fields: [["put_call", "ratio"], ["blocks", "large"], ["unusual", "flagged"]],
  },
  {
    i: "13", provider: "apitoll", host: "apitoll.cloud", name: "Fear & Greed", price: "$0.001",
    desc: "Crypto market-sentiment index, 0–100",
    fields: [["score", "0–100"], ["class", "greed…"], ["updated", "live"]],
  },
  {
    i: "14", provider: "Kronos", host: "kronossignals.com", name: "Liquidation Map", price: "$0.02", accent: true,
    desc: "Forward liquidation clusters, 17 assets",
    fields: [["clusters", "est. levels"], ["recent", "prints"], ["asset", "BTC…"]],
  },
  {
    i: "15", provider: "printmoneylab", host: "printmoneylab.com", name: "Korean Prices", price: "$0.002",
    desc: "Upbit & Bithumb KRW — kimchi premium",
    fields: [["upbit", "KRW"], ["bithumb", "KRW"], ["premium", "vs global"]],
  },
];

const FEATURES = [
  { i: "01", label: "Any strategy", body: "Spin up separate agents for momentum, sentiment, or fresh-launch hunting — each with its own mandate and its own Solana + Base wallet." },
  { i: "02", label: "Public record, private edge", body: "Every trade posts to a public feed while your prompt, thresholds, and data sources stay yours. No one copies the play." },
  { i: "03", label: "Exits in code", body: "Stop-loss, take-profit, and trailing stops fire on a five-minute clock — not on your nerve." },
  { i: "04", label: "Risk guardrails", body: "Position caps, token-safety scans, and a sell-simulation veto stop bad fills before they clear." },
  { i: "05", label: "Paper, then live", body: "Start in paper mode by default. Flip to live capital when the numbers hold up." },
  { i: "06", label: "No allowlist", body: "It scores every launch on Solana and Base — the whole field, not a curated shortlist." },
];

export function LiquidLanding() {
  return (
    <ReactLenis root options={{ lerp: 0.085, duration: 1.1 }}>
      <WaitlistProvider>
        <Cursor />
        <main className="liquid-main relative w-full bg-[#040407] text-[#f4f4f1]">
          <IsotopeHero />
          <Signals />
          <Mechanics />
          <CursorTrailContact />
          <Grain />
        </main>
      </WaitlistProvider>
    </ReactLenis>
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
      bar.style.transform = `translateX(${vis > 0 ? (frac * (1 - vis)) / vis * 100 : 0}%)`;
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
    // in isotope.css); the scroll-driven transform must not touch it.
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

  return (
    <section id="signals" ref={outer} className="sig-section relative w-full bg-[#050506]">
      <div className="sig-stage sticky top-0 h-svh w-full overflow-hidden">
        <p className="sig-label absolute left-[clamp(20px,4vw,64px)] top-8 z-20 font-mono text-[11px] tracking-[0.16em] text-[rgba(244,244,241,0.45)] uppercase">
          02 — Endpoints / 16,000+ live services in the x402 Bazaar
        </p>
        <div
          ref={word}
          className="sig-word pointer-events-none absolute top-1/2 left-0 z-0 -translate-y-1/2 whitespace-nowrap font-semibold uppercase"
          style={{ fontSize: "26vw", lineHeight: 0.8, letterSpacing: "-0.04em", color: "rgba(244,244,241,0.07)" }}
        >
          Signals
        </div>
        <div className="sig-rail absolute top-1/2 left-0 z-10 -translate-y-1/2">
          {/* data-lenis-prevent: the smooth-scroll root must not swallow wheel/touch on the row. */}
          <div
            ref={track}
            data-lenis-prevent
            className="sig-track flex items-center gap-7 pl-[clamp(20px,4vw,64px)] pr-[30vw] will-change-transform"
          >
            <div className="sig-intro w-[26vw] max-w-[380px] shrink-0 pr-8">
              <p className="font-mono text-[11px] leading-[1.6] tracking-[0.08em] text-[rgba(244,244,241,0.55)] uppercase">
                Your agent discovers and pays any of 16,000+ live services in the open x402 Bazaar
                — prices, signals, pre-trade checks, routing. Cents per call, settled on Base.
              </p>
            </div>
            {SIGNALS.map((s) => (
              <SignalCard key={s.i} s={s} />
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

function SignalCard({ s }: { s: (typeof SIGNALS)[number] }) {
  const accent = s.accent ? "255, 45, 92" : "25, 227, 255";
  return (
    <article data-cursor="drag" className="sig-card" style={{ "--accent": accent } as CSSProperties}>
      <div className="sig-glow" aria-hidden />
      <header className="sig-top">
        <span className="sig-logo">{s.provider}</span>
        <span className="sig-net">Base</span>
      </header>

      <div className="sig-namerow">
        <h3 className="sig-name">{s.name}</h3>
        {s.tag ? <span className="sig-tagpill">{s.tag}</span> : null}
      </div>
      <p className="sig-desc">{s.desc}</p>

      <div className="sig-preview">
        <div className="sig-preview-head">
          <span>Returns</span>
          <span className="sig-live">live</span>
        </div>
        {s.fields.map(([k, v]) => (
          <div key={k} className="sig-row">
            <span className="sig-key">{k}</span>
            <span className="sig-val">{v}</span>
          </div>
        ))}
      </div>

      <div className="sig-foot">
        <span className="sig-price">
          {s.price}
          <span className="sig-per">/ {s.per ?? "call"}</span>
        </span>
        <span className="sig-src">x402 · {s.host}</span>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- mechanics */
function Mechanics() {
  return (
    <section id="mechanics" className="relative w-full bg-[#050506] px-[clamp(20px,4vw,64px)] py-[14vh]">
      <p className="font-mono text-[11px] tracking-[0.16em] text-[rgba(244,244,241,0.45)] uppercase">
        03 — Mechanics
      </p>
      <h2
        className="mt-6 max-w-[16ch] font-semibold uppercase"
        style={{ fontSize: "clamp(2rem, 7vw, 6rem)", lineHeight: 0.95, letterSpacing: "-0.02em", color: OFF }}
      >
        Build the agent that trades like you.
      </h2>
      <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.i} className="border-t border-[rgba(244,244,241,0.12)] pt-5">
            <div className="flex items-baseline gap-3 font-mono text-[12px] tracking-[0.1em] uppercase">
              <span className="text-[rgba(244,244,241,0.4)]">{f.i}</span>
              <span>{f.label}</span>
            </div>
            <p className="mt-3 font-mono text-[11px] leading-[1.6] tracking-[0.04em] text-[rgba(244,244,241,0.5)] uppercase">
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- cursor */
function Cursor() {
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
    const move = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      setVisible(true);
      const el = (e.target as HTMLElement)?.closest?.("[data-cursor]") as HTMLElement | null;
      setDrag(el?.dataset.cursor === "drag");
    };
    const loop = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      if (ring.current) ring.current.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      if (dot.current) dot.current.style.transform = `translate(${tx}px,${ty}px) translate(-50%,-50%)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", move, { passive: true });
    loop();
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] hidden md:block" style={{ opacity: visible ? 1 : 0 }}>
      <div
        ref={ring}
        className="fixed left-0 top-0 flex items-center justify-center rounded-full border border-[rgba(244,244,241,0.5)] font-mono text-[9px] tracking-[0.14em] text-[rgba(244,244,241,0.7)] uppercase transition-[width,height] duration-300"
        style={{ width: drag ? 72 : 34, height: drag ? 72 : 34 }}
      >
        {drag ? "Drag" : ""}
      </div>
      <div ref={dot} className="fixed left-0 top-0 h-1.5 w-1.5 rounded-full bg-[#f4f4f1]" style={{ opacity: drag ? 0 : 1 }} />
    </div>
  );
}

/* ----------------------------------------------------------------- grain */
function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90]"
      style={{
        opacity: 0.04,
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")",
        backgroundSize: "160px 160px",
      }}
    />
  );
}
