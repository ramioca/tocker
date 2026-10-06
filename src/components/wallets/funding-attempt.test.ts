import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { attemptFunding, isTransferStatusUnknown, type FundingSettlement } from "./funding-attempt";
import { TransferStatusUnknown } from "./use-transfer";

const REJECTED = "Your wallet rejected the request.";

describe("isTransferStatusUnknown", () => {
  it("knows the error the transfer hook raises when the submit got no answer", () => {
    expect(isTransferStatusUnknown(new TransferStatusUnknown())).toBe(true);
  });

  it("matches by name, so a second copy of the module still counts", () => {
    expect(isTransferStatusUnknown(Object.assign(new Error("no answer"), { name: "TransferStatusUnknown" }))).toBe(true);
  });

  it("is false for a refusal, a cancel and anything that is not an error", () => {
    expect(isTransferStatusUnknown(new Error("You cancelled the signature. Nothing was sent."))).toBe(false);
    expect(isTransferStatusUnknown("TransferStatusUnknown")).toBe(false);
    expect(isTransferStatusUnknown(null)).toBe(false);
  });
});

describe("attemptFunding", () => {
  it("settles a transfer that went as sent, with its hash", async () => {
    const settle = vi.fn<(settlement: FundingSettlement) => void>();
    const attempt = await attemptFunding({ send: async () => ({ hash: "5hG3" }), settle, rejected: REJECTED });
    expect(attempt).toEqual({ outcome: "sent", hash: "5hG3" });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith({ status: "sent", txHash: "5hG3" });
  });

  it("settles a refusal as failed, with the sentence the hook wrote", async () => {
    const settle = vi.fn<(settlement: FundingSettlement) => void>();
    const attempt = await attemptFunding({
      send: async () => {
        throw new Error("You cancelled the signature. Nothing was sent.");
      },
      settle,
      rejected: REJECTED,
    });
    expect(attempt).toEqual({ outcome: "failed", message: "You cancelled the signature. Nothing was sent." });
    expect(settle).toHaveBeenCalledWith({ status: "failed", error: "You cancelled the signature. Nothing was sent." });
  });

  it("never settles a transfer whose outcome is unknown, and never calls it failed", async () => {
    // The submit request died after the signature: the server may have broadcast. A
    // "failed" intent here is what told the owner to send the same money again.
    const settle = vi.fn<(settlement: FundingSettlement) => void>();
    const attempt = await attemptFunding({
      send: async () => {
        throw new TransferStatusUnknown({ cause: new TypeError("Failed to fetch") });
      },
      settle,
      rejected: REJECTED,
    });
    expect(attempt.outcome).toBe("unknown");
    expect(settle).not.toHaveBeenCalled();
    expect(attempt).toMatchObject({ message: expect.stringMatching(/can't tell whether it went/) });
    expect(attempt).not.toMatchObject({ message: expect.stringMatching(/failed|rejected/i) });
  });

  it("uses the caller's sentence when the wallet threw something that is not an error", async () => {
    const settle = vi.fn<(settlement: FundingSettlement) => void>();
    const attempt = await attemptFunding({
      send: async () => {
        throw "nope";
      },
      settle,
      rejected: REJECTED,
    });
    expect(attempt).toEqual({ outcome: "failed", message: REJECTED });
    expect(settle).toHaveBeenCalledWith({ status: "failed", error: REJECTED });
  });

  it("works without a recorded intent", async () => {
    expect(await attemptFunding({ send: async () => ({ hash: "0xabc" }), rejected: REJECTED })).toEqual({
      outcome: "sent",
      hash: "0xabc",
    });
  });

  it("does not report a transfer that went as failed because closing its record threw", async () => {
    const attempt = await attemptFunding({
      send: async () => ({ hash: "5hG3" }),
      settle: () => {
        throw new Error("offline");
      },
      rejected: REJECTED,
    });
    expect(attempt).toEqual({ outcome: "sent", hash: "5hG3" });
  });
});

/**
 * The two places that fund an agent. Read from their sources, because the behaviour that
 * matters lives in a `catch` inside a component: an unknown outcome must be told apart
 * before anything is settled or offered again.
 */
describe("the funding callers", () => {
  const components = join(process.cwd(), "src", "components");
  const drawer = readFileSync(join(components, "agents", "settings", "fund-agent-drawer.tsx"), "utf8");
  const builder = readFileSync(join(components, "agents", "builder", "agent-builder.tsx"), "utf8");

  it("the Fund drawer sends through attemptFunding and names the unknown outcome honestly", () => {
    expect(drawer).toContain("attemptFunding(");
    expect(drawer).toContain('toast.warning("Funding status unknown"');
    // The only settle left in the drawer is the one handed to attemptFunding.
    expect(drawer.match(/settleFundingIntent\(/g)).toHaveLength(1);
  });

  it("the builder tells an unknown outcome apart before it settles the intent as failed", () => {
    const unknownAt = builder.indexOf("isTransferStatusUnknown(error)");
    expect(unknownAt).toBeGreaterThan(-1);
    // The `failed` settle for a thrown send is the `else` of that check.
    expect(builder.slice(unknownAt, unknownAt + 220)).toMatch(/else if \(ids\[i\]\) void settleFundingIntent\(\{ id: ids\[i\], status: "failed"/);
  });

  it("the builder's retry dialog does not claim nothing moved on top of the error's own sentence", () => {
    expect(builder).not.toContain("Nothing moved.");
    expect(builder).toContain("Funding not confirmed yet");
  });
});
