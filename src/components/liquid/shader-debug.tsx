"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * `?shaderdebug` overlay. Paper Shaders is silent by design when it cannot
 * draw, and a phone has no console, so this prints on screen everything the
 * gate and the renderer know: the browser, whether `navigator.gpu` exists,
 * whether an adapter and device can actually be created, the limit the
 * renderer cares about, the OS motion preference, and each section's state
 * and reason. Renders nothing without the query flag.
 */
type Probe = {
  gpu: boolean;
  adapter: string;
  device: string;
  maxUniform: string;
  library: string;
  reducedMotion: boolean;
  coarse: boolean;
  ua: string;
};

const subscribeNever = () => () => {};
const wantsDebug = () => /[?&]shaderdebug/.test(window.location.search);

export function ShaderDebug() {
  const enabled = useSyncExternalStore(subscribeNever, wantsDebug, () => false);
  return enabled ? <Overlay /> : null;
}

function Overlay() {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [sections, setSections] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nav = navigator as Navigator & {
        gpu?: {
          requestAdapter: (o?: unknown) => Promise<
            | { info?: { vendor?: string; architecture?: string }; limits: Record<string, number>; requestDevice: () => Promise<unknown> }
            | null
          >;
        };
      };
      const p: Probe = {
        gpu: !!nav.gpu,
        adapter: "—",
        device: "—",
        maxUniform: "—",
        library: "—",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        coarse: window.matchMedia("(pointer: coarse)").matches,
        ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 120),
      };
      if (nav.gpu) {
        try {
          const a = await nav.gpu.requestAdapter();
          if (!a) {
            p.adapter = "null (no adapter)";
          } else {
            p.adapter = `${a.info?.vendor ?? "?"} ${a.info?.architecture ?? ""}`.trim();
            p.maxUniform = String(a.limits?.maxUniformBufferBindingSize ?? "?");
            try {
              await a.requestDevice();
              p.device = "ok";
            } catch (e) {
              p.device = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
            }
          }
        } catch (e) {
          p.adapter = `threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
        }
        // The library's own verdict — the one the renderer acts on.
        try {
          const { getWebGPUSupport } = await import("shaders/react");
          const s = await getWebGPUSupport();
          p.library = s.supported ? "supported" : `unsupported (${s.reason ?? "?"})`;
        } catch (e) {
          p.library = `probe threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
        }
      }
      if (!cancelled) setProbe(p);
    })();

    const read = () => {
      const parts: string[] = [];
      for (const [label, sel] of [
        ["hero", ".iso-hero"],
        ["contact", ".ctc"],
      ] as const) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) continue;
        const canvas = el.querySelector("canvas");
        parts.push(
          `${label}: ${el.dataset.shader ?? "?"}${el.dataset.shaderReason ? ` (${el.dataset.shaderReason})` : ""} · canvas ${canvas ? `${canvas.width}×${canvas.height}` : "none"}`,
        );
      }
      parts.unshift(`t+${Math.round(performance.now() / 1000)}s`);
      setSections(parts.join("\n"));
    };
    read();
    const id = window.setInterval(read, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <pre
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 1000,
        margin: 0,
        maxWidth: "calc(100vw - 16px)",
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(7,7,8,0.88)",
        border: "1px solid rgba(244,244,241,0.18)",
        color: "#f4f4f1",
        font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        pointerEvents: "none",
      }}
    >
      {probe
        ? [
            `ua: ${probe.ua}`,
            `navigator.gpu: ${probe.gpu ? "yes" : "NO"}`,
            `adapter: ${probe.adapter}`,
            `device: ${probe.device}`,
            `maxUniformBufferBindingSize: ${probe.maxUniform}`,
            `library: ${probe.library}`,
            `reduced-motion: ${probe.reducedMotion ? "YES" : "no"} · coarse: ${probe.coarse ? "yes" : "no"}`,
            sections,
          ].join("\n")
        : "probing…"}
    </pre>
  );
}
