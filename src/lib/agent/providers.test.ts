import { describe, expect, it } from "vitest";
import { isModelId } from "./models";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  PROVIDER_IDS,
  PROVIDER_ORDER,
  PROVIDER_UNSUPPORTED,
  filterProviders,
  isCatalogueId,
  isProvider,
  keyPrefixProvider,
  keyProblem,
  providerLabel,
  providerRow,
  providersInOrder,
  requestTemperature,
  searchProviders,
  withArticle,
  wrongProviderSentence,
  type CatalogueId,
} from "./providers";

/**
 * Stand-ins for keys, put together at run time: nothing key-shaped is written out in a
 * tracked file (`repo-secrets.test.ts`). The body has capitals and digits, as a key does.
 */
const body = (length: number) => "Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV".repeat(4).slice(0, length);
const keyWith = (prefix: string) => `${prefix}${body(40)}`;
/** A key no provider's prefix is on. */
const PLAIN = body(40);
/** A legacy OpenAI key, a DeepSeek key and others all look like this. */
const BARE_SK = `sk-${body(40)}`;

const rows = CATALOGUE_IDS.map((id) => CATALOGUE[id]);
/**
 * The rows that are not switched on. Asked through a plain yes-or-no so the list keeps
 * its type: once every provider is enabled it is simply empty, and what loops over it
 * checks nothing instead of failing to compile.
 */
const enabled = (id: string): boolean => isProvider(id);
const notEnabled: CatalogueId[] = CATALOGUE_IDS.filter((id) => !enabled(id));

