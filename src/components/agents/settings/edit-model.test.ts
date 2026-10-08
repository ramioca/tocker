/**
 * Editing a saved agent, decided without a browser: what a save sends, what refuses one,
 * which steps hold unsaved edits, what a save would loosen on an agent that trades real
 * money, and when the working copy may be replaced.
 *
 * The page these rules serve replaced a single long form. What that form sent, what it
 * refused and when it called itself unsaved are written out below from its source
 * (`former…`), and the new rules are held to them over tables of edits, so the only
 * differences are the ones named in each test.
 */
import { describe, expect, it } from "vitest";
import { SETTINGS_STEPS, type SharedStepId } from "@/components/agents/builder/contract";
import { firstErrorKey, firstErrorPlace, placeOfError } from "@/components/agents/builder/flow";
import type { BuilderDraft } from "@/components/agents/builder/types";
import { validateDraft } from "@/components/agents/builder/validate";
import { checkUsdc, chooseSource, defaultUsdc, firstUsdcError, thinkChoice } from "@/components/agents/thinking";
import type { AgentConfig, AgentConfigWithSizing, PositionSizingConfig } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG, MAX_AGENT_NAME, agentConfigSchema } from "@/lib/agent/config";
import { thinkSource } from "@/lib/agent/inference";
import { DEFAULT_SIZING } from "@/lib/trading/sizing";
import type { AgentStatus } from "@/server/types";
import {
  CONFIRM_LIVE_SAVES,
  UNSAVED_STEP_NAMES,
  changedSteps,
  configToSave,
  draftOf,
  editReducer,
  editStatus,
  liveSaveWarnings,
  sameSettings,
  savePayload,
  saveStateShort,
  saveStateText,
  savedFrom,
  shownErrors,
  startEdit,
  stillRefused,
  validateEdit,
  type EditState,
  type SavedAgent,
} from "./edit-model";
import { sameConfig } from "./same-config";

// ---------------------------------------------------------------------- fixtures

type Config = AgentConfigWithSizing;
type Agent = SavedAgent & { paperStartingUsd: number; status: AgentStatus };

const anthropic = { id: "key_a", provider: "anthropic" as const };
const second = { id: "key_b", provider: "anthropic" as const };
const openai = { id: "key_oa", provider: "openai" as const };

/** The shipped default config, or a changed copy of it. */
function config(change: (config: Config) => void = () => {}): Config {
  const copy = structuredClone(DEFAULT_AGENT_CONFIG);
  change(copy);
  return copy;
}

/** A config that pays per use, as the form writes one. */
function usdcConfig(change: (config: Config) => void = () => {}): Config {
  const copy = chooseSource(config(), "usdc").config;
  change(copy);
  return copy;
}

/** A saved agent with a tagline, an avatar and a key. */
function agent(over: Partial<Agent> = {}): Agent {
  return {
    name: "Aileen",
    tagline: "Buys the first hour.",
    avatarSeed: "kestrel",
    isPublic: true,
    llmKeyId: "key_a",
    paperStartingUsd: 10_000,
    status: "active",
    config: config(),
    ...over,
  };
}

/** The working copy of an agent, with an edit made to it. */
function edited(saved: Agent, change: (draft: BuilderDraft) => void = () => {}): BuilderDraft {
  const draft = structuredClone(draftOf(saved, saved.config));
  change(draft);
  return draft;
}

/** The same data with the keys of every object in reverse, as a jsonb column may hand it back. */
function reordered<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reordered) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reordered(inner)]),
  ) as T;
}

// ------------------------------------------------- the form this page replaced

/** The six things the old form held in state, less its list of keys. */
function formOf(draft: BuilderDraft) {
  return {
    name: draft.name,
    tagline: draft.tagline,
    isPublic: draft.isPublic,
    llmKeyId: draft.llmKeyId,
    config: draft.config as AgentConfig,
  };
}

/** The mode the old form was in, and the config it saved. */
function formerSource(draft: BuilderDraft, saved: SavedAgent, allowed: boolean) {
  const form = formOf(draft);
  const { source } = thinkChoice({ allowed, saved: saved.config, working: form.config });
  const usdc = source === "usdc" ? (form.config.llm.usdc ?? defaultUsdc(form.config.schedule.intervalMinutes)) : null;
  const configSent: AgentConfig =
    usdc && !form.config.llm.usdc ? { ...form.config, llm: { ...form.config.llm, source: "usdc", usdc } } : form.config;
  return { form, source, usdc, configSent };
}

/** What the old form passed to `updateAgentAction`. */
function formerPayload(draft: BuilderDraft, saved: SavedAgent, allowed: boolean) {
  const { form, source, configSent } = formerSource(draft, saved, allowed);
  return {
    name: form.name.trim(),
    tagline: form.tagline.trim() || undefined,
    isPublic: form.isPublic,
    llmKeyId: source === "usdc" ? null : form.llmKeyId,
    config: configSent,
  };
}

/** When the old form said "Unsaved changes". */
function formerDirty(draft: BuilderDraft, saved: SavedAgent, allowed: boolean): boolean {
  const { form, source, configSent } = formerSource(draft, saved, allowed);
  return (
    form.name !== saved.name ||
    form.tagline !== (saved.tagline ?? "") ||
    form.isPublic !== saved.isPublic ||
    (source === "usdc" ? thinkSource(saved.config) !== "usdc" : form.llmKeyId !== saved.llmKeyId) ||
    !sameConfig(configSent, saved.config)
  );
}

/** The sentence the old form refused a save with, or null when it sent it. One at a time, in this order. */
function formerRefusal(draft: BuilderDraft, saved: SavedAgent, allowed: boolean): string | null {
  const { form, source, usdc } = formerSource(draft, saved, allowed);
  const trimmed = form.name.trim();
  if (trimmed.length < 2) return "Give it a name — at least two characters.";
  if (trimmed.length > MAX_AGENT_NAME) return `Keep the name to ${MAX_AGENT_NAME} characters or fewer.`;
  const strategy = agentConfigSchema.shape.strategyPrompt.safeParse(form.config.strategyPrompt);
  if (!strategy.success) return strategy.error.issues[0]?.message ?? "Describe the strategy in at least a sentence.";
  const thinking = usdc
    ? firstUsdcError(checkUsdc({ usdc, intervalMinutes: form.config.schedule.intervalMinutes, chains: form.config.chains }))
    : null;
  if (thinking) return thinking;
  if (thinkSource(saved.config) === "usdc" && source === "key" && form.llmKeyId === null) {
    return "Choose or add a key before saving, or stay on pay per use. Without one every run would fail.";
  }
  return null;
}

/**
 * Edits an owner can make, each to an agent of its own. `allowed` is the account's
 * pay-per-use answer the old form was given; the new rules are never told it.
 */
