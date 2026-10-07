import { describe, expect, it } from "vitest";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_ORDER, providersInOrder } from "@/lib/agent/providers";
import { providerSearchWords } from "./provider-words";

/** What the palette does with a row's keywords: one lower-cased substring test. */
const finds = (words: string, query: string) => words.includes(query.trim().toLowerCase());

describe("the words that find Settings by a provider's name", () => {
  const three = providerSearchWords(["anthropic", "openai", "openrouter"]);
  const every = providerSearchWords(providersInOrder(CATALOGUE_IDS));

  it("is the three names for the three the product started with", () => {
    expect(three).toBe("anthropic openai openrouter");
  });

  it("finds every provider by its id and by its name", () => {
    for (const id of CATALOGUE_IDS) {
      expect(finds(every, id), id).toBe(true);
      // The first word of the name is always findable; so is the whole name, unless it
      // carries a word that means something else here.
      expect(finds(every, CATALOGUE[id].label.split(" ")[0]), CATALOGUE[id].label).toBe(true);
    }
    for (const query of ["Gemini", "hugging face", "huggingface", "z.ai", "ai gateway", "groq", "nebius"]) {
      expect(finds(every, query), query).toBe(true);
    }
  });

  it("is not found by the words this palette is for", () => {
    for (const query of ["token", "tokens", "agent", "agents"]) {
      expect(finds(every, query), query).toBe(false);
      expect(finds(three, query), query).toBe(false);
    }
  });

  it("names only the providers it is handed", () => {
    expect(finds(three, "groq")).toBe(false);
    expect(finds(three, "gemini")).toBe(false);
    // What the palette is handed today is the enabled list, whatever that is.
    const today = providerSearchWords(PROVIDER_ORDER);
    const enabled = new Set<string>(PROVIDER_ORDER);
    for (const id of CATALOGUE_IDS) expect(finds(today, id), id).toBe(enabled.has(id));
  });
});
