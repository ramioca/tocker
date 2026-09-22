import { describe, expect, it } from "vitest";
import type { TradeScore } from "@/server/types";
import {
  buyersTrend,
  byNewestFirst,
  countdownProgress,
  countdownTone,
  deriveSafety,
  formatAgeMinutes,
  formatCountdown,
  formatCountdownCoarse,
  reserveTrend,
  soonestExpiry,
  sparklinePath,
  statsFromSnapshot,
} from "./proposal-stats";

/** A token that cleared every gate: authorities checked, nothing flagged. */
function cleanScore(overrides: Partial<TradeScore> = {}): TradeScore {
  return {
    total: 74,
    verdict: "candidate",
    components: { safety: 82, liquidity: 61, momentum: 70, organic: 66, distribution: 58, gecko: 41 },
    blockers: [],
    warnings: [],
    liquidityUsd: 4_700,
    ageHours: 0.35,
    scoredAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("buyersTrend", () => {
  it("is null when either window is missing", () => {
    expect(buyersTrend(null, 120)).toBeNull();
    expect(buyersTrend(40, null)).toBeNull();
    expect(buyersTrend(Number.NaN, 120)).toBeNull();
  });

  it("calls the last five minutes hot when they beat the hourly rate", () => {
    // 120 buyers an hour is 10 in a typical five minutes; 40 is four times that.
    expect(buyersTrend(40, 120)).toBe("up");
  });

  it("calls them cold when they fall behind it", () => {
    expect(buyersTrend(2, 240)).toBe("down");
  });

  it("calls them flat when they track it", () => {
    expect(buyersTrend(10, 120)).toBe("flat");
  });

  it("stays flat when the hour holds nothing the five minutes do not", () => {
    // A pool ninety seconds old reports the same counts in every window: there is no
    // earlier rate to compare against, and an arrow here would be invented.
    expect(buyersTrend(92, 92)).toBe("flat");
    expect(buyersTrend(0, 0)).toBe("flat");
  });

  it("still compares rates when the counts are tiny", () => {
    // Three of the four buyers this token has ever had arrived in the last five
    // minutes: that is an uptick, even though four is nothing. The cell prints the
    // count next to the arrow, so the reader sees how thin the evidence is.
    expect(buyersTrend(3, 4)).toBe("up");
    // The single buyer was in the fifty-five minutes before this window.
    expect(buyersTrend(0, 1)).toBe("down");
  });
});

describe("formatAgeMinutes", () => {
  it("dashes for absent, never zero", () => {
    expect(formatAgeMinutes(null)).toBe("—");
    expect(formatAgeMinutes(undefined)).toBe("—");
    expect(formatAgeMinutes(Number.NaN)).toBe("—");
    expect(formatAgeMinutes(-1)).toBe("—");
  });

  it("keeps launch-day precision in minutes", () => {
    expect(formatAgeMinutes(0.4)).toBe("<1m");
    expect(formatAgeMinutes(4)).toBe("4m");
    expect(formatAgeMinutes(4.4)).toBe("4m");
    expect(formatAgeMinutes(59)).toBe("59m");
  });

  it("shows two units just past the hour, then drops the minutes", () => {
    expect(formatAgeMinutes(60)).toBe("1h");
    expect(formatAgeMinutes(65)).toBe("1h 5m");
    expect(formatAgeMinutes(190)).toBe("3h");
    expect(formatAgeMinutes(47 * 60)).toBe("47h");
  });

  it("switches to days past two", () => {
    expect(formatAgeMinutes(3 * 1_440)).toBe("3.0d");
    expect(formatAgeMinutes(40 * 1_440)).toBe("40d");
  });
});

describe("formatCountdown", () => {
  it("counts seconds under the hour", () => {
    expect(formatCountdown(184_000)).toBe("3:04");
    expect(formatCountdown(59_000)).toBe("0:59");
  });

  it("counts hours over it", () => {
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
  });

  it("says Expired at and past zero", () => {
    expect(formatCountdown(0)).toBe("Expired");
    expect(formatCountdown(-5_000)).toBe("Expired");
  });

  it("has a coarse form for the list header", () => {
    expect(formatCountdownCoarse(184_000)).toBe("3m");
    expect(formatCountdownCoarse(20_000)).toBe("20s");
    expect(formatCountdownCoarse(-1)).toBe("now");
  });
});

describe("countdown tone and ring", () => {
  it("goes amber under two minutes and red past zero", () => {
    expect(countdownTone(300_000)).toBe("calm");
    expect(countdownTone(119_000)).toBe("urgent");
    expect(countdownTone(0)).toBe("expired");
  });

  it("maps remaining time onto 0-1, clamped", () => {
    expect(countdownProgress(150_000, 300_000)).toBeCloseTo(0.5);
    expect(countdownProgress(400_000, 300_000)).toBe(1);
    expect(countdownProgress(-10, 300_000)).toBe(0);
    expect(countdownProgress(150_000, 0)).toBe(0);
  });
});

describe("sparklinePath", () => {
  it("needs two usable points", () => {
    expect(sparklinePath([])).toBeNull();
    expect(sparklinePath([1])).toBeNull();
    expect(sparklinePath([1, Number.NaN])).toBeNull();
  });

  it("spans the box, oldest on the left", () => {
    const geometry = sparklinePath([1, 2, 3], { width: 80, height: 24, pad: 2 });
    expect(geometry?.d).toBe("M2.00,22.00 L40.00,12.00 L78.00,2.00");
    expect(geometry?.direction).toBe(2);
  });

  it("draws a flat series down the middle, not along the floor", () => {
    const geometry = sparklinePath([5, 5, 5], { width: 80, height: 24, pad: 2 });
    expect(geometry?.d).toBe("M2.00,12.00 L40.00,12.00 L78.00,12.00");
    expect(geometry?.direction).toBe(0);
  });

  it("reports a fall as a negative direction", () => {
    expect(sparklinePath([9, 3])?.direction).toBe(-6);
  });

  it("drops non-finite points rather than the whole line", () => {
    const geometry = sparklinePath([1, Number.POSITIVE_INFINITY, 3]);
    expect(geometry).not.toBeNull();
    expect(geometry?.d.split(" ")).toHaveLength(2);
  });
});

describe("deriveSafety", () => {
  it("is all-unknown without a snapshot", () => {
    const safety = deriveSafety(null);
    expect(safety.authoritiesRevoked).toBeNull();
    expect(safety.top10Pct).toBeNull();
    expect(safety.blockers).toEqual([]);
  });

  it("reads a clean token as revoked with no blockers", () => {
    const safety = deriveSafety(cleanScore());
    expect(safety.authoritiesRevoked).toBe(true);
    expect(safety.blockers).toEqual([]);
    expect(safety.top10Pct).toBeNull();
    expect(safety.safety).toBe(82);
    expect(safety.organic).toBe(66);
    expect(safety.distribution).toBe(58);
  });

  it("never claims revoked when nobody assessed safety", () => {
    const safety = deriveSafety(
      cleanScore({ components: { organic: 40 }, warnings: ["no_contract_security_data"] }),
    );
    expect(safety.authoritiesRevoked).toBeNull();
    expect(safety.safety).toBe(0);
    expect(safety.warnings).toEqual(["no_contract_security_data"]);
  });

  it("reads mint_authority_unknown as unknown, not as failed", () => {
    const safety = deriveSafety(cleanScore({ blockers: ["mint_authority_unknown"] }));
    expect(safety.authoritiesRevoked).toBeNull();
    expect(safety.blockers).toEqual(["mint_authority_unknown"]);
  });

  it("reads a live authority as false and keeps every blocker", () => {
    const safety = deriveSafety(
      cleanScore({
        total: 31,
        verdict: "avoid",
        blockers: ["mint_authority_active", "top10_holders_72pct", "liquidity_below_floor"],
        warnings: ["lp_barely_locked", "dev_holds_over_25pct"],
      }),
    );
    expect(safety.authoritiesRevoked).toBe(false);
    expect(safety.top10Pct).toBe(72);
    expect(safety.blockers).toHaveLength(3);
    expect(safety.warnings).toEqual(["lp_barely_locked", "dev_holds_over_25pct"]);
  });

  it("pulls a fractional top-10 out of the blocker code", () => {
    expect(deriveSafety(cleanScore({ blockers: ["top10_holders_22.5pct"] })).top10Pct).toBe(22.5);
  });

  it("copies the blocker list rather than aliasing the snapshot", () => {
    const score = cleanScore({ blockers: ["honeypot"] });
    const safety = deriveSafety(score);
    safety.blockers.push("mutated");
    expect(score.blockers).toEqual(["honeypot"]);
  });
});

describe("statsFromSnapshot", () => {
  it("fills what the snapshot knows and dashes the rest", () => {
    const stats = statsFromSnapshot(cleanScore());
    expect(stats.ageMinutes).toBeCloseTo(21);
    expect(stats.reserveUsd).toBe(4_700);
    expect(stats.gtScore).toBe(41);
    expect(stats.buyers5m).toBeNull();
    expect(stats.buyersH1).toBeNull();
    expect(stats.sparkline).toEqual([]);
    expect(stats.safety.authoritiesRevoked).toBe(true);
  });

  it("survives a trade with no score at all", () => {
    const stats = statsFromSnapshot(null);
    expect(stats.ageMinutes).toBeNull();
    expect(stats.gtScore).toBeNull();
    expect(stats.safety.authoritiesRevoked).toBeNull();
  });
});

describe("reserveTrend", () => {
  it("prefers the five-minute window and says so", () => {
    expect(reserveTrend({ priceChangeM5Pct: 12.4, priceChangeH1Pct: -3 })).toEqual({ pct: 12.4, window: "5m" });
  });

  it("falls back to the hour and labels it honestly", () => {
    expect(reserveTrend({ priceChangeM5Pct: null, priceChangeH1Pct: -3 })).toEqual({ pct: -3, window: "1h" });
  });

  it("is silent when neither window reported", () => {
    expect(reserveTrend({ priceChangeM5Pct: null, priceChangeH1Pct: null })).toBeNull();
  });
});

describe("queue ordering", () => {
  const rows = [
    { id: "old", proposedAt: "2026-09-22T10:00:00.000Z", createdAt: "2026-09-22T10:00:00.000Z", expiresAt: "2026-09-22T10:05:00.000Z" },
    { id: "new", proposedAt: "2026-09-22T10:03:00.000Z", createdAt: "2026-09-22T10:03:00.000Z", expiresAt: "2026-09-22T10:08:00.000Z" },
    { id: "mid", proposedAt: null, createdAt: "2026-09-22T10:01:00.000Z", expiresAt: "2026-09-22T10:06:00.000Z" },
  ];

  it("sorts newest first and falls back to createdAt", () => {
    expect(byNewestFirst(rows).map((row) => row.id)).toEqual(["new", "mid", "old"]);
  });

  it("does not mutate the input", () => {
    byNewestFirst(rows);
    expect(rows.map((row) => row.id)).toEqual(["old", "new", "mid"]);
  });

  it("finds the one that expires first, even when it is not the oldest", () => {
    const now = new Date("2026-09-22T10:04:00.000Z").getTime();
    expect(soonestExpiry(rows, now)).toBe(60_000);
    expect(soonestExpiry([], now)).toBeNull();
    expect(soonestExpiry([{ expiresAt: "not a date" }], now)).toBeNull();
  });
});