const EDITS: Array<{ what: string; saved: Agent; draft: BuilderDraft; allowed: boolean }> = (() => {
  const keyed = agent();
  const noKey = agent({ llmKeyId: null });
  const paying = agent({ llmKeyId: null, config: usdcConfig() });
  const payingBare = agent({
    llmKeyId: null,
    config: config((c) => {
      c.llm = { ...c.llm, source: "usdc" };
    }),
  });
  const row = (what: string, saved: Agent, change: (draft: BuilderDraft) => void = () => {}, allowed = false) => ({
    what,
    saved,
    draft: edited(saved, change),
    allowed,
  });
  return [
    row("nothing", keyed),
    row("nothing, on an account that may pay per use", keyed, () => {}, true),
    row("nothing, on an agent with no key", noKey),
    row("the name", keyed, (d) => {
      d.name = "Aileen the Second";
    }),
    row("a tagline", agent({ tagline: null }), (d) => {
      d.tagline = "Sells the second.";
    }),
    row("another tagline", keyed, (d) => {
      d.tagline = "Sells the second.";
    }),
    row("public to private", keyed, (d) => {
      d.isPublic = false;
    }),
    row("another key", keyed, (d) => {
      d.llmKeyId = "key_b";
    }),
    row("a first key", noKey, (d) => {
      d.llmKeyId = "key_a";
    }),
    row("the strategy", keyed, (d) => {
      d.config.strategyPrompt = `${d.config.strategyPrompt} And never on a Sunday.`;
    }),
    row("a chain added", keyed, (d) => {
      d.config.chains = ["solana", "base"];
    }),
    row("the score floor", keyed, (d) => {
      d.config.universe.minScore = 70;
    }),
    row("the data sources", keyed, (d) => {
      d.config.dataSources = ["x-search"];
    }),
    row("max per trade", keyed, (d) => {
      d.config.risk.maxTradeUsd = 250;
    }),
    row("an exit rule switched off", keyed, (d) => {
      d.config.risk.stopLossPct = null;
    }),
    row("position sizing", keyed, (d) => {
      d.config.risk.sizing = { ...DEFAULT_SIZING, mode: "percent_equity" };
    }),
    row("the interval", keyed, (d) => {
      d.config.schedule = { intervalMinutes: 60 };
    }),
    row("trading on its own", keyed, (d) => {
      d.config.execution = { mode: "auto", proposalTtlMinutes: 60 };
    }),
    row("the model", keyed, (d) => {
      d.config.llm.model = "claude-other-model";
    }),
    row("the temperature", keyed, (d) => {
      d.config.llm.temperature = 0.9;
    }),
    row("the same config with its keys in another order", keyed, (d) => {
      d.config = reordered(d.config);
    }),
    row(
      "to pay per use",
      keyed,
      (d) => {
        d.config = chooseSource(d.config, "usdc").config;
      },
      true,
    ),
    row("nothing, on an agent that pays per use", paying, () => {}, true),
    row("nothing, on one that pays per use after the account lost it", paying),
    row(
      "a key left over on an agent that pays per use",
      paying,
      (d) => {
        d.llmKeyId = "key_a";
      },
      true,
    ),
    row(
      "a pay-per-use limit",
      paying,
      (d) => {
        d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 9 };
      },
      true,
    ),
    row("pay per use to a key", paying, (d) => {
      d.config = chooseSource(d.config, "key", { explicitKey: true }).config;
      d.llmKeyId = "key_a";
    }),
    row("pay per use to a key, with none chosen", paying, (d) => {
      d.config = chooseSource(d.config, "key", { explicitKey: true }).config;
    }),
    // Saved in the mode without its model and limits: the panel shows the defaults, and
    // those are what a save writes, so there is something to save from the start.
    row("nothing, on an agent that pays per use and was saved without its limits", payingBare, () => {}, true),
  ];
})();

// ---------------------------------------------------------------------- draftOf

describe("draftOf", () => {
  it("is the saved agent, in the shape the steps edit", () => {
    const saved = agent();
    expect(draftOf(saved, saved.config)).toEqual({
      name: "Aileen",
      tagline: "Buys the first hour.",
      avatarSeed: "kestrel",
      isPublic: true,
      llmKeyId: "key_a",
      paperStartingUsd: 10_000,
      activate: true,
      goLive: false,
      funding: { mode: "paper", amountUsd: 0, gasUsd: 0, split: null },
      config: saved.config,
    });
  });

  it("gives an agent with no tagline an empty one, and one with no avatar the name it is drawn from", () => {
    const saved = agent({ tagline: null, avatarSeed: null });
    const draft = draftOf(saved, saved.config);
    expect(draft.tagline).toBe("");
    expect(draft.avatarSeed).toBe("Aileen");
  });

  it("reads whether it is running from its status", () => {
    for (const status of ["draft", "paused", "error"] as const) {
      const saved = agent({ status });
      expect(draftOf(saved, saved.config).activate, status).toBe(false);
    }
  });

  it("round trips: an untouched agent sends what the old form sent, and has nothing unsaved", () => {
    const saved = agent();
    const draft = draftOf(saved, saved.config);
    const payload = savePayload(draft, saved);
    expect(payload).toEqual(formerPayload(draft, saved, false));
    expect(payload).toEqual({
      name: "Aileen",
      tagline: "Buys the first hour.",
      isPublic: true,
      llmKeyId: "key_a",
      config: saved.config,
    });
    expect("avatarSeed" in payload).toBe(false);
    expect(changedSteps(draft, saved).size).toBe(0);
  });
});

// ---------------------------------------------------------------------- savePayload

describe("savePayload", () => {
  it("equals what the old form sent for every edit that leaves the tagline in place", () => {
    for (const { what, saved, draft, allowed } of EDITS) {
      // An agent with no tagline: the old form left the field out, and this sends it empty.
      const { tagline, ...payload } = savePayload(draft, saved);
      const { tagline: formerTagline, ...former } = formerPayload(draft, saved, allowed);
      expect(payload, what).toEqual(former);
      expect(tagline, what).toBe(formerTagline ?? "");
      expect("avatarSeed" in payload, what).toBe(false);
    }
  });

  it("sends a cleared tagline as an empty string, so it is really cleared", () => {
    const saved = agent();
    const cleared = edited(saved, (d) => {
      d.tagline = "";
    });
    expect(savePayload(cleared, saved).tagline).toBe("");
    // The old form left it out, and the server kept the old one.
    expect(formerPayload(cleared, saved, false).tagline).toBeUndefined();
    const spaces = edited(saved, (d) => {
      d.tagline = "   ";
    });
    expect(savePayload(spaces, saved).tagline).toBe("");
  });

  it("sends the name and the tagline trimmed", () => {
    const saved = agent();
    const payload = savePayload(
      edited(saved, (d) => {
        d.name = "  Aileen the Second ";
        d.tagline = " Sells the second. ";
      }),
      saved,
    );
    expect(payload.name).toBe("Aileen the Second");
    expect(payload.tagline).toBe("Sells the second.");
  });

  it("carries the avatar only when another one was picked", () => {
    const saved = agent();
    expect("avatarSeed" in savePayload(edited(saved), saved)).toBe(false);
    const picked = edited(saved, (d) => {
      d.avatarSeed = "ember";
    });
    expect(savePayload(picked, saved).avatarSeed).toBe("ember");
    const shuffled = edited(saved, (d) => {
      d.avatarSeed = "kestrel-x7k2";
    });
    expect(savePayload(shuffled, saved).avatarSeed).toBe("kestrel-x7k2");
    // A rename alone does not move the picture of an agent that has a seed of its own.
    const renamed = edited(saved, (d) => {
      d.name = "Aileen the Second";
    });
    expect("avatarSeed" in savePayload(renamed, saved)).toBe(false);
  });

  it("does not send an untouched avatar for an agent whose seed is null", () => {
    const saved = agent({ avatarSeed: null });
    const draft = edited(saved, (d) => {
      d.config.risk.maxTradeUsd = 250;
    });
    expect(draft.avatarSeed).toBe("Aileen");
    expect("avatarSeed" in savePayload(draft, saved)).toBe(false);
    // A space typed after the name is not a rename.
    const spaced = edited(saved, (d) => {
      d.name = "Aileen ";
    });
    expect("avatarSeed" in savePayload(spaced, saved)).toBe(false);
  });

  it("sends the old name as the seed when that agent is renamed, so its picture stays", () => {
    const saved = agent({ avatarSeed: null });
    const renamed = edited(saved, (d) => {
      d.name = "Aileen the Second";
    });
    const payload = savePayload(renamed, saved);
    expect(payload.name).toBe("Aileen the Second");
    expect(payload.avatarSeed).toBe("Aileen");
    // Renamed and given another picture: the picture that was picked.
    const both = edited(saved, (d) => {
      d.name = "Aileen the Second";
      d.avatarSeed = "ember";
    });
    expect(savePayload(both, saved).avatarSeed).toBe("ember");
  });

  it("does not send a name as a seed when it is too long to be one", () => {
    const long = "A".repeat(65);
    const saved = agent({ name: long, avatarSeed: null });
    const renamed = edited(saved, (d) => {
      d.name = "Aileen";
    });
    expect("avatarSeed" in savePayload(renamed, saved)).toBe(false);
    // Sixty-four characters is still a seed.
    const fits = agent({ name: "A".repeat(64), avatarSeed: null });
    const renamedToo = edited(fits, (d) => {
      d.name = "Aileen";
    });
    expect(savePayload(renamedToo, fits).avatarSeed).toBe("A".repeat(64));
  });

  it("sends no key for an agent that pays per use", () => {
    const saved = agent();
    const switched = edited(saved, (d) => {
      d.config = chooseSource(d.config, "usdc").config;
    });
    expect(switched.llmKeyId).toBe("key_a");
    expect(savePayload(switched, saved).llmKeyId).toBeNull();
    // And the key again once it is back on one.
    const paying = agent({ llmKeyId: null, config: usdcConfig() });
    const back = edited(paying, (d) => {
      d.config = chooseSource(d.config, "key", { explicitKey: true }).config;
      d.llmKeyId = "key_b";
    });
    expect(savePayload(back, paying).llmKeyId).toBe("key_b");
  });

  it("sends the defaults for a pay-per-use agent that was saved without its limits", () => {
    const bare = config((c) => {
      c.llm = { ...c.llm, source: "usdc" };
    });
    const saved = agent({ llmKeyId: null, config: bare });
    const sent = savePayload(edited(saved), saved).config!;
    expect(sent.llm.source).toBe("usdc");
    expect(sent.llm.usdc).toEqual(defaultUsdc(bare.schedule.intervalMinutes));
  });
});

