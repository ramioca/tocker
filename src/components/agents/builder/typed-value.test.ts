/**
 * What a typed value becomes, decided without a browser. These limits are real money,
 * so the tables are spelled out: for each kind of field, what each piece of text
 * stores, and what it refuses. Nothing here may clamp.
 */
import { describe, expect, it } from "vitest";
import { formatCompactUsd, formatHolders, formatHours, formatMinutes } from "@/components/tokens/format";
import {
  HOLDER_LADDER,
  LIQUIDITY_LADDER,
  MAX_AGE_LADDER,
  MIN_AGE_LADDER,
  SPECS,
  type SpecId,
} from "./module-specs";
import { STRATEGY_PRESETS, UNIVERSE_PRESETS } from "./types";
import {
  display,
  isAnyWord,
  preview,
  readBps,
  readCount,
  readNumber,
  readPercent,
  readScore,
  readSpan,
  readUsd,
  roundTo,
  sayCount,
  sayHold,
  sayHours,
  sayMinutes,
  sayUsd,
  settle,
  shownUnit,
  type ValueSpec,
} from "./typed-value";

/**
 * What one row of a table expects.
 * - `set`: the stored value; `shows` what the field then reads; `say` the note; `note`
 *   whether the note is visible rather than only spoken.
 * - "unchanged": nothing is written.
 * - "unreadable" / "range": refused, with the message of that kind.
 * - `refused`: refused with exactly this message.
 */
type Outcome =
  | { set: number | null; shows?: string; say?: string; note?: boolean }
  | "unchanged"
  | "unreadable"
  | "range"
  | { refused: string };

type Row = [typed: string, outcome: Outcome];

function check(spec: ValueSpec, current: number | null, [typed, outcome]: Row): void {
  const result = settle(spec, typed, current);
  if (outcome === "unchanged") {
    expect(result).toEqual({ status: "unchanged" });
    expect(preview(spec, typed, current)).toBeNull();
    return;
  }
  if (outcome === "unreadable" || outcome === "range" || "refused" in outcome) {
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    // A refusal always names the value that was kept.
    expect(result.message.endsWith(`Kept ${display(spec, current)}.`)).toBe(true);
    if (outcome === "unreadable") expect(result.message.startsWith("Could not read that. Try ")).toBe(true);
    else if (outcome === "range") expect(result.message.startsWith(`${spec.label} goes from `)).toBe(true);
    else expect(result.message).toBe(outcome.refused);
    expect(preview(spec, typed, current)).toBeNull();
    return;
  }
  expect(result.status).toBe("set");
  if (result.status !== "set") return;
  expect(result.value).toBe(outcome.set);
  if (outcome.shows !== undefined) {
    expect(display(spec, result.value)).toBe(outcome.shows);
    expect(preview(spec, typed, current)).toBe(`Reads as ${outcome.shows}`);
  }
  if (outcome.say !== undefined) expect(result.say).toBe(outcome.say);
  if (outcome.note !== undefined) expect(result.show).toBe(outcome.note);
}

function table(name: string, id: SpecId, current: number | null, rows: Row[]): void {
  describe(name, () => {
    it.each(rows)("%j", (...row) => check(SPECS[id], current, row as Row));
  });
}

// ------------------------------------------------------------------ tables

const LIQUIDITY_RANGE = "Minimum liquidity goes from $1.0K to $1.0M. Kept $15K.";
const LIQUIDITY_UNREADABLE = "Could not read that. Try 10k or $12,345. Kept $15K.";

table("money, compact: Minimum liquidity at $15K", "minLiquidityUsd", 15_000, [
  ["10k", { set: 10_000, shows: "$10K", say: "Set to $10K.", note: false }],
  ["$10K", { set: 10_000 }],
  ["2.5k", { set: 2_500, shows: "$2.5K" }],
  ["1m", { set: 1_000_000, shows: "$1.0M" }],
  ["12,345", { set: 12_345, shows: "$12,345", say: "Set to $12,345.", note: true }],
  ["12345", { set: 12_345, shows: "$12,345", note: false }],
  ["12345.67", { set: 12_346, say: "Rounded to $12,346.", note: true }],
  ["9999", { set: 9_999, shows: "$9,999" }],
  ["999999", { set: 999_999, shows: "$999,999" }],
  ["$15K", "unchanged"],
  ["15000", "unchanged"],
  ["", "unchanged"],
  ["   ", "unchanged"],
  ["$1.5M", { refused: LIQUIDITY_RANGE }],
  ["500", { refused: LIQUIDITY_RANGE }],
  ["0", { refused: LIQUIDITY_RANGE }],
  // A decimal comma, so 1.5 dollars: out of range, never fifteen and never 15,000.
  ["1,5", { refused: LIQUIDITY_RANGE }],
  ["1,5k", { set: 1_500, shows: "$1.5K", say: "Set to $1.5K.", note: true }],
  ["1,2345", { refused: LIQUIDITY_UNREADABLE }],
  ["1.234,5", { refused: LIQUIDITY_UNREADABLE }],
  ["15 000", "unreadable"],
  ["1e3", "unreadable"],
  ["abc", "unreadable"],
  ["-5k", "unreadable"],
  ["$", "unreadable"],
  ["10kk", "unreadable"],
  ["any", { refused: "Minimum liquidity needs a number, like 10k or $12,345. Kept $15K." }],
]);

