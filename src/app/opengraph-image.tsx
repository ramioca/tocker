import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { TOCKER_MARK_RATIO } from "@/components/brand/tocker-mark";

/**
 * The share card: the mark and the wordmark on black, the headline, one mono
 * line, and the mark again large on the right as the card's art. Generated at
 * build time and cached.
 *
 * Fonts: the renderer needs at least one embedded face. Geist 500/600 are
 * fetched from Google Fonts at build (an old user agent gets a WOFF/TTF the
 * renderer accepts); `fonts/Geist-Regular.ttf` (the copy that ships inside
 * next/og, SIL OFL) is always loaded too, so the card renders even offline.
 *
 * The mark is the real render: the 512px PNG, read from public/ and embedded
 * as a data URL, because the renderer has no site to fetch a path from. A card
 * without it is still a card, so a failed read leaves the text and never throws.
 */
export const alt = "Tocker — your strategy, your rules, 24/7.";
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

/** The mark as a data URL, or null when the file cannot be read. */
async function loadMark(): Promise<string | null> {
  try {
    const buf = await readFile(join(process.cwd(), "public/brand/tocker/v3/tocker-mark-512.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image() {
  const [mark, ...loaded] = await Promise.all([
    loadMark(),
    loadLocalGeist(),
    loadGeistFromGoogle(500),
    loadGeistFromGoogle(600),
  ]);
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
          // Opaque stops on purpose: the renderer blends see-through ones into a hard
          // ring, where a browser would draw a soft glow.
          background: "radial-gradient(52% 64% at 79% 44%, #141f4d 0%, #0b0f24 46%, #050507 80%)",
          position: "relative",
          color: "#f4f4f1",
          fontFamily: fonts.length > 0 ? "Geist" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {mark ? <Mark src={mark} width={44} /> : null}
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>tocker</div>
        </div>

        {mark ? (
          <div style={{ position: "absolute", right: 64, top: 120, display: "flex" }}>
            <Mark src={mark} width={380} />
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: -0.8, color: "rgba(244,244,241,0.72)" }}>
            your strategy.
          </div>
          <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: -8, lineHeight: 0.95, marginTop: 6 }}>
            your rules.
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
          <div>solana · base · 24/7</div>
          <div>tocker.xyz</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}

/**
 * The mark at a given width. Both sides are spelled out from the shared ratio,
 * so the layout never depends on what the renderer reads out of the file.
 */
function Mark({ src, width }: { src: string; width: number }) {
  return <img src={src} alt="" width={width} height={Math.round(width / TOCKER_MARK_RATIO)} />;
}
