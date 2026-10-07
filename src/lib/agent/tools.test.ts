import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CATALOGUE } from "./providers";
import { freeFormParamsSchema, readFreeFormParams } from "./tools";

/**
 * One tool takes a parameter that is whatever its data source asks for. Some providers
 * refuse to be told about an object with no declared properties, so for them the same
 * parameter is declared as JSON in a string. Either way the tool reads both forms.
 */
describe("readFreeFormParams", () => {
  it("takes the object a model sends, and the same object written as JSON in a string", () => {
    expect(readFreeFormParams({ query: "bonk", limit: 5 })).toEqual({ query: "bonk", limit: 5 });
    expect(readFreeFormParams('{"query":"bonk","limit":5}')).toEqual({ query: "bonk", limit: 5 });
  });

  it("reads nothing at all as no parameters", () => {
    for (const nothing of [undefined, null, "", "{}", {}]) expect(readFreeFormParams(nothing)).toEqual({});
  });

  it("refuses what is not an object: text that is not JSON, a list, a number", () => {
    for (const bad of ["not json", "[1,2]", [1, 2], "42", 42, "null x"]) expect(readFreeFormParams(bad), String(bad)).toBeNull();
  });
});

describe("how the free-form parameter is declared", () => {
  it("is an object for most providers, exactly as before", () => {
    expect(z.toJSONSchema(freeFormParamsSchema(false))).toMatchObject({ type: "object" });
  });

  /** Gemini refuses a function whose object parameter names no properties. */
  it("is a string for a provider that refuses an object with no declared properties", () => {
    const declared = z.toJSONSchema(freeFormParamsSchema(true));
    expect(declared).toMatchObject({ type: "string" });
    expect(JSON.stringify(declared)).not.toContain('"object"');
  });

  it("is asked for by Google's row and by none of the three providers that came first", () => {
    expect(CATALOGUE.google.freeFormParams).toBe("json-string");
    for (const id of ["anthropic", "openai", "openrouter"] as const) expect(CATALOGUE[id].freeFormParams).toBeUndefined();
  });
});