const TRADE_RANGE = "Max per trade goes from $1.00 to $5,000.00. Kept $100.00.";

table("money, cents: Max per trade at $100.00", "maxTradeUsd", 100, [
  ["7.37", { set: 7.37, shows: "$7.37", say: "Set to $7.37.", note: false }],
  ["7,37", { set: 7.37, shows: "$7.37", say: "Set to $7.37.", note: true }],
  ["1,234", { set: 1_234, shows: "$1,234.00", say: "Set to $1,234.00.", note: true }],
  ["$1,250.50", { set: 1_250.5, shows: "$1,250.50", note: true }],
  ["2k", { set: 2_000, shows: "$2,000.00" }],
  ["1", { set: 1 }],
  ["5000", { set: 5_000 }],
  ["7.375", { set: 7.38, say: "Rounded to $7.38.", note: true }],
  ["$100.00", "unchanged"],
  ["100", "unchanged"],
  ["0,5", { refused: TRADE_RANGE }],
  ["0.5", { refused: TRADE_RANGE }],
  [".99", { refused: TRADE_RANGE }],
  ["5000.01", { refused: TRADE_RANGE }],
  // The old box stored $5,000 here: a cap nobody typed.
  ["10000", { refused: TRADE_RANGE }],
  ["-20", "unreadable"],
  ["100 usd", "unreadable"],
  ["1.2.3", "unreadable"],
  ["off", { refused: "Max per trade needs a number, like 25 or $1,250.50. Kept $100.00." }],
]);

table("money, cents: Data spend cap per run at $1.00", "maxDataSpendUsdPerRun", 1, [
  ["0.07", { set: 0.07, shows: "$0.07" }],
  ["0,07", { set: 0.07, shows: "$0.07", note: true }],
  ["0", { set: 0, shows: "$0.00" }],
  ["5", { set: 5 }],
  ["5.01", "range"],
]);

table("money, cents: Limit per run at $0.30", "usdcPerRun", 0.3, [
  ["0.07", { set: 0.07, shows: "$0.07" }],
  ["2", { set: 2 }],
  ["0.04", { refused: "Limit per run goes from $0.05 to $2.00. Kept $0.30." }],
  ["2.01", "range"],
]);

table("money, cents: Limit per day at $3.00", "usdcPerDay", 3, [
  ["12.34", { set: 12.34, shows: "$12.34" }],
  ["0.49", { refused: "Limit per day goes from $0.50 to $50.00. Kept $3.00." }],
  ["51", "range"],
]);

const HOLDERS_RANGE = "Minimum holders goes from 0 to 100K. Kept 25.";

table("counts: Minimum holders at 25", "minHolderCount", 25, [
  ["37", { set: 37, shows: "37", note: false }],
  ["1,234", { set: 1_234, shows: "1,234", note: true }],
  ["10k", { set: 10_000, shows: "10K" }],
  ["2.5K", { set: 2_500, shows: "2,500" }],
  ["12345", { set: 12_345, shows: "12,345" }],
  ["37.5", { set: 38, say: "Rounded to 38.", note: true }],
  ["0", { set: 0, shows: "Any" }],
  ["any", { set: 0, shows: "Any", say: "Set to Any." }],
  ["none", { set: 0, shows: "Any" }],
  ["25", "unchanged"],
  ["100001", { refused: HOLDERS_RANGE }],
  ["1m", { refused: HOLDERS_RANGE }],
  ["-3", "unreadable"],
  ["thirty", "unreadable"],
  ["1 000", "unreadable"],
]);

table("counts: Minimum holders at Any", "minHolderCount", 0, [
  ["any", "unchanged"],
  ["Any", "unchanged"],
  ["0", "unchanged"],
  ["50", { set: 50 }],
]);

table("counts: Max trades per day at 10", "maxDailyTrades", 10, [
  ["40", { set: 40, shows: "40" }],
  ["1", { set: 1 }],
  ["100", { set: 100 }],
  ["0", { refused: "Max trades per day goes from 1 to 100. Kept 10." }],
  ["101", "range"],
  ["ten", "unreadable"],
]);

table("counts: Max steps per run at 20", "maxSteps", 20, [
  ["12", { set: 12 }],
  ["41", { refused: "Max steps per run goes from 2 to 40. Kept 20." }],
  ["1", "range"],
]);

