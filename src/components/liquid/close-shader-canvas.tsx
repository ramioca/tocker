"use client";

import { FlowingGradient, Liquify, Shader } from "shaders/react";

/**
 * The closing section's silk, in its own module so close-shader.tsx can load it lazily.
 * With a mouse (`interactive`), it gives a little under the cursor (a gentle Liquify);
 * the library tracks the pointer on the window, so the canvas never takes a click.
 */
export default function CloseShaderCanvas({
  interactive,
  onReady,
  onUnavailable,
}: {
  interactive: boolean;
  onReady: () => void;
  onUnavailable: () => void;
}) {
  const silk = (
    <FlowingGradient
      colorA="#030306"
      colorB="#2c47d8"
      colorC="#7a5cff"
      colorD="#ff3dcb"
      colorSpace="oklch"
      speed={0.45}
      distortion={0.6}
    />
  );
  return (
    <Shader className="lp-close-shader-canvas" disableTelemetry onReady={onReady} onUnavailable={onUnavailable}>
      {interactive ? (
        <Liquify intensity={5} stiffness={6} damping={4} radius={0.8}>
          {silk}
        </Liquify>
      ) : (
        silk
      )}
    </Shader>
  );
}
