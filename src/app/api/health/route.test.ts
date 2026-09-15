import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  /**
   * An unconfigured production deploy is the exact case this endpoint exists for, so
   * it must answer with a readable body rather than throwing on the way out.
   */
  it("reports 503 with a reason when production has no DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    const res = await GET();
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.database).toBe("unreachable");
    expect(body.embedded).toBe(false);
    expect(body.error).toMatch(/DATABASE_URL/);
  });
});
