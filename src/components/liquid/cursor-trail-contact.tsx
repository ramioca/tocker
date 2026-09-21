"use client";

import { type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { useShaderGate } from "./use-shader-gate";
import { useWaitlist } from "./waitlist";
import "./isotope.css";

/**
 * Cursor-Trail Contact. The invite and footer are server-rendered DOM; the
 * Paper Shaders background (cursor-trail-shader.tsx) mounts only on a device
 * that can draw it, and the section keeps the same near-black diagonal
 * gradient as a plain CSS background everywhere else, so a phone never sees a
 * flat black half-screen with a hint about a cursor it does not have.
 */
const CursorTrailShader = dynamic(
  () => import("./cursor-trail-shader").then((m) => m.CursorTrailShader),
  { ssr: false },
);

export function CursorTrailContact() {
  const shader = useShaderGate();
  const { open: openWaitlist } = useWaitlist();
  const mountShader = shader.state === "loading" || shader.state === "on";

  return (
    <section id="contact" className="ctc" data-shader={shader.state}>
      {mountShader ? (
        <CursorTrailShader onReady={shader.ready} onUnavailable={shader.unavailable} />
      ) : null}

      <div className="ctc-invite">
        <h2 className="reveal ctc-kicker" style={{ "--reveal-delay": "0.1s" } as CSSProperties}>
          Ready to give a strategy a wallet?
        </h2>
        <button className="reveal ctc-cta group" type="button" onClick={openWaitlist} style={{ "--reveal-delay": "0.25s" } as CSSProperties} data-cursor="magnetic">
          Join the waitlist
          <span className="ctc-underline" aria-hidden />
        </button>
      </div>

      <footer className="reveal ctc-footer" style={{ "--reveal-delay": "0.45s" } as CSSProperties}>
        <div className="ctc-socials">
          <a href="#" data-cursor="magnetic">X</a>
          <a href="#" data-cursor="magnetic">Docs</a>
          <a href="#" data-cursor="magnetic">GitHub</a>
        </div>
        {shader.state === "on" ? <p className="ctc-hint">( move your cursor )</p> : null}
      </footer>
    </section>
  );
}
