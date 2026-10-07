"use client";

import { FlowingGradient, Liquify, Shader } from "shaders/react";

/**
 * The hero's silk, in its own module so hero-shader.tsx can load it lazily: a
 * static named import lets the bundler keep only these effects out of the
 * library's 200-odd (it is marked side-effect free). The same flowing gradient
 * as the closing section (close-shader-canvas.tsx), so the page opens and ends
 * on one surface.
 *
 * With a mouse (`interactive`), the silk gives under the cursor (Liquify). The
 * library tracks the pointer on the window, so the canvas stays pointer-events: none
 * and never steals a click. On touch it just flows: a drag there is a scroll.
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
  const silk = (
    <FlowingGradient
      colorA="#030306"
      colorB="#2c47d8"
      colorC="#7a5cff"
      colorD="#ff3dcb"
      colorSpace="oklch"
      speed={0.5}
      distortion={0.6}
    />
  );
  return (
    <Shader className="lp-hero-shader-canvas" disableTelemetry onReady={onReady} onUnavailable={onUnavailable}>
      {interactive ? (
        <Liquify intensity={8} stiffness={5} damping={3.5} radius={0.9}>
          {silk}
        </Liquify>
      ) : (
        silk
      )}
    </Shader>
  );
}
