/**
 * What the provider chooser and the key forms show, decided without a browser.
 *
 * Written to hold whichever providers are switched on: where a test is about a provider
 * that may not be enabled yet it asks through the functions that take any set of ids, or
 * loops over whichever are on. The three there have always been are pinned by name.
 */
import { describe, expect, it } from "vitest";
import { wrongProviderOnAdd, wrongProviderOnRotate } from "@/lib/agent/key-prefix";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  PROVIDER_IDS,
  PROVIDER_ORDER,
  PROVIDER_UNSUPPORTED,
  isProvider,
  keyProblem,
  providersInOrder,
  type CatalogueId,
} from "@/lib/agent/providers";
import { REDACTED } from "@/lib/security/redact";
import {
  KEY_MIN,
  KEY_TOO_SHORT,
  addKeyLabel,
  chooserFooter,
  keyNote,
  keyPage,
  keyPlaceholder,
  keyRefusal,
  keyShapeHint,
  moveActive,
  openingRow,
  optionAt,
  optionsFor,
  providerHelp,
  providerNames,
  providerOptions,
  shownKeyError,
  temperatureNote,
} from "./provider-choice";

/**
 * Stand-ins for keys, put together at run time: nothing key-shaped is written out in a
 * tracked file (`repo-secrets.test.ts`). The body has capitals and digits, as a key does.
 */
const body = (length: number) => "Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV".repeat(4).slice(0, length);
/** A key that starts the way this provider's keys do, where the registry knows how. */
const keyOf = (id: CatalogueId) => `${CATALOGUE[id].keyPrefixes[0] ?? ""}${body(40)}`;
/** A key no provider's prefix is on. */
const PLAIN = body(40);

/** Every provider with a row, in display order, switched on or not. */
const ALL = providersInOrder(CATALOGUE_IDS);
const THREE = ["anthropic", "openai", "openrouter"] as const;
/**
 * The providers with a row that are not switched on. Asked through a plain yes-or-no so
 * the list keeps its type: once every provider is enabled it is simply empty, and what
 * loops over it checks nothing instead of failing to compile.
 */
const enabled = (id: string): boolean => isProvider(id);
const NOT_ENABLED: CatalogueId[] = CATALOGUE_IDS.filter((id) => !enabled(id));
/** Things a stored row, a saved draft or a form could hold that are not a provider. */
const NOT_PROVIDERS = ["", "nope", "constructor", "__proto__", "toString", "Anthropic", " openai"];

