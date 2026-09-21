"use client";

import { useEffect, useRef } from "react";
import {
  Circle,
  Exposure,
  GradientMap,
  Group,
  LensDistortion,
  Repeater,
  Shader,
  SolidColor,
  Text,
  TimeTrail,
} from "shaders/react";

/**
 * The Isotope hero's shader tree, on its own so the 700 KB WebGPU runtime is
 * only downloaded by devices that will draw it (see use-shader-gate.ts). The
 * headline lives inside the shader: two Text layers burn bright (Exposure), a
 * GradientMap-monochromed cluster of 14 jitter-scattered circles
 * (TimeTrail → Repeater → Circle) smears trails that chase the cursor, and a
 * mouse-following LensDistortion warps and fringes the type. Tree order is
 * load-bearing.
 */
export function IsotopeShader({
  textVisible,
  onReady,
  onUnavailable,
}: {
  textVisible: boolean;
  onReady: () => void;
  onUnavailable: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // The shader's mouse-position / mouse drivers are uninitialized until the
  // first pointer event, so on load the hero renders pure black and the
  // headline is invisible. Prime the drivers with a short synthetic pointer
  // sweep to a resting anchor so the type reads immediately and the molten
  // cluster settles as an accent; the real cursor takes over from there.
  useEffect(() => {
    let raf = 0;
    let userMoved = false;
    // Only a real cursor (isTrusted) cancels the seed — our own synthetic
    // pointermoves below have isTrusted === false and must not trip this.
    const onUser = (e: PointerEvent) => {
      if (e.isTrusted) userMoved = true;
    };
    window.addEventListener("pointermove", onUser);

    const start = performance.now();
    const DURATION = 900;
    // Resting anchor (fraction of canvas): parks the melt upper-right so the
    // big "sleep." stays legible. Traced from an off-canvas point for a trail.
    const from = { x: 0.5, y: 1.05 };
    const to = { x: 0.62, y: 0.4 };
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const canvas = wrapRef.current?.querySelector("canvas");
      if (!canvas) {
        if (now - start < 3000) raf = requestAnimationFrame(tick);
        return;
      }
      if (userMoved) return;
      const p = Math.min((now - start) / DURATION, 1);
      const e = ease(p);
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width * (from.x + (to.x - from.x) * e);
      const cy = r.top + r.height * (from.y + (to.y - from.y) * e);
      for (const type of ["pointermove", "mousemove"] as const) {
        const ev = new PointerEvent(type, {
          clientX: cx,
          clientY: cy,
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
        });
        canvas.dispatchEvent(ev);
        window.dispatchEvent(ev);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onUser);
    };
  }, []);

  return (
    <div ref={wrapRef} className="iso-shaderwrap" aria-hidden>
      <Shader
        toneMapping="aces"
        style={{ width: "100%", height: "100%", display: "block" }}
        onReady={onReady}
        onUnavailable={onUnavailable}
      >
        <SolidColor color="#050029" />
        <Exposure exposure={1.7}>
          <Group flow={{ mode: "column", gap: 13, align: "center", anchor: "center", anchorOffset: { x: 0, y: 0 } }}>
            <Text
              center={{ x: 0.5, y: 0.39 }}
              fontFamily="Geist"
              fontSize={0.07}
              letterSpacing={-0.03}
              origin="bottom-left"
              text="your agent trades while you"
              visible={textVisible}
            />
            <Text
              center={{ x: 0.5, y: 0.53 }}
              fontFamily="Geist"
              fontSize={0.34}
              fontWeight={600}
              letterSpacing={-0.045}
              origin="bottom-left"
              text="sleep."
              visible={textVisible}
            />
          </Group>
        </Exposure>
        <GradientMap colorHigh="#ffffff" colorLow="#1a1a1a" colorMid="#0d0d0d" colorSpace="oklab" palette="custom" visible whitePoint={0.5}>
          <TimeTrail
            driftX={{ axis: "x", type: "mouse", outputMax: 1, outputMin: -1, smoothing: 0.25 }}
            driftY={{ axis: "y", type: "mouse", curve: 0, outputMax: 1, outputMin: -1, smoothing: 0.25 }}
            motionThreshold={0.01}
            trailLength={1}
            trailSource="alpha"
          >
            <Repeater
              count={14}
              hueShift={43}
              jitterPosition={0.835}
              mode="radial"
              radius={0.095}
              startAngle={{ mode: "loop", type: "auto-animate", speed: 2, easing: "linear", outputMax: 360, outputMin: 0 }}
            >
              <Circle
                center={{ type: "mouse-position", reach: 0.5, invertX: true, invertY: true, originX: 0.5, originY: 0.5, momentum: 0.7, smoothing: 0.75 }}
                color="#fc0808"
                radius={{ unit: "px", value: 40 }}
                visible
              />
            </Repeater>
          </TimeTrail>
        </GradientMap>
        <LensDistortion
          angle={195}
          bias={0.44}
          center={{ type: "mouse-position", originX: 0.5, originY: 0.5, smoothing: 0.3, reach: 0.54, momentum: 0.2 }}
          count={22}
          dispersion={0.79}
          dispersionColor={0.74}
          dispersionShift={0.67}
          focusCenter={0.7}
          focusEdges={0.56}
          grainMixer={0.26}
          grainOverlay={0.04}
          lensBulge={-0.27}
          noiseFrequency={0.32}
          perspective={0.61}
          spread={0.05}
          swirl={1}
          visible
        />
      </Shader>
    </div>
  );
}
