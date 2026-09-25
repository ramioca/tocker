import { describe, expect, it } from "vitest";
import { mismatchedProvider, providerFromKeyPrefix, wrongProviderOnAdd, wrongProviderOnRotate } from "./key-prefix";

describe("providerFromKeyPrefix", () => {
  it("reads each provider's own prefix", () => {
    expect(providerFromKeyPrefix("sk-ant-api03-abcdefghijklmnop")).toBe("anthropic");
    expect(providerFromKeyPrefix("sk-ant-admin01-abcdefghijklmnop")).toBe("anthropic");
    expect(providerFromKeyPrefix("sk-or-v1-abcdefghijklmnop")).toBe("openrouter");
    expect(providerFromKeyPrefix("sk-proj-abcdefghijklmnop")).toBe("openai");
    expect(providerFromKeyPrefix("sk-svcacct-abcdefghijklmnop")).toBe("openai");
    expect(providerFromKeyPrefix("sk-admin-abcdefghijklmnop")).toBe("openai");
  });

  it("ignores whitespace around a pasted key", () => {
    expect(providerFromKeyPrefix("  sk-or-v1-abcdefghijklmnop\n")).toBe("openrouter");
  });

  it("names nobody for a legacy bare sk- key, or anything else", () => {
    // A bare "sk-" is how every prefix starts: guessing OpenAI would be a false alarm.
    expect(providerFromKeyPrefix("sk-abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(providerFromKeyPrefix("")).toBeNull();
    expect(providerFromKeyPrefix("wrkspc_abcdefghijklmnop")).toBeNull();
    expect(providerFromKeyPrefix("SK-ANT-api03-abcdefghijklmnop")).toBeNull();
  });
});

describe("mismatchedProvider", () => {
  it("returns the key's provider only when it differs from the chosen one", () => {
    expect(mismatchedProvider("sk-ant-api03-abcdefghijklmnop", "openai")).toBe("anthropic");
    expect(mismatchedProvider("sk-ant-api03-abcdefghijklmnop", "anthropic")).toBeNull();
    expect(mismatchedProvider("sk-abcdefghijklmnopqrstuvwxyz", "anthropic")).toBeNull();
  });
});

describe("refusals", () => {
  it("names both providers and what to do", () => {
    expect(wrongProviderOnAdd("openai", "anthropic")).toBe(
      "That looks like an OpenAI key, not an Anthropic one — choose OpenAI as the provider",
    );
    expect(wrongProviderOnRotate("anthropic", "openai")).toBe(
      "That looks like an Anthropic key; this is an OpenAI key — add it as a new key instead",
    );
  });
});