describe("configToSave", () => {
  it("is the working config itself for a key agent and for a pay-per-use one with its limits", () => {
    const keyed = edited(agent());
    expect(configToSave(keyed)).toBe(keyed.config);
    const paying = edited(agent({ config: usdcConfig() }));
    expect(configToSave(paying)).toBe(paying.config);
  });

  it("fills in the default model and limits where a pay-per-use config has none", () => {
    const bare = edited(
      agent({
        config: config((c) => {
          c.llm = { ...c.llm, source: "usdc" };
          c.schedule = { intervalMinutes: 240 };
        }),
      }),
    );
    const saved = configToSave(bare);
    expect(saved).not.toBe(bare.config);
    expect(saved.llm.usdc).toEqual(defaultUsdc(240));
    expect({ ...saved, llm: { ...saved.llm, usdc: undefined } }).toEqual(bare.config);
  });
});

describe("savedFrom", () => {
  it("is the working copy as the server will hold it", () => {
    const draft = edited(agent(), (d) => {
      d.name = " Aileen the Second ";
      d.tagline = "  ";
      d.config = chooseSource(d.config, "usdc").config;
    });
    const held = savedFrom(draft);
    expect(held).toEqual({
      name: "Aileen the Second",
      tagline: null,
      avatarSeed: "kestrel",
      isPublic: true,
      llmKeyId: null,
      config: draft.config,
    });
    // So the copy that was sent reads as saved the moment the save succeeds.
    expect(changedSteps(draft, held).size).toBe(0);
  });
});

// ---------------------------------------------------------------------- validateEdit

describe("validateEdit", () => {
  const keyed = agent();
  const paying = agent({ llmKeyId: null, config: usdcConfig() });

  it("passes an untouched agent", () => {
    expect(validateEdit(edited(keyed), keyed)).toEqual({});
    expect(validateEdit(edited(paying), paying)).toEqual({});
  });

  it("refuses a name under two characters or over the limit", () => {
    for (const name of ["", " ", "A", " A "]) {
      expect(
        validateEdit(
          edited(keyed, (d) => {
            d.name = name;
          }),
          keyed,
        ),
        JSON.stringify(name),
      ).toEqual({ name: "Give it a name — at least two characters." });
    }
    const long = edited(keyed, (d) => {
      d.name = "A".repeat(MAX_AGENT_NAME + 1);
    });
    expect(validateEdit(long, keyed)).toEqual({ name: "Keep the name to 60 characters or fewer." });
    const longest = edited(keyed, (d) => {
      d.name = ` ${"A".repeat(MAX_AGENT_NAME)} `;
    });
    expect(validateEdit(longest, keyed)).toEqual({});
  });

  it("refuses a strategy the schema would", () => {
    const short = edited(keyed, (d) => {
      d.config.strategyPrompt = "Buy low.";
    });
    expect(validateEdit(short, keyed)).toEqual({ strategyPrompt: "Describe the strategy in at least a sentence." });
    const long = edited(keyed, (d) => {
      d.config.strategyPrompt = "x".repeat(8001);
    });
    const tooLong = agentConfigSchema.shape.strategyPrompt.safeParse(long.config.strategyPrompt);
    expect(tooLong.success).toBe(false);
    expect(validateEdit(long, keyed)).toEqual({ strategyPrompt: tooLong.error?.issues[0]?.message });
  });

  it("refuses pay-per-use limits the schedule would break, a model not offered, and no Solana wallet", () => {
    const overDay = edited(paying, (d) => {
      d.config.schedule = { intervalMinutes: 5 };
      d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 0.5 };
    });
    expect(validateEdit(overDay, paying).thinking).toMatch(
      /^At this schedule the agent is expected to spend about \$\d+\.\d\d a day on thinking, more than its \$0\.50 daily limit\. Raise the limit, run it less often, or pick a cheaper model\.$/,
    );
    const noModel = edited(paying, (d) => {
      d.config.llm.usdc = { ...d.config.llm.usdc!, model: "nobody/nothing" };
    });
    expect(validateEdit(noModel, paying)).toEqual({
      thinking: "nobody/nothing is not offered for pay-per-use. Pick one from the list.",
    });
    const noSolana = edited(paying, (d) => {
      d.config.chains = ["base"];
    });
    expect(validateEdit(noSolana, paying)).toEqual({
      thinking:
        "Pay-per-use thinking is paid from the agent's Solana wallet. Add Solana to its chains, or use your own API key.",
    });
  });

  it("judges an agent saved without its limits on the defaults the panel shows it", () => {
    const bare = agent({
      llmKeyId: null,
      config: config((c) => {
        c.llm = { ...c.llm, source: "usdc" };
      }),
    });
    expect(validateEdit(edited(bare), bare)).toEqual({});
  });

  it("refuses leaving pay per use with no key chosen", () => {
    const left = edited(paying, (d) => {
      d.config = chooseSource(d.config, "key", { explicitKey: true }).config;
    });
    expect(validateEdit(left, paying)).toEqual({
      llmKeyId: "Choose or add a key before saving, or stay on pay per use. Without one every run would fail.",
    });
    left.llmKeyId = "key_a";
    expect(validateEdit(left, paying)).toEqual({});
  });

  it("lets a key agent with no key save, as it always could", () => {
    const noKey = agent({ llmKeyId: null });
    expect(validateEdit(edited(noKey), noKey)).toEqual({});
    const other = edited(noKey, (d) => {
      d.config.risk.maxTradeUsd = 50;
    });
    expect(validateEdit(other, noKey)).toEqual({});
    // A key that was taken off is not a refusal either.
    const removed = edited(keyed, (d) => {
      d.llmKeyId = null;
    });
    expect(validateEdit(removed, keyed)).toEqual({});
  });

  it("refuses exactly what the old form refused, in its words, and takes the owner to the same thing first", () => {
    const broken: Array<(d: BuilderDraft) => void> = [
      (d) => {
        d.name = "";
      },
      (d) => {
        d.config.strategyPrompt = "";
      },
      (d) => {
        d.name = "";
        d.config.strategyPrompt = "";
      },
    ];
    const cases = EDITS.flatMap((edit) => [
      edit,
      ...broken.map((change, index) => ({
        ...edit,
        what: `${edit.what}, broken ${index}`,
        draft: edited(edit.saved, (d) => {
          Object.assign(d, structuredClone(edit.draft));
          change(d);
        }),
      })),
    ]);
    let refusals = 0;
    for (const { what, saved, draft, allowed } of cases) {
      const errors = validateEdit(draft, saved);
      const former = formerRefusal(draft, saved, allowed);
      const first = firstErrorKey(errors);
      expect(first === null ? null : errors[first], what).toBe(former);
      if (former !== null) refusals += 1;
    }
    expect(refusals).toBeGreaterThan(EDITS.length);
  });

  it("never answers with a key the page has no step for", () => {
    const known = ["name", "strategyPrompt", "thinking", "llmKeyId"];
    const steps: readonly string[] = SETTINGS_STEPS;
    // Everything wrong at once, and the things only the server judges.
    const everything: Array<(d: BuilderDraft) => void> = [
      (d) => {
        d.name = "";
        d.config.strategyPrompt = "";
        d.config.chains = [];
        d.config.universe.discovery = [];
        d.config.dataSources = Array.from({ length: 20 }, (_, i) => `source-${i}`);
        d.config.risk.maxTradeUsd = -1;
        d.config.schedule = { intervalMinutes: -5 };
        d.config.execution = { mode: "auto", proposalTtlMinutes: 1 };
        d.config.llm.temperature = 9;
        d.llmKeyId = null;
      },
      (d) => {
        d.config = chooseSource(d.config, "usdc").config;
        d.config.chains = [];
        d.config.llm.usdc = { model: "", maxUsdPerRun: 99, maxUsdPerDay: -1 };
        d.config.risk.maxDataSpendUsdPerRun = 900;
      },
    ];
    for (const saved of [agent(), agent({ llmKeyId: null, config: usdcConfig() })]) {
      for (const change of [...everything, () => {}]) {
        const errors = validateEdit(edited(saved, change), saved);
        for (const key of Object.keys(errors)) {
          expect(known).toContain(key);
          expect(steps).toContain(placeOfError(key).step);
        }
        const place = firstErrorPlace(errors, null);
        if (place) expect(steps).toContain(place.step);
      }
    }
  });
});

