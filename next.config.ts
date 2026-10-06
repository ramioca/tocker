import type { NextConfig } from "next";

// Sign-in lives at /login (`LOGIN_HREF` in src/lib/contact.ts; repeated here as a
// literal so the config imports nothing from the app). These are the addresses people
// type when they guess.
const SIGN_IN = "/login";
const SIGN_IN_GUESSES = ["/signin", "/sign-in", "/signup", "/sign-up"];

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
};

export default nextConfig;