const TOP10_RANGE = "Top-10 wallet share goes from 5% to 100%. Kept 50%.";

table("percents: Top-10 wallet share at 50%", "maxTop10HolderPct", 50, [
  ["42", { set: 42, shows: "42%", note: false }],
  ["42%", { set: 42 }],
  ["42.4", { set: 42, say: "Rounded to 42%.", note: true }],
  ["42.5 %", { set: 43, say: "Rounded to 43%.", note: true }],
  ["5", { set: 5 }],
  ["100", { set: 100 }],
  ["+50", "unchanged"],
  ["50%", "unchanged"],
  ["4", { refused: TOP10_RANGE }],
  ["101", { refused: TOP10_RANGE }],
  ["0.5", { refused: TOP10_RANGE }],
  ["-50", "unreadable"],
  ["half", "unreadable"],
  ["any", { refused: "Top-10 wallet share needs a number, like 45%. Kept 50%." }],
]);

table("percents: Maximum buy tax at 5%", "maxBuyTaxPct", 5, [
  ["0", { set: 0, shows: "0%" }],
  ["25", { set: 25 }],
  ["7.5", { set: 8, say: "Rounded to 8%." }],
  ["26", { refused: "Maximum buy tax goes from 0% to 25%. Kept 5%." }],
]);

table("percents with a sign: Stop loss at −15%", "stopLossPct", 15, [
  ["-20", { set: 20, shows: "−20%" }],
  ["−20%", { set: 20, shows: "−20%" }],
  ["20", { set: 20, shows: "−20%" }],
  ["12.5", { set: 13, say: "Rounded to −13%.", note: true }],
  ["−15%", "unchanged"],
  ["15", "unchanged"],
  ["+20", "unreadable"],
  ["95", { refused: "Stop loss goes from −1% to −90%. Kept −15%." }],
  ["0", { refused: "Stop loss goes from −1% to −90%. Kept −15%." }],
  ["off", { refused: "Stop loss needs a number, like 20 or −20%. Kept −15%." }],
]);

table("percents with a sign: Take profit at +40%", "takeProfitPct", 40, [
  ["+42%", { set: 42, shows: "+42%" }],
  ["42", { set: 42, shows: "+42%" }],
  ["100.4", { set: 100, say: "Rounded to +100%.", note: true }],
  ["+40%", "unchanged"],
  ["-42", "unreadable"],
  ["750", { refused: "Take profit goes from +5% to +500%. Kept +40%." }],
  ["4", { refused: "Take profit goes from +5% to +500%. Kept +40%." }],
]);

table("percents with a sign: Trailing stop at 25% off peak", "trailingStopPct", 25, [
  ["30% off peak", { set: 30, shows: "30% off peak" }],
  ["30", { set: 30 }],
  ["25% off peak", "unchanged"],
  ["3", { refused: "Trailing stop goes from 5% off peak to 90% off peak. Kept 25% off peak." }],
  ["-30", "unreadable"],
]);

table("percents with a sign: Liquidity collapse at −50%", "exitOnLiquidityDropPct", 50, [
  ["-30", { set: 30, shows: "−30%" }],
  ["32", { set: 32, shows: "−32%" }],
  ["9", "range"],
  ["91", "range"],
]);

const SLIPPAGE_RANGE = "Slippage tolerance goes from 10 bps to 2000 bps. Kept 300 bps.";

table("basis points: Slippage tolerance at 300 bps", "slippageBps", 300, [
  ["155", { set: 155, shows: "155 bps" }],
  ["1.5%", { set: 150 }],
  ["1.55%", { set: 155, shows: "155 bps", note: false }],
  ["250bp", { set: 250 }],
  ["1,000", { set: 1_000, note: true }],
  ["1.555%", { set: 156, say: "Rounded to 156 bps.", note: true }],
  ["300 bps", "unchanged"],
  ["3 %", "unchanged"],
  ["0.05%", { refused: SLIPPAGE_RANGE }],
  ["5", { refused: SLIPPAGE_RANGE }],
  ["25%", { refused: SLIPPAGE_RANGE }],
  ["2001", { refused: SLIPPAGE_RANGE }],
  ["3 percent", "unreadable"],
  ["-1%", "unreadable"],
]);

table("scores: Minimum score at 62", "minScore", 62, [
  ["70", { set: 70, shows: "70" }],
  ["70/100", { set: 70 }],
  ["70 / 100", { set: 70 }],
  ["0", { set: 0 }],
  ["100", { set: 100 }],
  [".9", { set: 1, say: "Rounded to 1.", note: true }],
  ["61.5", "unchanged"],
  ["62", "unchanged"],
  ["101", { refused: "Minimum score goes from 0 to 100. Kept 62." }],
  ["-1", "unreadable"],
  ["70%", "unreadable"],
  ["62+", "unreadable"],
  ["7 0", "unreadable"],
  ["seventy", "unreadable"],
]);

