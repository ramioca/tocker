import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    // Several suites stand up their own in-memory PGlite in `beforeAll` (see
    // `src/lib/agent/test-support.ts`). Pushing the schema takes a few seconds, and with
    // the files running in parallel the default 10s hook timeout is a coin flip.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Token providers hit Jupiter / DexScreener / GoPlus / RugCheck live otherwise.
    env: { TOKENS_MOCK: "1" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
