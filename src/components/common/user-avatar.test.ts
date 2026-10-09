/**
 * One avatar for people. Rendered to markup for what it draws (the picked avatar, the
 * photo over the generated one, or the generated one alone), and read as text for where
 * it is used: every place a person is drawn goes through it, and nothing else puts a
 * person's photo link on a page.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { USER_AVATAR_VARIANT, UserAvatar } from "./user-avatar";

const X_PHOTO = "https://pbs.twimg.com/profile_images/1234567890/AbC_dEf-1_normal.jpg";

type User = { handle: string; avatarSeed?: string | null; avatarUrl?: string | null };

function render(user: User, px = 36, className = "size-9"): string {
  // React escapes the quotes of `url("…")` inside the style attribute.
  return renderToStaticMarkup(createElement(UserAvatar, { user, px, className })).replace(/&quot;/g, '"');
}

/** The photo layer's address, or null when no photo is drawn. */
function photoIn(html: string): string | null {
  return /background-image:url\("([^"]+)"\)/.exec(html)?.[1] ?? null;
}

/** The generated drawing alone: the markup with the photo layer taken out. */
function drawingIn(html: string): string {
  return html.replace(/<span[^>]*background-image[^>]*><\/span>/, "");
}

describe("what UserAvatar draws", () => {
  it("draws the picked avatar and loads no photo", () => {
    const html = render({ handle: "rami", avatarSeed: "k3j9x0a1bz", avatarUrl: X_PHOTO });
    expect(html).toContain("<svg");
    expect(photoIn(html)).toBeNull();
    // The seed is the drawing: the same one under another name is the same picture.
    expect(html).toBe(render({ handle: "someoneelse", avatarSeed: "k3j9x0a1bz" }));
    expect(html).not.toBe(render({ handle: "rami", avatarSeed: "zzzzzzzzz9" }));
  });

  it("lays the photo over the avatar made from the username when none was picked", () => {
    const html = render({ handle: "rami", avatarSeed: null, avatarUrl: X_PHOTO });
    expect(photoIn(html)).toBe(X_PHOTO.replace("_normal", "_bigger"));
    // Under it, what shows if the link is dead: the same drawing an account with no photo gets.
    expect(drawingIn(html)).toBe(render({ handle: "rami" }));
    // A background layer, not an image element: one that fails to load paints nothing.
    expect(html).not.toContain("<img");
  });

  it("asks for the photo at the size it is drawn", () => {
    const user = { handle: "rami", avatarUrl: X_PHOTO };
    expect(photoIn(render(user, 24, "size-6"))).toBe(X_PHOTO);
    expect(photoIn(render(user, 32, "size-8"))).toBe(X_PHOTO.replace("_normal", "_bigger"));
    expect(photoIn(render(user, 96, "size-16 sm:size-24"))).toBe(X_PHOTO.replace("_normal", "_200x200"));
  });

  it("falls back to the avatar made from the username", () => {
    const plain = render({ handle: "rami" });
    expect(plain).toContain("<svg");
    expect(photoIn(plain)).toBeNull();
    expect(render({ handle: "rami", avatarSeed: null, avatarUrl: null })).toBe(plain);
    // A link the app will not show is the same as none: no other host is ever fetched.
    for (const url of ["https://example.com/me.jpg", "http://pbs.twimg.com/a_normal.jpg", "javascript:alert(1)"]) {
      expect(render({ handle: "rami", avatarUrl: url }), url).toBe(plain);
    }
    expect(render({ handle: "nova" })).not.toBe(plain);
  });

  it("is round, decorative, and the size its caller gives it", () => {
    const html = render({ handle: "rami", avatarUrl: X_PHOTO }, 96, "size-16 sm:size-24");
    const box = html.slice(0, html.indexOf(">") + 1);
    expect(box).toContain('aria-hidden="true"');
    expect(box).toContain("rounded-full");
    expect(box).toContain("size-16");
    expect(box).toContain("sm:size-24");
    // Never squashed by a flex row, as the avatars it replaces were not.
    expect(box).toContain("shrink-0");
  });

  it("is in the agents' family", () => {
    expect(USER_AVATAR_VARIANT).toBe("marble");
  });
});

const SRC = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** Every component and module under src/, tests left out. */
function sources(dir: string = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Where a person is drawn, and the size class each really draws at. */
const CALL_SITES: Array<[file: string, px: number, size: string]> = [
  ["components/shell/account-menu.tsx", 32, "size-8"],
  ["components/auth/login-button.tsx", 24, "size-6"],
  ["components/feed/feed-card.tsx", 36, "size-9"],
  ["components/feed/comment-sheet.tsx", 28, "size-7"],
  ["components/profile/profile-header.tsx", 96, "size-16"],
  ["components/settings/profile-form.tsx", 64, "size-16"],
];

describe("where a person is drawn", () => {
  it.each(CALL_SITES)("%s draws through UserAvatar, at %ipx", (file, px, size) => {
    const source = read(file);
    expect(source).toMatch(/import \{ UserAvatar \} from "@\/components\/common\/user-avatar";/);
    const tag = /<UserAvatar\b[^>]*\/>/.exec(source)?.[0] ?? "";
    expect(tag).toContain(`px={${px}}`);
    expect(tag).toMatch(new RegExp(`className="[^"]*\\b${size}\\b`));
  });

  it("keeps the profile page's avatar at both of its sizes", () => {
    const tag = /<UserAvatar\b[^>]*\/>/.exec(read("components/profile/profile-header.tsx"))?.[0] ?? "";
    expect(tag).toMatch(/className="[^"]*\bsm:size-24\b/);
  });

  it("has one component for people, and the two it replaced are gone", () => {
    expect(existsSync(join(SRC, "components/social-common/agent-avatar.tsx"))).toBe(false);
    expect(read("components/common/agent-avatar.tsx")).not.toMatch(/export function UserAvatar/);
    for (const file of sources()) {
      const source = readFileSync(file, "utf8");
      const name = relative(SRC, file);
      expect(source, name).not.toMatch(/social-common\/agent-avatar/);
      if (name !== "components/common/user-avatar.tsx") {
        expect(source, name).not.toMatch(/export (?:function|const) UserAvatar\b/);
      }
    }
  });

  it("puts a person's photo link on a page nowhere else", () => {
    for (const file of sources()) {
      const source = readFileSync(file, "utf8");
      const name = relative(SRC, file);
      // An image element or a CSS url() fed from `avatarUrl`, on one line or across a few.
      expect(source, name).not.toMatch(/src=\{[^}]*avatarUrl/);
      expect(source, name).not.toMatch(/url\([^)]*avatarUrl/);
      expect(source, name).not.toMatch(/AvatarImage[^>]*avatarUrl/);
    }
    // The one place a photo is drawn takes its address from `avatarFor`, which asks `photoAt`.
    const avatar = read("components/common/user-avatar.tsx");
    expect(avatar).toMatch(/avatarFor\(user, px\)/);
    expect(avatar).not.toMatch(/avatarUrl\b(?!\?: string)/);
    // No image element with attributes; its own comment names the tag it avoids.
    expect(avatar).not.toMatch(/<img\s/);
  });

  it("carries the picked avatar in a comment drawn before the server answers", () => {
    expect(read("components/feed/comment-sheet.tsx")).toMatch(/avatarSeed: session\.avatarSeed \?\? null/);
  });
});
