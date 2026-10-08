/**
 * One spec per module: what may be typed into it, and how its value is printed. The
 * builder and the settings form both read ranges from here, so the two cannot disagree.
 * Pure: no React.
 *
 * A typed value reaches what the module's slider reaches and the values between its
 * stops. It does not go wider: the slider ranges are the product's safety envelope (Max
 * per trade stops at $5,000 though the schema allows far more). The two exceptions are
 * Maximum age and Max hold, which go down to fifteen minutes because a shipped preset
 * already stores that.
 *
 * Precision is what the field's formatter prints, so nothing is stored that the screen
 * cannot show.
 */
import { formatUsd } from "@/components/common/format";
import { USDC_DAY_CAP, USDC_RUN_CAP } from "@/lib/x402/inference-types";
import { MAX_DATA_SPEND_PER_RUN_USD } from "@/lib/x402/types";
import { LLM_BOUNDS, RISK_BOUNDS } from "./types";
import {
  readBps,
  readCount,
  readNumber,
  readPercent,
  readScore,
  readSpan,
  readUsd,
  sayCount,
  sayHold,
  sayHours,
  sayMinutes,
  sayUsd,
  type ValueSpec,
} from "./typed-value";

export type SpecId =
  | "minScore"
  | "minLiquidityUsd"
  | "minHolderCount"
  | "minAgeMinutes"
  | "maxAgeHours"
  | "maxTop10HolderPct"
  | "maxBuyTaxPct"
  | "maxTradeUsd"
  | "maxDailyTrades"
  | "maxPositionPct"
  | "maxDataSpendUsdPerRun"
  | "slippageBps"
  | "maxOpenPositions"
  | "cashReserveUsd"
  | "stopLossPct"
  | "takeProfitPct"
  | "trailingStopPct"
  | "maxHoldHours"
  | "exitScoreBelow"
  | "exitOnLiquidityDropPct"
  | "temperature"
  | "maxSteps"
  | "usdcPerRun"
  | "usdcPerDay"
  | "interval"
  | "proposalTtl"
  | "paperStart";

// --------------------------------------------------------------- ladders

/**
 * Liquidity, holders and age are log-ish: the difference between $1k and $5k
 * matters far more than between $500k and $600k. A linear slider over those
 * ranges is a lie, so each one moves along a ladder of numbers a trader would
 * actually type.
 */
export const LIQUIDITY_LADDER: readonly number[] = [
  1_000, 2_500, 5_000, 10_000, 15_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000,
];
export const HOLDER_LADDER: readonly number[] = [
  0, 25, 50, 100, 150, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 100_000,
];
/** Minutes. */
export const MIN_AGE_LADDER: readonly number[] = [0, 5, 15, 30, 60, 120, 360, 720, 1_440, 4_320, 10_080];
/** Hours. */
export const MAX_AGE_LADDER: readonly number[] = [1, 6, 12, 24, 72, 168, 720, 2_160, 8_760];

// ----------------------------------------------------------------- shapes

const last = (ladder: readonly number[]): number => ladder[ladder.length - 1];

const wholePercent = (value: number): string => `${Math.round(value)}%`;
const whole = (value: number): string => String(Math.round(value));

/** A whole percentage with no sign: a share or a tax. */
function percent(label: string, min: number, max: number, example: string): ValueSpec {
  return {
    label,
    min,
    max,
    precision: 1,
    read: (text) => readPercent(text, "none"),
    format: wholePercent,
    example,
    inputMode: "decimal",
  };
}

/** Dollars kept to the cent, printed with both decimals. */
function cents(label: string, min: number, max: number, example: string): ValueSpec {
  return {
    label,
    min,
    max,
    precision: 0.01,
    read: readUsd,
    format: (value) => formatUsd(value),
    example,
    inputMode: "decimal",
  };
}

/** A whole number of things. */
function count(label: string, min: number, max: number, example: string): ValueSpec {
  return { label, min, max, precision: 1, read: readCount, format: whole, example, inputMode: "numeric" };
}

/** The fifteen-minute floor of the two fields a shipped preset takes under their slider. */
const QUARTER_HOUR = 15;
const WEEK_MINUTES = 10_080;

// ------------------------------------------------------------------ specs