describe("every row of the registry", () => {
  it("has a row for each of the nineteen ids, filed under its own id", () => {
    expect(CATALOGUE_IDS).toHaveLength(19);
    expect(new Set(CATALOGUE_IDS).size).toBe(19);
    expect(Object.keys(CATALOGUE).sort()).toEqual([...CATALOGUE_IDS].sort());
    for (const id of CATALOGUE_IDS) expect(CATALOGUE[id].id, id).toBe(id);
  });

  it("has a label, an article and a placeholder for the key field", () => {
    for (const row of rows) {
      expect(row.label.trim(), row.id).toBe(row.label);
      expect(row.label.length, row.id).toBeGreaterThan(1);
      expect(["a", "an"], row.id).toContain(row.article);
      expect(row.keyHint.length, row.id).toBeGreaterThan(0);
      for (const word of row.search) expect(word, row.id).toBe(word.toLowerCase());
    }
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length);
  });

  /** The origin is the one host a key is sent to; a path, a port or a login in it would widen that. */
  it("names one https origin, and nothing but an origin", () => {
    for (const row of rows) {
      const url = new URL(row.origin);
      expect(url.protocol, row.id).toBe("https:");
      expect(url.origin, row.id).toBe(row.origin);
      expect(url.username + url.password + url.port, row.id).toBe("");
      // A name, never an address a redirect or a typo could turn into something local.
      expect(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname), row.id).toBe(true);
    }
    expect(new Set(rows.map((row) => row.origin)).size).toBe(rows.length);
  });

  it("gives the SDK a base URL on that same origin, with no query and no trailing slash", () => {
    for (const row of rows) {
      const url = new URL(row.baseUrl);
      expect(url.origin, row.id).toBe(row.origin);
      expect(url.search + url.hash, row.id).toBe("");
      expect(row.baseUrl.endsWith("/"), row.id).toBe(false);
      expect(row.baseUrl.startsWith(row.origin), row.id).toBe(true);
    }
  });

  it("links to an https page where a key is made", () => {
    for (const row of rows) {
      expect(new URL(row.keyPage).protocol, row.id).toBe("https:");
      expect(/\s/.test(row.keyPage), row.id).toBe(false);
    }
  });

  it("starts on a model that its own list offers", () => {
    for (const row of rows) {
      expect(row.models.length, row.id).toBeGreaterThan(0);
      expect(row.models.map((model) => model.id), row.id).toContain(row.defaultModel);
    }
  });

  it("lists nothing twice, nothing that could not be sent as a model id, and a price on every model", () => {
    for (const row of rows) {
      const ids = row.models.map((model) => model.id);
      expect(new Set(ids).size, row.id).toBe(ids.length);
      expect(ids.length, row.id).toBeLessThanOrEqual(row.id === "openai" || row.id === "anthropic" ? 40 : 10);
      for (const model of row.models) {
        const at = `${row.id} ${model.id}`;
        expect(isModelId(model.id), at).toBe(true);
        expect(model.label.length, at).toBeGreaterThan(0);
        expect(typeof model.inputPerMTok, at).toBe("number");
        expect(typeof model.outputPerMTok, at).toBe("number");
        expect(model.inputPerMTok, at).toBeGreaterThanOrEqual(0);
        expect(model.outputPerMTok, at).toBeGreaterThanOrEqual(model.inputPerMTok ?? 0);
      }
    }
  });

  it("says where the model list comes from, and how a run treats the temperature", () => {
    for (const row of rows) {
      expect(["by-key", "public", "built-in"], row.id).toContain(row.modelList);
      if (typeof row.temperature === "object") {
        expect(row.temperature.max, row.id).toBeGreaterThan(0);
        expect(row.temperature.max, row.id).toBeLessThan(2);
      } else {
        expect(["send", "omit"], row.id).toContain(row.temperature);
      }
      if (row.maxOutputTokens !== undefined) {
        expect(Number.isInteger(row.maxOutputTokens), row.id).toBe(true);
        expect(row.maxOutputTokens, row.id).toBeGreaterThanOrEqual(1024);
      }
      for (const part of row.fixedSampling ?? []) expect(part, row.id).toBe(part.toLowerCase());
    }
  });

  it("keeps a note to one plain line", () => {
    for (const row of rows) {
      if (row.note === undefined) continue;
      expect(row.note.includes("\n"), row.id).toBe(false);
      expect(row.note.trim(), row.id).toBe(row.note);
      expect(/[.”]$/.test(row.note), row.id).toBe(true);
      expect(row.note.length, row.id).toBeLessThan(180);
    }
  });

  /**
   * A prefix decides whose key a string is, so it can belong to one provider only, and
   * one may not be the start of another's: `sk-` on a row would claim every `sk-ant-` key.
   */
  it("shares no key prefix between two providers, and lets none shadow another", () => {
    const owned = rows.flatMap((row) => row.keyPrefixes.map((prefix) => ({ id: row.id, prefix })));
    for (const { prefix, id } of owned) {
      expect(prefix.length, id).toBeGreaterThanOrEqual(3);
      expect(/\s/.test(prefix), id).toBe(false);
    }
    for (const a of owned) {
      for (const b of owned) {
        if (a.id === b.id) continue;
        expect(a.prefix.startsWith(b.prefix), `${a.id} ${a.prefix} / ${b.id} ${b.prefix}`).toBe(false);
      }
    }
    // The bare prefix half the industry uses is nobody's.
    expect(owned.map((entry) => entry.prefix)).not.toContain("sk-");
  });

  it("demands a prefix only where it has one to demand", () => {
    for (const row of rows) if (row.requiresPrefix) expect(row.keyPrefixes.length, row.id).toBeGreaterThan(0);
    // The two whose own documentation says every key carries it.
    expect(rows.filter((row) => row.requiresPrefix).map((row) => row.id).sort()).toEqual(["cerebras", "novita"]);
  });

  /**
   * One row may send its key to a second host, for the key check alone: Hugging Face's
   * router cannot say whether a token is good and the Hub can. Any other row gaining one
   * is a second place a key can go, and should be argued for here.
   */
  it("lets only Hugging Face's key check leave its origin, and only for the Hub", () => {
    expect(rows.filter((row) => row.keyCheckOrigin !== undefined).map((row) => row.id)).toEqual(["huggingface"]);
    expect(CATALOGUE.huggingface.keyCheckOrigin).toBe("https://huggingface.co");
    expect(CATALOGUE.huggingface.origin).toBe("https://router.huggingface.co");
  });
});

