import { describe, expect, it } from "vitest";
import { unfinishedFundingAdvice, unfinishedIntentText } from "./funding-intent-copy";

describe("unfinishedIntentText", () => {
  it("does not claim a transfer with no answer on record never reached the chain", () => {
    // A funding whose submit request got no reply stays pending, and may have landed.
    expect(unfinishedIntentText("pending")).toBe(" has no result on record");
    expect(unfinishedIntentText("pending")).not.toMatch(/never|rejected|failed/);
  });

  it("does not call a failure a rejection", () => {
    expect(unfinishedIntentText("failed")).toBe(" did not complete");
  });

  it("says a skipped leg was not attempted", () => {
    expect(unfinishedIntentText("cancelled")).toBe(" was not attempted");
  });
});

describe("unfinishedFundingAdvice", () => {
  it("sends the owner to the balance, not to Fund, while any transfer has no result", () => {
    const advice = unfinishedFundingAdvice(["failed", "pending"]);
    expect(advice).toMatch(/may still have arrived/);
    expect(advice).toMatch(/check the balance above before/);
    expect(advice).not.toMatch(/send the rest/);
  });

  it("offers Fund when every unfinished transfer is known not to have gone", () => {
    expect(unfinishedFundingAdvice(["failed", "cancelled"])).toBe(
      "The agent exists and is safe; it just has less than you meant it to. Use Fund above to send the rest.",
    );
  });
});
