/**
 * What the documents say about LLM providers, against the registry they describe.
 *
 * DEPLOY.md tells an owner where each provider's key is made and the one host it may be
 * sent to, SPEC.md and CLAUDE.md carry the rule the code is built on, and the landing
 * page and README name providers in passing. A row edited in the registry without the
 * table beside it, a package bumped without its line, or a provider named somewhere
 * before it is switched on, would each be a page telling an owner something untrue about
 * where their key goes. Each test pins one such statement to the thing it is about.
 *
 * It reads files and compares text and constants. Nothing is run and no network is
 * touched. Everything here holds whichever providers are switched on.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, PROVIDER_UNSUPPORTED, type CatalogueId } from "./providers";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
/** Line wraps and table padding are not part of a sentence. */
const flat = (text: string) => text.replace(/\s+/g, " ");

const deploy = read("DEPLOY.md");
const from = deploy.indexOf("\n## Model providers, in full");
/** The providers section of DEPLOY.md, as written and with its whitespace collapsed. */
const section = deploy.slice(from);
const text = flat(section);
const spec = flat(read("SPEC.md"));
const conventions = flat(read("CLAUDE.md"));

/** The cells of every table row whose first cell is exactly this. */
function row(first: string): string[] | null {
  const line = section.split("\n").find((candidate) => candidate.startsWith(`| ${first} |`));
  return line
    ? line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    : null;
}

const LIST_WORDS = { "by-key": "asked with the key", public: "its public list", "built-in": "built in" } as const;

describe("DEPLOY.md, the providers table", () => {
  it("is where the section is, after everything section 5's own test reads", () => {
    expect(from).toBeGreaterThan(deploy.indexOf("\n## Notes"));
    expect(from).toBeGreaterThan(deploy.indexOf("## 5. Pay-per-use thinking"));
  });

  it("has one row for every provider in the registry, and no other", () => {
    const first = section.indexOf("| Provider | Where its key is made |");
    const table = section.slice(first, section.indexOf("\n\n", first)).split("\n").slice(2);
    expect(table.map((line) => line.split("|")[1].trim())).toEqual(CATALOGUE_IDS.map((id) => CATALOGUE[id].label));
    expect(text).toContain(`each of the nineteen providers`);
    expect(CATALOGUE_IDS).toHaveLength(19);
  });

  it.each(CATALOGUE_IDS)("says where a %s key is made, where it is sent and how its models are listed", (id: CatalogueId) => {
    const provider = CATALOGUE[id];
    const cells = row(provider.label);
    expect(cells, provider.label).not.toBeNull();
    const [, keyPage, host, list] = cells!;
    expect(keyPage).toBe(provider.keyPage);
    // The host the table names is the registry's origin, and the base URL is on it.
    const origin = new URL(provider.origin);
    expect(provider.origin).toBe(`https://${origin.host}`);
    expect(new URL(provider.baseUrl).origin).toBe(provider.origin);
    expect(host.startsWith(`\`${origin.host}\``)).toBe(true);
    expect(list).toBe(LIST_WORDS[provider.modelList]);
    // A second host is written in the row, or there is none.
    if (provider.keyCheckOrigin) {
      expect(host).toBe(`\`${origin.host}\`, and \`${new URL(provider.keyCheckOrigin).host}\` for the token check alone`);
    } else {
      expect(host).toBe(`\`${origin.host}\``);
    }
  });

  it("says which row has a second host, and that no other does", () => {
    const second = CATALOGUE_IDS.filter((id) => CATALOGUE[id].keyCheckOrigin);
    expect(second).toEqual(["huggingface"]);
    expect(text).toContain("it is checked once against `https://huggingface.co/api/whoami-v2`");
    expect(text).toContain("only the key check may use it, and no other row has one");
  });
});

