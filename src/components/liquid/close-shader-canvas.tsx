"use client";

import { FlowingGradient, Shader } from "shaders/react";

/**
 * The closing section's liquid silk, in its own module so close-shader.tsx can load it
 * lazily (a static named import keeps only Shader and FlowingGradient from the library).
 */
export default function CloseShaderCanvas({ onReady, onUnavailable }: { onReady: () => void; onUnavailable: () => void }) {
  return (
    <Shader className="lp-close-shader-canvas" disableTelemetry onReady={onReady} onUnavailable={onUnavailable}>
      <FlowingGradient
        colorA="#030306"
        colorB="#2c47d8"
        colorC="#7a5cff"
        colorD="#ff3dcb"
        colorSpace="oklch"
        speed={0.45}
        distortion={0.6}
      />
    </Shader>
  );
}
