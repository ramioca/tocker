import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a wasm bundle + Node fs access; bundling it breaks
  // `fs.readFileSync(new URL(...))` inside the server runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
