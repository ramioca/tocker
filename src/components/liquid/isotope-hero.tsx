"use client";

import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import mark from "../../../public/brand/tocker/master/tocker-mark-3d-transparent.png";
import { useShaderGate } from "./use-shader-gate";
import { useWaitlist } from "./waitlist";
import "./isotope.css";

/**
 * Isotope Hero. The copy, nav and CTAs are ordinary DOM and server-rendered;
 * the Paper Shaders tree (isotope-shader.tsx) is a client-only chunk that only
 * mounts on a device that can draw it — WebGPU, a fine pointer, no reduced
 * motion. Everywhere else (phones, iOS before 26, Firefox, reduced motion) the
 * hero shows the Ticker Knot mark as a lit object over the same near-black
 * ground, and the DOM headline is the headline.
 *
 * Below 640px the in-shader text hides and the DOM <h1> takes over; at or above
 * it the <h1> is visually hidden only once the shader is actually drawing
 * (`data-shader="on"`), so a blank canvas can never take the headline with it.
 */
const IsotopeShader = dynamic(() => import("./isotope-shader").then((m) => m.IsotopeShader), {
  ssr: false,
});

export function IsotopeHero() {
  const [textVisible, setTextVisible] = useState(false);
  const shader = useShaderGate();
  const { open: openWaitlist } = useWaitlist();

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setTextVisible(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const mountShader = shader.state === "loading" || shader.state === "on";
  // The static art stays underneath until the renderer reports ready, so the
  // desktop hero fades from the mark into the shader instead of through black.
  const showStatic = shader.state !== "on";

  return (
    <section className="iso-hero" data-shader={shader.state}>
      {mountShader ? (
        <IsotopeShader
          textVisible={textVisible}
          onReady={shader.ready}
          onUnavailable={shader.unavailable}
        />
      ) : null}

      <div className="iso-scrim" aria-hidden />

      <header className="iso-header reveal" style={{ "--reveal-delay": "0s" } as CSSProperties}>
        <Link href="/" className="iso-logo" data-cursor="magnetic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="2.4" fill="currentColor" />
            <g className="orbit">
              <ellipse cx="12" cy="12" rx="10.5" ry="4.2" stroke="currentColor" strokeWidth="1.4" transform="rotate(-24 12 12)" />
              <circle cx="20.6" cy="7.4" r="1.6" fill="currentColor" />
            </g>
          </svg>
          Tocker
        </Link>
        <nav aria-label="Main" className="iso-nav">
          <a className="nav-link" href="#signals" data-cursor="magnetic">Signals</a>
          <a className="nav-link" href="#mechanics" data-cursor="magnetic">Mechanics</a>
          <a className="nav-link" href="#contact" data-cursor="magnetic">Docs</a>
          <button type="button" className="nav-link iso-nav-active" onClick={openWaitlist} data-cursor="magnetic">Waitlist</button>
        </nav>
      </header>

      {/* After the header on purpose: on a phone the art is in flow, under the logo. */}
      {showStatic ? (
        <div className="iso-static" aria-hidden>
          <div className="iso-static-glow" />
          <Image
            src={mark}
            alt=""
            priority
            sizes="(min-width: 640px) 420px, 64vw"
            className="iso-static-mark reveal"
            style={{ "--reveal-delay": "0.05s" } as CSSProperties}
          />
        </div>
      ) : null}

      <div className="iso-copy">
        <h1 className="reveal iso-h1" style={{ "--reveal-delay": "0.1s" } as CSSProperties}>
          <span className="iso-h1-kicker">your agent trades while you </span>
          <span className="iso-h1-big">sleep.</span>
        </h1>
        <p className="reveal iso-sub" style={{ "--reveal-delay": "0.2s" } as CSSProperties}>
          Describe a strategy in plain English. Tocker builds an agent that scores every launch and
          trades it, 24/7 — on its own wallet, out in the open.
        </p>
        <div className="reveal iso-ctas" style={{ "--reveal-delay": "0.36s" } as CSSProperties}>
          <button type="button" className="cta-primary" onClick={openWaitlist} data-cursor="magnetic">
            Join the waitlist
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="cta-arrow" aria-hidden>
              <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a className="cta-secondary" href="#signals" data-cursor="magnetic">
            See the feed
          </a>
        </div>
      </div>
    </section>
  );
}