table("scores: Score floor at 40/100", "exitScoreBelow", 40, [
  ["55", { set: 55, shows: "55/100" }],
  ["55/100", { set: 55 }],
  ["40/100", "unchanged"],
  ["4", { refused: "Score floor goes from 5/100 to 90/100. Kept 40/100." }],
  ["91", "range"],
]);

table("a plain number: Temperature at 0.7", "temperature", 0.7, [
  ["0.44", { set: 0.4, shows: "0.4", say: "Rounded to 0.4.", note: true }],
  ["0,4", { set: 0.4, note: true }],
  ["1.5", { set: 1.5 }],
  ["0", { set: 0, shows: "0.0" }],
  ["0.7", "unchanged"],
  ["1.6", { refused: "Temperature goes from 0.0 to 1.5. Kept 0.7." }],
  ["40%", "unreadable"],
  ["$1", "unreadable"],
]);

const MIN_AGE_UNREADABLE = "Could not read that. Try 30 minutes or 2h. Kept 5 minutes.";

table("durations in minutes: Minimum age at 5 minutes", "minAgeMinutes", 5, [
  // A bare number takes the unit on show, and says so where it can be seen.
  ["7", { set: 7, shows: "7 minutes", say: "Set to 7 minutes.", note: true }],
  ["7m", { set: 7, shows: "7 minutes", note: false }],
  ["2h", { set: 120, shows: "2 hours", note: false }],
  ["90 min", { set: 90, shows: "1.5 hours" }],
  ["1h 30m", { set: 90, shows: "1.5 hours" }],
  ["100", { set: 100, shows: "100 minutes" }],
  ["1.5 d", { set: 2_160, shows: "1.5 days" }],
  ["1w", { set: 10_080, shows: "7 days" }],
  ["1,440", { set: 1_440, shows: "1 day", note: true }],
  ["1d 2h 3m", { set: 1_563, shows: "1,563 minutes" }],
  ["7.4", { set: 7, say: "Rounded to 7 minutes.", note: true }],
  ["0", { set: 0, shows: "Any" }],
  ["any", { set: 0, shows: "Any" }],
  ["5m", "unchanged"],
  ["5 minutes", "unchanged"],
  ["5", "unchanged"],
  ["8d", { refused: "Minimum age goes from 0 to 7 days. Kept 5 minutes." }],
  ["1h30", { refused: MIN_AGE_UNREADABLE }],
  ["h", { refused: MIN_AGE_UNREADABLE }],
  ["45 s", { refused: MIN_AGE_UNREADABLE }],
  ["2 fortnights", { refused: MIN_AGE_UNREADABLE }],
  ["1h 1h", { refused: MIN_AGE_UNREADABLE }],
  ["30m 1h", { refused: MIN_AGE_UNREADABLE }],
  ["1y 1mo 1d 1h", { refused: MIN_AGE_UNREADABLE }],
]);

table("durations in minutes: Minimum age at 1 day", "minAgeMinutes", 1_440, [
  ["3", { set: 4_320, shows: "3 days", say: "Set to 3 days.", note: true }],
  ["36h", { set: 2_160, shows: "1.5 days" }],
  // Twelve days and thirty days are over the range. Never twelve or thirty minutes.
  ["12", { refused: "Minimum age goes from 0 to 7 days. Kept 1 day." }],
  ["30", { refused: "Minimum age goes from 0 to 7 days. Kept 1 day." }],
  ["30m", { set: 30, shows: "30 minutes" }],
]);

table("durations in minutes: Minimum age at 2 hours", "minAgeMinutes", 120, [
  ["30", { set: 1_800, shows: "30 hours", say: "Set to 30 hours.", note: true }],
  ["100", { set: 6_000, shows: "100 hours", note: true }],
]);

table("durations in minutes: Minimum age at 1.5 hours", "minAgeMinutes", 90, [
  // The residual risk: somebody who meant ninety minutes. The visible note is the receipt.
  ["90", { set: 5_400, shows: "90 hours", say: "Set to 90 hours.", note: true }],
  ["90m", "unchanged"],
]);

table("durations in minutes: Minimum age at Any", "minAgeMinutes", 0, [
  ["30", { set: 30, shows: "30 minutes", note: true }],
  ["any", "unchanged"],
  ["no minimum", "unchanged"],
]);

const MAX_AGE_ZERO = '0 would block every token. Type "any" for no limit. Kept 1 day.';
const MAX_AGE_RANGE = "Maximum age goes from 15 minutes to 1 year. Kept 1 day.";