describe("what the chooser lists", () => {
  it("lists the enabled providers, in the registry's display order, under their own names", () => {
    const options = providerOptions("");
    expect(options.map((option) => option.id)).toEqual([...PROVIDER_ORDER]);
    expect([...options.map((option) => option.id)].sort()).toEqual([...PROVIDER_IDS].sort());
    for (const option of options) expect(option.label).toBe(CATALOGUE[option.id].label);
  });

  it("still offers Anthropic, OpenAI and OpenRouter, under those names", () => {
    const byId = new Map(providerOptions("").map((option) => [option.id, option.label]));
    expect(byId.get("anthropic")).toBe("Anthropic");
    expect(byId.get("openai")).toBe("OpenAI");
    expect(byId.get("openrouter")).toBe("OpenRouter");
  });

  it("leads with the five people look for, then the rest by name", () => {
    const ids = optionsFor(ALL, "").map((option) => option.id);
    expect(ids).toHaveLength(CATALOGUE_IDS.length);
    expect(ids.slice(0, 5)).toEqual(["anthropic", "openai", "google", "xai", "openrouter"]);
    const rest = ids.slice(5).map((id) => CATALOGUE[id].label.toLowerCase());
    expect(rest).toEqual([...rest].sort());
  });

  it("finds a provider by its name or by what it makes", () => {
    const found = (query: string) => optionsFor(ALL, query).map((option) => option.id);
    expect(found("grok")).toEqual(["xai"]);
    expect(found("GROK")).toEqual(["xai"]);
    expect(found("kimi")).toEqual(["moonshot"]);
    expect(found("claude")).toEqual(["anthropic"]);
    expect(found("gpt")).toEqual(["openai"]);
    expect(found("glm")).toEqual(["zai"]);
    expect(found("ai gateway")).toEqual(["vercel"]);
    expect(found("gateway ai")).toEqual(["vercel"]);
    expect(found("hugging")).toEqual(["huggingface"]);
    expect(found("  open  ")).toEqual(["openai", "openrouter"]);
  });

  it("shows the registry's note as a row's second line, and none for a provider without one", () => {
    for (const option of optionsFor(ALL, "")) expect(option.note, option.id).toBe(CATALOGUE[option.id].note ?? null);
    for (const option of optionsFor(THREE, "")) expect(option.note, option.id).toBeNull();
    expect(optionsFor(ALL, "groq")[0]?.note).toBe(CATALOGUE.groq.note);
  });

  it("never turns what was typed into a provider", () => {
    for (const query of ["my-own-provider", "https://evil.example/v1", "constructor", "zzz", "anthropic openai"]) {
      const options = optionsFor(ALL, query);
      expect(options, query).toEqual([]);
      // Enter on an empty list takes nothing.
      expect(optionAt(options, 0), query).toBeNull();
      expect(providerOptions(query), query).toEqual([]);
    }
    // Whatever is typed, a row is always one of the enabled providers.
    for (const query of ["", "a", "o", "ai", "open", "groq", "x"]) {
      for (const option of providerOptions(query)) expect(isProvider(option.id), `${query}: ${option.id}`).toBe(true);
    }
  });

  it("takes the provider of the highlighted row, and nothing for a row that is not there", () => {
    const options = optionsFor(ALL, "open");
    expect(optionAt(options, 0)).toBe("openai");
    expect(optionAt(options, 1)).toBe("openrouter");
    expect(optionAt(options, 2)).toBeNull();
    expect(optionAt(options, -1)).toBeNull();
  });

  it("opens with the highlight on the provider already chosen", () => {
    const options = optionsFor(ALL, "");
    expect(openingRow(options, "anthropic")).toBe(0);
    expect(openingRow(options, "openrouter")).toBe(4);
    for (const [index, option] of options.entries()) expect(openingRow(options, option.id)).toBe(index);
    // A value that is not in the list starts at the top rather than nowhere.
    for (const value of NOT_PROVIDERS) expect(openingRow(options, value), value).toBe(0);
    expect(openingRow([], "anthropic")).toBe(0);
  });

  it("moves the highlight one row at a time and stops at either end", () => {
    expect(moveActive(0, "ArrowDown", 5)).toBe(1);
    expect(moveActive(3, "ArrowDown", 5)).toBe(4);
    expect(moveActive(4, "ArrowDown", 5)).toBe(4);
    expect(moveActive(4, "ArrowUp", 5)).toBe(3);
    expect(moveActive(0, "ArrowUp", 5)).toBe(0);
    // A search that left nothing: there is no row to move to.
    expect(moveActive(0, "ArrowDown", 0)).toBe(0);
    expect(moveActive(0, "ArrowUp", 0)).toBe(0);
  });

  it("says in the footer how many there are, and whose account pays", () => {
    expect(chooserFooter(3)).toBe(
      "3 providers. The model runs on your own account with the one you choose, and it bills you.",
    );
    expect(chooserFooter(19)).toContain("19 providers.");
    expect(chooserFooter(1)).toContain("One provider.");
  });
});

