"use client";

import { useEffect, useRef } from "react";
import { createRunner } from "./runner";

/**
 * WebGL2 rendition of the Isotope hero for browsers without WebGPU. Same
 * ingredients as the Paper Shaders tree: a cluster of fourteen discs orbiting
 * a centre that runs away from the pointer, leaving trails that drift with
 * it; a lens around the pointer that ripples, swirls and splits the trails
 * into colour fringes; film grain over a deep violet-black ground. The
 * headline is not drawn here — the DOM <h1> carries it on this path.
 *
 * Feedback pass: the trail buffer (r = trail age, 1 under a disc, decaying
 * behind it). Screen pass: lens + shading + grain.
 */
const FEEDBACK = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uDt, uSpin, uRadius;
uniform vec2 uCenter, uDrift;
in vec2 vUv;
out vec4 o;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float aspect = uRes.x / uRes.y;
  // The wake drifts away from the pointer while it fades, and softens as it
  // ages (a little diffusion each frame is what makes the smears look molten).
  vec2 s = vUv - uDrift * 0.0034;
  vec2 px = 1.6 / uRes;
  float prev = texture(uPrev, s).r * 0.52
    + (texture(uPrev, s + vec2(px.x, 0.0)).r + texture(uPrev, s - vec2(px.x, 0.0)).r
     + texture(uPrev, s + vec2(0.0, px.y)).r + texture(uPrev, s - vec2(0.0, px.y)).r) * 0.12;
  prev *= pow(0.012, uDt / 1.9);
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  vec2 c = vec2(uCenter.x * aspect, uCenter.y);
  float m = 0.0;
  float edge = uRadius * 0.3;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float a = uSpin + fi * 0.44879895 + (hash(fi * 3.7 + 2.0) - 0.5) * 2.2;
    float rr = 0.11 * (0.3 + hash(fi * 7.31 + 1.0) * 1.9);
    vec2 q = c + vec2(cos(a), sin(a)) * rr;
    float d = length(p - q);
    m = max(m, 1.0 - smoothstep(uRadius - edge, uRadius + edge, d));
  }
  o = vec4(max(prev, m), 0.0, 0.0, 1.0);
}`;

const SCREEN = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform vec2 uRes, uLens;
uniform float uTime;
in vec2 vUv;
out vec4 o;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// Trail age -> ink. A fresh disc is dark; the wake just behind it burns white;
// the far tail fades back to the ground — the monochrome gradient map.
float shade(float t) {
  float wake = smoothstep(0.04, 0.34, t);
  float core = smoothstep(0.88, 0.975, t);
  return wake * (1.0 - core * 0.94);
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  vec2 lc = vec2(uLens.x * aspect, uLens.y);
  vec2 dv = p - lc;
  float r = length(dv);
  vec2 n = dv / max(r, 1e-4);
  vec2 tg = vec2(-n.y, n.x);
  float reach = 1.0 - smoothstep(0.04, 0.62, r);
  float wob = vnoise(p * 3.2 + vec2(uTime * 0.07, -uTime * 0.05));
  float rings = sin(r * 69.1 + wob * 3.2);
  float amp = 0.0085 * reach;
  vec2 disp = n * rings * amp + tg * rings * amp * 0.7 - n * reach * 0.005;
  disp += (vec2(wob, vnoise(p * 2.1 - uTime * 0.04)) - 0.5) * 0.011 * reach;
  vec2 dUv = vec2(disp.x / aspect, disp.y);
  // Chromatic dispersion: the channels part only near the lens, and gently.
  float tR = texture(uTrail, vUv - dUv * 1.22).r;
  float tG = texture(uTrail, vUv - dUv).r;
  float tB = texture(uTrail, vUv - dUv * 0.78).r;
  vec3 ink = vec3(shade(tR), shade(tG), shade(tB));
  vec3 bg = vec3(0.034, 0.026, 0.128);
  bg += rings * 0.011 * reach;
  vec3 col = bg + ink * vec3(0.94, 0.93, 0.96);
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * 0.06;
  col *= 1.0 - 0.32 * smoothstep(0.45, 1.15, length(vUv - 0.5) * 1.3);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export function IsotopeWebGL({ onUnavailable }: { onUnavailable: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    // Resting anchor (texture space, y up). The cluster's home is the upper
    // half, clear of the headline that sits at the bottom of the hero; it
    // runs away from the pointer from there. The priming sweep traces the
    // pointer in from below so the first frames already carry a wake.
    const anchor = { x: 0.62, y: 0.6 };
    const home = { x: 0.52, y: 0.72 };
    const from = { x: 0.5, y: -0.05 };
    const target = { x: from.x, y: from.y };
    const cluster = { x: home.x, y: home.y - 0.4 };
    const lens = { x: 0.5, y: 0.5 };
    const drift = { x: 0, y: 0 };
    let spin = 0;
    let t0 = -1;
    const PRIME = 0.9;
    const IDLE_PAUSE = 2.2;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const lerpRate = (dt: number, perSecond: number) => 1 - Math.exp(-dt * perSecond);

    const runner = createRunner(canvas, {
      feedbackFrag: FEEDBACK,
      screenFrag: SCREEN,
      onFrame(ctx) {
        if (t0 < 0) t0 = ctx.time;
        const since = ctx.time - t0;
        const idle = ctx.time - ctx.lastInputAt > IDLE_PAUSE;
        if (since < PRIME && !ctx.pointerActive) {
          const e = ease(since / PRIME);
          target.x = from.x + (anchor.x - from.x) * e;
          target.y = from.y + (anchor.y - from.y) * e;
        } else if (ctx.coarse ? idle : !ctx.pointerActive) {
          // No cursor: a slow figure around the anchor keeps the melt alive.
          const t = ctx.time - t0;
          target.x = anchor.x + 0.16 * Math.sin(t * 0.42);
          target.y = anchor.y + 0.12 * Math.sin(t * 0.29 + 1.3);
        } else {
          target.x = ctx.pointer.x;
          target.y = ctx.pointer.y;
        }
        // The cluster runs away from the pointer (inverted, reach 0.5), slowly.
        const cx = home.x - (target.x - 0.5) * 0.5;
        const cy = home.y - (target.y - 0.5) * 0.5;
        const kc = lerpRate(ctx.dt, 2.4);
        cluster.x += (cx - cluster.x) * kc;
        cluster.y += (cy - cluster.y) * kc;
        // The lens follows the pointer (reach 0.54), quicker.
        const kl = lerpRate(ctx.dt, 6);
        lens.x += (0.5 + (target.x - 0.5) * 0.54 - lens.x) * kl;
        lens.y += (0.5 + (target.y - 0.5) * 0.54 - lens.y) * kl;
        // The wake drifts with the pointer's offset from centre.
        const kd = lerpRate(ctx.dt, 5);
        drift.x += ((target.x - 0.5) * 2 - drift.x) * kd;
        drift.y += ((target.y - 0.5) * 2 - drift.y) * kd;
        spin += ctx.dt * 1.5;
      },
      onUniforms(u, ctx, pass) {
        if (pass === "feedback") {
          u.v2("uCenter", cluster.x, cluster.y);
          u.v2("uDrift", drift.x, drift.y);
          u.f("uSpin", spin);
          u.f("uRadius", (34 * ctx.dpr) / Math.max(ctx.height, 1));
        } else {
          u.v2("uLens", lens.x, lens.y);
        }
      },
    });
    if (!runner) {
      onUnavailable();
      return;
    }
    return () => runner.destroy();
  }, [onUnavailable]);

  return (
    <div className="iso-shaderwrap" aria-hidden>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