table("durations in hours: Maximum age at 1 day", "maxAgeHours", 24, [
  ["36 hours", { set: 36, shows: "36 hours", note: false }],
  ["36h", { set: 36, shows: "36 hours" }],
  ["1.5 d", { set: 36, shows: "36 hours" }],
  ["2", { set: 48, shows: "2 days", say: "Set to 2 days.", note: true }],
  ["6", { set: 144, shows: "6 days" }],
  ["30", { set: 720, shows: "1 month", say: "Set to 1 month.", note: true }],
  ["90m", { set: 1.5, shows: "1.5 hours" }],
  ["15m", { set: 0.25, shows: "15 minutes" }],
  // Twenty minutes is stored as 0.3333 hours and is not reported as rounded.
  ["20 min", { set: 0.3333, shows: "20 minutes", say: "Set to 20 minutes.", note: false }],
  ["100 minutes", { set: 1.6667, shows: "100 minutes" }],
  ["1 month", { set: 720, shows: "1 month" }],
  ["3 months", { set: 2_160, shows: "3 months" }],
  ["1y", { set: 8_760, shows: "1 year" }],
  ["24.5h", { set: 24.5, shows: "24.5 hours" }],
  ["1h 7m", { set: 1.1167, shows: "67 minutes" }],
  ["42d", { set: 1_008, shows: "42 days" }],
  ["any", { set: null, shows: "Any", say: "Set to Any." }],
  ["none", { set: null }],
  ["no limit", { set: null }],
  ["1 day", "unchanged"],
  ["24h", "unchanged"],
  ["", "unchanged"],
  ["10m", { refused: MAX_AGE_RANGE }],
  ["2y", { refused: MAX_AGE_RANGE }],
  ["0", { refused: MAX_AGE_ZERO }],
  ["0h", { refused: MAX_AGE_ZERO }],
]);

table("durations in hours: Maximum age at 1 month", "maxAgeHours", 720, [
  // Three months, not three hours: the unit on show includes months.
  ["3", { set: 2_160, shows: "3 months", say: "Set to 3 months.", note: true }],
]);

table("durations in hours: Maximum age at 15 minutes", "maxAgeHours", 0.25, [
  ["30", { set: 0.5, shows: "30 minutes", note: true }],
  ["15 minutes", "unchanged"],
]);

table("durations in hours: Maximum age at 36 hours", "maxAgeHours", 36, [["1.5 d", "unchanged"]]);

table("durations in hours: Maximum age at Any", "maxAgeHours", null, [
  ["12", { set: 12, shows: "12 hours", say: "Set to 12 hours.", note: true }],
  ["36", { set: 36, shows: "36 hours" }],
  ["3d", { set: 72, shows: "3 days", note: false }],
  ["any", "unchanged"],
  ["Any", "unchanged"],
  ["0", { refused: '0 would block every token. Type "any" for no limit. Kept Any.' }],
]);

table("durations in hours: Max hold at 24h", "maxHoldHours", 24, [
  ["90m", { set: 1.5, shows: "1.5h", note: false }],
  ["30", { set: 30, shows: "30h", say: "Set to 30h.", note: true }],
  ["3d", { set: 72, shows: "3d" }],
  ["50h", { set: 50, shows: "50h" }],
  ["60h", { set: 60, shows: "2.5d" }],
  ["15m", { set: 0.25, shows: "0.25h" }],
  ["49h 15m", { set: 49.25, shows: "49.25h" }],
  ["20m", { set: 0.25, say: "Rounded to 0.25h.", note: true }],
  ["24h", "unchanged"],
  ["1d", "unchanged"],
  ["5m", { refused: "Max hold goes from 0.25h to 7d. Kept 24h." }],
  ["8d", { refused: "Max hold goes from 0.25h to 7d. Kept 24h." }],
  ["off", { refused: "Max hold needs a number, like 24h or 90m. Kept 24h." }],
]);

table("durations in hours: Max hold at 2.5d", "maxHoldHours", 60, [
  ["3", { set: 72, shows: "3d", say: "Set to 3d.", note: true }],
]);

// ----------------------------------------------------------------- readers