describe("under the chooser", () => {
  it("says nothing for Anthropic, OpenAI or OpenRouter once the account has their key", () => {
    for (const id of THREE) expect(providerHelp(id, { hasKey: true }), id).toBeNull();
  });

  it("links to where a key is made while the account has none for that provider", () => {
    expect(providerHelp("anthropic", { hasKey: false })).toEqual({
      note: null,
      keyPage: { href: "https://console.anthropic.com/settings/keys", host: "console.anthropic.com" },
    });
    expect(providerHelp("openai", { hasKey: false })?.keyPage).toEqual({
      href: "https://platform.openai.com/api-keys",
      host: "platform.openai.com",
    });
    expect(providerHelp("openrouter", { hasKey: false })?.keyPage).toEqual({
      href: "https://openrouter.ai/keys",
      host: "openrouter.ai",
    });
  });

  it("only ever links to the registry's own https address for that provider", () => {
    for (const id of ALL) {
      const page = keyPage(id);
      expect(page?.href, id).toBe(CATALOGUE[id].keyPage);
      expect(page?.href.startsWith("https://"), id).toBe(true);
      // What the link reads as is the site it goes to, and only the site.
      expect(page?.host, id).toBe(new URL(CATALOGUE[id].keyPage).hostname.replace(/^www\./, ""));
      expect(/^[a-z0-9.-]+$/.test(page?.host ?? ""), id).toBe(true);
    }
  });

  it("shows a provider's note whether or not the account has its key, and the link only without one", () => {
    for (const id of PROVIDER_IDS) {
      const row = CATALOGUE[id];
      const withKey = providerHelp(id, { hasKey: true });
      const without = providerHelp(id, { hasKey: false });
      expect(withKey?.note ?? null, id).toBe(row.note ?? null);
      expect(withKey?.keyPage ?? null, id).toBeNull();
      expect(without?.note ?? null, id).toBe(row.note ?? null);
      expect(without?.keyPage?.href, id).toBe(row.keyPage);
    }
  });

  it("says a provider that is not offered cannot be used, and links nowhere for it", () => {
    for (const id of NOT_ENABLED) {
      for (const hasKey of [true, false]) {
        const help = providerHelp(id, { hasKey });
        expect(help?.note, id).toBe(`Tocker cannot run an agent on ${CATALOGUE[id].label}. Choose another provider.`);
        expect(help?.keyPage, id).toBeNull();
      }
    }
    for (const value of NOT_PROVIDERS) {
      const help = providerHelp(value, { hasKey: false });
      expect(help?.note, value).toContain("Choose another provider.");
      expect(help?.keyPage, value).toBeNull();
      expect(keyPage(value), value).toBeNull();
    }
  });
});

describe("the key field", () => {
  it("shows the three what their keys start with, as it always has", () => {
    expect(keyShapeHint("anthropic")).toBe("sk-ant-…");
    expect(keyShapeHint("openai")).toBe("sk-…");
    expect(keyShapeHint("openrouter")).toBe("sk-or-…");
  });

  it("takes the placeholder from the registry, and leaves the brackets off where it has only words", () => {
    for (const id of ALL) {
      const hint = CATALOGUE[id].keyHint;
      expect(keyPlaceholder(id), id).toBe(hint);
      expect(keyShapeHint(id), id).toBe(hint.includes("…") ? hint : null);
    }
    // "API key (API key)" is what the brackets would otherwise read as.
    expect(CATALOGUE.mistral.keyHint).toBe("API key");
    expect(keyShapeHint("mistral")).toBeNull();
    for (const value of NOT_PROVIDERS) {
      expect(keyPlaceholder(value), value).toBe("");
      expect(keyShapeHint(value), value).toBeNull();
    }
  });

  it("puts the article in front by sound", () => {
    expect(addKeyLabel("anthropic")).toBe("Add an Anthropic key");
    expect(addKeyLabel("openai")).toBe("Add an OpenAI key");
    expect(addKeyLabel("openrouter")).toBe("Add an OpenRouter key");
    expect(addKeyLabel("groq")).toBe("Add a Groq key");
    expect(addKeyLabel("xai")).toBe("Add an xAI key");
    expect(addKeyLabel("huggingface")).toBe("Add a Hugging Face key");
  });
});

