import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    // Every db-backed test file spins its own in-memory PGlite and pushes the whole
    // schema into it in `beforeAll`. Under parallel workers that legitimately takes
    // longer than vitest's 10s default, and the failure looks like a bug rather than
    // a busy machine.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Token providers hit Jupiter / DexScreener / GoPlus / RugCheck live otherwise.
    env: { TOKENS_MOCK: "1" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a bundler marker Next resolves itself; node cannot see it,
      // so server queries would fail to import in a test. Empty module, same effect.
      "server-only": fileURLToPath(new URL("./scripts/server-only-shim.mjs", import.meta.url)),
    },
  },
});
