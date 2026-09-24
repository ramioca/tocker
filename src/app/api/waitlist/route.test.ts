/**
 * The waitlist is the one unauthenticated write on the landing page. These tests pin
 * down the two things that make it safe to leave open: nothing oversized gets in, and a
 * repeat address neither inserts again nor emails the founder again.
 *
 * Real route against in-memory PGlite; only the mail and `after()` are stubbed.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";

const notifyWaitlistSignup = vi.fn(async () => undefined);
vi.mock("@/lib/waitlist/notify", () => ({ notifyWaitlistSignup }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Outside a request there is no `after()` scope; run the callback inline instead.
  after: (fn: () => unknown) => void fn(),
}));

const { POST } = await import("./route");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => notifyWaitlistSignup.mockClear());

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const valid = { email: "a@example.com", volume: "$10k–100k", chains: ["Solana", "Base"], style: null };

describe("POST /api/waitlist", () => {
  it("accepts what the landing form sends", async () => {
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(notifyWaitlistSignup).toHaveBeenCalledTimes(1);
  });

  it("answers a repeat address the same way, without a second row or email", async () => {
    const res = await post({ ...valid, email: "A@Example.com" });
    expect(await res.json()).toEqual({ ok: true });
    expect(notifyWaitlistSignup).not.toHaveBeenCalled();
    const rows = await db.select().from(schema.waitlistSignups);
    expect(rows.filter((r) => r.email.toLowerCase() === "a@example.com")).toHaveLength(1);
  });

  it("refuses an oversized or malformed body", async () => {
    const cases = [
      { ...valid, email: `${"x".repeat(250)}@example.com` },
      { ...valid, email: "not-an-email" },
      { ...valid, volume: "v".repeat(65) },
      { ...valid, volume: "" },
      { ...valid, style: "s".repeat(65) },
      { ...valid, chains: ["a", "b", "c", "d", "e", "f"] },
      { ...valid, chains: ["c".repeat(17)] },
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(notifyWaitlistSignup).not.toHaveBeenCalled();
  });

  it("keeps the form's field-specific messages", async () => {
    expect((await (await post({ ...valid, email: "nope" })).json()).error).toBe("Enter a valid email.");
    expect((await (await post({ ...valid, email: "b@example.com", volume: undefined })).json()).error).toBe(
      "Pick your monthly volume.",
    );
  });
});
