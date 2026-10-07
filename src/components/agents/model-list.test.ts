/**
 * Where the model picker's rows come from for each provider, and what its footer says.
 *
 * Anthropic, OpenAI and OpenRouter are pinned word for word: the picker has to behave
 * for them exactly as it did when they were the only three. Everything else is checked
 * against the registry row by row, so the tests hold whichever providers are switched on.
 */
import { describe, expect, it } from "vitest";
import { isModelId, knownModelLabel, typedModelId, type ModelOption } from "@/lib/agent/models";
import { CATALOGUE, CATALOGUE_IDS, type CatalogueId } from "@/lib/agent/providers";
import {
  NOTHING_ASKED,
  builtInModels,
  listFooter,
  modelListSource,
  modelNameOn,
  ownListModelName,
  publicListUrl,
  readPublicList,
  shownModels,
  type ModelListState,
} from "./model-list";

const THREE = ["anthropic", "openai", "openrouter"] as const;
const NOT_PROVIDERS = ["", "nope", "constructor", "__proto__", "../users"];
const idsWith = (source: string): CatalogueId[] => CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === source);

const state = (over: Partial<ModelListState> = {}): ModelListState => ({ ...NOTHING_ASKED, ...over });
const row = (id: string, label = id): ModelOption => ({ id, label });

describe("where each provider's list comes from", () => {
  it("asks Anthropic and OpenAI by key and reads OpenRouter's public list, as before", () => {
    expect(modelListSource("anthropic")).toBe("by-key");
    expect(modelListSource("openai")).toBe("by-key");
    expect(modelListSource("openrouter")).toBe("public");
    expect(publicListUrl("openrouter")).toBe("/api/models/openrouter");
    expect(publicListUrl("anthropic")).toBeNull();
    expect(publicListUrl("openai")).toBeNull();
  });

  it("follows the registry for every provider", () => {
    for (const id of CATALOGUE_IDS) {
      expect(modelListSource(id), id).toBe(CATALOGUE[id].modelList);
      expect(builtInModels(id), id).toBe(CATALOGUE[id].models);
      expect(publicListUrl(id), id).toBe(CATALOGUE[id].modelList === "public" ? `/api/models/${id}` : null);
    }
    // Each of the three ways is in use, so each branch below has a provider to answer for.
    expect(idsWith("by-key").length).toBeGreaterThan(0);
    expect(idsWith("public").length).toBeGreaterThan(0);
    expect(idsWith("built-in").length).toBeGreaterThan(0);
  });

  it("puts nothing in the address but the registry's own id", () => {
    for (const id of idsWith("public")) expect(publicListUrl(id), id).toMatch(/^\/api\/models\/[a-z]+$/);
  });

  it("has no list to ask for under a provider it does not know", () => {
    for (const value of NOT_PROVIDERS) {
      expect(modelListSource(value), value).toBe("built-in");
      expect(builtInModels(value), value).toEqual([]);
      expect(publicListUrl(value), value).toBeNull();
      expect(shownModels(value, state({ hasKey: true, keyModels: [row("x")] })), value).toEqual([]);
    }
  });
});

