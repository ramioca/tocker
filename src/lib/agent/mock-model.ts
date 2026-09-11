/**
 * `LLM_MOCK=1` — a deterministic scripted model so the whole run loop (tools, x402,
 * risk guard, executor, feed writes) can be exercised end to end without an API key.
 *
 * The script is fixed: get_portfolio → query_data_source(sentimentalpha) →
 * place_trade(buy $50 BONK) → finish. Built on `MockLanguageModelV3` from `ai/test`.
 */
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModel } from "ai";
import { KNOWN_TOKENS } from "@/lib/trading/tokens";

/**
 * Derived from the mock class itself, so we stay pinned to whatever
 * `LanguageModelV3GenerateResult` looks like without depending on `@ai-sdk/provider`
 * (a transitive dependency, not a direct one).
 */
type MockGenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

const BONK = KNOWN_TOKENS.find((t) => t.symbol === "BONK");
const BONK_MINT = BONK?.address ?? "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const usage: MockGenerateResult["usage"] = {
  inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 120, text: 120, reasoning: 0 },
};

function step(
  text: string,
  call: { name: string; input: Record<string, unknown> } | null,
  id: string,
): MockGenerateResult {
  return {
    content: [
      { type: "text" as const, text },
      ...(call
        ? [
            {
              type: "tool-call" as const,
              toolCallId: id,
              toolName: call.name,
              input: JSON.stringify(call.input),
            },
          ]
        : []),
    ],
    finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined },
    usage,
    warnings: [],
  };
}

export const MOCK_SCRIPT = [
  { text: "Checking the book before I do anything.", call: { name: "get_portfolio", input: {} } },
  {
    text: "Cash is there. Reading the X narrative on Solana memecoins.",
    call: {
      name: "query_data_source",
      input: { sourceId: "sentimentalpha", params: { query: "solana memecoins", watchlist: ["BONK", "WIF"] } },
    },
  },
  {
    text: "Sentiment 0.62 with velocity 0.41 — that is the setup my strategy wants. Taking a starter position.",
    call: {
      name: "place_trade",
      input: {
        chain: "solana",
        side: "buy",
        tokenAddress: BONK_MINT,
        amountUsd: 50,
        rationale:
          "SentimentAlpha has BONK at 0.62 sentiment with narrative velocity 0.41 — mentions accelerating faster than the WIF/JUP comparables. Starter $50 position while the rotation is still early.",
      },
    },
  },
  {
    text: "Done for this tick.",
    call: {
      name: "finish",
      input: {
        summary:
          "Bought $50 of BONK on rising X narrative velocity (sentiment 0.62, velocity 0.41). Holding one position, will reassess next tick.",
      },
    },
  },
] as const;

export function isLlmMock(): boolean {
  return process.env.LLM_MOCK === "1";
}

/** A model that walks {@link MOCK_SCRIPT} one step per `doGenerate` call. */
export function createMockModel(): LanguageModel {
  let index = 0;
  return new MockLanguageModelV3({
    provider: "petri-mock",
    modelId: "scripted-momentum-trader",
    doGenerate: async () => {
      const entry = MOCK_SCRIPT[index];
      index += 1;
      if (!entry) return step("Nothing further this tick.", null, `mock-${index}`);
      return step(entry.text, { name: entry.call.name, input: { ...entry.call.input } }, `mock-${index}`);
    },
  });
}
