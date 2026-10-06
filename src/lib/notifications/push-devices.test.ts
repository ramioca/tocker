/**
 * Where a push may go, to how many devices, and for how long the sender waits.
 *
 * A subscription's endpoint is a URL this server POSTs to, signed as Tocker, whenever
 * the owner's agent raises a proposal. These tests are the three bounds on that: only a
 * browser push service's host is an endpoint, an account has at most ten, and the
 * fan-out stops being waited for at a deadline, because it is awaited inside the run
 * loop that other owners' agents share.
 *
 * `web-push` is mocked, so nothing is sent anywhere; the rows are real, against
 * in-memory PGlite.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";

type SentTo = { endpoint: string };
const sendNotification = vi.fn<(subscription: SentTo, payload: string, options: unknown) => Promise<unknown>>();

vi.mock("web-push", () => ({
  sendNotification: (subscription: SentTo, payload: string, options: unknown) =>
    sendNotification(subscription, payload, options),
}));

let push: typeof import("./push");
let db: Db;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  db = await setupTestDb();
  push = await import("./push");
}, 120_000);

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201 });
  // A placeholder identity: the mocked sender never signs with it.
  vi.stubEnv("VAPID_SUBJECT", "mailto:alerts@example.com");
  vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedUser(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `p${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}` });
  return userId;
}

const fcm = (): string => `https://fcm.googleapis.com/fcm/send/${nanoid(24)}`;
const device = (endpoint: string = fcm()) => ({ endpoint, p256dh: "p".repeat(87), auth: "a".repeat(22), userAgent: "test" });

function rowsOf(userId: string) {
  return db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
}

/** A row written straight to the table, as one stored before the rules existed would be. */
async function storeRow(userId: string, endpoint: string, createdAt = new Date()): Promise<void> {
  await db.insert(schema.pushSubscriptions).values({ id: nanoid(), userId, ...device(endpoint), createdAt });
}

const PROPOSAL = {
  tradeId: "V1StGXR8_Z5jdHi6B-myT",
  agentName: "Alpha",
  agentSlug: "alpha",
  side: "buy" as const,
  requestedUsd: 2,
  symbol: "DOVE",
  rationale: "Momentum is building.",
  expiresAt: new Date(Date.now() + 5 * 60_000),
};