describe("the readers", () => {
  it("read the shapes the old value box read", () => {
    expect(readUsd("$1,250.50")).toBe(1250.5);
    expect(readPercent("15%")).toBe(15);
    expect(readNumber(" 0.5 ")).toBe(0.5);
    expect(readNumber(".5")).toBe(0.5);
    expect(readPercent("−15%", "drop")).toBe(15);
    expect(readPercent("-20", "drop")).toBe(20);
    expect(readPercent("−20%", "drop")).toBe(20);
    expect(readPercent("x", "drop")).toBeNull();
    expect(readBps("1.5%")).toBe(150);
    expect(readBps("300")).toBe(300);
    expect(readBps("300 bps")).toBe(300);
  });

  it("refuse anything that is not a plain decimal", () => {
    for (const text of ["abc", "1e3", "", "1.2.3", "300 bps"]) expect(readNumber(text)).toBeNull();
  });

  it("never give a number that is not finite, and never a negative one", () => {
    const hostile = [
      "NaN", "Infinity", "-Infinity", "1e3", "1e400", "0x10", "-0", "٣", "１２", "1_000",
      "--5", "+-5", "5-", "$-5", "", " ", ".", ",", ",5", "1,", "1,,000", "1,00,000", "1.", "$",
    ];
    for (const text of hostile) {
      const results = [
        readUsd(text), readCount(text), readPercent(text), readPercent(text, "gain"),
        readBps(text), readScore(text), readNumber(text), readSpan(text, "minute"),
      ];
      for (const result of results) expect(result, JSON.stringify(text)).toBeNull();
      const drop = readPercent(text, "drop");
      expect(drop === null || (Number.isFinite(drop) && drop >= 0), JSON.stringify(text)).toBe(true);
    }
  });

  it("read a comma two ways and no others", () => {
    expect(readUsd("7,37")).toBe(7.37);
    expect(readUsd("1,5")).toBe(1.5);
    expect(readUsd("0,5")).toBe(0.5);
    expect(readUsd("12,34")).toBe(12.34);
    expect(readUsd("1,234")).toBe(1234);
    expect(readUsd("1,234,567.5")).toBe(1234567.5);
    for (const text of ["1,2345", "1.234,5", "15 000", ",5", "1,", "1,23,456", "1234,567"]) {
      expect(readUsd(text), text).toBeNull();
    }
  });

  it("keep a sign for the fields that are shown with one", () => {
    expect(readPercent("+50")).toBe(50);
    expect(readPercent("-50")).toBeNull();
    expect(readPercent("+20", "drop")).toBeNull();
    expect(readPercent("+42%", "gain")).toBe(42);
    expect(readPercent("-42", "gain")).toBeNull();
    expect(readPercent("30 off peak")).toBe(30);
  });

  it("clear the float dust a suffix leaves", () => {
    expect(readUsd("2.3k")).toBe(2300);
    expect(readBps("1.15%")).toBe(115);
    expect(readSpan("1.1h", "minute")).toBe(66);
  });

  it("read a length of time in minutes, larger unit first, each unit once", () => {
    expect(readSpan("30", "minute")).toBe(30);
    expect(readSpan("30", "hour")).toBe(1_800);
    expect(readSpan("3", "month")).toBe(129_600);
    expect(readSpan("1 minute", "day")).toBe(1);
    expect(readSpan("1m", "day")).toBe(1);
    expect(readSpan("2 hrs", "minute")).toBe(120);
    expect(readSpan("1 wk", "minute")).toBe(10_080);
    expect(readSpan("1mo", "minute")).toBe(43_200);
    expect(readSpan("1 yr", "minute")).toBe(525_600);
    expect(readSpan("1d 2h 3m", "minute")).toBe(1_563);
    for (const text of ["1h30", "1h 1h", "30m 1h", "h", "45 s", "1y 1mo 1d 1h", "-1h", "1 h m"]) {
      expect(readSpan(text, "minute"), text).toBeNull();
    }
  });

  it("know the words that remove a limit", () => {
    for (const word of ["any", "Any", " ANY AGE ", "none", "no limit", "no minimum", "no ceiling", "off", "unlimited", "∞"]) {
      expect(isAnyWord(word), word).toBe(true);
    }
    for (const word of ["", "0", "anything", "no", "infinite"]) expect(isAnyWord(word), word).toBe(false);
  });

  it("take a bare number's unit from what the field shows", () => {
    expect(shownUnit("5 minutes", "hour")).toBe("minute");
    expect(shownUnit("1.5 hours", "minute")).toBe("hour");
    expect(shownUnit("1 day", "minute")).toBe("day");
    expect(shownUnit("1 month", "hour")).toBe("month");
    expect(shownUnit("1 year", "hour")).toBe("year");
    expect(shownUnit("2 weeks", "hour")).toBe("week");
    expect(shownUnit("24h", "minute")).toBe("hour");
    expect(shownUnit("2.5d", "hour")).toBe("day");
    expect(shownUnit("Any", "hour")).toBe("hour");
    expect(shownUnit("Any", "minute")).toBe("minute");
  });
});

// -------------------------------------------------------------- formatters

/** Today's label for a maximum age, as the universe controls print it. */
const maxAgeLabel = (hours: number): string =>
  hours < 1 ? formatMinutes(Math.max(1, Math.round(hours * 60))) : formatHours(hours);