describe("the providers a key can be added for", () => {
  /** Widening `PROVIDER_IDS` adds to this list; it never reorders or drops the first three. */
  it("still starts with the three there have always been, in their order", () => {
    expect(PROVIDER_IDS.slice(0, 3)).toEqual(["anthropic", "openai", "openrouter"]);
    expect(new Set<string>(PROVIDER_IDS).size).toBe(PROVIDER_IDS.length);
    for (const id of PROVIDER_IDS) expect(isCatalogueId(id), id).toBe(true);
  });

  it("answers by membership, for any value a form or a row might hold", () => {
    for (const id of PROVIDER_IDS) expect(isProvider(id), id).toBe(true);
    for (const id of notEnabled) expect(isProvider(id), id).toBe(false);
    for (const value of ["", "Anthropic", " anthropic", "constructor", "__proto__", "toString", "hasOwnProperty", null, undefined, 0, {}, ["openai"]]) {
      expect(isProvider(value), String(value)).toBe(false);
      expect(isCatalogueId(value), String(value)).toBe(false);
    }
  });

  it("finds a row by id and refuses, in a sentence, an id that has none", () => {
    for (const id of CATALOGUE_IDS) expect(providerRow(id)).toBe(CATALOGUE[id]);
    for (const stale of ["cohere", "constructor", "__proto__", ""]) {
      expect(() => providerRow(stale as CatalogueId), stale).toThrow(PROVIDER_UNSUPPORTED);
    }
    expect(PROVIDER_UNSUPPORTED).toMatch(/^This key's provider is no longer supported\./);
  });

  it("names a provider as its brand does, and leaves an unknown id as it is stored", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("xai")).toBe("xAI");
    expect(providerLabel("huggingface")).toBe("Hugging Face");
    expect(providerLabel("cohere")).toBe("cohere");
    expect(providerLabel("constructor")).toBe("constructor");
  });

  it("puts the right article in front, by sound and not by spelling", () => {
    expect(withArticle("openai")).toBe("an OpenAI");
    expect(withArticle("anthropic")).toBe("an Anthropic");
    expect(withArticle("xai")).toBe("an xAI");
    expect(withArticle("groq")).toBe("a Groq");
    expect(withArticle("huggingface")).toBe("a Hugging Face");
    expect(withArticle("zai")).toBe("a Z.AI");
    expect(withArticle("acme")).toBe("an acme");
    expect(withArticle("cohere")).toBe("a cohere");
  });
});

describe("display order and search", () => {
  it("leads with the five people look for, then the rest by name", () => {
    expect(providersInOrder(CATALOGUE_IDS)).toEqual([
      "anthropic",
      "openai",
      "google",
      "xai",
      "openrouter",
      "cerebras",
      "deepinfra",
      "deepseek",
      "fireworks",
      "groq",
      "huggingface",
      "mistral",
      "moonshot",
      "nebius",
      "novita",
      "together",
      "venice",
      "vercel",
      "zai",
    ]);
  });

  it("orders whatever it is given, and adds nothing to it", () => {
    expect(providersInOrder(["openrouter", "openai", "anthropic"])).toEqual(["anthropic", "openai", "openrouter"]);
    expect(providersInOrder(["zai", "groq", "xai"])).toEqual(["xai", "groq", "zai"]);
    expect(providersInOrder([])).toEqual([]);
  });

  it("lists exactly the enabled providers, in that order", () => {
    expect(PROVIDER_ORDER).toEqual(providersInOrder(PROVIDER_IDS));
    expect([...PROVIDER_ORDER].sort()).toEqual([...PROVIDER_IDS].sort());
    expect(filterProviders("")).toEqual(PROVIDER_ORDER);
    expect(filterProviders("   ")).toEqual(PROVIDER_ORDER);
  });

  const all = providersInOrder(CATALOGUE_IDS);

  it("finds a provider by its name, its id or the words people know it by", () => {
    expect(searchProviders(all, "claude")).toEqual(["anthropic"]);
    expect(searchProviders(all, "GPT")).toEqual(["openai"]);
    expect(searchProviders(all, "gemini")).toEqual(["google"]);
    expect(searchProviders(all, "grok")).toEqual(["xai"]);
    expect(searchProviders(all, "spacexai")).toEqual(["xai"]);
    expect(searchProviders(all, "groq")).toEqual(["groq"]);
    expect(searchProviders(all, "kimi")).toEqual(["moonshot"]);
    expect(searchProviders(all, "zhipu")).toEqual(["zai"]);
    expect(searchProviders(all, "hf")).toEqual(["huggingface"]);
    expect(searchProviders(all, "gateway ai")).toEqual(["vercel"]);
    expect(searchProviders(all, "token factory")).toEqual(["nebius"]);
    expect(searchProviders(all, "ai studio")).toEqual(["google", "nebius"]);
  });

  it("keeps the display order, and returns nothing for no match", () => {
    expect(searchProviders(all, "deep")).toEqual(["deepinfra", "deepseek"]);
    expect(searchProviders(all, "open")).toEqual(["openai", "openrouter"]);
    expect(searchProviders(all, "cohere")).toEqual([]);
  });

  /** The chooser never offers a provider a key cannot be added for. */
  it("searches only the enabled providers from the chooser", () => {
    expect(filterProviders("claude")).toEqual(["anthropic"]);
    expect(filterProviders("open")).toEqual(["openai", "openrouter"]);
    expect(filterProviders("grok")).toEqual(enabled("xai") ? ["xai"] : []);
    for (const id of notEnabled) expect(filterProviders(CATALOGUE[id].label), id).not.toContain(id);
  });
});