describe("DEPLOY.md, what it says the code does with a key", () => {
  it("names every prefix the registry recognises, with the provider it belongs to", () => {
    const list = text.slice(text.indexOf("**Whose a prefix is.**"), text.indexOf("**Who documents one.**"));
    for (const id of CATALOGUE_IDS) {
      for (const prefix of CATALOGUE[id].keyPrefixes) expect(list, `${prefix} (${id})`).toContain(`\`${prefix}\``);
    }
    // And claims no prefix the registry does not have.
    const named = [...list.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const known = new Set(CATALOGUE_IDS.flatMap((id) => [...CATALOGUE[id].keyPrefixes]));
    expect(named.filter((prefix) => !known.has(prefix))).toEqual([]);
  });

  it("names exactly the providers whose keys must carry their prefix", () => {
    const required = CATALOGUE_IDS.filter((id) => CATALOGUE[id].requiresPrefix).map((id) => CATALOGUE[id].label);
    expect(required).toEqual(["Cerebras", "Novita AI"]);
    expect(text).toContain("Cerebras and Novita say every key of theirs starts with their prefix");
    expect(text).toContain("**Cerebras.** A key must start `csk-`.");
    expect(text).toContain("**Novita AI.** A key must start `sk_`.");
  });

  it("names the providers whose keys no prefix can place, as the limit of that check", () => {
    const limit = text.slice(text.indexOf("The limit of that check"), text.indexOf("**What a provider says to a bad key differs**"));
    const unplaced = CATALOGUE_IDS.filter((id) => CATALOGUE[id].keyPrefixes.length === 0);
    expect(unplaced.sort()).toEqual(["deepinfra", "deepseek", "mistral", "moonshot", "nebius", "together", "venice", "zai"]);
    for (const name of ["DeepSeek", "Mistral", "Moonshot", "Z.AI", "Together", "DeepInfra", "Venice", "Nebius"]) expect(limit).toContain(name);
    expect(limit).toContain("**is sent once**");
  });

  it("quotes the sentence a dropped provider's key gets, word for word", () => {
    expect(text).toContain(`"${PROVIDER_UNSUPPORTED}"`);
  });

  it("states each per-provider request rule the registry holds", () => {
    const omitted = CATALOGUE_IDS.filter((id) => CATALOGUE[id].temperature === "omit");
    expect(omitted).toEqual(["google", "deepseek", "moonshot", "vercel"]);
    expect(text).toContain("The agent's temperature setting is not sent (Google");
    expect(text).toContain("the API ignores a temperature while it is, so none is sent");
    expect(text).toContain("No temperature is sent: Kimi models fix their own");
    expect(text).toContain("**Vercel AI Gateway.** No temperature is sent for any model");

    const capped = CATALOGUE_IDS.flatMap((id) => {
      const rule = CATALOGUE[id].temperature;
      return typeof rule === "object" ? [[id, rule.max] as const] : [];
    });
    expect(capped).toEqual([
      ["mistral", 1.5],
      ["zai", 1],
    ]);
    expect(text).toContain("**Mistral AI.** A temperature above 1.5 is sent as 1.5.");
    expect(text).toContain("A temperature above 1 is sent as 1.");

    const limited = CATALOGUE_IDS.filter((id) => CATALOGUE[id].maxOutputTokens !== undefined);
    expect(limited.map((id) => [id, CATALOGUE[id].maxOutputTokens])).toEqual([
      ["cerebras", 8192],
      ["novita", 8192],
    ]);
    expect(text.match(/Every step is sent an output limit of 8,192 tokens/g)).toHaveLength(2);

    // The hosts that are sent no temperature for a Kimi model, in the registry's order.
    const kimi = CATALOGUE_IDS.filter((id) => CATALOGUE[id].fixedSampling?.includes("kimi-k"));
    expect(kimi).toEqual(["together", "fireworks", "deepinfra", "venice", "nebius", "novita", "huggingface"]);
    expect(text).toContain("(Together, Fireworks, DeepInfra, Venice, Nebius, Novita, Hugging Face) no temperature is sent for a Kimi model");
  });

  it("says, without softening it, that none of the sixteen has run on a real key", () => {
    expect(text).toContain("**none of the sixteen has yet been run with a real key**");
    expect(text).toContain("**No real key was used on any of the sixteen.**");
    expect(CATALOGUE_IDS.length - 3).toBe(16);
  });

  it("names the seven that were left out, none of which has a row", () => {
    const left = section.slice(section.indexOf("### Seven that were looked at and left out"), section.indexOf("### Where a key can go"));
    const names = left
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Provider") && !line.startsWith("|---"))
      .map((line) => line.split("|")[1].trim());
    expect(names).toEqual(["Cohere", "MiniMax", "SambaNova", "Perplexity", "Alibaba Model Studio (Qwen)", "NVIDIA NIM", "Hyperbolic"]);
    const ids: readonly string[] = CATALOGUE_IDS;
    for (const id of ["cohere", "minimax", "sambanova", "perplexity", "alibaba", "nvidia", "hyperbolic"]) expect(ids).not.toContain(id);
  });
});

describe("DEPLOY.md, the packages and the migration", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  /** The provider clients added with the sixteen: everything under @ai-sdk but the two that were there. */
  const added = Object.keys(pkg.dependencies).filter(
    (name) => name.startsWith("@ai-sdk/") && name !== "@ai-sdk/anthropic" && name !== "@ai-sdk/openai",
  );

  it("lists every added package at the exact version package.json pins", () => {
    expect(added).toHaveLength(12);
    expect(text).toContain("Twelve packages were added");
    for (const name of added) {
      const version = pkg.dependencies[name];
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(row(`\`${name}\``)?.[1], name).toBe(version);
    }
  });

  it("names the migration that is there, and what it does", () => {
    const file = "drizzle/0011_lonely_ego.sql";
    expect(text).toContain(`\`${file}\``);
    expect(existsSync(path.join(ROOT, file))).toBe(true);
    const sql = read(file);
    expect(sql).toContain('ALTER TABLE "llm_keys" ALTER COLUMN "provider" SET DATA TYPE text;');
    expect(sql).toContain('DROP TYPE "public"."llm_provider";');
    expect(sql.split("statement-breakpoint")).toHaveLength(2);
    expect(text).toContain("two statements");
  });
});

