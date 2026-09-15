"use client";

/**
 * The closing CTA's WebGPU composition. Same isolation contract as
 * `hero-shader-stage.tsx`: this is the only other module that imports `shaders`, it is
 * only ever loaded through `next/dynamic({ ssr: false })` after the host has verified
 * a GPU adapter, and it shares the hero's async chunk — a visitor who saw the hero
 * pays nothing extra to see this.
 *
 * FlowingGradient over the composition ground, in the Pixel Ink band and nothing
 * outside it (finishing-touches note: a background stays background-like through
 * restraint — narrow palette, low speed). The hero's stage has torn itself down by
 * the time this card is on screen, so the page never runs two GPU compositions.
 */

import { FlowingGradient, Shader } from "shaders/react";

export type CtaShaderStageProps = {
  /** Fires once the renderer has drawn — the host cross-fades on it. */
  onReady: () => void;
  /** Fires once if this GPU can never run the composition. */
  onUnavailable: () => void;
};

export function CtaShaderStage({ onReady, onUnavailable }: CtaShaderStageProps) {
  return (
    <Shader
      toneMapping="aces"
      onReady={onReady}
      onUnavailable={onUnavailable}
      style={{ width: "100%", height: "100%" }}
    >
      <FlowingGradient
        colorA="#050505"
        colorB="#4338ff"
        colorC="#19e3ff"
        colorD="#ff2d7e"
        colorSpace="oklch"
        speed={0.22}
        distortion={0.55}
      />
    </Shader>
  );
}

export default CtaShaderStage;