describe("keyPrefixProvider", () => {
  it("reads every prefix on every row", () => {
    for (const row of rows) {
      for (const prefix of row.keyPrefixes) expect(keyPrefixProvider(keyWith(prefix)), prefix).toBe(row.id);
    }
  });

  it("ignores whitespace around a pasted key, and is exact about case", () => {
    expect(keyPrefixProvider(`  ${keyWith("gsk_")}\n`)).toBe("groq");
    expect(keyPrefixProvider(keyWith("GSK_"))).toBeNull();
    expect(keyPrefixProvider(keyWith("SK-ANT-"))).toBeNull();
  });

  it("names nobody for a bare sk- key, an unprefixed key, or nothing", () => {
    expect(keyPrefixProvider(BARE_SK)).toBeNull();
    expect(keyPrefixProvider(PLAIN)).toBeNull();
    expect(keyPrefixProvider("")).toBeNull();
    expect(keyPrefixProvider(`wrkspc_${body(20)}`)).toBeNull();
  });
});

describe("keyProblem", () => {
  /** The rule that keeps one provider's credential from being handed to another. */
  it("refuses a key that starts the way another provider's keys do, under every provider", () => {
    for (const owner of rows) {
      for (const prefix of owner.keyPrefixes) {
        const key = keyWith(prefix);
        for (const chosen of CATALOGUE_IDS) {
          const said = keyProblem(chosen, key);
          if (chosen === owner.id) expect(said, `${prefix} under ${chosen}`).toBeNull();
          else expect(said, `${prefix} under ${chosen}`).toContain(`That looks like ${owner.article} ${owner.label} key`);
        }
      }
    }
  });

  it("refuses the examples the brief names", () => {
    expect(keyProblem("openai", keyWith("gsk_"))).toContain("That looks like a Groq key, not an OpenAI one");
    expect(keyProblem("groq", keyWith("sk-ant-"))).toBe(
      "That looks like an Anthropic key, not a Groq one — choose Anthropic as the provider",
    );
    expect(keyProblem("cerebras", PLAIN)).toBe(
      "Cerebras keys start with csk- — check you copied all of it, or choose the provider this key is from",
    );
  });

  it("refuses a key without the prefix its provider documents, and only there", () => {
    expect(keyProblem("cerebras", BARE_SK)).toContain("Cerebras keys start with csk-");
    expect(keyProblem("novita", PLAIN)).toContain("Novita AI keys start with sk_");
    expect(keyProblem("novita", BARE_SK)).toContain("Novita AI keys start with sk_");
    expect(keyProblem("cerebras", keyWith("csk-"))).toBeNull();
    expect(keyProblem("novita", keyWith("sk_"))).toBeNull();
    expect(keyProblem("cerebras", PLAIN, "rotate")).toBe("Cerebras keys start with csk- — check you copied all of it");
  });

  /** Most providers publish no format, and Google's is changing: nothing is refused for its shape. */
  it("never refuses a key for its length, its characters or a prefix that is only usually there", () => {
    for (const row of rows) {
      if (row.requiresPrefix) continue;
      for (const key of [PLAIN, BARE_SK, "x".repeat(16), body(400), `${body(8)}.${body(8)}-${body(8)}_${body(8)}`]) {
        expect(keyProblem(row.id, key), `${row.id} ${key.slice(0, 6)}`).toBeNull();
      }
    }
  });

  it("says what to do with a key for a provider that is offered, and stops short for one that is not", () => {
    expect(wrongProviderSentence("openai", "anthropic")).toBe(
      "That looks like an OpenAI key, not an Anthropic one — choose OpenAI as the provider",
    );
    expect(wrongProviderSentence("anthropic", "openai", "rotate")).toBe(
      "That looks like an Anthropic key; this is an OpenAI key — add it as a new key instead",
    );
    for (const id of notEnabled) {
      const label = CATALOGUE[id].label;
      expect(wrongProviderSentence(id, "openai"), id).toBe(
        `That looks like ${CATALOGUE[id].article} ${label} key, not an OpenAI one. Tocker cannot use ${label} keys`,
      );
      expect(wrongProviderSentence(id, "openai", "rotate"), id).toBe(
        `That looks like ${CATALOGUE[id].article} ${label} key; this is an OpenAI key. Tocker cannot use ${label} keys`,
      );
    }
  });

  /** A refusal is shown and may be logged: it must never carry the key it is about. */
  it("never repeats the key in what it says", () => {
    for (const chosen of CATALOGUE_IDS) {
      for (const key of [PLAIN, BARE_SK, ...rows.flatMap((row) => row.keyPrefixes.map(keyWith))]) {
        expect(keyProblem(chosen, key) ?? "", chosen).not.toContain(body(12));
      }
    }
  });
});