export const SPECS: Record<SpecId, ValueSpec> = {
  // ---- where it hunts
  minScore: {
    label: "Minimum score",
    min: 0,
    max: 100,
    precision: 1,
    read: readScore,
    format: whole,
    example: "70",
    inputMode: "decimal",
  },
  minLiquidityUsd: {
    label: "Minimum liquidity",
    min: LIQUIDITY_LADDER[0],
    max: last(LIQUIDITY_LADDER),
    precision: 1,
    read: readUsd,
    format: sayUsd,
    // Leads with what a phone's number pad can type; the short form is for a keyboard.
    example: "10000 or 10k",
    inputMode: "decimal",
  },
  minHolderCount: {
    label: "Minimum holders",
    min: HOLDER_LADDER[0],
    max: last(HOLDER_LADDER),
    precision: 1,
    read: readCount,
    format: (value) => (value === 0 ? "Any" : sayCount(value)),
    any: 0,
    example: "250 or 10k",
    inputMode: "numeric",
  },
  minAgeMinutes: {
    label: "Minimum age",
    min: MIN_AGE_LADDER[0],
    max: last(MIN_AGE_LADDER),
    precision: 1,
    read: (text) => readSpan(text, "minute"),
    format: (value) => (value === 0 ? "Any" : sayMinutes(value)),
    span: { stored: "minutes", bare: "minute" },
    any: 0,
    example: "30 minutes or 2h",
    inputMode: "text",
  },
  maxAgeHours: {
    label: "Maximum age",
    min: QUARTER_HOUR,
    max: last(MAX_AGE_LADDER) * 60,
    precision: 1,
    read: (text) => readSpan(text, "hour"),
    format: sayHours,
    span: { stored: "hours", bare: "hour" },
    any: null,
    example: "36 hours or 3d",
    // The schema takes a zero ceiling, and the score gate would then turn every token
    // away. Reading it as "no ceiling" would be a guess in the opposite direction.
    refuse: (minutes) => (minutes === 0 ? '0 would block every token. Type "any" for no limit.' : null),
    inputMode: "text",
  },
  maxTop10HolderPct: percent("Top-10 wallet share", 5, 100, "45%"),
  maxBuyTaxPct: percent("Maximum buy tax", 0, 25, "5%"),

  // ---- risk limits
  maxTradeUsd: cents("Max per trade", RISK_BOUNDS.maxTradeUsd.min, RISK_BOUNDS.maxTradeUsd.max, "25 or $1,250.50"),
  maxDailyTrades: count("Max trades per day", 1, 100, "10"),
  maxPositionPct: percent("Max position size", 1, 100, "25%"),
  maxDataSpendUsdPerRun: cents("Data spend cap per run", 0, MAX_DATA_SPEND_PER_RUN_USD, "1 or $0.35"),
  slippageBps: {
    label: "Slippage tolerance",
    min: 10,
    max: 2_000,
    precision: 1,
    read: readBps,
    format: (value) => `${Math.round(value)} bps`,
    example: "150 or 1.5%",
    inputMode: "decimal",
  },
  // Both can be off, which is the switch's to say: the box itself only takes a number.
  maxOpenPositions: count(
    "Max open positions",
    RISK_BOUNDS.maxOpenPositions.min,
    RISK_BOUNDS.maxOpenPositions.max,
    "3",
  ),
  cashReserveUsd: cents("Cash reserve", RISK_BOUNDS.cashReserveUsd.min, RISK_BOUNDS.cashReserveUsd.max, "5 or $12.50"),

  // ---- exit rules
  stopLossPct: {
    label: "Stop loss",
    min: 1,
    max: 90,
    precision: 1,
    read: (text) => readPercent(text, "drop"),
    format: (value) => `−${value}%`,
    example: "20 or −20%",
    inputMode: "decimal",
  },
  takeProfitPct: {
    label: "Take profit",
    min: 5,
    max: 500,
    precision: 1,
    read: (text) => readPercent(text, "gain"),
    format: (value) => `+${value}%`,
    example: "40 or +40%",
    inputMode: "decimal",
  },
  trailingStopPct: {
    label: "Trailing stop",
    min: 5,
    max: 90,
    precision: 1,
    read: (text) => readPercent(text, "none"),
    format: (value) => `${value}% off peak`,
    example: "25 or 25%",
    inputMode: "decimal",
  },
  maxHoldHours: {
    label: "Max hold",
    min: QUARTER_HOUR,
    max: 168 * 60,
    precision: QUARTER_HOUR,
    read: (text) => readSpan(text, "hour"),
    format: sayHold,
    span: { stored: "hours", bare: "hour" },
    example: "24h or 90m",
    inputMode: "text",
  },
  exitScoreBelow: {
    label: "Score floor",
    min: 5,
    max: 90,
    precision: 1,
    read: readScore,
    format: (value) => `${value}/100`,
    example: "40",
    inputMode: "decimal",
  },
  exitOnLiquidityDropPct: {
    label: "Liquidity collapse",
    min: 10,
    max: 90,
    precision: 1,
    read: (text) => readPercent(text, "drop"),
    format: (value) => `−${value}%`,
    example: "50 or −50%",
    inputMode: "decimal",
  },

  // ---- how it thinks
  temperature: {
    label: "Temperature",
    min: 0,
    max: 1.5,
    precision: 0.1,
    read: readNumber,
    format: (value) => value.toFixed(1),
    example: "0.4",
    inputMode: "decimal",
  },
  maxSteps: count("Max steps per run", LLM_BOUNDS.maxSteps.min, LLM_BOUNDS.maxSteps.max, "12"),
  usdcPerRun: cents("Limit per run", USDC_RUN_CAP.min, USDC_RUN_CAP.max, "0.30"),
  usdcPerDay: cents("Limit per day", USDC_DAY_CAP.min, USDC_DAY_CAP.max, "3"),

  // ---- schedule. No module draws these three yet; the ranges are the ones a custom
  // choice beside the preset buttons would take.
  interval: {
    label: "Interval",
    // The scheduler wakes agents every five minutes, so a seven-minute interval would
    // be a promise it cannot keep.
    min: 5,
    max: WEEK_MINUTES,
    precision: 5,
    read: (text) => readSpan(text, "minute"),
    format: sayMinutes,
    span: { stored: "minutes", bare: "minute" },
    example: "30 minutes or 2h",
    refuse: (minutes) => (minutes === 0 ? "Use Manual for no schedule." : null),
    inputMode: "text",
  },
  proposalTtl: {
    label: "Decision window",
    min: 5,
    max: 1_440,
    precision: 1,
    read: (text) => readSpan(text, "minute"),
    format: sayMinutes,
    span: { stored: "minutes", bare: "minute" },
    example: "30 minutes or 2h",
    inputMode: "text",
  },
  paperStart: {
    label: "Paper starting balance",
    min: 1,
    max: 10_000_000,
    precision: 1,
    read: readUsd,
    format: sayUsd,
    example: "10k or $12,345",
    inputMode: "decimal",
  },
};
