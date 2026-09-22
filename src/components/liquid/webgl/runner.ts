"use client";

/**
 * A small WebGL2 fullscreen-quad runner for the landing's fallback effects —
 * what draws the hero and the closing section on browsers without WebGPU
 * (iOS before 26, Firefox, older Chrome), where Paper Shaders cannot run.
 *
 * One optional feedback pass (ping-pong render targets, for trails and flow
 * fields) and one screen pass. The runner owns the canvas size (DPR capped),
 * the frame loop (paused while hidden or off-screen), and pointer input from
 * mouse and touch, normalised to texture coordinates (origin bottom-left).
 * Effects add their own uniforms through `onUniforms`.
 */

export interface FrameContext {
  time: number;
  dt: number;
  width: number;
  height: number;
  dpr: number;
  /** Current and previous-frame pointer, in 0..1 texture space (y up). */
  pointer: { x: number; y: number };
  pointerPrev: { x: number; y: number };
  /** 1 once any real pointer input has arrived. */
  pointerActive: number;
  /** performance.now()/1000 of the last real pointer input. */
  lastInputAt: number;
  coarse: boolean;
  frame: number;
}

export interface Uniforms {
  f: (name: string, v: number) => void;
  v2: (name: string, x: number, y: number) => void;
  v4v: (name: string, values: Float32Array) => void;
}

export interface RunnerOptions {
  feedbackFrag?: string;
  screenFrag: string;
  dprCap?: number;
  onUniforms?: (u: Uniforms, ctx: FrameContext, pass: "feedback" | "screen") => void;
  onPointerDown?: (ctx: FrameContext, x: number, y: number) => void;
  /** Called every frame before uniforms — for effect-side smoothing state. */
  onFrame?: (ctx: FrameContext) => void;
}

