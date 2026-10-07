import { describe, expect, it } from "vitest";
import { mismatchedProvider, providerFromKeyPrefix, providerName, wrongProviderOnAdd, wrongProviderOnRotate } from "./key-prefix";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, isProvider, keyPrefixProvider, keyProblem } from "./providers";

/** A stand-in for a key, put together at run time: nothing key-shaped is written out here. */
const keyWith = (prefix: string) => `${prefix}${"Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV".repeat(2).slice(0, 40)}`;

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

/**
 * What these functions return is offered back to the person as "Switch to …", so they
 * name only a provider a key can be added for. The whole check, which also refuses a key
 * belonging to a provider that is not offered, is `keyProblem`.
 */
describe("the registry behind it", () => {
  it("reads every enabled provider's prefixes from its row", () => {
    for (const id of PROVIDER_IDS) {
      for (const prefix of CATALOGUE[id].keyPrefixes) {
        expect(providerFromKeyPrefix(keyWith(prefix)), prefix).toBe(id);
        expect(providerName(id)).toBe(CATALOGUE[id].label);
      }
    }
  });

  it("names nobody for a key whose provider is not offered, and leaves refusing it to keyProblem", () => {
    for (const id of CATALOGUE_IDS) {
      // A plain yes or no: the type predicate would leave `id` with no type once all are enabled.
      const offered: boolean = isProvider(id);
      if (offered) continue;
      for (const prefix of CATALOGUE[id].keyPrefixes) {
        const key = keyWith(prefix);
        expect(keyPrefixProvider(key), prefix).toBe(id);
        expect(providerFromKeyPrefix(key), prefix).toBeNull();
        expect(mismatchedProvider(key, "openai"), prefix).toBeNull();
        expect(keyProblem("openai", key), prefix).toContain(`That looks like ${CATALOGUE[id].article} ${CATALOGUE[id].label} key`);
      }
    }
  });

  it("agrees with keyProblem wherever it does name a provider", () => {
    for (const detected of PROVIDER_IDS) {
      for (const prefix of CATALOGUE[detected].keyPrefixes) {
        for (const chosen of PROVIDER_IDS) {
          const key = keyWith(prefix);
          const other = mismatchedProvider(key, chosen);
          expect(other, `${prefix} under ${chosen}`).toBe(detected === chosen ? null : detected);
          if (other) {
            expect(keyProblem(chosen, key)).toBe(wrongProviderOnAdd(other, chosen));
            expect(keyProblem(chosen, key, "rotate")).toBe(wrongProviderOnRotate(other, chosen));
          }
        }
      }
    }
  });
});
