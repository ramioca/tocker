import { describe, expect, it } from "vitest";
import { matchesAgent, normalizeSearch } from "./agent-search";

const agent = {
  name: "Momentum Mike",
  tagline: "Rides breakouts, cuts losers fast.",
  model: "gpt-5-mini",
  owner: { handle: "dex", displayName: "Dex Rivera" },
};

const finds = (query: string, a: Parameters<typeof matchesAgent>[0] = agent) =>
  matchesAgent(a, normalizeSearch(query));

describe("normalizeSearch", () => {
  it("drops a leading @ and folds separators to single spaces", () => {
    expect(normalizeSearch("  @Dex ")).toBe("dex");
    expect(normalizeSearch("GPT-5 mini")).toBe("gpt 5 mini");
    expect(normalizeSearch("deepseek/deepseek-v4")).toBe("deepseek deepseek v4");
    expect(normalizeSearch("Haiku 4.5")).toBe("haiku 4 5");
  });

  it("is empty for a bare @ or whitespace", () => {
    expect(normalizeSearch("@")).toBe("");
    expect(normalizeSearch("   ")).toBe("");
  });
});

describe("matchesAgent", () => {
  it("finds an owner the way the card prints them", () => {
    expect(finds("@dex")).toBe(true);
    expect(finds("rivera")).toBe(true);
  });

  it("finds a model by its chip label or its raw id", () => {
    expect(finds("GPT-5 mini")).toBe(true);
    expect(finds("gpt 5")).toBe(true);
    expect(finds("gpt-5-mini")).toBe(true);
    const claude = { ...agent, model: "claude-sonnet-5" };
    expect(finds("Sonnet 5", claude)).toBe(true);
    expect(finds("claude sonnet", claude)).toBe(true);
    const haiku = { ...agent, model: "claude-haiku-4-5-20251001" };
    expect(finds("Haiku 4.5", haiku)).toBe(true);
    const deepseek = { ...agent, model: "deepseek/deepseek-v4" };
    expect(finds("DeepSeek V4", deepseek)).toBe(true);
  });

  it("finds a name or tagline, and matches everything on an empty query", () => {
    expect(finds("momentum")).toBe(true);
    expect(finds("breakouts")).toBe(true);
    expect(finds("")).toBe(true);
  });

  it("does not match what is not on the card", () => {
    expect(finds("zzzz")).toBe(false);
    expect(finds("sonnet")).toBe(false);
  });

  it("tolerates a missing tagline and display name", () => {
    expect(finds("mike", { ...agent, tagline: null, owner: { handle: "dex", displayName: null } })).toBe(true);
  });
});
