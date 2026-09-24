import { describe, expect, it } from "vitest";
import { DATA_SOURCES, toDataSourceInfo } from "./registry";

/**
 * `description` is written for the model: modes, per-call prices, vendor quirks. The
 * picker showed it verbatim ("EXPERIMENTAL: this vendor advertises the wrong EIP-712
 * domain name…"). Every source now carries a one-line `summary` for people instead.
 */
describe("data-source summaries", () => {
  it("gives every registry source a short, plain summary that reaches the client", () => {
    for (const source of DATA_SOURCES) {
      const info = toDataSourceInfo(source);
      expect(info.summary, source.id).toBeTruthy();
      expect(info.summary!.length, source.id).toBeLessThanOrEqual(120);
      expect(info.summary, source.id).not.toMatch(/EXPERIMENTAL|EIP-712|mode '|\$\d|`/);
    }
  });
});