describe("refusing a key before it is sent anywhere", () => {
  it("refuses what is too short to be a key, under any provider", () => {
    expect(KEY_MIN).toBe(16);
    for (const id of PROVIDER_IDS) {
      expect(keyRefusal(id, ""), id).toBe(KEY_TOO_SHORT);
      expect(keyRefusal(id, body(KEY_MIN - 1)), id).toBe(KEY_TOO_SHORT);
      expect(keyRefusal(id, `   ${body(KEY_MIN - 1)}   `), id).toBe(KEY_TOO_SHORT);
    }
    expect(KEY_TOO_SHORT).toBe("That doesn’t look like a full API key — paste the whole thing.");
  });

  it("lets through a key that fits its provider, and one that says nothing about whose it is", () => {
    for (const id of PROVIDER_IDS) expect(keyRefusal(id, keyOf(id)), id).toBeNull();
    for (const id of THREE) {
      expect(keyRefusal(id, PLAIN), id).toBeNull();
      expect(keyRefusal(id, `sk-${body(40)}`), id).toBeNull();
      expect(keyRefusal(id, PLAIN, "rotate"), id).toBeNull();
    }
  });

  it("refuses the three each other's keys in the words it always used", () => {
    for (const chosen of THREE) {
      for (const detected of THREE) {
        if (chosen === detected) continue;
        expect(keyRefusal(chosen, keyOf(detected)), `${detected} under ${chosen}`).toBe(
          wrongProviderOnAdd(detected, chosen),
        );
        expect(keyRefusal(chosen, keyOf(detected), "rotate"), `${detected} into ${chosen}`).toBe(
          wrongProviderOnRotate(detected, chosen),
        );
      }
    }
    expect(keyRefusal("openai", keyOf("anthropic"))).toBe(
      "That looks like an Anthropic key, not an OpenAI one — choose Anthropic as the provider",
    );
    expect(keyRefusal("anthropic", keyOf("openrouter"), "rotate")).toBe(
      "That looks like an OpenRouter key; this is an Anthropic key — add it as a new key instead",
    );
  });

  it("makes exactly the registry's refusal for every provider and every key", () => {
    for (const chosen of PROVIDER_IDS) {
      for (const other of CATALOGUE_IDS) {
        for (const use of ["add", "rotate"] as const) {
          expect(keyRefusal(chosen, keyOf(other), use), `${other} under ${chosen}`).toBe(
            keyProblem(chosen, keyOf(other), use),
          );
        }
      }
    }
  });

  it("refuses a key with another provider's prefix, whether or not that provider is switched on", () => {
    for (const other of CATALOGUE_IDS) {
      if (CATALOGUE[other].keyPrefixes.length === 0) continue;
      for (const chosen of PROVIDER_IDS) {
        if (chosen === other) continue;
        expect(keyRefusal(chosen, keyOf(other)), `${other} under ${chosen}`).not.toBeNull();
      }
    }
  });

  it("will not replace a key whose provider is no longer offered", () => {
    for (const value of [...NOT_PROVIDERS, "retired-provider"]) {
      expect(keyRefusal(value, PLAIN, "rotate"), value).toBe(PROVIDER_UNSUPPORTED);
      expect(keyRefusal(value, PLAIN), value).toBe(PROVIDER_UNSUPPORTED);
    }
    for (const id of NOT_ENABLED) expect(keyRefusal(id, keyOf(id), "rotate"), id).toBe(PROVIDER_UNSUPPORTED);
  });

  it("never repeats the key in what it says", () => {
    for (const chosen of [...PROVIDER_IDS, "nope"]) {
      for (const other of CATALOGUE_IDS) {
        expect(keyRefusal(chosen, keyOf(other)) ?? "", `${other} under ${chosen}`).not.toContain(body(40));
      }
    }
  });
});