describe("the rows the picker lists", () => {
  it("opens on the registry's rows for every provider", () => {
    for (const id of CATALOGUE_IDS) expect(shownModels(id, NOTHING_ASKED), id).toEqual(CATALOGUE[id].models);
  });

  it("replaces a by-key provider's built-in rows only with what the chosen key's provider answered", () => {
    const answered = [row("model-the-key-can-use"), row("another-one")];
    for (const id of idsWith("by-key")) {
      expect(shownModels(id, state({ hasKey: true, keyModels: answered })), id).toBe(answered);
      // Asked and not yet answered, refused, or no key chosen: the built-in rows stand in.
      expect(shownModels(id, state({ hasKey: true, loading: true })), id).toBe(CATALOGUE[id].models);
      expect(shownModels(id, state({ hasKey: true, keyError: "No." })), id).toBe(CATALOGUE[id].models);
      expect(shownModels(id, state({ hasKey: false, keyModels: answered })), id).toBe(CATALOGUE[id].models);
    }
  });

  it("moves the registry's rows to the front of a public catalogue, in the registry's order", () => {
    for (const id of idsWith("public")) {
      const builtIn = CATALOGUE[id].models;
      const first = { ...builtIn[0], label: "As the provider names it", inputPerMTok: 9, outputPerMTok: 9 };
      const second = { ...builtIn[1], label: "The second one" };
      const listed = [row("vendor/newest"), second, row("vendor/older"), first];
      const shown = shownModels(id, state({ publicList: { models: listed, live: true } }));
      // The provider's own row for a featured model is the one shown, with its price.
      expect(shown, id).toEqual([first, second, row("vendor/newest"), row("vendor/older")]);
    }
  });

  it("falls back to the registry's rows when the public list has not come or came back empty", () => {
    for (const id of idsWith("public")) {
      expect(shownModels(id, state({ loading: true })), id).toEqual(CATALOGUE[id].models);
      expect(shownModels(id, state({ publicList: { models: [], live: false } })), id).toEqual(CATALOGUE[id].models);
    }
  });

  it("ignores a key's list on a provider that is not asked by key", () => {
    const stray = [row("not-from-here")];
    for (const id of [...idsWith("public"), ...idsWith("built-in")]) {
      expect(shownModels(id, state({ hasKey: true, keyModels: stray })), id).toEqual(CATALOGUE[id].models);
    }
  });

  it("shows a built-in provider the registry's rows whatever else is known", () => {
    for (const id of idsWith("built-in")) {
      const noise = state({ hasKey: true, keyModels: [row("a")], publicList: { models: [row("b")], live: true } });
      expect(shownModels(id, noise), id).toBe(CATALOGUE[id].models);
    }
  });

  it("always lets an id that is typed be used, whatever the list", () => {
    for (const id of CATALOGUE_IDS) {
      const shown = shownModels(id, NOTHING_ASKED);
      expect(typedModelId(shown, "some-new-model-9"), id).toBe("some-new-model-9");
      expect(typedModelId(shown, "vendor/some-new-model:free"), id).toBe("vendor/some-new-model:free");
      // What is already a row is chosen as that row, not offered a second time.
      expect(typedModelId(shown, CATALOGUE[id].defaultModel), id).toBeNull();
    }
    expect(typedModelId(shownModels("nope", NOTHING_ASKED), "any-model-id")).toBe("any-model-id");
  });
});

describe("the footer, for the three there have always been", () => {
  it("says of OpenRouter exactly what it said", () => {
    expect(listFooter("openrouter", state({ loading: true }), 8)).toBe("Loading OpenRouter's list…");
    expect(listFooter("openrouter", state({ publicList: { models: [row("a")], live: true } }), 312)).toBe(
      "312 models that can run an agent, from OpenRouter's own list.",
    );
    expect(listFooter("openrouter", state({ publicList: { models: [row("a")], live: false } }), 8)).toBe(
      "Couldn't reach OpenRouter's list, so this is a short one. Any model id can be typed.",
    );
    // The request failed outright, so there is no answer at all.
    expect(listFooter("openrouter", state(), 8)).toBe(
      "Couldn't reach OpenRouter's list, so this is a short one. Any model id can be typed.",
    );
    // A key makes no difference to a public list.
    expect(listFooter("openrouter", state({ hasKey: true, publicList: { models: [row("a")], live: true } }), 5)).toBe(
      "5 models that can run an agent, from OpenRouter's own list.",
    );
  });

  it("says of Anthropic and OpenAI exactly what it said", () => {
    for (const [id, label] of [
      ["anthropic", "Anthropic"],
      ["openai", "OpenAI"],
    ] as const) {
      expect(listFooter(id, state(), 11)).toBe(
        "Pick a key to see every model it can use. Until then this is the built-in list; any model id can be typed.",
      );
      expect(listFooter(id, state({ hasKey: true, loading: true }), 11)).toBe(`Asking ${label} what this key can use…`);
      expect(listFooter(id, state({ hasKey: true, keyModels: [row("a"), row("b")] }), 2)).toBe(
        `2 models this key can use, from ${label}.`,
      );
      expect(
        listFooter(
          id,
          state({ hasKey: true, keyError: `${label} no longer accepts this key. Replace it under Settings, LLM API keys.` }),
          11,
        ),
      ).toBe(
        `${label} no longer accepts this key. Replace it under Settings, LLM API keys. This is the built-in list; any model id can be typed.`,
      );
      expect(listFooter(id, state({ hasKey: true }), 11)).toBe(
        `Couldn't get the list from ${label} just now. This is the built-in list; any model id can be typed.`,
      );
    }
  });
});

