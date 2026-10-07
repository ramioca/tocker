import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The share card: the chroma T on black, the headline, the wordmark, one mono
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

/** The v3 chroma mark as a data URL (the renderer can't fetch relative paths). */
async function loadMark(): Promise<string> {
  const buf = await readFile(join(process.cwd(), "public/brand/tocker/v3/tocker-mark-lg.png"));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Width / height of public/brand/tocker/v3/tocker-mark-lg.png. */
const MARK_RATIO = 1200 / 989;

export default async function Image() {
  const [loaded, mark] = await Promise.all([
    Promise.all([loadLocalGeist(), loadGeistFromGoogle(500), loadGeistFromGoogle(600)]),
    loadMark(),
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
          background: "#000000",
          position: "relative",
          color: "#f4f4f1",
          fontFamily: fonts.length > 0 ? "Geist" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src={mark} width={44} height={Math.round(44 / MARK_RATIO)} alt="" />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1 }}>tocker</div>
        </div>

        <div style={{ position: "absolute", right: 64, top: 130, display: "flex" }}>
          <img src={mark} width={400} height={Math.round(400 / MARK_RATIO)} alt="" />
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
          <div>solana · base · paper by default</div>
          <div>tocker.xyz</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