// ---------------------------------------------------------------------- shownErrors

describe("shownErrors", () => {
  const offered = { payPerUseOffered: true };
  const notOffered = { payPerUseOffered: false };

  it("shows nothing for an agent on a key of its own provider", () => {
    expect(shownErrors(edited(agent()), [anthropic], notOffered, null)).toEqual({});
  });

  it("tells a key agent with no key that it cannot think, although a save is not refused for it", () => {
    const noKey = agent({ llmKeyId: null });
    const draft = edited(noKey);
    expect(validateEdit(draft, noKey)).toEqual({});
    expect(shownErrors(draft, [anthropic], notOffered, null)).toEqual({
      llmKeyId: "Pick or add an API key. The agent cannot think without one.",
    });
  });

  it("counts a key of another provider, or one that is gone, as no key", () => {
    const otherProvider = edited(agent({ llmKeyId: "key_oa" }));
    expect(shownErrors(otherProvider, [openai, anthropic], notOffered, null)).toEqual({
      llmKeyId: "Pick one of your Anthropic keys, or add one.",
    });
    expect(shownErrors(edited(agent()), [], notOffered, null).llmKeyId).toBe(
      "Pick one of your Anthropic keys, or add one.",
    );
  });

  it("marks a name or a strategy only once a save has been refused for it", () => {
    const saved = agent();
    const draft = edited(saved, (d) => {
      d.name = "";
      d.config.strategyPrompt = "";
    });
    expect(shownErrors(draft, [anthropic], notOffered, null)).toEqual({});
    const refused = validateEdit(draft, saved);
    expect(shownErrors(draft, [anthropic], notOffered, refused)).toEqual({
      name: "Give it a name — at least two characters.",
      strategyPrompt: refused.strategyPrompt,
    });
    // Once the name has been edited its mark is gone, and the strategy's is not.
    expect(shownErrors(draft, [anthropic], notOffered, { strategyPrompt: refused.strategyPrompt })).toEqual({
      strategyPrompt: refused.strategyPrompt,
    });
  });

  it("says what the choice is when a save was refused for leaving pay per use with no key", () => {
    const paying = agent({ llmKeyId: null, config: usdcConfig() });
    const left = edited(paying, (d) => {
      d.config = chooseSource(d.config, "key", { explicitKey: true }).config;
    });
    expect(shownErrors(left, [anthropic], offered, null).llmKeyId).toBe(
      "Pick or add an API key. The agent cannot think without one.",
    );
    expect(shownErrors(left, [anthropic], offered, validateEdit(left, paying)).llmKeyId).toBe(
      "Choose or add a key before saving, or stay on pay per use. Without one every run would fail.",
    );
  });

  it("shows what is wrong with pay per use before anyone presses Save", () => {
    const paying = agent({ llmKeyId: null, config: usdcConfig() });
    expect(shownErrors(edited(paying), [], offered, null)).toEqual({});
    const overDay = edited(paying, (d) => {
      d.config.schedule = { intervalMinutes: 5 };
      d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 0.5 };
    });
    expect(shownErrors(overDay, [], offered, null)).toEqual({ thinking: validateEdit(overDay, paying).thinking });
  });

  it("puts a missing Solana wallet on the chain picker, and on how it thinks once a save was refused for it", () => {
    const paying = agent({ llmKeyId: null, config: usdcConfig() });
    const noSolana = edited(paying, (d) => {
      d.config.chains = ["base"];
    });
    const sentence =
      "Pay-per-use thinking is paid from the agent's Solana wallet. Add Solana to its chains, or use your own API key.";
    expect(shownErrors(noSolana, [], offered, null)).toEqual({ chains: sentence });
    expect(shownErrors(noSolana, [], offered, validateEdit(noSolana, paying))).toEqual({
      chains: sentence,
      thinking: sentence,
    });
  });

  it("judges a pay-per-use config as a key config where the choice is not offered", () => {
    const draft = edited(agent({ llmKeyId: null, config: usdcConfig() }));
    expect(shownErrors(draft, [], notOffered, null)).toEqual({
      llmKeyId: "Pick or add an API key. The agent cannot think without one.",
    });
  });

  it("shows model settings and chains the schema would refuse, and leaves the rest to the server", () => {
    const draft = edited(agent(), (d) => {
      d.config.llm.temperature = 9;
      d.config.chains = [];
      d.config.risk.maxTradeUsd = -1;
      d.config.universe.discovery = [];
      d.config.schedule = { intervalMinutes: -5 };
    });
    const found = validateDraft(draft, [anthropic]);
    expect(Object.keys(found).sort()).toEqual(["chains", "llm", "risk", "schedule", "universe"]);
    expect(shownErrors(draft, [anthropic], notOffered, null)).toEqual({ chains: found.chains, llm: found.llm });
  });
});

