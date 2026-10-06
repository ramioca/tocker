import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODELS } from "./models";
import { getOpenRouterCatalog, parseOpenRouterModels, resetOpenRouterCatalog } from "./openrouter-catalog";

const model = (over: Record<string, unknown>) => ({
  id: "vendor/model-a",
  name: "Vendor: Model A",
  created: 100,
  pricing: { prompt: "0.000002", completion: "0.00001" },
  supported_parameters: ["tools", "temperature"],
  architecture: { output_modalities: ["text"] },
  ...over,
});

describe("parseOpenRouterModels", () => {
  it("keeps a model an agent can run on, with its name and its price per million tokens", () => {
    expect(parseOpenRouterModels({ data: [model({})] })).toEqual([
      { id: "vendor/model-a", label: "Vendor: Model A", inputPerMTok: 2, outputPerMTok: 10 },
    ]);
  });

  it("drops what an agent cannot run on: no tool calling, not text out, a batch variant", () => {
    const rows = parseOpenRouterModels({
      data: [
        model({ id: "vendor/no-tools", supported_parameters: ["temperature"] }),
        model({ id: "vendor/no-params", supported_parameters: undefined }),
        model({ id: "vendor/draws", architecture: { output_modalities: ["image", "text"] } }),
        model({ id: "vendor/speaks", architecture: { output_modalities: ["text", "audio"] } }),
        model({ id: "vendor/slow:batch" }),
        model({ id: "vendor/kept:free", pricing: { prompt: "0", completion: "0" } }),
      ],
    });
    expect(rows).toEqual([{ id: "vendor/kept:free", label: "Vendor: Model A", inputPerMTok: 0, outputPerMTok: 0 }]);
  });

  it("puts the newest first", () => {
    const rows = parseOpenRouterModels({
      data: [model({ id: "v/old", created: 1 }), model({ id: "v/new", created: 3 }), model({ id: "v/mid", created: 2 })],
    });
    expect(rows.map((row) => row.id)).toEqual(["v/new", "v/mid", "v/old"]);
  });

  /** The body is somebody else's: nothing in it is trusted to be the shape it should be. */
  it("survives a body that is not what it should be", () => {
    for (const body of [null, undefined, "nope", 7, {}, { data: "x" }, { data: [null, 3, "id", {}] }]) {
      expect(parseOpenRouterModels(body)).toEqual([]);
    }
    const rows = parseOpenRouterModels({
      data: [
        model({ id: "has spaces" }),
        model({ id: "<script>" }),
        model({ id: "x".repeat(101) }),
        model({ id: "v/no-name", name: "   " }),
        model({ id: "v/no-price", pricing: { prompt: "abc" } }),
        model({ id: "v/negative", pricing: { prompt: "-1", completion: "1" } }),
        model({ id: "v/long-name", name: "N".repeat(500) }),
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(["v/no-name", "v/no-price", "v/negative", "v/long-name"]);
    expect(rows[0]?.label).toBe("v/no-name");
    expect(rows[1]).toEqual({ id: "v/no-price", label: "Vendor: Model A" });
    expect(rows[2]).toEqual({ id: "v/negative", label: "Vendor: Model A" });
    expect(rows[3]?.label).toHaveLength(80);
  });
});

describe("getOpenRouterCatalog", () => {
  let calls = 0;

  beforeEach(() => {
    resetOpenRouterCatalog();
    calls = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const answer = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });

  it("serves the fetched list, and asks again only after an hour", async () => {
    answer({ data: [model({})] });
    const first = await getOpenRouterCatalog(0);
    expect(first.live).toBe(true);
    expect(first.models.map((m) => m.id)).toEqual(["vendor/model-a"]);

    await getOpenRouterCatalog(59 * 60_000);
    expect(calls).toBe(1);
    await getOpenRouterCatalog(61 * 60_000);
    expect(calls).toBe(2);
  });

  it("falls back to the short built-in list, and says so, when OpenRouter cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    expect(await getOpenRouterCatalog(0)).toEqual({ models: DEFAULT_MODELS.openrouter, live: false });

    answer({ error: "nope" }, 500);
    expect((await getOpenRouterCatalog(0)).live).toBe(false);

    // A reachable answer with nothing usable in it is no better.
    answer({ data: [] });
    expect((await getOpenRouterCatalog(0)).live).toBe(false);
  });

  it("keeps serving the last good list when a later fetch fails", async () => {
    answer({ data: [model({})] });
    await getOpenRouterCatalog(0);
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const later = await getOpenRouterCatalog(2 * 60 * 60_000);
    expect(later.live).toBe(true);
    expect(later.models.map((m) => m.id)).toEqual(["vendor/model-a"]);
  });
});
