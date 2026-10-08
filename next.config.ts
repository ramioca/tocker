import type { NextConfig } from "next";

// Sign-in lives at /login (`LOGIN_HREF` in src/lib/contact.ts; repeated here as a
// literal so the config imports nothing from the app). These are the addresses people
// type when they guess.
const SIGN_IN = "/login";
const SIGN_IN_GUESSES = ["/signin", "/sign-in", "/signup", "/sign-up"];

// The mark's files (the paths are in src/components/brand/tocker-mark.tsx; a test there
// checks they fall under this rule). Next sends everything in public/ with `max-age=0`,
// so a browser asks again before it draws any of it; left at that, the mark in the app
// bar arrives a round trip after the bar on every load. A day, not longer, because
// these files are rewritten in place when the master render changes
// (scripts/brand/make-mark-assets.py): that is how long a returning visitor can keep the
// old cut.
const MARK_FILES = "/brand/tocker/v3/:path*";
const MARK_CACHE = "public, max-age=86400";

const nextConfig: NextConfig = {
  // PGlite ships a wasm bundle + Node fs access; bundling it breaks
  // `fs.readFileSync(new URL(...))` inside the server runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  async redirects() {
    return [
      // The liquid page used to live at /liquid; it is the landing page now.
      { source: "/liquid", destination: "/", permanent: true },
      // Temporary (307), so no browser remembers one if a real page ever takes the
      // address. Exact paths only. A query string travels with the redirect, so
      // `?next=` still reaches the sign-in page, which checks it as it always has.
      ...SIGN_IN_GUESSES.map((source) => ({ source, destination: SIGN_IN, permanent: false })),
    ];
  },
  async headers() {
    // Not in dev, where a mark cut a minute ago should show on the next reload.
    if (process.env.NODE_ENV === "development") return [];
    return [{ source: MARK_FILES, headers: [{ key: "Cache-Control", value: MARK_CACHE }] }];
  },
};

export default nextConfig;
