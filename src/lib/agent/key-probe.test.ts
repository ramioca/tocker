import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLlmKey, probeOutcome } from "./key-probe";

const KEY = "sk-test-0123456789abcdef";

function respond(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeOutcome", () => {
  it("only a 401 is a verdict on the key", () => {
    expect(probeOutcome(200)).toBe("ok");
    expect(probeOutcome(401)).toBe("rejected");
    // Region blocks and permission errors are about the request, not the key.
    expect(probeOutcome(403)).toBe("unreachable");
    expect(probeOutcome(429)).toBe("unreachable");
    expect(probeOutcome(503)).toBe("unreachable");
  });

  it("does not refuse a real restricted key that cannot list models", () => {
    expect(probeOutcome(401, "You have insufficient permissions for this operation. Missing scopes: api.model.read.")).toBe(
      "ok",
    );
  });
});

describe("probeLlmKey", () => {
  it("refuses a key the provider does not recognise", async () => {
    respond(401, { error: { message: "Incorrect API key provided" } });
    expect(await probeLlmKey("openai", KEY)).toBe("rejected");
  });

  it("asks each provider its own free endpoint, with its own auth header", async () => {
    const fetchMock = respond(200);
    await probeLlmKey("openai", KEY);
    await probeLlmKey("openrouter", KEY);
    await probeLlmKey("anthropic", KEY, "wrkspc_1");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([
      "https://api.openai.com/v1/models",
      "https://openrouter.ai/api/v1/key",
      "https://api.anthropic.com/v1/models?limit=1",
    ]);
    expect(calls[0][1].headers).toMatchObject({ authorization: `Bearer ${KEY}` });
    expect(calls[2][1].headers).toMatchObject({ "x-api-key": KEY, "anthropic-workspace-id": "wrkspc_1" });
  });

  it("calls a network failure unreachable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await probeLlmKey("anthropic", KEY)).toBe("unreachable");
  });
});
