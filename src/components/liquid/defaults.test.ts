import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, PROVIDER_ORDER, providersInOrder, type CatalogueId } from "@/lib/agent/providers";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/platform/fee";
import { inferenceFlags } from "@/lib/x402/inference-types";
import { DEFAULT_ROWS, LANDING_DEFAULTS, MODE_WORDS, feeSentence, providerWords, thinkingAnswers } from "./defaults";

/** The Guardrails card quotes a new agent's defaults; the agent config is the truth. */
describe("the landing's defaults card", () => {
  it("quotes DEFAULT_AGENT_CONFIG", () => {
    expect(LANDING_DEFAULTS).toEqual({
      mode: C.execution.mode,
      intervalMinutes: C.schedule.intervalMinutes,
      chains: C.chains,
      dataSources: C.dataSources,
      minScore: C.universe.minScore,
      maxTradeUsd: C.risk.maxTradeUsd,
      maxDailyTrades: C.risk.maxDailyTrades,
      stopLossPct: C.risk.stopLossPct,
      takeProfitPct: C.risk.takeProfitPct,
      slippageBps: C.risk.slippageBps,
      maxDataSpendUsdPerRun: C.risk.maxDataSpendUsdPerRun,
      minLiquidityUsd: C.universe.minLiquidityUsd,
      minAgeMinutes: C.universe.minAgeMinutes,
    });
  });

  it("prints an even number of rows, so the two-column card has no hole", () => {
    expect(DEFAULT_ROWS.length % 2).toBe(0);
  });

  it("says what the default mode does", () => {
    const mode = DEFAULT_ROWS.find(([k]) => k === "Mode")?.[1];
    expect(mode).toBe(MODE_WORDS[C.execution.mode]);
    expect(MODE_WORDS.approve).toBe("asks first");
  });

  it("names the default chains, then the opt-in, without a break inside the brackets", () => {
    const chains = DEFAULT_ROWS.find(([k]) => k === "Chains")?.[1] ?? "";
    expect(chains.startsWith("Solana")).toBe(true);
    expect(chains).toContain("(Base opt‑in)");
  });
});

/** The FAQ states what Tocker charges; the rate is the fee module's, not the page's. */
describe("the landing's fee sentence", () => {
  it("states the rate the product charges by default", () => {
    expect(DEFAULT_PLATFORM_FEE_BPS).toBe(50);
    expect(feeSentence(DEFAULT_PLATFORM_FEE_BPS)).toBe(" What Tocker charges is 0.5% of each filled trade, buy or sell.");
  });

  it("states whatever rate it is handed, in the same words", () => {
    expect(feeSentence(25)).toBe(" What Tocker charges is 0.25% of each filled trade, buy or sell.");
    expect(feeSentence(100)).toBe(" What Tocker charges is 1% of each filled trade, buy or sell.");
  });

  it("no longer says the fee is flat, or that it is never a share of the trade", () => {
    const said = feeSentence(DEFAULT_PLATFORM_FEE_BPS);
    expect(said).not.toMatch(/flat|\$|never a percentage/);
  });

  it("says nothing about a fee when there is none", () => {
    expect(feeSentence(0)).toBe("");
    expect(feeSentence(Number.NaN)).toBe("");
    expect(feeSentence(-50)).toBe("");
  });
});

/**
 * Whether an agent needs an API key depends on a switch that ships off. While it is
 * anything but fully on, the page says what it has always said, to the letter.
 */
