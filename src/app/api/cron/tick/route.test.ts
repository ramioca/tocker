/**
 * The tick route: what it hands the scheduler, and what it says when the pass fails.
 *
 * A pay-per-use run signs payments, and the platform ends an invocation at its time
 * limit whatever is in flight. So the route notes when its invocation began, before
 * anything else, and passes that down; the scheduler and the run loop decide from it.
 * The scheduler and the kill switch's count are stand-ins here; the auth is the real code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SECRET = "s".repeat(64);
const tickDueAgents = vi.fn();
const countPausedDueAgents = vi.fn(async () => 0);

vi.mock("@/lib/agent/scheduler", () => ({
  tickDueAgents: (...args: unknown[]) => tickDueAgents(...args),
}));
vi.mock("@/lib/security/kill-switch", () => ({
  countPausedDueAgents: () => countPausedDueAgents(),
}));

const { GET, maxDuration } = await import("./route");

let caller = 0;
function call(options: { secret?: string | null; query?: string } = {}): Promise<Response> {
  caller += 1;
  const headers: Record<string, string> = { "x-real-ip": `10.1.0.${caller}` };
  if (options.secret !== null) headers.authorization = `Bearer ${options.secret ?? SECRET}`;
  return GET(new NextRequest(`http://localhost/api/cron/tick${options.query ?? ""}`, { headers }));
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("CRON_MAX_AGENTS", "");
  tickDueAgents.mockReset();
  tickDueAgents.mockResolvedValue({ due: 0, results: [], reaped: 0, holdsCleared: 0 });
  countPausedDueAgents.mockClear();
});

describe("GET /api/cron/tick", () => {
  it("runs nothing for a caller without the secret", async () => {
    expect((await call({ secret: null })).status).toBe(401);
    expect((await call({ secret: "w".repeat(64) })).status).toBe(401);
    expect(tickDueAgents).not.toHaveBeenCalled();
  });

  it("hands the scheduler the moment this invocation began", async () => {
    const before = Date.now();
    const res = await call();
    expect(res.status).toBe(200);

    expect(tickDueAgents).toHaveBeenCalledTimes(1);
    const [limit, now, options] = tickDueAgents.mock.calls[0] as [number, Date, { invocationStartedAt: number }];
    expect(limit).toBe(5);
    expect(now).toBeInstanceOf(Date);
    expect(options.invocationStartedAt).toBeGreaterThanOrEqual(before);
    // Taken before the checks and the count, so never later than the pass's own clock.
    expect(options.invocationStartedAt).toBeLessThanOrEqual(now.getTime());
  });

  it("is allowed the 300 seconds the run loop's deadlines are counted against", () => {
    expect(maxDuration).toBe(300);
  });

  it("reports the pass, the holds it lifted and what the kill switch held back", async () => {
    tickDueAgents.mockResolvedValue({ due: 2, results: [], reaped: 1, holdsCleared: 3 });
    countPausedDueAgents.mockResolvedValueOnce(4);
    const body = await (await call({ query: "?limit=20" })).json();
    expect(body).toMatchObject({ ok: true, due: 2, reaped: 1, holdsCleared: 3, pausedSkipped: 4 });
    expect(tickDueAgents.mock.calls[0]?.[0]).toBe(20);
  });

  it("says a database failure without the statement or what was bound to it", async () => {
    const failure = new Error('Failed query: select "id" from "agents" where "owner_id" = $1\nparams: did:privy:someone');
    tickDueAgents.mockRejectedValueOnce(failure);
    const res = await call();
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"ok":false');
    expect(text).not.toContain("did:privy:someone");
    expect(text).not.toContain("owner_id");
  });
});
