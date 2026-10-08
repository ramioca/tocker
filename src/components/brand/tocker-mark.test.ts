import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";
import { TOCKER_MARK_LG_SRC, TOCKER_MARK_PNG_SRC, TOCKER_MARK_RATIO, TOCKER_MARK_SM_SRC } from "./tocker-mark";

const ROOT = process.cwd();

/** Pixel size from a PNG's header: width and height are the first two fields of IHDR. */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * The file behind a root-relative URL: something in public/, or one of the icon files
 * Next serves from src/app by convention.
 */
function fileBehind(url: string): string | null {
  const inPublic = join(ROOT, "public", url);
  if (existsSync(inPublic)) return inPublic;
  const inApp = join(ROOT, "src", "app", url);
  return /^\/(favicon\.ico|icon\.png|apple-icon\.png)$/.test(url) && existsSync(inApp) ? inApp : null;
}

/**
 * The mark is addressed by path, and a path is a string nothing type-checks: a renamed
 * folder would leave an empty box in the nav and a share card with no art, with every
 * other check still green. These read the files the strings point at.
 */
describe("the mark's files", () => {
  it.each([TOCKER_MARK_SM_SRC, TOCKER_MARK_LG_SRC, TOCKER_MARK_PNG_SRC])("%s is in public/", (src) => {
    expect(existsSync(join(ROOT, "public", src))).toBe(true);
  });

  it("has the ratio of the cut-out every size is made from", () => {
    const { width, height } = pngSize(join(ROOT, "public/brand/tocker/v3/tocker-mark-3d-transparent.png"));
    expect(width / height).toBe(TOCKER_MARK_RATIO);
  });

  it("keeps that ratio in the PNG, to the pixel it was rounded to", () => {
    const { width, height } = pngSize(join(ROOT, "public", TOCKER_MARK_PNG_SRC));
    expect(height).toBe(Math.round(width / TOCKER_MARK_RATIO));
  });

  // The share card spells its path out so the build can see which file to ship with it,
  // and it swallows a failed read; this is what notices if the two ever name different files.
  it("is the PNG the share card reads from disk", () => {
    const card = readFileSync(join(ROOT, "src/app/opengraph-image.tsx"), "utf8");
    expect(card).toContain(`"public${TOCKER_MARK_PNG_SRC}"`);
  });

  // The rule is in next.config.ts, which imports nothing from the app, so it names the
  // folder a second time. Without it the browser asks for the mark again on every load
  // and the app bar is drawn before its mark; a move to a new folder would bring that back.
  it.each([TOCKER_MARK_SM_SRC, TOCKER_MARK_LG_SRC])("%s may be kept by the browser", async (src) => {
    // The config leaves the rule out in dev, so say which build this is about.
    vi.stubEnv("NODE_ENV", "production");
    const rules = (await nextConfig.headers?.()) ?? [];
    vi.unstubAllEnvs();
    const rule = rules.find(({ source }) => src.startsWith(source.replace(/:path\*$/, "")));
    const cacheControl = rule?.headers.find(({ key }) => key.toLowerCase() === "cache-control")?.value ?? "";
    expect(Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0)).toBeGreaterThan(0);
  });
});

describe("the installed app's icons", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "public/manifest.webmanifest"), "utf8")) as {
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };

  it("offers a 192 and a 512 for each purpose", () => {
    for (const purpose of ["any", "maskable"]) {
      const sizes = manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
      expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    }
  });

  it("names files that exist, at the size it says they are", () => {
    for (const icon of manifest.icons) {
      const file = fileBehind(icon.src);
      expect(file, icon.src).not.toBeNull();
      const { width, height } = pngSize(file!);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("gives the service worker a notification icon that exists", () => {
    const worker = readFileSync(join(ROOT, "public/sw.js"), "utf8");
    const icons = [...worker.matchAll(/\bicon:\s*"([^"]+)"/g)].map(([, src]) => src);
    expect(icons.length).toBeGreaterThan(0);
    for (const src of icons) expect(fileBehind(src), src).not.toBeNull();
  });
});
