/**
 * `LLM_MOCK=1` — a deterministic scripted model so the whole run loop (tools,
 * discovery, scoring, risk guard, executor, feed writes) can be exercised end to end
 * without an API key and without the network.
 *
 * The script walks the real loop: get_portfolio → discover_tokens → score_token →
 * place_trade → finish. Built on `MockLanguageModelV3` from `ai/test`.
 *
 * The trade rationale is **not** hard-coded prose: the model reads the actual
 * `score_token` tool result out of the conversation it is handed and quotes the real
 * numbers back. That keeps `pnpm demo` honest — if the scorer changes, the demo's
 * rationale changes with it, and a rationale citing a score the run never produced
 * cannot slip through.
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
type MockGenerateOptions = Parameters<MockLanguageModelV3["doGenerate"]>[0];

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

/** The subset of a `score_token` result the scripted rationale quotes. */
interface ScoreEcho {
  symbol: string;
  total: number;
  verdict: string;
  safety: number;
  liquidity: number;
  organic: number;
  distribution: number;
  momentum: number;
  /** Present only when the score was deep, i.e. the agent paid an x402 source for it. */
  sentiment: number | null;
  sources: string[];
  liquidityUsd: number | null;
  holderCount: number | null;
}

/** Display names for the paid sentiment sources a deep score can fold in. */
const PAID_SOURCE_NAMES: Record<string, string> = {
  sentimentalpha: "SentimentAlpha",
  "x-search": "x402Atlas X search",
  "xquik-search": "Xquik",
};

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Digs the most recent `score_token` result out of the prompt the runtime handed us.
 * The AI SDK shapes tool results as `{ type: "tool-result", toolName, output }`, and
 * `output` is a `{ type: "json", value }` wrapper in v7 — both shapes are handled.
 */
function lastScore(options: MockGenerateOptions): ScoreEcho | null {
  let found: ScoreEcho | null = null;
  for (const message of options.prompt) {
    const content: unknown = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const part = raw as Record<string, unknown>;
      if (part.type !== "tool-result" || part.toolName !== "score_token") continue;
      let value: unknown = part.output ?? part.result;
      if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>).value;
      }
      if (!value || typeof value !== "object") continue;
      const result = value as Record<string, unknown>;
      const components = (result.components ?? {}) as Record<string, unknown>;
      const total = readNumber(result, "total");
      if (total === null) continue;
      found = {
        symbol: typeof result.symbol === "string" ? result.symbol : "the token",
        total,
        verdict: typeof result.verdict === "string" ? result.verdict : "candidate",
        safety: readNumber(components, "safety") ?? 0,
        liquidity: readNumber(components, "liquidity") ?? 0,
        organic: readNumber(components, "organic") ?? 0,
        distribution: readNumber(components, "distribution") ?? 0,
        momentum: readNumber(components, "momentum") ?? 0,
        sentiment: readNumber(components, "sentiment"),
        sources: Array.isArray(result.sources) ? result.sources.filter((x): x is string => typeof x === "string") : [],
        liquidityUsd: readNumber(result, "liquidityUsd"),
        holderCount: readNumber(result, "holderCount"),
      };
    }
  }
  return found;
}

function money(n: number | null): string {
  if (n === null) return "unreported liquidity";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M liquidity`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k liquidity`;
  return `$${n.toFixed(0)} liquidity`;
}

/** "X sentiment 74 via SentimentAlpha (paid) · " — or nothing when the score was free. */
function paidSentiment(score: ScoreEcho): string {
  if (score.sentiment === null) return "";
  const paid = score.sources.map((id) => PAID_SOURCE_NAMES[id]).find(Boolean);
  return `X sentiment ${score.sentiment}${paid ? ` via ${paid} (paid)` : ""}, `;
}

function rationaleFrom(score: ScoreEcho | null): string {
  if (score === null) {
    return "Scored the candidate before sizing: it cleared every hard gate and beat this agent's minimum score, so I am opening a starter position.";
  }
  const holders = score.holderCount === null ? "" : `, ${score.holderCount.toLocaleString("en-US")} holders`;
  return `${score.symbol} scores ${score.total.toFixed(1)}/100 (${score.verdict}) with no hard-gate blockers: ${paidSentiment(score)}safety ${score.safety}, organic ${score.organic}, distribution ${score.distribution}, momentum ${score.momentum}. Real demand behind the volume against ${money(score.liquidityUsd)}${holders}, so the clip fills without moving it. Starter position.`;
}

function summaryFrom(score: ScoreEcho | null): string {
  if (score === null) return "Swept the discovery feeds, scored the best candidate and opened one starter position.";
  return `Swept the discovery feeds, scored ${score.symbol} at ${score.total.toFixed(1)}/100 (${score.verdict}, safety ${score.safety} / organic ${score.organic}) and bought a $50 starter position. One position open, will reassess next tick.`;
}

/** Steps 0-2 are fixed; the trade and the summary are built from the real score. */
export const MOCK_SCRIPT = [
  { text: "Checking the book before I do anything.", call: { name: "get_portfolio", input: {} } },
  {
    text: "Sweeping my discovery feeds for anything that clears the free gates.",
    call: { name: "discover_tokens", input: { limit: 10 } },
  },
  {
    text: "Scoring the strongest name on that table, and paying a cent for its X sentiment before I size anything.",
    call: { name: "score_token", input: { chain: "solana", address: BONK_MINT, deep: true } },
  },
  { text: "It clears my bar. Taking a starter position.", call: { name: "place_trade", input: {} } },
  { text: "Done for this tick.", call: { name: "finish", input: {} } },
] as const;

export function isLlmMock(): boolean {
  return process.env.LLM_MOCK === "1";
}

/** A model that walks {@link MOCK_SCRIPT} one step per `doGenerate` call. */
export function createMockModel(): LanguageModel {
  let index = 0;
  return new MockLanguageModelV3({
    provider: "petri-mock",
    modelId: "scripted-discovery-trader",
    doGenerate: async (options) => {
      const entry = MOCK_SCRIPT[index];
      index += 1;
      if (!entry) return step("Nothing further this tick.", null, `mock-${index}`);

      const input: Record<string, unknown> = { ...entry.call.input };
      if (entry.call.name === "place_trade") {
        const score = lastScore(options);
        Object.assign(input, {
          chain: "solana",
          side: "buy",
          tokenAddress: BONK_MINT,
          amountUsd: 50,
          rationale: rationaleFrom(score),
        });
      }
      if (entry.call.name === "finish") {
        input.summary = summaryFrom(lastScore(options));
      }
      return step(entry.text, { name: entry.call.name, input }, `mock-${index}`);
    },
  });
}