describe("the note under the key box", () => {
  it("offers the switch as soon as another offered provider's prefix is there", () => {
    expect(keyNote("openai", keyOf("anthropic"))).toEqual({
      text: "This looks like an Anthropic key.",
      switchTo: "anthropic",
    });
    // The prefix alone is enough: nobody has to finish pasting to be told.
    expect(keyNote("anthropic", CATALOGUE.openrouter.keyPrefixes[0])).toEqual({
      text: "This looks like an OpenRouter key.",
      switchTo: "openrouter",
    });
    for (const chosen of PROVIDER_IDS) {
      for (const other of PROVIDER_IDS) {
        if (chosen === other || CATALOGUE[other].keyPrefixes.length === 0) continue;
        expect(keyNote(chosen, keyOf(other))?.switchTo, `${other} under ${chosen}`).toBe(other);
      }
    }
  });

  it("says nothing about a key that fits, a bare sk- key, or a few characters", () => {
    for (const id of PROVIDER_IDS) {
      expect(keyNote(id, keyOf(id)), id).toBeNull();
      expect(keyNote(id, ""), id).toBeNull();
      expect(keyNote(id, "s"), id).toBeNull();
    }
    for (const id of THREE) {
      expect(keyNote(id, `sk-${body(40)}`), id).toBeNull();
      expect(keyNote(id, PLAIN), id).toBeNull();
    }
  });

  it("never offers a switch to a provider that cannot be chosen", () => {
    for (const other of NOT_ENABLED) {
      if (CATALOGUE[other].keyPrefixes.length === 0) continue;
      const note = keyNote("openai", keyOf(other));
      expect(note?.switchTo, other).toBeNull();
      // It says whose key it is, in the registry's words, and stops there.
      expect(note?.text, other).toBe(keyProblem("openai", keyOf(other)));
      expect(note?.text, other).toContain(`Tocker cannot use ${CATALOGUE[other].label} keys`);
    }
  });

  it("waits for a whole key before saying its prefix is missing", () => {
    for (const id of PROVIDER_IDS) {
      if (!CATALOGUE[id].requiresPrefix) continue;
      expect(keyNote(id, "ab"), id).toBeNull();
      expect(keyNote(id, body(KEY_MIN - 1)), id).toBeNull();
      expect(keyNote(id, PLAIN), id).toEqual({ text: keyProblem(id, PLAIN), switchTo: null });
    }
  });

  it("has nothing to say under a provider that is not one", () => {
    for (const value of NOT_PROVIDERS) expect(keyNote(value, keyOf("anthropic")), value).toBeNull();
  });
});

describe("an error that came back from the server", () => {
  it("has the key taken out wherever it appears, whatever its shape", () => {
    const shown = shownKeyError(`The provider said: invalid key ${PLAIN} (${PLAIN})`, `  ${PLAIN}  `);
    expect(shown).not.toContain(PLAIN);
    expect(shown).toContain(REDACTED);
    expect(shown.startsWith("The provider said: invalid key")).toBe(true);
  });

  it("has anything key-shaped taken out even when it is not the key in the field", () => {
    const other = keyOf("anthropic");
    const shown = shownKeyError(`Incorrect API key provided: ${other}`, PLAIN);
    expect(shown).not.toContain(other);
    expect(shown).not.toContain(body(40));
  });

  it("only looks for what is long enough to have been sent as a key", () => {
    const short = body(KEY_MIN - 1);
    const long = body(KEY_MIN);
    expect(shownKeyError(`Nothing like ${short} here`, short)).toBe(`Nothing like ${short} here`);
    expect(shownKeyError(`Nothing like ${long} here`, long)).toBe(`Nothing like ${REDACTED} here`);
  });

  it("leaves a plain sentence exactly as it was", () => {
    for (const message of [
      "Label must be 60 characters or fewer",
      "That does not look like a Workspace ID. It starts with wrkspc_ (Anthropic Console, Settings, Workspaces).",
      "OpenAI did not accept this key. Check it and try again.",
      PROVIDER_UNSUPPORTED,
    ]) {
      expect(shownKeyError(message, PLAIN), message).toBe(message);
      // A few stray characters in the field are not searched for: it would shred the sentence.
      expect(shownKeyError(message, "a"), message).toBe(message);
      expect(shownKeyError(message, ""), message).toBe(message);
    }
  });
});

