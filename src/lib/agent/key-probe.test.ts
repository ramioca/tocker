import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLlmKey, probeOutcome } from "./key-probe";
import { CATALOGUE_IDS, isProvider, type LlmProvider } from "./providers";

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

  /**
   * The registry is the only list now, and the type is erased at the wire. A provider
   * that is not switched on has no host a key may be sent to, so it is sent to none.
   */
  it("sends a key nowhere for a provider that is not switched on, and never calls it accepted", async () => {
    const fetchMock = respond(200);
    const notOn = [...CATALOGUE_IDS.filter((id) => !isProvider(id)), "cohere", "constructor", "__proto__", ""];
    for (const provider of notOn) {
      expect(await probeLlmKey(provider as LlmProvider, KEY), provider).toBe("rejected");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a key nowhere when it is plainly another provider's", async () => {
    const fetchMock = respond(200);
    // Put together here: an Anthropic prefix on a stand-in, offered to OpenAI and OpenRouter.
    const anthropicKey = `sk-ant-${KEY.slice(3)}`;
    expect(await probeLlmKey("openai", anthropicKey)).toBe("rejected");
    expect(await probeLlmKey("openrouter", anthropicKey)).toBe("rejected");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await probeLlmKey("anthropic", anthropicKey)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect with the key on it", async () => {
    const fetchMock = respond(200);
    await probeLlmKey("anthropic", KEY);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
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
