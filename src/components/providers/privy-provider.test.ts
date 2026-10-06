import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The provider is a client component wrapped around the auth SDK, so it cannot be
 * rendered here; its config is read as text instead.
 *
 * What is guarded: every account gets both Tocker wallets at sign-in. Under
 * "users-without-wallets" the SDK skips a chain as soon as any wallet of that chain type
 * is linked, and the wallet someone signs in with is one. Those accounts had no deposit
 * address on their own chain and nothing to fund an agent from, and every message about
 * it sent them to a Sync button that could not help.
 */
const SOURCE = readFileSync(new URL("./privy-provider.tsx", import.meta.url), "utf8");

describe("embedded wallets at sign-in", () => {
  it("creates one on each chain for every account, wallet sign-ins included", () => {
    expect(SOURCE).toMatch(/ethereum:\s*\{\s*createOnLogin:\s*"all-users"\s*\}/);
    expect(SOURCE).toMatch(/solana:\s*\{\s*createOnLogin:\s*"all-users"\s*\}/);
  });

  it("does not use the mode that skips the chain the sign-in wallet is on", () => {
    // As a setting, not as a word: the comment on the provider names the old mode on purpose.
    expect(SOURCE).not.toMatch(/createOnLogin:\s*"users-without-wallets"/);
    expect(SOURCE).not.toMatch(/createOnLogin:\s*"off"/);
  });
});
