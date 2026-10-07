import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The share card: the neon T on black, the headline, the wordmark, one mono
 * line, and the mark again large on the right as the card's art. Generated at
 * build time and cached.
 *
 * Fonts: the renderer needs at least one embedded face. Geist 500/600 are
 * fetched from Google Fonts at build (an old user agent gets a WOFF/TTF the
 * renderer accepts); `fonts/Geist-Regular.ttf` (the copy that ships inside
 * next/og, SIL OFL) is always loaded too, so the card renders even offline.
 */
export const alt = "Tocker — your agent trades while you sleep.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };

async function loadGeistFromGoogle(weight: 500 | 600): Promise<Font | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Geist:wght@${weight}&display=swap`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:20.0) Gecko/20100101 Firefox/20.0" },
    }).then((r) => r.text());
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype|woff)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return { name: "Geist", data: await res.arrayBuffer(), weight, style: "normal" };
  } catch {
    return null;
  }
}

async function loadLocalGeist(): Promise<Font | null> {
  try {
    const buf = await readFile(join(process.cwd(), "src/app/fonts/Geist-Regular.ttf"));
    return { name: "Geist", data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight: 400, style: "normal" };
  } catch {
    return null;
  }
}

export default async function Image() {
  const loaded = await Promise.all([loadLocalGeist(), loadGeistFromGoogle(500), loadGeistFromGoogle(600)]);
  const fonts = loaded.filter((f): f is Font => f !== null);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background:
            "radial-gradient(60% 70% at 80% 45%, rgba(61,107,255,0.22) 0%, rgba(255,61,203,0.08) 45%, #050507 75%)",
          position: "relative",
          color: "#f4f4f1",
          fontFamily: fonts.length > 0 ? "Geist" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <NeonT width={44} stroke={60} />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>tocker</div>
        </div>

        <div style={{ position: "absolute", right: 64, top: 120, display: "flex" }}>
          <NeonT width={380} stroke={14} />
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: -0.8, color: "rgba(244,244,241,0.72)" }}>
            your agent trades while you
          </div>
          <div style={{ fontSize: 168, fontWeight: 600, letterSpacing: -9, lineHeight: 0.95, marginTop: 6 }}>
            sleep.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 18,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "rgba(244,244,241,0.5)",
          }}
        >
          <div>solana · base · on your schedule</div>
          <div>tocker.xyz</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

/**
 * The new mark (public/brand/tocker/v2/tocker-mark-neon.svg) in the subset of
 * SVG the OG renderer draws: a dark glass fill and a cyan-to-magenta edge. No
 * filters, so no glow; at share-card sizes the gradient edge carries it.
 */
function NeonT({ width, stroke }: { width: number; stroke: number }) {
  return (
    <svg width={width} height={Math.round((width * 970) / 1180)} viewBox="40 170 1180 970">
      <defs>
        <linearGradient id="edge" x1="80" y1="200" x2="1180" y2="1100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3FD2FF" />
          <stop offset="0.32" stopColor="#2F5BFF" />
          <stop offset="0.55" stopColor="#FF2BD6" />
          <stop offset="0.78" stopColor="#3F7BFF" />
          <stop offset="1" stopColor="#FF3DB4" />
        </linearGradient>
      </defs>
      <path
        d="M76 204 H556 L563 386 L716 236 Q752 204 842 204 H1180 L1030 381 H802 Q727 381 727 458 V1110 L495 938 V381 H229 Z"
        fill="#0e0c16"
        stroke="url(#edge)"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    </svg>
  );
}
