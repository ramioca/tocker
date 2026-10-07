import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { DEFAULT_PLATFORM_FEE_USD } from "@/lib/platform/fee";
import { inferenceFlags } from "@/lib/x402/inference-types";
import { DEFAULT_ROWS, LANDING_DEFAULTS, MODE_WORDS, feeSentence, thinkingAnswers } from "./defaults";

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

/** The FAQ said "a flat fee" and no amount; the amount is the fee module's, not the page's. */
describe("the landing's fee sentence", () => {
  it("states the fee the product charges, to the cent", () => {
    expect(feeSentence(DEFAULT_PLATFORM_FEE_USD)).toBe(
      ` What Tocker charges is a flat $${DEFAULT_PLATFORM_FEE_USD.toFixed(2)} per filled trade, buy or sell, never a percentage of its size.`,
    );
    expect(feeSentence(0.1)).toContain("a flat $0.10 per filled trade");
    expect(feeSentence(0.25)).toContain("a flat $0.25 per filled trade");
  });

  it("prints a sub-cent fee as it is set rather than rounding it to nothing", () => {
    expect(feeSentence(0.001)).toContain("a flat $0.001 per filled trade");
  });

  it("says nothing about a fee when there is none", () => {
    expect(feeSentence(0)).toBe("");
  });
});

/**
 * Whether an agent needs an API key depends on a switch that ships off. While it is
 * anything but fully on, the page says what it has always said, to the letter.
 */
describe("the landing's answers about where an agent thinks", () => {
  const KEY_MODEL =
    "The one you choose, on your own key: Anthropic, OpenAI or OpenRouter. Keys are encrypted at rest and decrypted only on our servers, to run your agent and to list the models your key can use. Your provider bills you for the model directly.";
  const KEY_START =
    "An email address and an API key for the model your agent runs on (Anthropic, OpenAI or OpenRouter).";

  it("are unchanged while pay-per-use is not open to everyone", () => {
    expect(thinkingAnswers(false)).toEqual({ model: KEY_MODEL, start: KEY_START });
    const said = JSON.stringify(thinkingAnswers(false));
    expect(said).not.toMatch(/pay per use|BlockRun|USDC/i);
  });

  it("stay unchanged with the switch unset, off, mistyped, or open to invited accounts only", () => {
    for (const value of [undefined, "", "off", "owner", "ON ", "yes", "1"]) {
      const open = inferenceFlags({ INFERENCE_USDC: value }).stage === "on";
      // "ON " is trimmed and lower-cased by the switch itself, and is the one that opens.
      expect(open).toBe(value === "ON ");
      if (!open) expect(thinkingAnswers(open)).toEqual({ model: KEY_MODEL, start: KEY_START });
    }
  });

  it("once it is open to everyone, keep the key first and say what pay per use sends out", () => {
    const { model, start } = thinkingAnswers(true);
    // Everything the key answer said is still said, first.
    expect(model.startsWith(KEY_MODEL)).toBe(true);
    expect(model).toContain("pay per use");
    expect(model).toContain("strategy and transcript are sent to BlockRun and the model provider it uses");
    // A key is no longer needed to start, so the old sentence would be false.
    expect(start).not.toBe(KEY_START);
    expect(start).toContain("which is what we recommend");
    expect(start).toContain("pay per use");
    // The landing no longer promises "nothing to deposit": there is no paper mode on it.
    expect(start).not.toContain("nothing to deposit");
  });
});
