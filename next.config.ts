import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a wasm bundle + Node fs access; bundling it breaks
  // `fs.readFileSync(new URL(...))` inside the server runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The liquid page used to live at /liquid; it is the landing page now.
  async redirects() {
    return [{ source: "/liquid", destination: "/", permanent: true }];
  },
};

export default nextConfig;
