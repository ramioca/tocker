import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
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