describe("requestTemperature", () => {
  it("sends the agent's setting where the provider takes one", () => {
    for (const id of ["xai", "groq", "cerebras", "fireworks", "novita"] as const) {
      for (const value of [0, 0.4, 1, 2]) expect(requestTemperature(id, value), id).toBe(value);
    }
  });

  it("sends none where the provider ignores it or advises against one", () => {
    for (const id of ["google", "deepseek", "moonshot", "vercel"] as const) {
      for (const value of [0, 0.4, 2]) expect(requestTemperature(id, value), id).toBeUndefined();
    }
  });

  it("holds the setting to the most the provider accepts", () => {
    expect(requestTemperature("mistral", 2)).toBe(1.5);
    expect(requestTemperature("mistral", 1.5)).toBe(1.5);
    expect(requestTemperature("mistral", 0.4)).toBe(0.4);
    expect(requestTemperature("zai", 2)).toBe(1);
    expect(requestTemperature("zai", 0.4)).toBe(0.4);
    expect(requestTemperature("zai", 0)).toBe(0);
  });

  /** Kimi fixes its own sampling, so no host that serves it is sent a temperature for it. */
  it("leaves a model that fixes its own sampling alone, on the hosts that serve it", () => {
    for (const row of rows) {
      const kimi = row.models.filter((model) => model.id.toLowerCase().includes("kimi"));
      for (const model of kimi) {
        if (row.id === "openrouter") continue;
        expect(requestTemperature(row.id, 0.4, model.id), `${row.id} ${model.id}`).toBeUndefined();
      }
    }
    expect(requestTemperature("together", 0.4, "moonshotai/Kimi-K3")).toBeUndefined();
    expect(requestTemperature("together", 0.4, "zai-org/GLM-5.3")).toBe(0.4);
    expect(requestTemperature("together", 0.4)).toBe(0.4);
    expect(requestTemperature("together", 0.4, null)).toBe(0.4);
  });
});

/**
 * Nothing changes for a key or an agent already on Anthropic, OpenAI or OpenRouter. Their
 * rows are pinned here value for value: a change to one of them is a change to what
 * existing agents are sent, shown or priced at, and has to be made on purpose.
 */
