"use client";

import { type CSSProperties } from "react";
import {
  ChromaFlow,
  CursorRipples,
  DotGrid,
  FilmGrain,
  LinearGradient,
  Shader,
} from "shaders/react";
import { useWaitlist } from "./waitlist";
import "./isotope.css";

/**
 * Cursor-Trail Contact (Paper Shaders / WebGPU). The background IS the piece: a
 * near-black gradient until the cursor moves, then a twinkling halftone dot trail
 * (DotGrid masks a white LinearGradient, its dots sized by ChromaFlow's cursor
 * field) with chromatic ripple fringes and film grain. Both invisible driver
 * components must stay in the tree; the id linkages are load-bearing.
 */
export function CursorTrailContact() {
  const { open: openWaitlist } = useWaitlist();
  return (
    <section id="contact" className="ctc">
      <div className="ctc-shaderwrap" aria-hidden>
        <Shader style={{ width: "100%", height: "100%", display: "block" }}>
          <DotGrid
            id="trailDots"
            density={40}
            dotSize={{ type: "map", source: "trailFlow", channel: "alpha", inputMax: 1, inputMin: 0, outputMax: 1, outputMin: 0 }}
            twinkle={0.9}
            visible={false}
          />
          <ChromaFlow id="trailFlow" intensity={1.4} radius={2.9} visible={false} />
          <LinearGradient colorA="#1e1e1f" colorB="#070708" colorSpace="hsl" end={{ x: 1, y: 0 }} start={{ x: 0, y: 1 }} />
          <LinearGradient colorA="#000000" colorB="#ffffff" colorSpace="hsl" end={{ x: 1, y: 0 }} maskSource="trailDots" start={{ x: 0, y: 1 }} />
          <CursorRipples />
          <FilmGrain strength={0.1} />
        </Shader>
      </div>

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
        <p className="ctc-hint">( move your cursor )</p>
      </footer>
    </section>
  );
}
