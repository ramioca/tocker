import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { TOCKER_MARK_RATIO } from "@/components/brand/tocker-mark";

/**
 * The share card: the mark and the wordmark, the headline in the site's frosted
 * white, and the liquid shader from the X banner on the right as the card's art.
 * Generated at build time and cached.
 *
 * Kept clear: X lays the page title over the card's lower left corner, so nothing
 * sits there.
 *
 * Fonts: the renderer needs at least one embedded face. Geist 500/600 are fetched
 * from Google Fonts at build (an old user agent gets a WOFF/TTF the
 * renderer accepts); `fonts/Geist-Regular.ttf` (the copy that ships inside next/og,
 * SIL OFL) is always loaded too, so the card renders even offline.
 *
 * The mark and the background are files, read from public/ and embedded as data URLs,
 * because the renderer has no site to fetch a path from: the mark is the real render's
 * 512px PNG, and the background is made from the banner by
 * scripts/brand/make-og-background.py. A card missing either is still a card, so a
 * failed read leaves the rest and never throws.
 */
export const alt = "Tocker — your strategy, your rules, trading 24/7.";
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

/**
 * A file as a data URL, or null when it cannot be read. Each caller spells its path out
 * whole, in one string: that is how the build sees which file to ship with the route. A
 * path built from a variable would make it ship all of public/ with every page.
 */
async function asDataUrl(read: () => Promise<Buffer>, type: "image/png" | "image/jpeg"): Promise<string | null> {
  try {
    return `data:${type};base64,${(await read()).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The site's opaque frosted white (landing-hero.css), clipped to the type. */
const FROST = {
  backgroundImage: "linear-gradient(180deg, #ffffff 0%, #f6f7fb 45%, #dde2ef 100%)",
  backgroundClip: "text",
  color: "transparent",
} as const;

export default async function Image() {
  const [mark, background, ...loaded] = await Promise.all([
    asDataUrl(() => readFile(join(process.cwd(), "public/brand/tocker/v3/tocker-mark-512.png")), "image/png"),
    asDataUrl(() => readFile(join(process.cwd(), "public/brand/tocker/v3/og-background.jpg")), "image/jpeg"),
    loadLocalGeist(),
    loadGeistFromGoogle(500),
    loadGeistFromGoogle(600),
  ]);
  const fonts = loaded.filter((f): f is Font => f !== null);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#050507", color: "#f4f4f1", fontFamily: fonts.length > 0 ? "Geist" : "sans-serif" }}>
        {background ? (
          <img src={background} alt="" width={1200} height={630} style={{ position: "absolute", left: 0, top: 0 }} />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "60px 72px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {mark ? <Mark src={mark} width={58} /> : null}
            <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: -1.4 }}>tocker</div>
          </div>

          {/* The headline in the space under the lockup, a little above centre, so the
              lower left stays clear for X's title. */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1, paddingBottom: 40, fontSize: 84, fontWeight: 600, letterSpacing: -4.3, lineHeight: 1 }}>
            {["Your strategy.", "Your rules.", "Trading 24/7."].map((line, i) => (
              <div key={line} style={{ ...FROST, paddingBottom: 8, marginTop: i === 0 ? 0 : -8 }}>
                {line}
              </div>
            ))}
          </div>
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
