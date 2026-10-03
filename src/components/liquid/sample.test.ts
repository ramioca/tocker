import { describe, expect, it } from "vitest";
import { MIN_SCORED_PER_TICK } from "@/lib/agent/limits";
import { COINS } from "./coins";
import { HERO_LABEL, SAMPLE_OTHER_SCORES, SAMPLE_PROMPT, SAMPLE_ROWS, SAMPLE_SCORED, clearsFloor } from "./sample";

describe("the landing's sample run", () => {
  it("shows two tokens that clear the floor and one that doesn't, each a known coin", () => {
    expect(SAMPLE_ROWS.filter((r) => clearsFloor(r.score))).toHaveLength(2);
    for (const r of SAMPLE_ROWS) expect(COINS[r.coin]).toBeDefined();
  });

  it("shows its top three: everything else it scored is lower, and under the floor", () => {
    const lowest = Math.min(...SAMPLE_ROWS.map((r) => r.score));
    for (const s of SAMPLE_OTHER_SCORES) {
      expect(s).toBeLessThan(lowest);
      expect(clearsFloor(s)).toBe(false);
    }
  });

  it("scores at least the run loop's minimum of fresh candidates, plus SOL, which discovery never lists", () => {
    const fresh = SAMPLE_SCORED - SAMPLE_ROWS.filter((r) => r.coin === "SOL").length;
    expect(fresh).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
  });

  it("gives the hero card's picture a text alternative with the strategy and every row", () => {
    expect(HERO_LABEL).toContain(SAMPLE_PROMPT);
    for (const r of SAMPLE_ROWS) expect(HERO_LABEL).toContain(`${r.coin} on ${r.chain} ${r.score}`);
    expect(HERO_LABEL).not.toMatch(/\bbuys (TIBBIR|SOL)\b/);
  });
});