describe("stillRefused", () => {
  const paying = agent({ llmKeyId: null, config: usdcConfig() });
  const before = edited(paying);
  const all = { name: "n", strategyPrompt: "s", thinking: "t", llmKeyId: "k" };
  const after = (change: (d: BuilderDraft) => void) => stillRefused(all, before, edited(paying, change));

  it("keeps every mark through an edit to something else", () => {
    expect(
      after((d) => {
        d.tagline = "Other";
        d.config.risk.maxTradeUsd = 5;
        d.config.universe.minScore = 10;
      }),
    ).toEqual(all);
    expect(stillRefused(null, before, before)).toBeNull();
  });

  it("drops each mark when the thing it is about is edited", () => {
    expect(
      after((d) => {
        d.name = "Aileen the Second";
      }),
    ).toEqual({ strategyPrompt: "s", thinking: "t", llmKeyId: "k" });
    expect(
      after((d) => {
        d.config.strategyPrompt = "Something else entirely, and long enough.";
      }),
    ).toEqual({ name: "n", thinking: "t", llmKeyId: "k" });
    expect(
      after((d) => {
        d.llmKeyId = "key_a";
      }),
    ).toEqual({ name: "n", strategyPrompt: "s", thinking: "t" });
    // The schedule and the chains are what the pay-per-use check prices and pays from.
    expect(
      after((d) => {
        d.config.schedule = { intervalMinutes: 240 };
      }),
    ).toEqual({ name: "n", strategyPrompt: "s", llmKeyId: "k" });
    expect(
      after((d) => {
        d.config.chains = ["solana", "base"];
      }),
    ).toEqual({ name: "n", strategyPrompt: "s", llmKeyId: "k" });
    // The model or the limits: both marks are about how it thinks.
    expect(
      after((d) => {
        d.config.llm.usdc = { ...d.config.llm.usdc!, maxUsdPerDay: 9 };
      }),
    ).toEqual({ name: "n", strategyPrompt: "s" });
  });

  it("is null once nothing is left", () => {
    expect(
      stillRefused({ name: "n" }, before, {
        ...before,
        name: "Aileen the Second",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------- changedSteps

describe("changedSteps", () => {
  const saved = agent();
  const steps = (change: (d: BuilderDraft) => void, of: Agent = saved) => [...changedSteps(edited(of, change), of)];

  it("is empty for an untouched agent, whatever it is saved as", () => {
    for (const untouched of [
      agent(),
      agent({ tagline: null, avatarSeed: null, llmKeyId: null }),
      agent({ llmKeyId: null, config: usdcConfig() }),
    ]) {
      expect(steps(() => {}, untouched)).toEqual([]);
    }
  });

  it("marks only the step whose controls write what was edited", () => {
    const edits: Array<[SharedStepId, (d: BuilderDraft) => void]> = [
      ["name", (d) => void (d.name = "Aileen the Second")],
      ["name", (d) => void (d.tagline = "Sells the second.")],
      ["name", (d) => void (d.avatarSeed = "ember")],
      ["name", (d) => void (d.isPublic = false)],
      ["strategy", (d) => void (d.config.strategyPrompt += " And never on a Sunday.")],
      ["hunts", (d) => void (d.config.chains = ["solana", "base"])],
      ["hunts", (d) => void (d.config.universe.minScore = 70)],
      ["hunts", (d) => void (d.config.universe.blocklist = [{ chain: "solana", address: "So111", symbol: "X" }])],
      ["data", (d) => void (d.config.dataSources = [])],
      ["limits", (d) => void (d.config.risk.maxTradeUsd = 250)],
      ["limits", (d) => void (d.config.risk.stopLossPct = null)],
      ["limits", (d) => void (d.config.risk.sizing = { ...DEFAULT_SIZING, percentOfEquity: 20 })],
      ["schedule", (d) => void (d.config.schedule = { intervalMinutes: 60 })],
      ["schedule", (d) => void (d.config.execution = { mode: "auto", proposalTtlMinutes: 60 })],
      ["brain", (d) => void (d.config.llm.model = "claude-other-model")],
      ["brain", (d) => void (d.config.llm.maxSteps = 12)],
      ["brain", (d) => void (d.llmKeyId = "key_b")],
      ["brain", (d) => void (d.llmKeyId = null)],
    ];
    for (const [step, change] of edits) expect(steps(change), change.toString()).toEqual([step]);
  });

  it("answers in rail order when several steps are edited", () => {
    expect(
      steps((d) => {
        d.config.llm.temperature = 1;
        d.config.risk.maxTradeUsd = 250;
        d.name = "Aileen the Second";
      }),
    ).toEqual(["name", "limits", "brain"]);
    // A preset writes several sections at once, and each step it touched says so.
    expect(
      steps((d) => {
        d.config = chooseSource(d.config, "usdc").config;
      }),
    ).toEqual(["schedule", "brain"]);
  });

  it("covers every section of the config, so none can change unseen", () => {
    const other: { [K in keyof AgentConfig]: AgentConfig[K] } = {
      strategyPrompt: "Another strategy, long enough to be one.",
      dataSources: ["something-else"],
      chains: ["base"],
      universe: { ...saved.config.universe, minScore: 1 },
      risk: { ...saved.config.risk, maxTradeUsd: 1 },
      execution: { mode: "auto", proposalTtlMinutes: 5 },
      schedule: { intervalMinutes: 1_440 },
      llm: { ...saved.config.llm, temperature: 1.5 },
    };
    expect(Object.keys(other).sort()).toEqual(Object.keys(saved.config).sort());
    for (const key of Object.keys(saved.config) as Array<keyof AgentConfig>) {
      const marked = steps((d) => {
        d.config = { ...d.config, [key]: other[key] };
      });
      expect(marked, key).toHaveLength(1);
    }
  });

  it("does not take jsonb's key order for a change", () => {
    const fromJsonb = { ...saved, config: reordered(saved.config) };
    expect(JSON.stringify(fromJsonb.config)).not.toBe(JSON.stringify(saved.config));
    expect([...changedSteps(edited(saved), fromJsonb)]).toEqual([]);
    expect(
      [
        ...changedSteps(
          edited(saved, (d) => {
            d.config.risk.maxTradeUsd = 250;
          }),
          fromJsonb,
        ),
      ],
    ).toEqual(["limits"]);
  });

  it("does not take a space after the name or the tagline for a change", () => {
    expect(steps((d) => void (d.name = "Aileen "))).toEqual([]);
    expect(steps((d) => void (d.tagline = " Buys the first hour.  "))).toEqual([]);
    // An agent with no tagline has an empty one, and spaces are still none.
    const none = agent({ tagline: null });
    expect(steps((d) => void (d.tagline = "  "), none)).toEqual([]);
    expect(steps((d) => void (d.tagline = "One."), none)).toEqual(["name"]);
  });

  it("ignores the key on pay per use, which is saved with none", () => {
    const paying = agent({ llmKeyId: null, config: usdcConfig() });
    expect(steps((d) => void (d.llmKeyId = "key_a"), paying)).toEqual([]);
    // Switching to it with a key still chosen is one change, the mode.
    expect(
      steps((d) => {
        d.config = { ...d.config, llm: chooseSource(d.config, "usdc").config.llm };
      }),
    ).toEqual(["brain"]);
  });

  it("says a pay-per-use agent saved without its limits has them to save", () => {
    const bare = agent({
      llmKeyId: null,
      config: config((c) => {
        c.llm = { ...c.llm, source: "usdc" };
      }),
    });
    expect(steps(() => {}, bare)).toEqual(["brain"]);
  });

  it("is unsaved exactly when the old form said so", () => {
    for (const { what, saved: of, draft, allowed } of EDITS) {
      expect(changedSteps(draft, of).size > 0, what).toBe(formerDirty(draft, of, allowed));
    }
    // The table has both answers in it.
    const answers = new Set(EDITS.map(({ saved: of, draft, allowed }) => formerDirty(draft, of, allowed)));
    expect(answers.size).toBe(2);
  });
});

// ---------------------------------------------------------------------- editStatus

describe("editStatus", () => {
  const none = new Set<SharedStepId>();

  it("is the rail's word for a step: as saved, changed, or to fix", () => {
    const changed = new Set<SharedStepId>(["limits"]);
    expect(editStatus("limits", changed, {})).toBe("edited");
    expect(editStatus("schedule", changed, {})).toBe("defaults");
    expect(editStatus("name", changed, { name: "Give it a name — at least two characters." })).toBe("fix");
  });

  it("puts each error on the step that holds its control", () => {
    const where: Record<string, SharedStepId> = {
      name: "name",
      strategyPrompt: "strategy",
      chains: "hunts",
      llmKeyId: "brain",
      thinking: "brain",
      llm: "brain",
    };
    for (const [key, step] of Object.entries(where)) {
      for (const candidate of SETTINGS_STEPS) {
        expect(editStatus(candidate, none, { [key]: "wrong" }), `${key} on ${candidate}`).toBe(
          candidate === step ? "fix" : "defaults",
        );
      }
    }
  });

  it("lets a mistake win over an unsaved edit", () => {
    expect(editStatus("brain", new Set<SharedStepId>(["brain"]), { llmKeyId: "wrong" })).toBe("fix");
  });

  it("never marks Manage, where nothing waits for Save", () => {
    const all = new Set<SharedStepId>(["name", "strategy", "hunts", "data", "limits", "schedule", "brain"]);
    expect(editStatus("manage", all, { name: "wrong", llmKeyId: "wrong", somethingElse: "wrong" })).toBe("defaults");
  });

  it("marks nothing for an error with no home on these steps", () => {
    for (const step of SETTINGS_STEPS) {
      expect(editStatus(step, none, { somethingElse: "wrong" }), step).toBe("defaults");
    }
  });

  it("reads as the page shows it: an agent with no key has Brain to fix and nothing unsaved", () => {
    const noKey = agent({ llmKeyId: null });
    const draft = edited(noKey);
    const errors = shownErrors(draft, [anthropic, second], { payPerUseOffered: false }, null);
    const changed = changedSteps(draft, noKey);
    expect(SETTINGS_STEPS.map((step) => editStatus(step, changed, errors, noKey))).toEqual([
      "defaults",
      "defaults",
      "defaults",
      "defaults",
      "defaults",
      "defaults",
      "fix",
      "defaults",
    ]);
    expect(saveStateText(changed, false)).toBe("Everything is saved");
  });
});

// ---------------------------------------------------------------------- the bar's sentence

describe("saveStateText", () => {
  const set = (...steps: SharedStepId[]) => new Set<SharedStepId>(steps);

  it("says so when everything is saved, live or not", () => {
    expect(saveStateText(set(), false)).toBe("Everything is saved");
    expect(saveStateText(set(), true)).toBe("Everything is saved");
  });

  it("counts the steps with unsaved edits and names up to three, in rail order", () => {
    expect(saveStateText(set("limits"), false)).toBe("Unsaved changes on 1 step: Risk limits");
    expect(saveStateText(set("schedule", "limits"), false)).toBe(
      "Unsaved changes on 2 steps: Risk limits, Schedule & mode",
    );
    expect(saveStateText(set("brain", "name", "hunts"), false)).toBe(
      "Unsaved changes on 3 steps: Name, Where it hunts, How it thinks",
    );
  });

  it("only counts them past three", () => {
    expect(saveStateText(set("name", "strategy", "data", "brain"), false)).toBe("Unsaved changes on 4 steps");
    expect(saveStateText(set("name", "strategy", "hunts", "data", "limits", "schedule", "brain"), false)).toBe(
      "Unsaved changes on 7 steps",
    );
  });

  it("says when a save takes effect on an agent that trades real money", () => {
    expect(saveStateText(set("limits"), true)).toBe(
      "Unsaved changes on 1 step: Risk limits · applies to real money from the next tick",
    );
    expect(saveStateText(set("name", "strategy", "data", "brain"), true)).toBe(
      "Unsaved changes on 4 steps · applies to real money from the next tick",
    );
  });

  it("has a short form for a phone", () => {
    expect(saveStateShort(set())).toBe("Everything is saved");
    expect(saveStateShort(set("limits"))).toBe("1 step unsaved");
    expect(saveStateShort(set("limits", "schedule"))).toBe("2 steps unsaved");
  });

  it("has a name for each of the seven steps that hold settings", () => {
    expect(Object.keys(UNSAVED_STEP_NAMES)).toEqual(SETTINGS_STEPS.filter((step) => step !== "manage"));
  });
});

// ---------------------------------------------------------------------- a live agent

describe("liveSaveWarnings", () => {
  const saved = config();
  const warnings = (change: (c: Config) => void, from: Config = saved) =>
    liveSaveWarnings(from, config((c) => {
      Object.assign(c, structuredClone(from));
      change(c);
    }));
  const sized = (sizing: Partial<PositionSizingConfig>) =>
    config((c) => {
      c.risk.sizing = { ...DEFAULT_SIZING, ...sizing };
    });

  it("asks nothing when nothing changed", () => {
    expect(liveSaveWarnings(saved, config())).toEqual([]);
    expect(liveSaveWarnings(saved, reordered(saved))).toEqual([]);
  });

  it("warns when one of the four caps or the slippage is raised", () => {
    expect(warnings((c) => void (c.risk.maxTradeUsd = 250))).toEqual(["Max per trade $100.00 → $250.00"]);
    expect(warnings((c) => void (c.risk.maxDailyTrades = 20))).toEqual(["Max trades per day 10 → 20"]);
    expect(warnings((c) => void (c.risk.maxPositionPct = 40))).toEqual(["Max position size 25% → 40%"]);
    expect(warnings((c) => void (c.risk.maxDataSpendUsdPerRun = 2.5))).toEqual([
      "Data spend cap per run $1.00 → $2.50",
    ]);
    expect(warnings((c) => void (c.risk.slippageBps = 500))).toEqual(["Slippage tolerance 3.00% → 5.00%"]);
  });

  it("does not warn when any of them is lowered", () => {
    expect(warnings((c) => void (c.risk.maxTradeUsd = 50))).toEqual([]);
    expect(warnings((c) => void (c.risk.maxDailyTrades = 5))).toEqual([]);
    expect(warnings((c) => void (c.risk.maxPositionPct = 10))).toEqual([]);
    expect(warnings((c) => void (c.risk.maxDataSpendUsdPerRun = 0.25))).toEqual([]);
    expect(warnings((c) => void (c.risk.slippageBps = 100))).toEqual([]);
    expect(
      warnings((c) => {
        c.risk = { ...c.risk, maxTradeUsd: 1, maxDailyTrades: 1, maxPositionPct: 1, maxDataSpendUsdPerRun: 0, slippageBps: 10 };
      }),
    ).toEqual([]);
  });

  it("does not take a slider's rounding for a raise", () => {
    const from = config((c) => {
      c.risk.maxDataSpendUsdPerRun = 0.15;
    });
    expect(warnings((c) => void (c.risk.maxDataSpendUsdPerRun = 0.1 + 0.05), from)).toEqual([]);
    expect(0.1 + 0.05).not.toBe(0.15);
    expect(warnings((c) => void (c.risk.maxDataSpendUsdPerRun = 0.16), from)).toEqual([
      "Data spend cap per run $0.15 → $0.16",
    ]);
  });

  it("warns when a saved cap cannot be read and a number is put in its place", () => {
    const from = config((c) => {
      c.risk.maxTradeUsd = Number.NaN;
    });
    expect(warnings((c) => void (c.risk.maxTradeUsd = 100), from)).toHaveLength(1);
    // Left as it was, it is not a change.
    expect(liveSaveWarnings(from, structuredClone(from))).toEqual([]);
  });

  it("warns when it stops asking first, and not when it starts to", () => {
    expect(warnings((c) => void (c.execution = { mode: "auto", proposalTtlMinutes: 60 }))).toEqual([
      "Trades on its own, without asking you",
    ]);
    const auto = config((c) => {
      c.execution = { mode: "auto", proposalTtlMinutes: 60 };
    });
    expect(warnings((c) => void (c.execution = { mode: "approve", proposalTtlMinutes: 60 }), auto)).toEqual([]);
    expect(warnings((c) => void (c.execution = { mode: "auto", proposalTtlMinutes: 5 }), auto)).toEqual([]);
    // A longer or shorter time to decide is still asking.
    expect(warnings((c) => void (c.execution = { mode: "approve", proposalTtlMinutes: 5 }))).toEqual([]);
  });

  it("warns when a chain is added, and not when one is taken away", () => {
    expect(warnings((c) => void (c.chains = ["solana", "base"]))).toEqual(["Also trades on Base"]);
    const both = config((c) => {
      c.chains = ["solana", "base"];
    });
    expect(warnings((c) => void (c.chains = ["base"]), both)).toEqual([]);
    expect(warnings((c) => void (c.chains = ["base", "solana"]), both)).toEqual([]);
    expect(warnings((c) => void (c.chains = ["base"]))).toEqual(["Also trades on Base"]);
  });

  it("warns when a stop loss, a score floor or a liquidity exit is switched off", () => {
    expect(warnings((c) => void (c.risk.stopLossPct = null))).toEqual(["Stop loss switched off (was 15%)"]);
    expect(warnings((c) => void (c.risk.exitScoreBelow = null))).toEqual(["Score floor switched off (was 40)"]);
    expect(warnings((c) => void (c.risk.exitOnLiquidityDropPct = null))).toEqual([
      "Liquidity collapse exit switched off (was 50%)",
    ]);
  });

  it("warns when one of them is set wider, and not when it is set tighter or switched on", () => {
    expect(warnings((c) => void (c.risk.stopLossPct = 25))).toEqual(["Stop loss 15% → 25%"]);
    expect(warnings((c) => void (c.risk.stopLossPct = 10))).toEqual([]);
    // A score floor lets more through when it goes down.
    expect(warnings((c) => void (c.risk.exitScoreBelow = 30))).toEqual(["Score floor 40 → 30"]);
    expect(warnings((c) => void (c.risk.exitScoreBelow = 50))).toEqual([]);
    expect(warnings((c) => void (c.risk.exitOnLiquidityDropPct = 70))).toEqual(["Liquidity collapse exit 50% → 70%"]);
    expect(warnings((c) => void (c.risk.exitOnLiquidityDropPct = 30))).toEqual([]);
    const off = config((c) => {
      c.risk = { ...c.risk, stopLossPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null };
    });
    expect(
      warnings((c) => {
        c.risk = { ...c.risk, stopLossPct: 90, exitScoreBelow: 5, exitOnLiquidityDropPct: 90 };
      }, off),
    ).toEqual([]);
  });

  it("does not ask about the exits that bank a gain or free up capital", () => {
    expect(
      warnings((c) => {
        c.risk = { ...c.risk, takeProfitPct: null, trailingStopPct: 50, maxHoldHours: 72 };
      }),
    ).toEqual([]);
  });

  it("warns when position sizing can make a ticket larger", () => {
    const share = sized({ mode: "percent_equity", percentOfEquity: 10 });
    const scaled = sized({ mode: "volatility_scaled", percentOfEquity: 10, referenceRangePct: 25 });
    expect(warnings((c) => void (c.risk.sizing = { ...DEFAULT_SIZING }), share)).toEqual([
      "Position sizing 10% of equity → fixed at the max per trade",
    ]);
    expect(warnings((c) => void (c.risk.sizing!.percentOfEquity = 20), share)).toEqual([
      "Position sizing 10% of equity → 20% of equity",
    ]);
    expect(warnings((c) => void (c.risk.sizing!.mode = "percent_equity"), scaled)).toEqual([
      "Position sizing 10% of equity, less on a token ranging over 25% → 10% of equity",
    ]);
    expect(warnings((c) => void (c.risk.sizing!.referenceRangePct = 50), scaled)).toEqual([
      "Position sizing 10% of equity, less on a token ranging over 25% → 10% of equity, less on a token ranging over 50%",
    ]);
    expect(warnings((c) => void (c.risk.sizing = { ...DEFAULT_SIZING }), scaled)).toHaveLength(1);
  });

  it("does not warn when sizing can only make a ticket smaller, or the same", () => {
    const share = sized({ mode: "percent_equity", percentOfEquity: 10 });
    const scaled = sized({ mode: "volatility_scaled", percentOfEquity: 10, referenceRangePct: 25 });
    // A fixed ticket is the largest there is under the cap.
    expect(warnings((c) => void (c.risk.sizing = { ...DEFAULT_SIZING, mode: "percent_equity" }))).toEqual([]);
    expect(warnings((c) => void (c.risk.sizing = { ...DEFAULT_SIZING, mode: "volatility_scaled" }))).toEqual([]);
    expect(warnings((c) => void (c.risk.sizing!.percentOfEquity = 5), share)).toEqual([]);
    expect(warnings((c) => void (c.risk.sizing!.mode = "volatility_scaled"), share)).toEqual([]);
    expect(warnings((c) => void (c.risk.sizing!.referenceRangePct = 10), scaled)).toEqual([]);
    expect(warnings((c) => void (c.risk.sizing!.percentOfEquity = 5), scaled)).toEqual([]);
    // The floor under a ticket is advice, not a rule, and moves no money.
    expect(warnings((c) => void (c.risk.sizing!.minTradeUsd = 500), share)).toEqual([]);
    // A config from before sizing existed is a fixed ticket, and writing that down changes nothing.
    const legacy = config((c) => {
      delete c.risk.sizing;
    });
    expect(warnings((c) => void (c.risk.sizing = { ...DEFAULT_SIZING }), legacy)).toEqual([]);
  });

  it("asks nothing about a change that moves no limit", () => {
    expect(warnings((c) => void (c.strategyPrompt = "A whole new strategy, with nothing held back at all."))).toEqual([]);
    expect(
      warnings((c) => {
        c.universe = { ...c.universe, minScore: 0, minLiquidityUsd: 0, requireMintRevoked: false, discovery: ["new_launches"] };
      }),
    ).toEqual([]);
    expect(warnings((c) => void (c.dataSources = []))).toEqual([]);
    expect(warnings((c) => void (c.schedule = { intervalMinutes: 5 }))).toEqual([]);
    expect(warnings((c) => void (c.llm = { ...c.llm, model: "claude-other-model", temperature: 1.5, maxSteps: 40 }))).toEqual([]);
    expect(liveSaveWarnings(saved, usdcConfig())).toEqual([]);
  });

  it("lists everything a save loosens, in the order the limits are set", () => {
    const from = sized({ mode: "percent_equity", percentOfEquity: 10 });
    expect(
      warnings((c) => {
        c.risk = {
          ...c.risk,
          maxTradeUsd: 250,
          maxDailyTrades: 20,
          maxPositionPct: 40,
          maxDataSpendUsdPerRun: 2,
          slippageBps: 1_000,
          stopLossPct: null,
          exitScoreBelow: 20,
          exitOnLiquidityDropPct: null,
          sizing: { ...DEFAULT_SIZING },
        };
        c.execution = { mode: "auto", proposalTtlMinutes: 60 };
        c.chains = ["solana", "base"];
        c.strategyPrompt = "A whole new strategy, with nothing held back at all.";
      }, from),
    ).toEqual([
      "Max per trade $100.00 → $250.00",
      "Max trades per day 10 → 20",
      "Max position size 25% → 40%",
      "Data spend cap per run $1.00 → $2.00",
      "Slippage tolerance 3.00% → 10.00%",
      "Position sizing 10% of equity → fixed at the max per trade",
      "Trades on its own, without asking you",
      "Also trades on Base",
      "Stop loss switched off (was 15%)",
      "Score floor 40 → 20",
      "Liquidity collapse exit switched off (was 50%)",
    ]);
  });

  it("only lists what is loosened when a save tightens other things", () => {
    expect(
      warnings((c) => {
        c.risk = { ...c.risk, maxTradeUsd: 250, maxDailyTrades: 2, stopLossPct: 5 };
      }),
    ).toEqual(["Max per trade $100.00 → $250.00"]);
  });

  it("is switched on", () => {
    expect(CONFIRM_LIVE_SAVES).toBe(true);
  });
});

// ---------------------------------------------------------------------- the working copy

describe("editReducer", () => {
  const saved = agent();
  const base = draftOf(saved, saved.config);
  const start = (): EditState => startEdit(base);
  /** The saved agent as the page is handed it again: a new object every time. */
  const again = (over: Partial<Agent> = {}, change: (c: Config) => void = () => {}) => {
    const next = agent({ ...over, config: config(change) });
    return draftOf(next, next.config);
  };
  const editRisk = (state: EditState, maxTradeUsd: number) =>
    editReducer(state, { type: "edit", config: { risk: { ...state.working.config.risk, maxTradeUsd } } });

  it("tells two copies apart by what a save writes, and by nothing else", () => {
    expect(sameSettings(base, again())).toBe(true);
    expect(sameSettings(base, again({ status: "paused", paperStartingUsd: 500 }))).toBe(true);
    expect(sameSettings(base, { ...base, config: reordered(base.config) })).toBe(true);
    for (const other of [
      again({ name: "Aileen the Second" }),
      again({ tagline: null }),
      again({ avatarSeed: "ember" }),
      again({ isPublic: false }),
      again({ llmKeyId: null }),
      again({}, (c) => void (c.risk.maxTradeUsd = 250)),
    ]) {
      expect(sameSettings(base, other)).toBe(false);
    }
  });

  it("opens on the saved agent, with nothing awaited and nothing refused", () => {
    expect(start()).toEqual({ working: base, saved: base, pending: null, refused: null, quietKey: 0, edits: 0 });
  });

  it("applies an edit to the draft, to its config, or to both", () => {
    let state = editReducer(start(), { type: "edit", patch: { name: "Aileen the Second", isPublic: false } });
    expect(state.working).toEqual({ ...base, name: "Aileen the Second", isPublic: false });
    state = editRisk(state, 250);
    expect(state.working.name).toBe("Aileen the Second");
    expect(state.working.config.risk.maxTradeUsd).toBe(250);
    expect(state.working.config.universe).toBe(base.config.universe);
    state = editReducer(state, {
      type: "edit",
      patch: { llmKeyId: "key_b" },
      config: { schedule: { intervalMinutes: 60 } },
    });
    expect(state.working.llmKeyId).toBe("key_b");
    expect(state.working.config.schedule).toEqual({ intervalMinutes: 60 });
    expect(state.working.config.risk.maxTradeUsd).toBe(250);
    // The saved copy is not what an edit writes.
    expect(state.saved).toBe(base);
    expect(base.config.risk.maxTradeUsd).toBe(100);
  });

  it("never lets the page being handed the agent again change the working copy", () => {
    let state = editRisk(start(), 250);
    const working = state.working;
    // A pause, a deposit, a wallet budget, and another tab's save of other settings.
    for (const handed of [
      again({ status: "paused" }),
      again(),
      again({ name: "Renamed elsewhere", tagline: null }, (c) => void (c.risk.maxTradeUsd = 5)),
    ]) {
      state = editReducer(state, { type: "propsChanged", saved: handed });
      expect(state.working).toBe(working);
      expect(state.saved).toBe(handed);
      expect(state.quietKey).toBe(0);
    }
    // What is unsaved is always judged against what the server holds now.
    expect(state.saved.config.risk.maxTradeUsd).toBe(5);
  });

  it("does nothing when it is told about the copy it already has", () => {
    const state = editRisk(start(), 250);
    expect(editReducer(state, { type: "propsChanged", saved: state.saved })).toBe(state);
  });

  it("takes the server's copy once its own save has come back", () => {
    let state = editReducer(start(), { type: "edit", patch: { name: "Aileen the Second " } });
    state = editRisk(state, 250);
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    // Nothing moves until the page is handed the agent as the server now holds it.
    expect(state.working).toBe(sent);
    expect(state.pending).toEqual({ sent, base });
    const server = again({ name: "Aileen the Second" }, (c) => void (c.risk.maxTradeUsd = 250));
    state = editReducer(state, { type: "propsChanged", saved: server });
    expect(state.working).toBe(server);
    expect(state.working.name).toBe("Aileen the Second");
    expect(state.saved).toBe(server);
    expect(state.pending).toBeNull();
    expect(state.quietKey).toBe(1);
  });

  it("keeps what was typed between the save and its answer", () => {
    let state = editReducer(start(), { type: "edit", patch: { name: "Aileen the Second " } });
    state = editRisk(state, 250);
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    state = editReducer(state, { type: "edit", patch: { tagline: "Typed since." } });
    state = editReducer(state, { type: "edit", config: { schedule: { intervalMinutes: 60 } } });
    const server = again({ name: "Aileen the Second" }, (c) => void (c.risk.maxTradeUsd = 250));
    state = editReducer(state, { type: "propsChanged", saved: server });
    // What was sent comes back as the server holds it, and what was typed since stays.
    expect(state.working.name).toBe("Aileen the Second");
    expect(state.working.config.risk).toBe(server.config.risk);
    expect(state.working.tagline).toBe("Typed since.");
    expect(state.working.config.schedule).toEqual({ intervalMinutes: 60 });
    expect(state.pending).toBeNull();
    expect([...changedSteps(state.working, { ...agent({ name: "Aileen the Second" }), config: server.config as AgentConfig })]).toEqual([
      "name",
      "schedule",
    ]);
  });

  it("does not take a refresh that was already on its way for the answer to a save", () => {
    let state = editRisk(start(), 250);
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    // A pause pressed a moment before the save: the agent as it was, paused.
    const stale = again({ status: "paused" });
    state = editReducer(state, { type: "propsChanged", saved: stale });
    expect(state.working).toBe(sent);
    expect(state.working.config.risk.maxTradeUsd).toBe(250);
    expect(state.saved).toBe(stale);
    expect(state.pending).not.toBeNull();
    const server = again({ status: "paused" }, (c) => void (c.risk.maxTradeUsd = 250));
    state = editReducer(state, { type: "propsChanged", saved: server });
    expect(state.working).toBe(server);
    expect(state.pending).toBeNull();
  });

  it("does not wait for an answer the page was handed before it heard of the save", () => {
    let state = editReducer(start(), { type: "edit", patch: { name: "Aileen the Second " } });
    state = editRisk(state, 250);
    const sent = state.working;
    const server = again({ name: "Aileen the Second" }, (c) => void (c.risk.maxTradeUsd = 250));
    state = editReducer(state, { type: "propsChanged", saved: server });
    expect(state.working).toBe(sent);
    state = editReducer(state, { type: "saved", sent });
    expect(state.working).toBe(server);
    expect(state.pending).toBeNull();
    expect(state.quietKey).toBe(1);
    // So a later refresh is only a refresh, whatever it carries.
    state = editRisk(state, 500);
    const working = state.working;
    state = editReducer(state, { type: "propsChanged", saved: again({ name: "Renamed elsewhere" }) });
    expect(state.working).toBe(working);
  });

  it("goes back to what is saved on Discard, and to a copy that is put back", () => {
    let state = editRisk(start(), 250);
    state = editReducer(state, { type: "refused", errors: { name: "wrong" } });
    const before = state.working;
    state = editReducer(state, { type: "discard" });
    expect(state.working).toBe(base);
    expect(state.refused).toBeNull();
    expect(state.quietKey).toBe(1);
    // Undo, offered as the discard was made.
    state = editReducer(state, { type: "restore", draft: before, since: state.edits });
    expect(state.working).toBe(before);
    expect(state.saved).toBe(base);
    expect(state.quietKey).toBe(2);
  });

  it("counts what the owner changes, and nothing the page does by itself", () => {
    let state = editRisk(start(), 250);
    expect(state.edits).toBe(1);
    state = editReducer(state, { type: "edit", patch: { tagline: "Typed." } });
    expect(state.edits).toBe(2);
    // The page handed the agent again, a refused save, a save and its answer, a discard.
    state = editReducer(state, { type: "propsChanged", saved: again({ status: "paused" }) });
    state = editReducer(state, { type: "refused", errors: { name: "wrong" } });
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    state = editReducer(state, {
      type: "propsChanged",
      saved: again({ tagline: "Typed." }, (c) => void (c.risk.maxTradeUsd = 250)),
    });
    state = editReducer(state, { type: "discard" });
    expect(state.edits).toBe(2);
    // A copy put back is the owner's doing.
    state = editReducer(state, { type: "restore", draft: sent, since: 2 });
    expect(state.edits).toBe(3);
  });

  it("does not put a copy back over anything edited since it was offered", () => {
    // Edits left behind on an earlier visit: only the tagline.
    const left: BuilderDraft = { ...base, tagline: "Left behind." };
    // The offer goes up as the page opens, and the owner drags a limit before pressing it.
    const offered = start().edits;
    const dragged = editRisk(start(), 250);
    const state = editReducer(dragged, { type: "restore", draft: left, since: offered });
    expect(state).toBe(dragged);
    expect(state.working.config.risk.maxTradeUsd).toBe(250);
    expect(state.working.tagline).toBe(base.tagline);
    // Pressed before anything was edited, it is put back whole.
    expect(editReducer(start(), { type: "restore", draft: left, since: offered }).working).toBe(left);
  });

  it("does not undo a discard over anything edited after it", () => {
    let state = editRisk(start(), 250);
    const discarded = state.working;
    const offered = state.edits;
    state = editReducer(state, { type: "discard" });
    state = editReducer(state, { type: "edit", patch: { tagline: "Typed after the discard." } });
    const typed = state;
    state = editReducer(state, { type: "restore", draft: discarded, since: offered });
    expect(state).toBe(typed);
    expect(state.working.tagline).toBe("Typed after the discard.");
    expect(state.working.config.risk.maxTradeUsd).toBe(100);
  });

  it("still undoes a discard after the page was handed the agent again, or a save's answer came", () => {
    let state = editRisk(start(), 250);
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    state = editRisk(state, 500);
    const discarded = state.working;
    const offered = state.edits;
    state = editReducer(state, { type: "discard" });
    // The answer replaces the working copy whole, and a pause refreshes the page. Neither
    // is an edit, so the copy on offer is still the newest thing the owner did.
    state = editReducer(state, { type: "propsChanged", saved: again({}, (c) => void (c.risk.maxTradeUsd = 250)) });
    state = editReducer(state, {
      type: "propsChanged",
      saved: again({ status: "paused" }, (c) => void (c.risk.maxTradeUsd = 250)),
    });
    state = editReducer(state, { type: "restore", draft: discarded, since: offered });
    expect(state.working).toBe(discarded);
    expect(state.working.config.risk.maxTradeUsd).toBe(500);
  });

  it("lets one copy be put back, not two over each other", () => {
    // Two offers from the same moment: the first press makes the second one stale.
    const first: BuilderDraft = { ...base, tagline: "First." };
    const second: BuilderDraft = { ...base, tagline: "Second." };
    let state = editReducer(start(), { type: "restore", draft: first, since: 0 });
    const restored = state;
    state = editReducer(state, { type: "restore", draft: second, since: 0 });
    expect(state).toBe(restored);
    expect(state.working).toBe(first);
  });

  it("discards to what the server holds now, not to what the page opened on", () => {
    let state = editRisk(start(), 250);
    const handed = again({ status: "paused" }, (c) => void (c.risk.maxDailyTrades = 3));
    state = editReducer(state, { type: "propsChanged", saved: handed });
    state = editReducer(state, { type: "discard" });
    expect(state.working).toBe(handed);
  });

  it("discards to what was sent while a save's answer is still awaited", () => {
    let state = editRisk(start(), 250);
    const sent = state.working;
    state = editReducer(state, { type: "saved", sent });
    state = editRisk(state, 500);
    state = editReducer(state, { type: "discard" });
    expect(state.working).toBe(sent);
    // And the answer still brings the server's copy.
    const server = again({}, (c) => void (c.risk.maxTradeUsd = 250));
    state = editReducer(state, { type: "propsChanged", saved: server });
    expect(state.working).toBe(server);
  });

  it("holds the errors of a refused save until each thing is edited", () => {
    let state = editReducer(start(), { type: "edit", patch: { name: "" }, config: { strategyPrompt: "" } });
    const errors = validateEdit(state.working, saved);
    expect(Object.keys(errors)).toEqual(["name", "strategyPrompt"]);
    state = editReducer(state, { type: "refused", errors });
    expect(state.refused).toEqual(errors);
    state = editRisk(state, 250);
    expect(state.refused).toEqual(errors);
    state = editReducer(state, { type: "edit", patch: { name: "Ai" } });
    expect(state.refused).toEqual({ strategyPrompt: errors.strategyPrompt });
    state = editReducer(state, { type: "edit", config: { strategyPrompt: base.config.strategyPrompt } });
    expect(state.refused).toBeNull();
  });

  it("forgets a refusal when a save goes through, and holds none for a save with nothing wrong", () => {
    let state = editReducer(start(), { type: "refused", errors: {} });
    expect(state.refused).toBeNull();
    state = editReducer(editRisk(state, 250), { type: "refused", errors: { name: "wrong" } });
    state = editReducer(state, { type: "saved", sent: state.working });
    expect(state.refused).toBeNull();
  });
});
