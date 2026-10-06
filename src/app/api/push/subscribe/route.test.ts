/**
 * What `/api/push/subscribe` will record as a device.
 *
 * The endpoint it stores is an address the server later POSTs to, so the interesting
 * cases are refusals: a host that is not a browser push service, and an eleventh
 * device. The one deliberate asymmetry is DELETE, which keeps the loose https rule so a
 * row stored before the host rule existed can still be removed by its owner.
 *
 * The session is mocked; the handler, its schema and the rows are real, against
 * in-memory PGlite. Each request carries its own client address, so the route's
 * per-address limiter never decides a test.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { NextRequest } from "next/server";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

let session: Session | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { DELETE, POST } = await import("./route");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
});

async function signInAsNewUser(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  const handle = `s${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await db.insert(schema.users).values({ id: userId, handle });
  session = { userId, handle, displayName: null, avatarUrl: null, email: null };
  return userId;
}

function request(method: "POST" | "DELETE", body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/push/subscribe", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` },
    body: JSON.stringify(body),
  });
}

const fcm = (): string => `https://fcm.googleapis.com/fcm/send/${nanoid(24)}`;
const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });

function rowsOf(userId: string) {
  return db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
}

describe("POST /api/push/subscribe", () => {
  it("records a browser push service's endpoint", async () => {
    const userId = await signInAsNewUser();
    const endpoint = fcm();
    const res = await POST(request("POST", subscription(endpoint)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await rowsOf(userId)).map((row) => row.endpoint)).toEqual([endpoint]);
  });

  it("refuses a loopback address, an internal one and a third party's server", async () => {
    const userId = await signInAsNewUser();
    for (const endpoint of [
      "https://127.0.0.1:8443/probe",
      "https://localhost/probe",
      "https://10.0.0.5/internal",
      "https://victim.example.com/hook",
      "https://fcm.googleapis.com.example.com/fcm/send/abc",
      "http://fcm.googleapis.com/fcm/send/abc",
    ]) {
      const res = await POST(request("POST", subscription(endpoint)));
      expect(res.status, endpoint).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "That is not a push subscription." });
    }
    expect(await rowsOf(userId)).toHaveLength(0);
  });

  it("refuses an eleventh device with a sentence that says what to do", async () => {
    const userId = await signInAsNewUser();
    for (let i = 0; i < 10; i++) {
      expect((await POST(request("POST", subscription(fcm())))).status).toBe(200);
    }

    const res = await POST(request("POST", subscription(fcm())));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Alerts are already on for 10 devices. Turn them off on one you no longer use, then try again.",
    });
    expect(await rowsOf(userId)).toHaveLength(10);
  });

  it("is refused without a session", async () => {
    const res = await POST(request("POST", subscription(fcm())));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("still removes a row stored before the host rule, which POST would now refuse", async () => {
    const userId = await signInAsNewUser();
    const legacy = "https://push.example.net/legacy-endpoint";
    await db.insert(schema.pushSubscriptions).values({ id: nanoid(), userId, endpoint: legacy, p256dh: "p".repeat(87), auth: "a".repeat(22) });

    const res = await DELETE(request("DELETE", { endpoint: legacy }));
    expect(res.status).toBe(200);
    expect(await rowsOf(userId)).toHaveLength(0);
  });

  it("removes only the caller's own device", async () => {
    const owner = await signInAsNewUser();
    const endpoint = fcm();
    expect((await POST(request("POST", subscription(endpoint)))).status).toBe(200);

    await signInAsNewUser();
    expect((await DELETE(request("DELETE", { endpoint }))).status).toBe(200);
    expect(await rowsOf(owner)).toHaveLength(1);
  });
});