describe("the footer, for every provider", () => {
  it("never credits the provider with rows that are only the fallback", () => {
    for (const id of CATALOGUE_IDS) {
      const label = CATALOGUE[id].label;
      const fallbacks = [
        state(),
        state({ hasKey: true }),
        state({ hasKey: true, keyError: "Could not read this key. The built-in list is shown instead." }),
        state({ publicList: { models: [...CATALOGUE[id].models], live: false } }),
      ];
      for (const fallback of fallbacks) {
        const footer = listFooter(id, fallback, CATALOGUE[id].models.length);
        expect(footer, id).not.toContain("own list");
        expect(footer, id).not.toContain("this key can use, from");
        // And it always says the way out: an id can be typed.
        expect(footer.toLowerCase(), id).toContain("any model id can be typed");
      }
      // The provider is named by the registry's name for it.
      expect(listFooter(id, state({ hasKey: true }), 3), id).toContain(label);
    }
  });

  it("names the provider as the source only when its list really answered", () => {
    for (const id of idsWith("public")) {
      const live = state({ publicList: { models: [row("a"), row("b")], live: true } });
      expect(listFooter(id, live, 2), id).toBe(
        `2 models that can run an agent, from ${CATALOGUE[id].label}'s own list.`,
      );
      expect(listFooter(id, state({ loading: true }), 2), id).toBe(`Loading ${CATALOGUE[id].label}'s list…`);
    }
    for (const id of idsWith("by-key")) {
      const answered = state({ hasKey: true, keyModels: [row("a"), row("b"), row("c")] });
      expect(listFooter(id, answered, 3), id).toBe(`3 models this key can use, from ${CATALOGUE[id].label}.`);
    }
  });

  it("says a built-in list is kept by hand, key or no key", () => {
    for (const id of idsWith("built-in")) {
      const footer = `This list is kept by hand: ${CATALOGUE[id].label} has none Tocker can read that says which models can run an agent. Any model id can be typed.`;
      expect(listFooter(id, state(), 10), id).toBe(footer);
      expect(listFooter(id, state({ hasKey: true, loading: true }), 10), id).toBe(footer);
    }
    for (const value of NOT_PROVIDERS) {
      expect(listFooter(value, state(), 0), value).toBe(
        "There is no model list for this provider. Any model id can be typed.",
      );
    }
  });
});