describe("the honest formatters", () => {
  it("print off-ladder values exactly", () => {
    expect(sayUsd(12_345)).toBe("$12,345");
    expect(sayUsd(9_999)).toBe("$9,999");
    expect(sayUsd(999_999)).toBe("$999,999");
    expect(sayCount(12_345)).toBe("12,345");
    expect(sayMinutes(100)).toBe("100 minutes");
    expect(sayMinutes(1_500)).toBe("25 hours");
    expect(sayMinutes(1_439)).toBe("1,439 minutes");
    expect(sayHours(36)).toBe("36 hours");
    expect(sayHours(1_008)).toBe("42 days");
    expect(sayHours(24.5)).toBe("24.5 hours");
    expect(sayHours(1.1167)).toBe("67 minutes");
    expect(sayHours(0.25)).toBe("15 minutes");
    expect(sayHours(0)).toBe("0 minutes");
    expect(sayHold(50)).toBe("50h");
    expect(sayHold(49.25)).toBe("49.25h");
    expect(sayHold(0.5)).toBe("0.5h");
  });

  it("print every ladder stop and every preset value as it is printed today", () => {
    const presets = [
      ...UNIVERSE_PRESETS.map((preset) => preset.values),
      ...STRATEGY_PRESETS.map((preset) => preset.universe ?? {}),
    ];
    const defined = (values: Array<number | null | undefined>): number[] =>
      values.filter((value): value is number => typeof value === "number");

    for (const usd of [...LIQUIDITY_LADDER, ...defined(presets.map((p) => p.minLiquidityUsd))]) {
      expect(sayUsd(usd)).toBe(formatCompactUsd(usd));
    }
    for (const holders of [...HOLDER_LADDER, ...defined(presets.map((p) => p.minHolderCount))]) {
      expect(sayCount(holders)).toBe(formatHolders(holders));
    }
    for (const minutes of [...MIN_AGE_LADDER, ...defined(presets.map((p) => p.minAgeMinutes))]) {
      if (minutes > 0) expect(sayMinutes(minutes)).toBe(formatMinutes(minutes));
    }
    for (const hours of [...MAX_AGE_LADDER, ...defined(presets.map((p) => p.maxAgeHours))]) {
      expect(sayHours(hours)).toBe(maxAgeLabel(hours));
    }
    expect([1, 24, 47, 48, 60, 168].map(sayHold)).toEqual(["1h", "24h", "47h", "2d", "2.5d", "7d"]);
  });

  // The property that lets a field keep its own text on focus: what it prints, it reads.
  it("read back as the same number over the whole of each range", () => {
    let failures = 0;
    for (let usd = 1_000; usd <= 1_000_000; usd += 1) if (readUsd(sayUsd(usd)) !== usd) failures += 1;
    for (let count = 0; count <= 100_000; count += 1) if (readCount(sayCount(count)) !== count) failures += 1;
    for (let minutes = 1; minutes <= 10_080; minutes += 1) {
      if (readSpan(sayMinutes(minutes), "minute") !== minutes) failures += 1;
    }
    // Hours are stored to four decimals; every whole minute up to a year survives that.
    for (let minutes = 15; minutes <= 525_600; minutes += 1) {
      const hours = Number((minutes / 60).toFixed(4));
      if (Math.round(hours * 60) !== minutes || readSpan(sayHours(hours), "hour") !== minutes) failures += 1;
    }
    for (let minutes = 15; minutes <= 10_080; minutes += 15) {
      if (readSpan(sayHold(minutes / 60), "hour") !== minutes) failures += 1;
    }
    expect(failures).toBe(0);
    // Well over a million values: give it room on a busy machine.
  }, 120_000);
});

// ------------------------------------------------------------------ settle

const SPEC_IDS = Object.keys(SPECS) as SpecId[];

/** Minutes to the unit the spec stores, as `settle` does it. */
const stored = (spec: ValueSpec, amount: number): number =>
  spec.span?.stored === "hours" ? Number((amount / 60).toFixed(4)) : amount;

/** Is `value` (in the stored unit) inside the spec's range and on its precision grid? */
function onGrid(spec: ValueSpec, value: number): boolean {
  const amount = spec.span?.stored === "hours" ? Math.round(value * 60) : value;
  return amount >= spec.min && amount <= spec.max && roundTo(amount, spec.precision) === amount && stored(spec, amount) === value;
}