describe("the three providers there were before", () => {
  it("keeps their names, hosts, key pages and placeholders", () => {
    const pinned = (["anthropic", "openai", "openrouter"] as const).map((id) => {
      const { label, article, keyHint, keyPage, origin, baseUrl, modelList, defaultModel } = CATALOGUE[id];
      return { id, label, article, keyHint, keyPage, origin, baseUrl, modelList, defaultModel };
    });
    expect(pinned).toEqual([
      {
        id: "anthropic",
        label: "Anthropic",
        article: "an",
        keyHint: "sk-ant-…",
        keyPage: "https://console.anthropic.com/settings/keys",
        origin: "https://api.anthropic.com",
        baseUrl: "https://api.anthropic.com/v1",
        modelList: "by-key",
        defaultModel: "claude-sonnet-5-5",
      },
      {
        id: "openai",
        label: "OpenAI",
        article: "an",
        keyHint: "sk-…",
        keyPage: "https://platform.openai.com/api-keys",
        origin: "https://api.openai.com",
        baseUrl: "https://api.openai.com/v1",
        modelList: "by-key",
        defaultModel: "gpt-5",
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        article: "an",
        keyHint: "sk-or-…",
        keyPage: "https://openrouter.ai/keys",
        origin: "https://openrouter.ai",
        baseUrl: "https://openrouter.ai/api/v1",
        modelList: "public",
        defaultModel: "anthropic/claude-sonnet-5.5",
      },
    ]);
  });

  it("recognises the same key prefixes, and demands none", () => {
    expect(CATALOGUE.anthropic.keyPrefixes).toEqual(["sk-ant-"]);
    expect(CATALOGUE.openai.keyPrefixes).toEqual(["sk-proj-", "sk-svcacct-", "sk-admin-"]);
    expect(CATALOGUE.openrouter.keyPrefixes).toEqual(["sk-or-"]);
    for (const id of ["anthropic", "openai", "openrouter"] as const) {
      expect(CATALOGUE[id].requiresPrefix, id).toBe(false);
      // A bare sk- key and a key with no prefix were never refused before a request.
      expect(keyProblem(id, BARE_SK), id).toBeNull();
      expect(keyProblem(id, PLAIN), id).toBeNull();
    }
  });

  it("sends the configured temperature untouched, sets no output limit and adds no note", () => {
    for (const id of ["anthropic", "openai", "openrouter"] as const) {
      const row = CATALOGUE[id];
      expect(row.temperature, id).toBe("send");
      expect(row.maxOutputTokens, id).toBeUndefined();
      expect(row.fixedSampling, id).toBeUndefined();
      expect(row.keyCheckOrigin, id).toBeUndefined();
      expect(row.note, id).toBeUndefined();
      for (const value of [0, 0.4, 1.7, 2]) {
        expect(requestTemperature(id, value), id).toBe(value);
        for (const model of row.models) expect(requestTemperature(id, value, model.id), model.id).toBe(value);
      }
      // Kimi through OpenRouter is sent what it always was.
      expect(requestTemperature("openrouter", 0.4, "moonshotai/kimi-k3")).toBe(0.4);
    }
  });

  it("refuses each other's keys in the words it always used", () => {
    expect(keyProblem("anthropic", keyWith("sk-proj-"))).toBe(
      "That looks like an OpenAI key, not an Anthropic one — choose OpenAI as the provider",
    );
    expect(keyProblem("openai", keyWith("sk-or-"))).toBe(
      "That looks like an OpenRouter key, not an OpenAI one — choose OpenRouter as the provider",
    );
    expect(keyProblem("openai", keyWith("sk-ant-"), "rotate")).toBe(
      "That looks like an Anthropic key; this is an OpenAI key — add it as a new key instead",
    );
    for (const id of ["anthropic", "openai", "openrouter"] as const) {
      for (const prefix of CATALOGUE[id].keyPrefixes) expect(keyProblem(id, keyWith(prefix)), prefix).toBeNull();
    }
  });

  it("offers the same models, in the same order, at the same prices", () => {
    const table = (id: CatalogueId) =>
      CATALOGUE[id].models.map((model) => [model.id, model.label, model.inputPerMTok, model.outputPerMTok]);
    expect(table("anthropic")).toEqual([
      ["claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 10],
      ["claude-opus-5-5", "Claude Opus 5.5", 4, 20],
      ["claude-fable-5-1", "Claude Fable 5.1", 10, 50],
      ["claude-haiku-4-5-20251001", "Claude Haiku 4.5", 1, 5],
      ["claude-sonnet-5", "Claude Sonnet 5", 2, 10],
      ["claude-opus-5", "Claude Opus 5", 5, 25],
      ["claude-fable-5", "Claude Fable 5", 10, 50],
      ["claude-opus-4-8", "Claude Opus 4.8", 5, 25],
      ["claude-opus-4-7", "Claude Opus 4.7", 5, 25],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6", 3, 15],
      ["claude-opus-4-6", "Claude Opus 4.6", 5, 25],
    ]);
    expect(table("openai")).toEqual([
      ["gpt-6.1-sol", "GPT-6.1 Sol", 2, 10],
      ["gpt-6.1-sol-pro", "GPT-6.1 Sol Pro", 2, 10],
      ["gpt-6-sol", "GPT-6 Sol", 2, 10],
      ["gpt-6-sol-pro", "GPT-6 Sol Pro", 2, 10],
      ["gpt-6-luna", "GPT-6 Luna", 0.1, 0.5],
      ["gpt-6-luna-pro", "GPT-6 Luna Pro", 0.1, 0.5],
      ["gpt-6-astra", "GPT-6 Astra", 10, 50],
      ["gpt-6-astra-pro", "GPT-6 Astra Pro", 10, 50],
      ["gpt-5.6-sol", "GPT-5.6 Sol", 2, 10],
      ["gpt-5.6-sol-pro", "GPT-5.6 Sol Pro", 2, 10],
      ["gpt-5.6-terra", "GPT-5.6 Terra", 2, 12],
      ["gpt-5.6-terra-pro", "GPT-5.6 Terra Pro", 2, 12],
      ["gpt-5.6-luna", "GPT-5.6 Luna", 0.2, 1.2],
      ["gpt-5.6-luna-pro", "GPT-5.6 Luna Pro", 0.2, 1.2],
      ["gpt-5.5", "GPT-5.5", 5, 30],
      ["gpt-5.5-pro", "GPT-5.5 Pro", 30, 180],
      ["gpt-5.4", "GPT-5.4", 2.5, 15],
      ["gpt-5.4-mini", "GPT-5.4 Mini", 0.75, 4.5],
      ["gpt-5.4-nano", "GPT-5.4 Nano", 0.2, 1.25],
      ["gpt-5.4-pro", "GPT-5.4 Pro", 30, 180],
      ["gpt-5.2", "GPT-5.2", 1.75, 14],
      ["gpt-5.1", "GPT-5.1", 1.25, 10],
      ["gpt-5", "GPT-5", 1.25, 10],
      ["gpt-5-mini", "GPT-5 mini", 0.25, 2],
      ["gpt-5-nano", "GPT-5 nano", 0.05, 0.4],
      ["gpt-4.1", "GPT-4.1", 2, 8],
      ["gpt-4.1-mini", "GPT-4.1 Mini", 0.4, 1.6],
      ["o3", "o3", 2, 8],
      ["o4-mini", "o4 Mini", 1.1, 4.4],
    ]);
    expect(table("openrouter")).toEqual([
      ["anthropic/claude-sonnet-5.5", "Anthropic: Claude Sonnet 5.5", 2, 10],
      ["anthropic/claude-sonnet-5", "Anthropic: Claude Sonnet 5", 2, 10],
      ["anthropic/claude-opus-5.5", "Anthropic: Claude Opus 5.5", 4, 20],
      ["openai/gpt-6.1-sol", "OpenAI: GPT-6.1 Sol", 2, 10],
      ["openai/gpt-6-luna", "OpenAI: GPT-6 Luna", 0.1, 0.5],
      ["google/gemini-3.8-flash", "Google: Gemini 3.8 Flash", 0.75, 3.75],
      ["x-ai/grok-4.7", "SpaceXAI: Grok 4.7", 2, 6],
      ["deepseek/deepseek-v4.1-flash", "DeepSeek: DeepSeek V4.1 Flash", 0.055, 1.32],
    ]);
  });
});

/** What the research found for the sixteen, where a wrong value would cost a key or a run. */
describe("the sixteen providers added", () => {
  it("sends each key to the host its provider documents", () => {
    const hosts = Object.fromEntries(notEnabledOrAdded().map((id) => [id, CATALOGUE[id].baseUrl]));
    expect(hosts).toEqual({
      google: "https://generativelanguage.googleapis.com/v1beta",
      xai: "https://api.x.ai/v1",
      deepseek: "https://api.deepseek.com",
      mistral: "https://api.mistral.ai/v1",
      moonshot: "https://api.moonshot.ai/v1",
      zai: "https://api.z.ai/api/paas/v4",
      groq: "https://api.groq.com/openai/v1",
      cerebras: "https://api.cerebras.ai/v1",
      together: "https://api.together.ai/v1",
      fireworks: "https://api.fireworks.ai/inference/v1",
      deepinfra: "https://api.deepinfra.com/v1",
      vercel: "https://ai-gateway.vercel.sh/v4/ai",
      venice: "https://api.venice.ai/api/v1",
      nebius: "https://api.tokenfactory.nebius.com/v1",
      novita: "https://api.novita.ai/openai/v1",
      huggingface: "https://router.huggingface.co/v1",
    });
  });

  it("knows whose keys start with what", () => {
    const prefixes = Object.fromEntries(
      notEnabledOrAdded()
        .filter((id) => CATALOGUE[id].keyPrefixes.length > 0)
        .map((id) => [id, CATALOGUE[id].keyPrefixes]),
    );
    expect(prefixes).toEqual({
      google: ["AIza", "AQ."],
      xai: ["xai-"],
      groq: ["gsk_"],
      cerebras: ["csk-"],
      fireworks: ["fw_"],
      vercel: ["vck_"],
      novita: ["sk_"],
      huggingface: ["hf_"],
    });
  });

  it("gets each model list the way that provider allows", () => {
    const by = (source: string) => notEnabledOrAdded().filter((id) => CATALOGUE[id].modelList === source);
    expect(by("by-key")).toEqual(["google", "xai", "deepseek", "mistral", "moonshot", "groq", "fireworks", "nebius"]);
    expect(by("public")).toEqual(["cerebras", "deepinfra", "vercel", "venice", "novita", "huggingface"]);
    expect(by("built-in")).toEqual(["zai", "together"]);
  });

  it("sets an output limit only where the provider needs one", () => {
    expect(notEnabledOrAdded().filter((id) => CATALOGUE[id].maxOutputTokens !== undefined)).toEqual(["cerebras", "novita"]);
  });

  it("starts each on the model the research chose", () => {
    expect(Object.fromEntries(notEnabledOrAdded().map((id) => [id, CATALOGUE[id].defaultModel]))).toEqual({
      google: "gemini-3.8-flash",
      xai: "grok-4.7",
      deepseek: "deepseek-flash",
      mistral: "mistral-medium-latest",
      moonshot: "kimi-k3",
      zai: "glm-5.3",
      groq: "openai/gpt-oss-120b",
      cerebras: "gpt-oss-120b",
      together: "zai-org/GLM-5.3",
      fireworks: "accounts/fireworks/models/glm-5p3",
      deepinfra: "zai-org/GLM-5.3",
      vercel: "anthropic/claude-sonnet-5.5",
      venice: "zai-org-glm-5-2",
      nebius: "zai-org/GLM-5.3",
      novita: "zai-org/glm-5.2",
      huggingface: "zai-org/GLM-5.3",
    });
  });
});

/** The sixteen, in catalogue order, whether or not they have been switched on yet. */
function notEnabledOrAdded(): CatalogueId[] {
  return CATALOGUE_IDS.filter((id) => !["anthropic", "openai", "openrouter"].includes(id));
}