describe("SPEC.md and CLAUDE.md", () => {
  it("carry the rule: a key only reaches its own provider's origin, from the registry", () => {
    expect(conventions).toContain(
      "A key only ever reaches its own provider's origin, and that origin comes from the registry (`src/lib/agent/providers.ts`, the only list of LLM providers)",
    );
    expect(conventions).toContain("decryption stays in the run loop and `listKeyModels`");
    expect(spec).toContain("a key only ever reaches its own provider's origin, and the origin comes from the registry");
    expect(spec).toContain("**Decryption stays in two places**: the run loop (`resolveModel`) and `listKeyModels`");
  });

  it("record the column's change of type, which the schema's own rule asks for", () => {
    expect(spec).toContain("`llm_keys.provider` is `text`, typed as `LlmProvider`");
    expect(spec).toContain("until migration `0011`");
    expect(spec).toContain("a type change, not a rename");
  });

  it("name every field a registry row has", () => {
    const fields = new Set(CATALOGUE_IDS.flatMap((id) => Object.keys(CATALOGUE[id])));
    for (const field of fields) expect(spec, field).toContain(`\`${field}\``);
  });
});

/**
 * A provider is named to a visitor or a reader only while it is switched on. The landing
 * page reads its names from the enabled list (`defaults.test.ts`); these two pages point
 * at the registry instead of spelling the list out, so they are true before a provider
 * is enabled and after.
 */
describe("the pages that mention providers in passing", () => {
  const enabled: readonly string[] = PROVIDER_IDS;
  const notSwitchedOn = CATALOGUE_IDS.filter((id) => !enabled.includes(id)).map((id) => CATALOGUE[id].label);

  it("README.md points at the registry and names no provider that is not switched on", () => {
    const readme = read("README.md");
    expect(flat(readme)).toContain("for Anthropic, OpenAI or any other provider switched on in `src/lib/agent/providers.ts`");
    for (const label of notSwitchedOn) expect(readme, label).not.toContain(label);
  });

  it("CLAUDE.md names none of them either", () => {
    for (const label of notSwitchedOn) expect(conventions, label).not.toContain(label);
  });

  it("the three the product started with are always switched on, as those pages assume", () => {
    for (const id of ["anthropic", "openai", "openrouter"]) expect(enabled).toContain(id);
  });
});
