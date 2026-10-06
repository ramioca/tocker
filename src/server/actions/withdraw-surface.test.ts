/**
 * One way out of an agent's wallet.
 *
 * Every export of a "use server" file is an endpoint anyone with a session can call,
 * whether or not a button points at it. `secureWithdrawAction` validates the chain and
 * the destination, applies the limits and writes the audit row; an older action in
 * wallets.ts, and a bridge to it in agent-actions.ts, did the same transfer with fewer
 * checks and no audit row on Base. They are gone, and this is the test that a second
 * agent-withdraw endpoint does not come back as an export of one of these files.
 *
 * Nothing is called: the modules are imported and their export names read. Paying out
 * of the user's own embedded wallet (sponsored-withdraw.ts) is a different thing, signed
 * in the browser by the user, and is not in scope here.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => null,
  requireSession: async () => null,
}));

/** Exported names that move, or offer to move, an agent's money out. */
function withdrawExports(module: Record<string, unknown>): string[] {
  return Object.keys(module)
    .filter((name) => /withdraw/i.test(name))
    .sort();
}

describe("the withdraw endpoints", () => {
  it("wallets.ts exports none", async () => {
    expect(withdrawExports(await import("./wallets"))).toEqual([]);
  });

  it("the agent bridge exports none", async () => {
    expect(withdrawExports(await import("@/components/agents/agent-actions"))).toEqual([]);
  });

  it("security.ts exports the audited action and its read-only preview, and nothing else", async () => {
    expect(withdrawExports(await import("./security"))).toEqual(["previewAgentWithdrawalAction", "secureWithdrawAction"]);
  });
});
