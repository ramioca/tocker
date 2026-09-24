import { beforeEach, describe, expect, it, vi } from "vitest";

const searchTokens = vi.fn(async (_query: string, _limit: number) => []);
vi.mock("@/server/queries/tokens", () => ({ searchTokens }));

const { GET } = await import("./route");

function search(q: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/tokens/search?q=${encodeURIComponent(q)}`));
}

beforeEach(() => searchTokens.mockClear());

describe("GET /api/tokens/search", () => {
  /** `%` and `_` are LIKE wildcards; a public, uncached-on-miss endpoint must not take them. */
  it("strips LIKE wildcards and the escape character before searching", async () => {
    await search("%b_o\\nk%");
    expect(searchTokens).toHaveBeenCalledWith("bonk", 8);
  });

  it("caps the query at 64 characters", async () => {
    await search("a".repeat(500));
    expect(searchTokens.mock.calls[0]?.[0]).toHaveLength(64);
  });

  it("treats a query of only wildcards as the empty listing", async () => {
    await search("%%%");
    expect(searchTokens).toHaveBeenCalledWith("", 25);
  });
});
