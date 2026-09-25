import { describe, expect, it } from "vitest";
import type { PnlDay } from "@/server/queries/money";
import { dayNote, flowText, movedMoney, tallyDays } from "./day-tally";

function day(date: string, pnlUsd: number | null, extra: Partial<PnlDay> = {}): PnlDay {
  return { day: date, equityUsd: 1_000, pnlUsd, pnlPct: null, flowUsd: 0, agents: 1, ...extra };
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

  it("keeps days that moved money out of best and worst, but still counts them", () => {
    const tally = tallyDays([
      day("2026-09-01", null),
      day("2026-09-02", 3),
      day("2026-09-03", 480, { flowUsd: 500 }),
      day("2026-09-04", -2),
      day("2026-09-05", -30, { agents: 2 }),
    ]);
    expect(tally).toMatchObject({ up: 2, down: 2, flat: 0 });
    expect(tally.best?.day).toBe("2026-09-02");
    expect(tally.worst?.day).toBe("2026-09-04");
  });
});

describe("day notes", () => {
  it("names the flow, else the change in agents, else nothing", () => {
    const prev = day("2026-09-01", 1);
    expect(flowText(500)).toBe("excl. $500.00 deposit");
    expect(flowText(-40)).toBe("excl. $40.00 withdrawal");
    expect(flowText(0)).toBeNull();
    expect(dayNote(day("2026-09-02", 1, { flowUsd: -40 }), prev)).toBe("excl. $40.00 withdrawal");
    expect(dayNote(day("2026-09-02", 1, { agents: 2 }), prev)).toBe("new agent");
    expect(dayNote(day("2026-09-02", 1, { agents: 0 }), prev)).toBe("agent left");
    expect(dayNote(day("2026-09-02", 1), prev)).toBeNull();
    expect(movedMoney(day("2026-09-02", 1), undefined)).toBe(false);
  });
});