describe("settle", () => {
  it.each(SPEC_IDS)("%s: what the field shows is readable, so focus and Tab never write", (id) => {
    const spec = SPECS[id];
    const steps = 240;
    for (let step = 0; step <= steps; step += 1) {
      const amount = roundTo(spec.min + ((spec.max - spec.min) * step) / steps, spec.precision);
      const value = stored(spec, amount);
      const shown = spec.format(value);
      expect(settle(spec, shown, value), shown).toEqual({ status: "unchanged" });
      expect(preview(spec, shown, value), shown).toBeNull();

      // And typed over a different value it gives exactly the number it names.
      const other = stored(spec, amount === spec.min ? spec.max : spec.min);
      const result = settle(spec, shown, other);
      expect(result.status === "set" ? result.value : result, shown).toBe(value);
    }
  });

  it("keeps a stored value it would not accept until it is changed", () => {
    // An older config can hold a value outside today's range: shown as it is, not rewritten.
    expect(settle(SPECS.maxTradeUsd, "$9,000.00", 9_000)).toEqual({ status: "unchanged" });
    expect(settle(SPECS.maxHoldHours, "0.3333h", 0.3333)).toEqual({ status: "unchanged" });
    expect(settle(SPECS.minScore, "62", 61.5)).toEqual({ status: "unchanged" });
  });

  it("never stores a value outside the range or off the grid, whatever is typed", () => {
    // A small deterministic generator, so a failure can be reproduced.
    let seed = 0x2f6e2b1;
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const pieces = [
      "0", "1", "2", "5", "7", "9", "15", "37", "100", "999", "5000", "12345", "1000000", "99999999",
      ".", ",", " ", "-", "+", "−", "$", "%", "k", "m", "K", "M", "h", "d", "w", "mo", "y", "min",
      " hours", " days", " minutes", "bps", "/100", " off peak", "e", "any", "off", "∞",
    ];
    const text = (): string => {
      if (random() < 0.4) {
        const magnitude = 10 ** Math.floor(random() * 9 - 2);
        const digits = Math.floor(random() * 4);
        return `${pick(["", "", "$", "-", "+"])}${(random() * magnitude).toFixed(digits)}${pick(["", "", "%", "k", "m", "h", "d", " bps"])}`;
      }
      return Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(pieces)).join("");
    };

    let stores = 0;
    for (const id of SPEC_IDS) {
      const spec = SPECS[id];
      for (let round = 0; round < 6_000; round += 1) {
        const typed = text();
        const amount = roundTo(spec.min + (spec.max - spec.min) * random(), spec.precision);
        const current = spec.any === null && random() < 0.2 ? null : stored(spec, amount);
        const result = settle(spec, typed, current);
        if (result.status !== "set") continue;
        stores += 1;
        if (result.value === null) {
          expect(spec.any, `${id} ${JSON.stringify(typed)}`).toBeNull();
          continue;
        }
        expect(onGrid(spec, result.value), `${id} ${JSON.stringify(typed)} stored ${result.value}`).toBe(true);
        expect(result.value).not.toBe(current);
      }
    }
    // The generator does reach values that are stored; an empty run would prove nothing.
    expect(stores).toBeGreaterThan(1_000);
  });

  it("never clamps: just outside either end is refused and the old value named", () => {
    for (const id of SPEC_IDS) {
      const spec = SPECS[id];
      const current = stored(spec, spec.min);
      const over = spec.span ? `${spec.max + spec.precision}m` : String(roundTo(spec.max + spec.precision, spec.precision));
      const result = settle(spec, over, current);
      expect(result.status, `${id} ${over}`).toBe("refused");
      if (result.status === "refused") expect(result.message).toContain(`Kept ${display(spec, current)}.`);
    }
  });
});

describe("display and preview", () => {
  it("show Any for a limit that is off", () => {
    expect(display(SPECS.maxAgeHours, null)).toBe("Any");
    expect(display(SPECS.maxAgeHours, 36)).toBe("36 hours");
    expect(display(SPECS.minHolderCount, 0)).toBe("Any");
    expect(display(SPECS.minAgeMinutes, 0)).toBe("Any");
  });

  it("say what the text would become, and nothing while it would not be stored", () => {
    expect(preview(SPECS.minLiquidityUsd, "10000", 15_000)).toBe("Reads as $10K");
    expect(preview(SPECS.minAgeMinutes, "100", 120)).toBe("Reads as 100 hours");
    expect(preview(SPECS.maxAgeHours, "any", 24)).toBe("Reads as Any");
    expect(preview(SPECS.minLiquidityUsd, "1", 15_000)).toBeNull();
    expect(preview(SPECS.minLiquidityUsd, "abc", 15_000)).toBeNull();
    expect(preview(SPECS.minLiquidityUsd, "", 15_000)).toBeNull();
    expect(preview(SPECS.minLiquidityUsd, "15k", 15_000)).toBeNull();
  });
});

describe("roundTo", () => {
  it("rounds to the field's precision without float dust", () => {
    expect(roundTo(7.375, 0.01)).toBe(7.38);
    expect(roundTo(0.44, 0.1)).toBe(0.4);
    expect(roundTo(1.005, 0.01)).toBe(1.01);
    expect(roundTo(155.5, 1)).toBe(156);
    expect(roundTo(0.1 + 0.05, 0.01)).toBe(0.15);
    expect(roundTo(20, 15)).toBe(15);
    expect(roundTo(7, 5)).toBe(5);
  });
});