describe("reading the public list route's answer", () => {
  it("keeps well-formed rows as they are", () => {
    const models = [
      { id: "vendor/model-a", label: "Vendor: Model A", inputPerMTok: 0.5, outputPerMTok: 1.5 },
      { id: "model-b", label: "Model B" },
      { id: "free-model:free", label: "Free", inputPerMTok: 0, outputPerMTok: 0 },
    ];
    expect(readPublicList({ models, live: true })).toEqual({ models, live: true });
    expect(readPublicList({ models, live: false })).toEqual({ models, live: false });
  });

  it("drops what could not be a model, and what it has already seen", () => {
    const read = readPublicList({
      live: true,
      models: [
        null,
        "model-as-a-string",
        42,
        {},
        { id: 7, label: "A number for an id" },
        { id: "has spaces in it", label: "Not an id" },
        { id: "up/../and/out", label: "Two dots" },
        { id: "x".repeat(101), label: "Too long" },
        { id: "kept", label: "  Kept  " },
        { id: "kept", label: "Kept again" },
        { id: "no-label" },
        { id: "blank-label", label: "   " },
        { id: "long-label", label: "L".repeat(500) },
      ],
    });
    expect(read.models.map((model) => model.id)).toEqual(["kept", "no-label", "blank-label", "long-label"]);
    expect(read.models[0].label).toBe("Kept");
    // A row with no name is shown by its id rather than blank.
    expect(read.models[1].label).toBe("no-label");
    expect(read.models[2].label).toBe("blank-label");
    expect(read.models[3].label).toHaveLength(120);
    for (const model of read.models) expect(isModelId(model.id), model.id).toBe(true);
  });

  it("keeps a price only when both halves are real numbers", () => {
    const read = readPublicList({
      live: true,
      models: [
        { id: "a", label: "A", inputPerMTok: 1 },
        { id: "b", label: "B", inputPerMTok: "1", outputPerMTok: "2" },
        { id: "c", label: "C", inputPerMTok: -1, outputPerMTok: 2 },
        { id: "d", label: "D", inputPerMTok: Number.NaN, outputPerMTok: 2 },
        { id: "e", label: "E", inputPerMTok: 1, outputPerMTok: Number.POSITIVE_INFINITY },
        { id: "f", label: "F", inputPerMTok: 1, outputPerMTok: 2, somethingElse: "ignored" },
      ],
    });
    expect(read.models).toEqual([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
      { id: "e", label: "E" },
      { id: "f", label: "F", inputPerMTok: 1, outputPerMTok: 2 },
    ]);
  });

  it("answers an empty list, and not a live one, for a body of the wrong shape", () => {
    for (const body of [null, undefined, "", "error", 5, [], {}, { models: "x", live: true }, { error: "unauthenticated" }]) {
      expect(readPublicList(body)).toEqual({ models: [], live: false });
    }
    // Live means the provider's own list answered with something: an empty one is not that.
    expect(readPublicList({ models: [], live: true }).live).toBe(false);
    expect(readPublicList({ models: [{ id: "a", label: "A" }], live: "true" }).live).toBe(false);
    expect(readPublicList({ models: [{ id: "a", label: "A" }], live: 1 }).live).toBe(false);
  });

  it("stops at a thousand rows", () => {
    const models = Array.from({ length: 1_500 }, (_, index) => ({ id: `model-${index}`, label: `Model ${index}` }));
    expect(readPublicList({ models, live: true }).models).toHaveLength(1_000);
  });
});

describe("a model's name, where the provider is known", () => {
  it("is what it always was for every model of the three", () => {
    for (const id of THREE) {
      for (const model of CATALOGUE[id].models) {
        expect(modelNameOn(id, model.id), model.id).toBe(knownModelLabel(model.id));
        // The owner's summary keeps printing the name the header prints for these.
        expect(ownListModelName(id, model.id), model.id).toBeNull();
      }
      // An id the three lists never had gets no name here either.
      for (const unknown of ["z-ai/glm-5.3", "mistral/mistral-large-2", "something-new", ""]) {
        expect(modelNameOn(id, unknown), `${id} ${unknown}`).toBe(knownModelLabel(unknown));
        expect(modelNameOn(id, unknown), `${id} ${unknown}`).toBeNull();
        expect(ownListModelName(id, unknown), `${id} ${unknown}`).toBeNull();
      }
    }
  });

  it("is never lost for a model the lookup without a provider already names", () => {
    for (const id of CATALOGUE_IDS) {
      for (const model of CATALOGUE[id].models) {
        const before = knownModelLabel(model.id);
        if (before !== null) expect(modelNameOn(id, model.id), `${id} ${model.id}`).toBe(before);
      }
    }
  });

  it("is found in the provider's own list when the lookup without a provider has none", () => {
    const fireworks = CATALOGUE.fireworks.defaultModel;
    expect(knownModelLabel(fireworks)).toBeNull();
    expect(modelNameOn("fireworks", fireworks)).toBe("GLM 5.3");
    expect(ownListModelName("fireworks", fireworks)).toBe("GLM 5.3");
    // The same id on a provider that does not list it has no name.
    expect(modelNameOn("groq", fireworks)).toBeNull();
    expect(modelNameOn("nope", fireworks)).toBeNull();
  });

  it("names the model every provider starts on", () => {
    for (const id of CATALOGUE_IDS) expect(modelNameOn(id, CATALOGUE[id].defaultModel), id).not.toBeNull();
  });
});