describe("the landing's answers about where an agent thinks", () => {
  /** The three providers the product started with, as the chooser orders and names them. */
  const THREE = ["Anthropic", "OpenAI", "OpenRouter"];
  const KEY_MODEL =
    "The one you choose, on your own key: Anthropic, OpenAI or OpenRouter. Keys are encrypted at rest and decrypted only on our servers, to run your agent and to list the models your key can use. Your provider bills you for the model directly.";
  const KEY_START =
    "An email address and an API key for the model your agent runs on (Anthropic, OpenAI or OpenRouter).";

  it("are unchanged while pay-per-use is not open to everyone", () => {
    expect(thinkingAnswers(false, THREE)).toEqual({ model: KEY_MODEL, start: KEY_START });
    const said = JSON.stringify(thinkingAnswers(false, THREE));
    expect(said).not.toMatch(/pay per use|BlockRun|USDC/i);
  });

  it("stay unchanged with the switch unset, off, mistyped, or open to invited accounts only", () => {
    for (const value of [undefined, "", "off", "owner", "ON ", "yes", "1"]) {
      const open = inferenceFlags({ INFERENCE_USDC: value }).stage === "on";
      // "ON " is trimmed and lower-cased by the switch itself, and is the one that opens.
      expect(open).toBe(value === "ON ");
      if (!open) expect(thinkingAnswers(open, THREE)).toEqual({ model: KEY_MODEL, start: KEY_START });
    }
  });

  it("once it is open to everyone, keep the key first and say what pay per use sends out", () => {
    const { model, start } = thinkingAnswers(true, THREE);
    // Everything the key answer said is still said, first.
    expect(model.startsWith(KEY_MODEL)).toBe(true);
    expect(model).toContain("pay per use");
    expect(model).toContain("strategy and transcript are sent to BlockRun and the model provider it uses");
    // A key is no longer needed to start, so the old sentence would be false.
    expect(start).not.toBe(KEY_START);
    expect(start).toContain("your own API key (Anthropic, OpenAI or OpenRouter), which is what we recommend");
    expect(start).toContain("pay per use");
    // The landing no longer promises "nothing to deposit": there is no paper mode on it.
    expect(start).not.toContain("nothing to deposit");
  });
});

/**
 * The answers name the providers a key can be from. The names come from the registry's
 * list of the ones that are switched on, so the page is true on the day a provider is
 * enabled and on the day before, without anyone editing a sentence.
 */
describe("the providers the landing names", () => {
  const label = (id: CatalogueId) => CATALOGUE[id].label;
  const live = PROVIDER_ORDER.map(label);
  const every = providersInOrder(CATALOGUE_IDS).map(label);

  it("names up to three in full, and the first three and more past that", () => {
    expect(providerWords(["Anthropic"])).toBe("Anthropic");
    expect(providerWords(["Anthropic", "OpenAI"])).toBe("Anthropic or OpenAI");
    expect(providerWords(["Anthropic", "OpenAI", "OpenRouter"])).toBe("Anthropic, OpenAI or OpenRouter");
    expect(providerWords(["Anthropic", "OpenAI", "Google Gemini", "xAI"])).toBe("Anthropic, OpenAI, Google Gemini and more");
    expect(providerWords(every)).toBe("Anthropic, OpenAI, Google Gemini and more");
    expect(providerWords([])).toBe("");
  });

  it("reads like this once every provider in the registry is switched on", () => {
    expect(every).toHaveLength(19);
    expect(thinkingAnswers(false, every)).toEqual({
      model:
        "The one you choose, on your own key: Anthropic, OpenAI, Google Gemini and more. Keys are encrypted at rest and decrypted only on our servers, to run your agent and to list the models your key can use. Your provider bills you for the model directly.",
      start:
        "An email address and an API key for the model your agent runs on (Anthropic, OpenAI, Google Gemini and more).",
    });
    expect(thinkingAnswers(true, every).start).toContain(
      "your own API key (Anthropic, OpenAI, Google Gemini and more), which is what we recommend",
    );
  });

  /** What the page is handed today, whatever today's list is. */
  it("never names a provider that is not switched on, and never says more when there is none", () => {
    const enabled = new Set<string>(PROVIDER_IDS);
    for (const open of [false, true]) {
      const said = JSON.stringify(thinkingAnswers(open, live));
      expect(said).toContain(providerWords(live));
      for (const id of CATALOGUE_IDS) {
        if (!enabled.has(id)) expect(said, label(id)).not.toContain(label(id));
      }
      expect(said.includes("and more")).toBe(live.length > 3);
    }
    // The three the product started with lead, in the order they always had.
    expect(live.slice(0, 2)).toEqual(["Anthropic", "OpenAI"]);
    if (live.length === 3) expect(providerWords(live)).toBe("Anthropic, OpenAI or OpenRouter");
  });

  it("still says something true when handed no names", () => {
    const { model, start } = thinkingAnswers(false, []);
    expect(model.startsWith("The one you choose, on your own key. Keys are encrypted")).toBe(true);
    expect(start).toBe("An email address and an API key for the model your agent runs on.");
  });
});
