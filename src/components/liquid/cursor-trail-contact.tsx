"use client";

import { type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { Mark } from "./mark";
import { useShaderGate } from "./use-shader-gate";
import { useWaitlist } from "./waitlist";
import "./isotope.css";

/**
 * Cursor-Trail Contact. The invite and footer are server-rendered DOM; the
 * Paper Shaders background (cursor-trail-shader.tsx) mounts where WebGPU
 * exists, the WebGL2 rendition (webgl/cursor-trail-webgl.tsx) where it does
 * not, and the section keeps the same near-black diagonal gradient as a plain
 * CSS background beneath both.
 */
const CursorTrailShader = dynamic(
  () => import("./cursor-trail-shader").then((m) => m.CursorTrailShader),
  { ssr: false },
);
const CursorTrailWebGL = dynamic(
  () => import("./webgl/cursor-trail-webgl").then((m) => m.CursorTrailWebGL),
  { ssr: false },
);

export function CursorTrailContact() {
  const shader = useShaderGate();
  const { open: openWaitlist } = useWaitlist();
  const mountShader = shader.state === "loading" || shader.state === "on";

  return (
    <section id="contact" className="ctc" data-shader={shader.state} data-shader-reason={shader.reason || undefined}>
      {mountShader ? (
        <CursorTrailShader onReady={shader.ready} onUnavailable={shader.unavailable} />
      ) : null}
      {shader.state === "webgl" ? <CursorTrailWebGL onUnavailable={shader.unavailable} /> : null}

      <div className="ctc-invite">
        <p className="reveal ctc-eyebrow" style={{ "--reveal-delay": "0.05s" } as CSSProperties}>
          04 — Private beta
        </p>
        <h2 className="reveal ctc-kicker" style={{ "--reveal-delay": "0.1s" } as CSSProperties}>
          Ready to give a strategy a wallet?
        </h2>
        <button className="reveal ctc-cta" type="button" onClick={openWaitlist} style={{ "--reveal-delay": "0.25s" } as CSSProperties}>
          Join the waitlist
          <span className="ctc-underline" aria-hidden />
        </button>
        <p className="reveal ctc-sub" style={{ "--reveal-delay": "0.35s" } as CSSProperties}>
          We onboard by trading size, largest books first.
        </p>
      </div>

      <footer className="reveal ctc-footer" style={{ "--reveal-delay": "0.45s" } as CSSProperties}>
        <p className="ctc-brand">
          <Mark size={15} />
          <span>tocker · solana and base · paper by default</span>
        </p>
        <p className="ctc-legal">
          <span>not investment advice</span>
          {shader.state === "on" || shader.state === "webgl" ? (
            <span className="ctc-hint">( move your cursor )</span>
          ) : null}
        </p>
      </footer>
    </section>
  );
}