describe("the providers, named in a sentence", () => {
  it("names the three as the onboarding copy always did", () => {
    expect(providerNames(THREE)).toBe("Anthropic, OpenAI or OpenRouter");
  });

  it("names five and counts the rest once there are many", () => {
    expect(providerNames(ALL)).toBe("Anthropic, OpenAI, Google Gemini, xAI, OpenRouter or one of 14 others");
    expect(providerNames(ALL.slice(0, 6))).toMatch(/^Anthropic, OpenAI, Google Gemini, xAI, OpenRouter or one other$/);
    expect(providerNames(ALL.slice(0, 5))).toBe("Anthropic, OpenAI, Google Gemini, xAI or OpenRouter");
    expect(providerNames(["groq"])).toBe("Groq");
    expect(providerNames([])).toBe("");
  });

  it("names the enabled providers when it is not told which", () => {
    expect(providerNames()).toBe(providerNames(PROVIDER_ORDER));
  });
});

describe("the temperature slider", () => {
  it("says nothing on Anthropic, OpenAI and OpenRouter, whatever is set and whatever the model", () => {
    for (const id of THREE) {
      for (const setting of [0, 0.4, 1, 1.5, 2]) {
        for (const model of [CATALOGUE[id].defaultModel, "moonshotai/kimi-k3", "anything", null, undefined]) {
          expect(temperatureNote(id, setting, model), `${id} ${setting} ${model}`).toBeNull();
        }
      }
    }
  });

  it("says the setting is not sent where the provider is sent none", () => {
    expect(temperatureNote("google", 0.4, CATALOGUE.google.defaultModel)).toBe(
      "Tocker sends no temperature to Google Gemini, so this setting has no effect there.",
    );
    for (const id of ALL) {
      if (CATALOGUE[id].temperature !== "omit") continue;
      for (const setting of [0, 0.4, 1.5]) {
        expect(temperatureNote(id, setting, CATALOGUE[id].defaultModel), id).toContain(
          `no temperature to ${CATALOGUE[id].label}`,
        );
      }
    }
  });

  it("says what is sent instead where the provider has a ceiling, and only above it", () => {
    expect(temperatureNote("zai", 1.5, "glm-5.3")).toBe("Z.AI accepts 1 at most, so a higher setting is sent as 1.");
    expect(temperatureNote("zai", 1, "glm-5.3")).toBeNull();
    expect(temperatureNote("zai", 0.4, "glm-5.3")).toBeNull();
    // The builder's slider stops at Mistral's ceiling, so it is never over it there.
    expect(temperatureNote("mistral", 1.5, CATALOGUE.mistral.defaultModel)).toBeNull();
    expect(temperatureNote("mistral", 2, CATALOGUE.mistral.defaultModel)).toContain("sent as 1.5");
  });

  it("says a model that fixes its own sampling is sent none, on a provider that otherwise is", () => {
    expect(temperatureNote("together", 0.4, "moonshotai/Kimi-K3")).toBe(
      "This model sets its own temperature, so Tocker sends none and this setting has no effect.",
    );
    expect(temperatureNote("together", 0.4, CATALOGUE.together.defaultModel)).toBeNull();
  });

  it("says nothing for a provider it does not know", () => {
    for (const value of NOT_PROVIDERS) expect(temperatureNote(value, 0.4, "x"), value).toBeNull();
  });
});
