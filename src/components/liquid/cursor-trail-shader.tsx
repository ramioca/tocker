"use client";

import {
  ChromaFlow,
  CursorRipples,
  DotGrid,
  FilmGrain,
  LinearGradient,
  Shader,
} from "shaders/react";

/**
 * The cursor-trail shader behind the closing CTA, on its own chunk so only
 * devices that can draw it download it. A near-black gradient until the cursor
 * moves, then a twinkling halftone dot trail (DotGrid masks a white
 * LinearGradient, its dots sized by ChromaFlow's cursor field) with chromatic
 * ripple fringes and film grain. Both invisible driver components must stay in
 * the tree; the id linkages are load-bearing.
 */
export function CursorTrailShader({
  onReady,
  onUnavailable,
}: {
  onReady: () => void;
  onUnavailable: () => void;
}) {
  return (
    <div className="ctc-shaderwrap" aria-hidden>
      <Shader
        style={{ width: "100%", height: "100%", display: "block" }}
        onReady={onReady}
        onUnavailable={onUnavailable}
      >
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
  );
}