export interface Runner {
  destroy: () => void;
}

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function isWebGL2Available(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export const isCoarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function createRunner(canvas: HTMLCanvasElement, opts: RunnerOptions): Runner | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  // A canvas keeps one context for life. If an earlier runner on this canvas
  // (React's dev double-mount, a route swap) left it lost, bring it back
  // before touching it; a lost context compiles nothing and logs nothing.
  if (gl.isContextLost()) {
    gl.getExtension("WEBGL_lose_context")?.restoreContext();
    if (gl.isContextLost()) return null;
  }

  const dprCap = opts.dprCap ?? 1.5;

  // ---- programs -------------------------------------------------------------
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("createShader failed");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader compile failed: ${log}`);
    }
    return s;
  };
  const link = (frag: string) => {
    const p = gl.createProgram();
    if (!p) throw new Error("createProgram failed");
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`program link failed: ${log}`);
    }
    const cache = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name) ?? null;
    };
    const u: Uniforms = {
      f: (n, v) => {
        const l = loc(n);
        if (l) gl.uniform1f(l, v);
      },
      v2: (n, x, y) => {
        const l = loc(n);
        if (l) gl.uniform2f(l, x, y);
      },
      v4v: (n, values) => {
        const l = loc(n);
        if (l) gl.uniform4fv(l, values);
      },
    };
    const i1 = (n: string, v: number) => {
      const l = loc(n);
      if (l) gl.uniform1i(l, v);
    };
    return { program: p, u, i1 };
  };

  let screen: ReturnType<typeof link> | null = null;
  let feedback: ReturnType<typeof link> | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const buildPrograms = () => {
    screen = link(opts.screenFrag);
    feedback = opts.feedbackFrag ? link(opts.feedbackFrag) : null;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
  };
  try {
    buildPrograms();
  } catch (e) {
    console.error("[landing/webgl]", e);
    return null;
  }

  // ---- render targets ---------------------------------------------------------
  const halfFloat = !!(gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float"));
  type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer };
  let targets: Target[] = [];
  let read = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;

  const freeTargets = () => {
    for (const t of targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    targets = [];
  };
  const allocate = () => {
    freeTargets();
    if (!feedback) return;
    for (let i = 0; i < 2; i += 1) {
      const tex = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!tex || !fbo) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (halfFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      targets.push({ tex, fbo });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    read = 0;
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    allocate();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // ---- input ------------------------------------------------------------------
  const ctx: FrameContext = {
    time: 0,
    dt: 0,
    width,
    height,
    dpr,
    pointer: { x: 0.5, y: 0.5 },
    pointerPrev: { x: 0.5, y: 0.5 },
    pointerActive: 0,
    lastInputAt: -1e9,
    coarse: isCoarsePointer(),
    frame: 0,
  };
  const now = () => performance.now() / 1000;
  const setPointer = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    ctx.pointer.x = (clientX - rect.left) / rect.width;
    ctx.pointer.y = 1 - (clientY - rect.top) / rect.height;
    ctx.pointerActive = 1;
    ctx.lastInputAt = now();
  };
  const onPointerMove = (e: PointerEvent) => setPointer(e.clientX, e.clientY);
  const onPointerDown = (e: PointerEvent) => {
    setPointer(e.clientX, e.clientY);
    opts.onPointerDown?.(ctx, ctx.pointer.x, ctx.pointer.y);
  };
  // iOS cancels pointer events once a scroll begins; touchmove keeps reporting.
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) setPointer(t.clientX, t.clientY);
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });

  // ---- loop -------------------------------------------------------------------
  let raf = 0;
  let running = false;
  let visible = true;
  let last = -1;
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      schedule();
    },
    { rootMargin: "128px", threshold: 0 },
  );
  io.observe(canvas);
  const onVisibility = () => schedule();
  document.addEventListener("visibilitychange", onVisibility);

  // Real context loss (GPU reset, memory pressure): stop, let the browser
  // restore, rebuild everything, resume. Programs and textures do not survive.
  const onContextLost = (e: Event) => {
    e.preventDefault();
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onContextRestored = () => {
    try {
      buildPrograms();
      allocate();
      schedule();
    } catch (err) {
      console.error("[landing/webgl] restore failed", err);
    }
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const draw = () => {
    raf = 0;
    if (!running || !screen || gl.isContextLost()) return;
    const t = now();
    ctx.dt = last < 0 ? 1 / 60 : Math.min(Math.max(t - last, 0), 0.05);
    last = t;
    ctx.time = t;
    ctx.width = width;
    ctx.height = height;
    ctx.dpr = dpr;
    ctx.frame += 1;

    opts.onFrame?.(ctx);

    const std = (u: Uniforms) => {
      u.v2("uRes", width, height);
      u.f("uTime", ctx.time);
      u.f("uDt", ctx.dt);
      u.v2("uPointer", ctx.pointer.x, ctx.pointer.y);
      u.v2("uPointerPrev", ctx.pointerPrev.x, ctx.pointerPrev.y);
      u.f("uPointerActive", ctx.pointerActive);
      u.f("uDpr", dpr);
    };

    if (feedback && targets.length === 2) {
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].fbo);
      gl.viewport(0, 0, width, height);
      gl.useProgram(feedback.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
      feedback.i1("uPrev", 0);
      std(feedback.u);
      opts.onUniforms?.(feedback.u, ctx, "feedback");
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      read = write;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(screen.program);
    if (feedback && targets.length === 2) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
      screen.i1("uTrail", 0);
    }
    std(screen.u);
    opts.onUniforms?.(screen.u, ctx, "screen");
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    ctx.pointerPrev.x = ctx.pointer.x;
    ctx.pointerPrev.y = ctx.pointer.y;
    raf = requestAnimationFrame(draw);
  };

  const schedule = () => {
    const should = visible && document.visibilityState !== "hidden";
    if (should && !running) {
      running = true;
      last = -1;
      if (!raf) raf = requestAnimationFrame(draw);
    } else if (!should && running) {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  schedule();

  return {
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("touchmove", onTouchMove);
      freeTargets();
      if (screen) gl.deleteProgram(screen.program);
      if (feedback) gl.deleteProgram(feedback.program);
      if (vao) gl.deleteVertexArray(vao);
      // Deliberately no loseContext(): the canvas may be mounted again with
      // the same context (React re-runs effects in development).
    },
  };
}