describe("isPushServiceEndpoint", () => {
  it("accepts the browser vendors' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://fcm.googleapis.com/wp/abc123",
      "https://jmt17.google.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/abc123",
      "https://web.push.apple.com/QOabc123",
      "https://wns2-by3p.notify.windows.com/w/?token=abc123",
      "https://FCM.GOOGLEAPIS.COM/fcm/send/abc123",
    ]) {
      expect(push.isPushServiceEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses anywhere else a signed-in stranger might point it", () => {
    for (const endpoint of [
      "https://127.0.0.1:8443/probe",
      "https://localhost/probe",
      "https://10.0.0.5/internal",
      "https://example.com/hook",
      "https://fcm.googleapis.com.example.com/fcm/send/abc",
      "https://example.com/fcm.googleapis.com",
      "https://notfcm.googleapis.com/fcm/send/abc",
      "https://push.apple.com.example.org/x",
      "https://xpush.apple.com/x",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:secret@fcm.googleapis.com/fcm/send/abc",
      "https://user@fcm.googleapis.com/fcm/send/abc",
      "fcm.googleapis.com/fcm/send/abc",
      "not a url",
      "",
    ]) {
      expect(push.isPushServiceEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});

describe("saveSubscription: ten devices an account", () => {
  it("refuses the eleventh device and keeps the ten", async () => {
    const userId = await seedUser();
    for (let i = 0; i < push.MAX_PUSH_DEVICES; i++) await push.saveSubscription(userId, device());

    await expect(push.saveSubscription(userId, device())).rejects.toBeInstanceOf(push.PushDeviceLimitError);
    expect(await rowsOf(userId)).toHaveLength(10);
  });

  it("still lets a device that is already on refresh itself at the limit", async () => {
    const userId = await seedUser();
    const first = fcm();
    await push.saveSubscription(userId, device(first));
    for (let i = 1; i < push.MAX_PUSH_DEVICES; i++) await push.saveSubscription(userId, device());

    await expect(push.saveSubscription(userId, { ...device(first), userAgent: "refreshed" })).resolves.toBeUndefined();
    const rows = await rowsOf(userId);
    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.endpoint === first)?.userAgent).toBe("refreshed");
  });

  it("needs a free place to turn a disabled device back on, or to take one over from another account", async () => {
    const userId = await seedUser();
    const dormant = fcm();
    await push.saveSubscription(userId, device(dormant));
    await db.update(schema.pushSubscriptions).set({ disabledAt: new Date() }).where(eq(schema.pushSubscriptions.endpoint, dormant));
    for (let i = 0; i < push.MAX_PUSH_DEVICES; i++) await push.saveSubscription(userId, device());

    await expect(push.saveSubscription(userId, device(dormant))).rejects.toBeInstanceOf(push.PushDeviceLimitError);

    const someoneElse = await seedUser();
    const theirs = fcm();
    await push.saveSubscription(someoneElse, device(theirs));
    await expect(push.saveSubscription(userId, device(theirs))).rejects.toBeInstanceOf(push.PushDeviceLimitError);
    expect((await rowsOf(someoneElse))[0]?.endpoint).toBe(theirs);
  });

  it("counts each account on its own, and frees a place when a device is removed", async () => {
    const full = await seedUser();
    const endpoints: string[] = [];
    for (let i = 0; i < push.MAX_PUSH_DEVICES; i++) {
      endpoints.push(fcm());
      await push.saveSubscription(full, device(endpoints[i]));
    }
    const other = await seedUser();
    await expect(push.saveSubscription(other, device())).resolves.toBeUndefined();

    await push.removeSubscription(full, endpoints[0]!);
    await expect(push.saveSubscription(full, device())).resolves.toBeUndefined();
    expect(await rowsOf(full)).toHaveLength(10);
  });
});

describe("sendProposalPush", () => {
  it("sends to push services only, whatever is stored", async () => {
    const userId = await seedUser();
    const real = fcm();
    await storeRow(userId, real);
    await storeRow(userId, "https://127.0.0.1:8443/probe");
    await storeRow(userId, "https://victim.example.com/hook");

    expect(await push.sendProposalPush(userId, PROPOSAL)).toBe(1);
    expect(sendNotification.mock.calls.map(([subscription]) => subscription.endpoint)).toEqual([real]);
  });

  it("sends to at most ten devices, the newest, however many rows the account has", async () => {
    const userId = await seedUser();
    const endpoints: string[] = [];
    for (let i = 0; i < 25; i++) {
      endpoints.push(fcm());
      // Oldest first: row 0 is 25 minutes old, row 24 is one minute old.
      await storeRow(userId, endpoints[i]!, new Date(Date.now() - (25 - i) * 60_000));
    }

    expect(await push.sendProposalPush(userId, PROPOSAL)).toBe(10);
    expect(sendNotification).toHaveBeenCalledTimes(10);
    const sentTo = sendNotification.mock.calls.map(([subscription]) => subscription.endpoint).sort();
    expect(sentTo).toEqual(endpoints.slice(15).sort());
  });

  it("stops waiting at the deadline when a push service does not answer", async () => {
    const userId = await seedUser();
    const quick = fcm();
    const stuck = fcm();
    await storeRow(userId, quick);
    await storeRow(userId, stuck);
    // One answers at once; the other never does.
    sendNotification.mockImplementation((subscription) =>
      subscription.endpoint === stuck ? new Promise(() => undefined) : Promise.resolve({ statusCode: 201 }),
    );

    const started = Date.now();
    const delivered = await push.sendProposalPush(userId, PROPOSAL, { deadlineMs: 50 });
    const waited = Date.now() - started;

    expect(delivered).toBe(1);
    expect(waited).toBeLessThan(2_000);
    // The one that answered is still recorded.
    const rows = await rowsOf(userId);
    expect(rows.find((row) => row.endpoint === quick)?.lastUsedAt).not.toBeNull();
    expect(rows.find((row) => row.endpoint === stuck)?.lastUsedAt).toBeNull();
  });

  it("still retires a device the push service says is gone, and only that one", async () => {
    const userId = await seedUser();
    const live = fcm();
    const gone = fcm();
    await storeRow(userId, live);
    await storeRow(userId, gone);
    sendNotification.mockImplementation((subscription) =>
      subscription.endpoint === gone ? Promise.reject(Object.assign(new Error("gone"), { statusCode: 410 })) : Promise.resolve({ statusCode: 201 }),
    );

    expect(await push.sendProposalPush(userId, PROPOSAL)).toBe(1);
    const rows = await rowsOf(userId);
    expect(rows.find((row) => row.endpoint === gone)?.disabledAt).not.toBeNull();
    expect(rows.find((row) => row.endpoint === live)?.disabledAt).toBeNull();
  });
});
