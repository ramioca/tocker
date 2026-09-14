"use client";

/**
 * The WebGPU hero composition. This is the ONLY module that imports `shaders`, and it is
 * never statically imported by anything: `hero-shader.tsx` pulls it in through
 * `next/dynamic({ ssr: false })` *after* it has checked `navigator.gpu`. The package is
 * ~35MB on disk, so it must stay in its own async chunk — if you ever `import` this file
 * from a server component or from the top of a component that renders on first paint,
 * the landing page's first-load JS goes with it.
 *
 * The engine is WebGPU-only: no WebGL2 fallback, no canvas2d path. On a browser without
 * it the canvas stays transparent for good and `onUnavailable` fires — which is why the
 * CSS fallback underneath this layer is permanent, not a placeholder.
 */

import { Glitch, InkFlow, ParticleField, Shader, SolidColor } from "shaders/react";

export type HeroShaderStageProps = {
  /** Particle count, chosen by the host from core count / viewport. */
  count: number;
  /** Fires once the renderer has drawn — the host cross-fades on it. */
  onReady: () => void;
  /** Fires once if this GPU can never run the composition. */
  onUnavailable: () => void;
};

export function HeroShaderStage({ count, onReady, onUnavailable }: HeroShaderStageProps) {
  return (
    <Shader
      toneMapping="aces"
      onReady={onReady}
      onUnavailable={onUnavailable}
      style={{ width: "100%", height: "100%" }}
    >
      <SolidColor color="#161617" />
      {/*
        Note on what this looks like before anyone moves the mouse: InkFlow is a fluid
        painted by the pointer, and its dye buffer starts empty, so the particle field
        has nothing bright to sample until the cursor crosses the hero. That is fine
        here — the canvas is screen-blended over the CSS fallback, so "no ink yet" looks
        exactly like the fallback, and the ink then blooms under the pointer. If a
        permanent base glow is wanted instead, the smallest change is a second dim
        SolidColor INSIDE this ParticleField, under the InkFlow, to give every particle
        a floor luminance.
      */}
      {/*
        Ink flow read as a depth field by the particles. `cursorStrength={0}` keeps the
        particles themselves still — the pointer paints the ink, it does not throw the
        grid around, which is what stops this reading as a screensaver. Colours are the
        brand violet cycle rather than the default rainbow so the backdrop stays one hue
        family with the page.
      */}
      <ParticleField
        count={count}
        cursorStrength={0}
        particleSize={0.37}
        zoom={1.4}
        wobble={0.42}
        depth={0.85}
        depthShading={0.72}
      >
        <InkFlow
          radius={0.6}
          colorMode="custom"
          color1="#7c3aed"
          color2="#c4b5fd"
          color3="#3b1e83"
          decay={0.3}
          curl={14}
          momentum={0.82}
        />
      </ParticleField>
      {/*
        Glitch, colour bars off as specified, and everything else pulled well down from
        the shader's defaults (intensity 0.5, rgbShift 5, mirror 0.3): a hero has headline
        copy sitting on it, and a mirrored block behind a word is unreadable.
      */}
      <Glitch
        colorBarIntensity={0}
        intensity={0.18}
        rgbShift={2.4}
        blockDensity={6}
        mirrorAmount={0}
        scanlineIntensity={0.1}
        speed={0.6}
      />
    </Shader>
  );
}

export default HeroShaderStage;
