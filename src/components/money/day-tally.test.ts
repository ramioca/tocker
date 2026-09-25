import { describe, expect, it } from "vitest";
import type { PnlDay } from "@/server/queries/money";
import { tallyDays } from "./day-tally";

function day(date: string, pnlUsd: number | null): PnlDay {
  return { day: date, equityUsd: 1_000, pnlUsd, pnlPct: null, agents: 1 };
}

describe("tallyDays", () => {
  it("counts up, down and flat days and skips days with no prior close", () => {
    const tally = tallyDays([
      day("2026-09-01", null),
      day("2026-09-02", 4),
      day("2026-09-03", -2),
      day("2026-09-04", 0),
      day("2026-09-05", -7),
      day("2026-09-06", 9),
    ]);
    expect(tally).toMatchObject({ up: 2, down: 2, flat: 1 });
    expect(tally.best?.day).toBe("2026-09-06");
    expect(tally.worst?.day).toBe("2026-09-05");
  });

  it("has no worst in a month with no down days", () => {
    const tally = tallyDays([day("2026-09-02", 2.1), day("2026-09-03", 5), day("2026-09-04", 0)]);
    expect(tally.best?.pnlUsd).toBe(5);
    expect(tally.worst).toBeNull();
  });

  it("has no best in a month with no up days", () => {
    const tally = tallyDays([day("2026-09-02", -1), day("2026-09-03", 0)]);
    expect(tally.best).toBeNull();
    expect(tally.worst?.pnlUsd).toBe(-1);
  });
});
