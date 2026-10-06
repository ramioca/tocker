/**
 * The relay's per-call limit. The proxy's request limit runs before the body is read, so
 * it cannot tell one call from a batch of twenty; this is the route charging each call.
 *
 * No network: `fetch` is a stub that answers like an RPC, and counts what reached it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS, limiter } from "@/lib/security/rate-limit";
import { POST } from "./route";

const realFetch = globalThis.fetch;
let forwarded = 0;

beforeEach(() => {
  limiter.reset();
  forwarded = 0;
  globalThis.fetch = (async () => {
    forwarded += 1;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const call = (id: number) => ({ jsonrpc: "2.0", id, method: "getSlot" });
const batchOf = (n: number) => Array.from({ length: n }, (_, i) => call(i));

function post(body: unknown, ip = "203.0.113.7"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/solana/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/solana/rpc", () => {
  it("charges a batch one unit per call, not one for the request", async () => {
    const perMinute = RATE_LIMITS.solanaRpcCalls.limit;
    const fullBatches = Math.floor(perMinute / 20);

    for (let i = 0; i < fullBatches; i += 1) expect((await post(batchOf(20))).status).toBe(200);
    expect(forwarded).toBe(fullBatches);

    // The allowance is spent in calls. Counted in requests, there would be room for
    // dozens more of these.
    const refused = await post(batchOf(20));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toMatchObject({ error: "rate limited" });
    // Refused whole: nothing of the batch went upstream.
    expect(forwarded).toBe(fullBatches);
  });

  it("charges a single call one unit", async () => {
    const perMinute = RATE_LIMITS.solanaRpcCalls.limit;
    for (let i = 0; i < perMinute; i += 1) expect((await post(call(i))).status).toBe(200);
    expect((await post(call(0))).status).toBe(429);
    expect(forwarded).toBe(perMinute);
  });

  it("keeps one client's calls out of another's allowance", async () => {
    const fullBatches = Math.ceil(RATE_LIMITS.solanaRpcCalls.limit / 20);
    for (let i = 0; i <= fullBatches; i += 1) await post(batchOf(20), "203.0.113.7");
    expect((await post(call(1), "203.0.113.7")).status).toBe(429);

    expect((await post(call(1), "198.51.100.9")).status).toBe(200);
  });

  /** A refused method never reaches the counter: it costs nothing upstream. */
  it("does not charge for a request it refuses anyway", async () => {
    const perMinute = RATE_LIMITS.solanaRpcCalls.limit;
    for (let i = 0; i < perMinute + 5; i += 1) {
      expect((await post({ jsonrpc: "2.0", id: i, method: "getProgramAccounts" })).status).toBe(403);
    }
    expect((await post(call(1))).status).toBe(200);
    expect(forwarded).toBe(1);
  });
});
