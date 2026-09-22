import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

/**
 * The token is a bearer credential for spending someone's money from a lock screen, so
 * these tests are about what it must refuse, not what it accepts. The happy path is one
 * test; the rest is tampering.
 *
 * `ENCRYPTION_KEY` is set before the module is imported, exactly as `crypto.test.ts`
 * does — the key is read on every call, so a test can also swap it mid-file to prove a
 * token signed under one key is worthless under another.
 */
let push: typeof import("./push");
let firstKey: string;

beforeAll(async () => {
  firstKey = randomBytes(32).toString("base64");
  process.env.ENCRYPTION_KEY = firstKey;
  push = await import("./push");
});

const CLAIMS = {
  tradeId: "V1StGXR8_Z5jdHi6B-myT",
  ownerId: "did:privy:abc123",
  decision: "approve" as const,
  exp: Math.floor(Date.parse("2026-09-22T12:05:00.000Z") / 1000),
};
const BEFORE_EXPIRY = new Date("2026-09-22T12:04:00.000Z");
const WELL_AFTER_EXPIRY = new Date("2026-09-22T12:10:00.000Z");

describe("signDecision / verifyDecision", () => {
  it("round-trips the claims", () => {
    const result = push.verifyDecision(push.signDecision(CLAIMS), BEFORE_EXPIRY);
    expect(result).toEqual({ ok: true, claims: CLAIMS });
  });

  it("is deterministic — the same claims sign to the same token", () => {
    expect(push.signDecision(CLAIMS)).toBe(push.signDecision(CLAIMS));
  });

  it("gives approve and reject different tokens", () => {
    const approve = push.signDecision(CLAIMS);
    const reject = push.signDecision({ ...CLAIMS, decision: "reject" });
    expect(approve).not.toBe(reject);
    const verified = push.verifyDecision(reject, BEFORE_EXPIRY);
    expect(verified.ok && verified.claims.decision).toBe("reject");
  });

  it("refuses a token whose claims were edited", () => {
    // Re-encode the body with someone else's trade id, keep the original signature.
    const token = push.signDecision(CLAIMS);
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    claims.t = "someone-elses-trade";
    const forged = `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;
    expect(push.verifyDecision(forged, BEFORE_EXPIRY)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a token whose decision was flipped", () => {
    const token = push.signDecision({ ...CLAIMS, decision: "reject" });
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    claims.d = "approve";
    const forged = `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;
    expect(push.verifyDecision(forged, BEFORE_EXPIRY)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a token whose expiry was pushed out", () => {
    const token = push.signDecision(CLAIMS);
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    claims.e = CLAIMS.exp + 86_400;
    const forged = `${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.${signature}`;
    expect(push.verifyDecision(forged, WELL_AFTER_EXPIRY)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a mangled signature", () => {
    const token = push.signDecision(CLAIMS);
    // Flip a character in the *middle* of the signature, never the last one: base64url
    // drops the unused low bits of the final character, so "…A" and "…B" can decode to
    // the same bytes and the "mangled" token verifies — this test was flaky that way.
    const dot = token.lastIndexOf(".");
    const at = dot + 4;
    const flipped = `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}`;
    expect(flipped).not.toBe(token);
    expect(push.verifyDecision(flipped, BEFORE_EXPIRY).ok).toBe(false);
  });

  it("refuses shapes that are not tokens at all", () => {
    for (const bad of ["", "nodot", ".", "a.", ".b", null, undefined, 42, {}, "x".repeat(5000)]) {
      expect(push.verifyDecision(bad, BEFORE_EXPIRY).ok).toBe(false);
    }
  });

  it("refuses an expired token", () => {
    expect(push.verifyDecision(push.signDecision(CLAIMS), WELL_AFTER_EXPIRY)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("tolerates a little clock skew but not a lot", () => {
    const token = push.signDecision(CLAIMS);
    const tenSecondsLate = new Date((CLAIMS.exp + 10) * 1000);
    const twoMinutesLate = new Date((CLAIMS.exp + 120) * 1000);
    expect(push.verifyDecision(token, tenSecondsLate).ok).toBe(true);
    expect(push.verifyDecision(token, twoMinutesLate)).toEqual({ ok: false, reason: "expired" });
  });

  it("is worthless under a different ENCRYPTION_KEY", () => {
    const token = push.signDecision(CLAIMS);
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    try {
      expect(push.verifyDecision(token, BEFORE_EXPIRY)).toEqual({ ok: false, reason: "signature" });
    } finally {
      process.env.ENCRYPTION_KEY = firstKey;
    }
    expect(push.verifyDecision(token, BEFORE_EXPIRY).ok).toBe(true);
  });

  it("reports an unusable key as unconfigured rather than as a bad signature", () => {
    const token = push.signDecision(CLAIMS);
    process.env.ENCRYPTION_KEY = "";
    try {
      expect(push.verifyDecision(token, BEFORE_EXPIRY)).toEqual({ ok: false, reason: "unconfigured" });
    } finally {
      process.env.ENCRYPTION_KEY = firstKey;
    }
  });

  it("refuses to sign nonsense", () => {
    expect(() => push.signDecision({ ...CLAIMS, tradeId: "" })).toThrow();
    expect(() => push.signDecision({ ...CLAIMS, ownerId: "" })).toThrow();
    expect(() => push.signDecision({ ...CLAIMS, exp: Number.NaN })).toThrow();
    // @ts-expect-error — the runtime guard exists precisely because a caller can lie.
    expect(() => push.signDecision({ ...CLAIMS, decision: "maybe" })).toThrow();
  });
});

describe("pushEnabled", () => {
  it("is false until all three VAPID variables are set, and true once they are", () => {
    const saved = {
      subject: process.env.VAPID_SUBJECT,
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
    try {
      delete process.env.VAPID_SUBJECT;
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      expect(push.pushEnabled()).toBe(false);

      process.env.VAPID_PUBLIC_KEY = "BPublicKey";
      process.env.VAPID_PRIVATE_KEY = "PrivateKey";
      expect(push.pushEnabled()).toBe(false);

      // A subject that is neither mailto: nor https: is a misconfiguration a push
      // service would reject at send time; refuse it here instead.
      process.env.VAPID_SUBJECT = "ops@tocker.xyz";
      expect(push.pushEnabled()).toBe(false);

      process.env.VAPID_SUBJECT = "mailto:ops@tocker.xyz";
      expect(push.pushEnabled()).toBe(true);
    } finally {
      for (const [key, value] of Object.entries({
        VAPID_SUBJECT: saved.subject,
        VAPID_PUBLIC_KEY: saved.publicKey,
        VAPID_PRIVATE_KEY: saved.privateKey,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("firstSentence", () => {
  it("takes the first sentence", () => {
    expect(push.firstSentence("Liquidity doubled in an hour. Organic buyers lead the tape.")).toBe(
      "Liquidity doubled in an hour.",
    );
  });

  it("does not break on a decimal price", () => {
    expect(push.firstSentence("Entry at $0.0012 is 40% under the 6h VWAP. Holders are still growing.")).toBe(
      "Entry at $0.0012 is 40% under the 6h VWAP.",
    );
  });

  it("does not stop at an abbreviation", () => {
    expect(push.firstSentence("e.g. the mint authority is revoked and LP is burned. Then we buy.")).toBe(
      "e.g. the mint authority is revoked and LP is burned.",
    );
  });

  it("returns the whole thing when there is no terminator", () => {
    expect(push.firstSentence("Momentum without the wash volume")).toBe("Momentum without the wash volume");
  });

  it("collapses whitespace and handles empty input", () => {
    expect(push.firstSentence("  two   spaces\nand a newline  ")).toBe("two spaces and a newline");
    expect(push.firstSentence(null)).toBe("");
    expect(push.firstSentence(undefined)).toBe("");
    expect(push.firstSentence("   ")).toBe("");
  });

  it("truncates a sentence that would not fit a lock screen", () => {
    const long = `${"word ".repeat(80)}end.`;
    const body = push.firstSentence(long);
    expect(body.length).toBeLessThanOrEqual(180);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("buildProposalPayload", () => {
  const proposal = {
    tradeId: "V1StGXR8_Z5jdHi6B-myT",
    agentName: "Alpha",
    agentSlug: "alpha",
    side: "buy" as const,
    requestedUsd: 2,
    symbol: "DOVE",
    rationale: "Liquidity doubled in an hour. Organic buyers lead the tape.",
    expiresAt: new Date("2026-09-22T12:05:00.000Z"),
  };

  it("reads like the notification it becomes", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", proposal);
    expect(payload.title).toBe("Alpha wants to buy $2 of DOVE");
    expect(payload.body).toBe("Liquidity doubled in an hour.");
    expect(payload.href).toBe("/agents/alpha?proposal=V1StGXR8_Z5jdHi6B-myT");
    expect(payload.expiresAt).toBe("2026-09-22T12:05:00.000Z");
  });

  it("tags on the trade id so a repeat replaces the bubble", () => {
    expect(push.buildProposalPayload("did:privy:abc123", proposal).tag).toBe(proposal.tradeId);
  });

  it("prints a fractional size with cents", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", { ...proposal, requestedUsd: 12.5 });
    expect(payload.title).toBe("Alpha wants to buy $12.50 of DOVE");
  });

  it("says something useful when the agent gave no rationale", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", { ...proposal, rationale: null });
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it("carries one-tap URLs whose tokens verify to the right owner, trade and decision", () => {
    const ownerId = "did:privy:abc123";
    const payload = push.buildProposalPayload(ownerId, proposal);

    for (const [url, decision] of [
      [payload.approveUrl, "approve"],
      [payload.rejectUrl, "reject"],
    ] as const) {
      const token = new URL(url, "https://tocker.xyz").searchParams.get("t");
      expect(token).toBeTruthy();
      const verified = push.verifyDecision(token, BEFORE_EXPIRY);
      expect(verified.ok).toBe(true);
      if (!verified.ok) continue;
      expect(verified.claims).toEqual({
        tradeId: proposal.tradeId,
        ownerId,
        decision,
        exp: Math.floor(proposal.expiresAt.getTime() / 1000),
      });
    }
  });

  it("expires its tokens with the proposal, not four weeks later", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", proposal);
    const token = new URL(payload.approveUrl, "https://tocker.xyz").searchParams.get("t");
    expect(push.verifyDecision(token, WELL_AFTER_EXPIRY)).toEqual({ ok: false, reason: "expired" });
  });

  it("stays inside a push envelope even for a very talkative agent", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", {
      ...proposal,
      rationale: "The tape is thick and ".repeat(400),
    });
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(4_000);
  });

  it("URL-encodes the token so a signature is never mangled by the query string", () => {
    const payload = push.buildProposalPayload("did:privy:abc123", proposal);
    // base64url has no + or / to encode, but the assertion is about the contract, not
    // today's alphabet: whatever is in the parameter must survive a round trip.
    const raw = payload.approveUrl.slice(payload.approveUrl.indexOf("t=") + 2);
    expect(decodeURIComponent(raw)).toBe(new URL(payload.approveUrl, "https://t.xyz").searchParams.get("t"));
  });
});
