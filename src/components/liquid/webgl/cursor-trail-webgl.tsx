"use client";

import { useEffect, useRef } from "react";
import { createRunner } from "./runner";

/**
 * WebGL2 rendition of the cursor-trail closing section for browsers without
 * WebGPU. A near-black diagonal gradient; a flow field that the pointer (or a
 * finger) charges and that diffuses and fades; a halftone dot grid whose dots
 * grow with the flow and twinkle; a chromatic ripple on every tap or click;
 * film grain. On touch devices an idle stroke runs now and then so the section
 * is never a flat rectangle.
 */
const FEEDBACK = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uRes, uStrokeA, uStrokeB;
uniform float uDt, uStroke;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 px = 1.0 / uRes;
  float f = texture(uPrev, vUv).r;
  float nb = texture(uPrev, vUv + vec2(px.x, 0.0)).r + texture(uPrev, vUv - vec2(px.x, 0.0)).r
           + texture(uPrev, vUv + vec2(0.0, px.y)).r + texture(uPrev, vUv - vec2(0.0, px.y)).r;
  f = mix(f, nb * 0.25, 0.4);
  f *= pow(0.02, uDt / 2.6);
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  vec2 a = vec2(uStrokeA.x * aspect, uStrokeA.y);
  vec2 b = vec2(uStrokeB.x * aspect, uStrokeB.y);
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(p - (a + ab * h));
  float splat = exp(-d * d / (2.0 * 0.075 * 0.075)) * uStroke;
  f = clamp(f + splat * uDt * 9.0, 0.0, 1.0);
  o = vec4(f, 0.0, 0.0, 1.0);
}`;

const SCREEN = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uRipple[4];
in vec2 vUv;
out vec4 o;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dots(vec2 uv, float aspect) {
  vec2 p = vec2(uv.x * aspect, uv.y);
  float cell = aspect / 40.0;
  vec2 id = floor(p / cell);
  vec2 centre = (id + 0.5) * cell;
  float flow = texture(uTrail, vec2(centre.x / aspect, centre.y)).r;
  float tw = 0.55 + 0.45 * sin(uTime * 2.6 + hash21(id) * 6.2831);
  float radius = flow * cell * 0.5 * (0.1 + 0.9 * tw);
  float d = length(p - centre);
  float aa = cell * 0.08;
  return 1.0 - smoothstep(radius - aa, radius + aa, d);
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  // Ground: #1e1e1f at the top-left corner to #070708 at the bottom-right.
  float g = clamp((vUv.x + (1.0 - vUv.y)) * 0.5, 0.0, 1.0);
  vec3 bg = mix(vec3(0.118, 0.118, 0.122), vec3(0.027, 0.027, 0.031), g);
  vec2 uvR = vUv, uvG = vUv, uvB = vUv;
  for (int i = 0; i < 4; i++) {
    vec4 rp = uRipple[i];
    if (rp.w < 0.5) continue;
    float age = uTime - rp.z;
    if (age < 0.0 || age > 2.4) continue;
    vec2 c = vec2(rp.x * aspect, rp.y);
    vec2 dv = p - c;
    float d = length(dv);
    float rr = age * 0.5;
    float band = exp(-pow((d - rr) * 28.0, 2.0)) * (1.0 - age / 2.4);
    vec2 n = dv / max(d, 1e-4);
    vec2 off = vec2(n.x / aspect, n.y) * band * 0.014;
    uvR += off * 1.5;
    uvG += off;
    uvB += off * 0.5;
    bg += band * 0.05;
  }
  // The dots reveal a black-to-white diagonal: dark near the top-left, white bottom-right.
  float dR = dots(uvR, aspect), dG = dots(uvG, aspect), dB = dots(uvB, aspect);
  vec3 ink = mix(vec3(0.0), vec3(1.0), g) * vec3(dR, dG, dB) + vec3(dR, dG, dB) * 0.18;
  vec3 col = bg + ink;
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.1;
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export function CursorTrailWebGL({ onUnavailable }: { onUnavailable: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const ripples = new Float32Array(16);
    let rippleAt = 0;
    const strokeA = { x: 0.5, y: 0.5 };
    const strokeB = { x: 0.5, y: 0.5 };
    let stroke = 0;
    // Idle stroke (touch only): a slow figure that runs when nobody is touching.
    let idleStart = -1;
    const IDLE_AFTER = 3.0;
    const IDLE_LEN = 3.4;
    const IDLE_GAP = 2.6;

    const runner = createRunner(canvas, {
      feedbackFrag: FEEDBACK,
      screenFrag: SCREEN,
      onPointerDown(ctx, x, y) {
        ripples[rippleAt * 4] = x;
        ripples[rippleAt * 4 + 1] = y;
        ripples[rippleAt * 4 + 2] = ctx.time;
        ripples[rippleAt * 4 + 3] = 1;
        rippleAt = (rippleAt + 1) % 4;
      },
      onFrame(ctx) {
        const recent = ctx.time - ctx.lastInputAt < 0.12;
        if (ctx.pointerActive && recent) {
          strokeA.x = ctx.pointerPrev.x;
          strokeA.y = ctx.pointerPrev.y;
          strokeB.x = ctx.pointer.x;
          strokeB.y = ctx.pointer.y;
          const speed = Math.hypot(strokeB.x - strokeA.x, strokeB.y - strokeA.y) / Math.max(ctx.dt, 1e-3);
          stroke = Math.min(0.25 + speed * 0.9, 1.4);
          idleStart = -1;
          return;
        }
        stroke = 0;
        if (!ctx.coarse) return;
        const sinceInput = ctx.time - ctx.lastInputAt;
        if (sinceInput < IDLE_AFTER) return;
        if (idleStart < 0) idleStart = ctx.time;
        const t = (ctx.time - idleStart) % (IDLE_LEN + IDLE_GAP);
        if (t > IDLE_LEN) return;
        const u = t / IDLE_LEN;
        const nx = 0.18 + 0.64 * u;
        const ny = 0.5 + 0.22 * Math.sin(u * Math.PI * 2.0);
        strokeA.x = strokeB.x;
        strokeA.y = strokeB.y;
        strokeB.x = nx;
        strokeB.y = ny;
        if (u < 0.02) {
          strokeA.x = nx;
          strokeA.y = ny;
        }
        stroke = 0.8 * Math.sin(u * Math.PI);
      },
      onUniforms(u, _ctx, pass) {
        if (pass === "feedback") {
          u.v2("uStrokeA", strokeA.x, strokeA.y);
          u.v2("uStrokeB", strokeB.x, strokeB.y);
          u.f("uStroke", stroke);
        } else {
          u.v4v("uRipple", ripples);
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
    <div className="ctc-shaderwrap" aria-hidden>
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
