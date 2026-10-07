"use client";

import { Aurora, ChromaFlow, Liquify, Shader } from "shaders/react";

/**
 * The aurora itself, in its own module so hero-shader.tsx can load it lazily: a
 * static named import lets the bundler keep only these effects out of the
 * library's 200-odd (it is marked side-effect free).
 *
 * With a mouse (`interactive`), the curtains hang like silk the cursor drags
 * through (Liquify) and its path leaves a faint neon wake (ChromaFlow). The
 * library tracks the pointer on the window, so the canvas stays pointer-events: none
 * and never steals a click. On touch it is the aurora alone: a drag there is a scroll.
 */
export default function HeroShaderCanvas({
  interactive,
  onReady,
  onUnavailable,
}: {
  interactive: boolean;
  onReady: () => void;
  onUnavailable: () => void;
}) {
  const aurora = (
    <Aurora
      colorA="#ff3dcb"
      colorB="#3d6bff"
      colorC="#3fd2ff"
      colorSpace="oklab"
      intensity={55}
      curtainCount={3}
      speed={2}
      waviness={45}
      rayDensity={14}
      height={110}
    />
  );
  return (
    <Shader className="lp-hero-shader-canvas" disableTelemetry onReady={onReady} onUnavailable={onUnavailable}>
      {interactive ? (
        <>
          <Liquify intensity={9} stiffness={4} damping={3.5} radius={0.9}>
            {aurora}
          </Liquify>
          <ChromaFlow
            baseColor="#000000"
            upColor="#3fd2ff"
            downColor="#ff3dcb"
            leftColor="#8b6cff"
            rightColor="#3d6bff"
            intensity={0.9}
            radius={2.2}
            momentum={24}
            blendMode="screen"
            opacity={0.75}
          />
        </>
      ) : (
        aurora
      )}
    </Shader>
  );
}
