"use client";

import { Aurora, Shader } from "shaders/react";

/**
 * The aurora itself, in its own module so hero-shader.tsx can load it lazily: a
 * static named import lets the bundler keep only Shader and Aurora out of the
 * library's 200-odd effects (it is marked side-effect free).
 */
export default function HeroShaderCanvas({ onReady, onUnavailable }: { onReady: () => void; onUnavailable: () => void }) {
  return (
    <Shader className="lp-hero-shader-canvas" disableTelemetry onReady={onReady} onUnavailable={onUnavailable}>
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
    </Shader>
  );
}
