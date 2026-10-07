/**
 * `/api/models/[provider]`: a provider's published model list, for the picker.
 *
 * What matters is who gets an answer and for which providers: a signed-in caller, and
 * only a provider that is switched on and publishes its list. The segment is whatever
 * was typed into the address, so everything else is a 404 and nothing is fetched for it.
 * `getSession` and `fetch` are stand-ins; no provider is contacted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOGUE, CATALOGUE_IDS, isProvider } from "@/lib/agent/providers";
import { resetPublicCatalogs } from "@/lib/agent/providers-keys";
import type { Session } from "@/server/types";

let session: Session | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const { GET } = await import("./route");

const SIGNED_IN: Session = { userId: "did:privy:test", handle: "owner", displayName: null, avatarUrl: null, email: null };

function get(provider: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/models/${encodeURIComponent(provider)}`), { params: Promise.resolve({ provider }) });
}

/** One row OpenRouter's filter keeps, in the shape its catalogue has. */
const OPENROUTER_BODY = {
  data: [
    {
      id: "vendor/model-a",
      name: "Vendor: Model A",
      created: 100,
      pricing: { prompt: "0.000002", completion: "0.00001" },
      supported_parameters: ["tools", "temperature"],
      architecture: { output_modalities: ["text"] },
    },
  ],
};

let requests: Array<{ url: string; headers: Record<string, string> }> = [];

beforeEach(() => {
  session = SIGNED_IN;
  requests = [];
  resetPublicCatalogs();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), headers: { ...(init.headers as Record<string, string>) } });
    return new Response(JSON.stringify(OPENROUTER_BODY), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/models/[provider]", () => {
  it("answers nobody who is not signed in, and fetches nothing for them", async () => {
    session = null;
    for (const provider of ["openrouter", "anthropic", "nope"]) {
      const res = await get(provider);
      expect(res.status, provider).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    }
    expect(requests).toHaveLength(0);
  });

  /** The address the picker has always called. */
  it("still serves OpenRouter's catalogue at /api/models/openrouter, with the answer it always gave", async () => {
    const res = await get("openrouter");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await res.json()).toEqual({
      models: [{ id: "vendor/model-a", label: "Vendor: Model A", inputPerMTok: 2, outputPerMTok: 10 }],
      live: true,
    });
    // Fetched with no credential, from OpenRouter and nowhere else.
    expect(requests).toEqual([{ url: "https://openrouter.ai/api/v1/models", headers: { accept: "application/json" } }]);
  });

  it("answers the short built-in list, and says so, when the provider is down", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const res = await get("openrouter");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [...CATALOGUE.openrouter.models], live: false });
  });

  it("is a 404 for anything that is not a provider, without asking anyone", async () => {
    for (const provider of ["nope", "", "OpenRouter", "openrouter ", "../openrouter", "constructor", "__proto__", "toString", "cohere", "https://evil.example"]) {
      const res = await get(provider);
      expect(res.status, provider).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    }
    expect(requests).toHaveLength(0);
  });

  /** Written against the registry, so it holds before and after the other providers are switched on. */
  it("serves exactly the providers that are switched on and publish their list", async () => {
    for (const id of CATALOGUE_IDS) {
      requests = [];
      const res = await get(id);
      const served = isProvider(id) && CATALOGUE[id].modelList === "public";
      expect(res.status, id).toBe(served ? 200 : 404);
      if (!served) {
        expect(requests, id).toHaveLength(0);
        continue;
      }
      // One request, to that provider's own origin, carrying no key.
      expect(requests, id).toHaveLength(1);
      expect(new URL(requests[0]!.url).origin, id).toBe(CATALOGUE[id].origin);
      expect(requests[0]?.headers, id).toEqual({ accept: "application/json" });
      const answered = (await res.json()) as { models: unknown[]; live: boolean };
      expect(Array.isArray(answered.models) && answered.models.length > 0, id).toBe(true);
    }
  });

  it("does not ask by this route for a provider whose list depends on the key", async () => {
    for (const provider of ["anthropic", "openai"]) expect((await get(provider)).status, provider).toBe(404);
    expect(requests).toHaveLength(0);
  });
});
