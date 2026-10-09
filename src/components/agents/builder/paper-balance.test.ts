/**
 * The paper starting balance, as far as it is decided without a browser: what may be
 * typed into its box and what is refused, how any amount is printed, what a create sends,
 * and the words around the control.
 *
 * The range is the server's (`checkPaperStartingUsd`); the first block holds the box to it
 * at both ends, so the form never offers an amount the server would turn away.
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_BALANCE_MAX_USD,
  PAPER_BALANCE_MIN_USD,
  checkPaperStartingUsd,
} from "@/lib/trading/paper-balance";
import { MIN_FUND_USD } from "@/lib/wallets/funding";
import { SPECS } from "./module-specs";
import {
  PAPER_BALANCE_HINT,
  PAPER_BALANCE_LOCKED_HINTS,
  PAPER_BALANCE_OPEN_HINT,
  paperBalanceForCreate,
  paperBalanceLabel,
  paperLabel,
} from "./paper-balance";
import { display, preview, settle } from "./typed-value";
import { PAPER_BALANCES, emptyDraft, restoreDraft, type BuilderDraft } from "./types";

const spec = SPECS.paperStart;
/** The box as it stands on a fresh draft: the middle button's amount. */
const AT = 10_000;

const RANGE = "Paper starting balance goes from $10 to $10M. Kept $10K.";
const UNREADABLE = "Could not read that. Try 10k or $12,345. Kept $10K.";

describe("what may be typed into the paper balance box", () => {
  it("has the server's range, to the cent", () => {
    expect(spec.min).toBe(PAPER_BALANCE_MIN_USD);
    expect(spec.max).toBe(PAPER_BALANCE_MAX_USD);
    expect(spec.precision).toBe(0.01);
    expect(spec.min).toBe(10);
    expect(spec.max).toBe(10_000_000);
  });

  it.each([
    ["20", 20, "$20"],
    ["$20", 20, "$20"],
    ["250", 250, "$250"],
    ["1500", 1_500, "$1.5K"],
    ["1.5k", 1_500, "$1.5K"],
    ["$1,500", 1_500, "$1.5K"],
    ["12345.67", 12_345.67, "$12,345.67"],
    ["$12,345.67", 12_345.67, "$12,345.67"],
    ["2.5m", 2_500_000, "$2.5M"],
    ["2500000", 2_500_000, "$2.5M"],
    ["1k", 1_000, "$1K"],
    ["100k", 100_000, "$100K"],
    // A decimal comma, as a phone's number pad types it in much of the world.
    ["20,50", 20.5, "$20.50"],
  ])("%j is %d and shows as %s", (typed, value, shown) => {
    const result = settle(spec, typed, AT);
    expect(result.status).toBe("set");
    if (result.status !== "set") return;
    expect(result.value).toBe(value);
    expect(display(spec, result.value)).toBe(shown);
    expect(preview(spec, typed, AT)).toBe(`Reads as ${shown}`);
    // Whatever the box takes, the server takes.
    expect(checkPaperStartingUsd(result.value)).toBeNull();
  });

  it("takes both ends of the range and refuses a cent outside either", () => {
    expect(settle(spec, "10", AT)).toMatchObject({ status: "set", value: 10 });
    expect(settle(spec, "10000000", AT)).toMatchObject({ status: "set", value: 10_000_000 });
    expect(settle(spec, "10m", AT)).toMatchObject({ status: "set", value: 10_000_000 });
    expect(settle(spec, "9.99", AT)).toEqual({ status: "refused", message: RANGE });
    expect(settle(spec, "10000000.01", AT)).toEqual({ status: "refused", message: RANGE });
  });

  it.each(["0", "1", "5", "9", "11m", "$1b", "99999999"].map((typed) => [typed]))(
    "refuses %j as out of range, and keeps what it had",
    (typed) => {
      const result = settle(spec, typed, AT);
      // "$1b" is not an amount the reader knows at all.
      expect(result).toEqual({ status: "refused", message: typed === "$1b" ? UNREADABLE : RANGE });
      expect(preview(spec, typed, AT)).toBeNull();
    },
  );

  it.each(["abc", "-50", "+50", "ten", "50%", "1.2.3", "any", "none"].map((typed) => [typed]))(
    "refuses %j, which is not an amount",
    (typed) => {
      const result = settle(spec, typed, AT);
      expect(result.status).toBe("refused");
      if (result.status !== "refused") return;
      // A balance has no "Any": the word is refused like any other that is not a number.
      expect(result.message).toBe(
        typed === "any" || typed === "none"
          ? "Paper starting balance needs a number, like 10k or $12,345. Kept $10K."
          : UNREADABLE,
      );
    },
  );

  it("never moves an amount to the nearest limit", () => {
    for (const typed of ["1", "9.99", "50m", "10000000.01"]) expect(settle(spec, typed, AT).status).toBe("refused");
  });

  it("keeps cents and rounds anything finer, saying so", () => {
    expect(settle(spec, "12.34", AT)).toMatchObject({ status: "set", value: 12.34, say: "Set to $12.34.", show: false });
    expect(settle(spec, "12.345", AT)).toMatchObject({ status: "set", value: 12.35, say: "Rounded to $12.35.", show: true });
  });

  it("leaves the balance alone when the box is emptied or left as it was", () => {
    for (const typed of ["", "   ", "$10K", "10000", "10k", "$10,000.00"]) {
      expect(settle(spec, typed, AT), typed).toEqual({ status: "unchanged" });
    }
  });

  it("lights a button when its amount is typed: the three are stored as typed", () => {
    for (const amount of PAPER_BALANCES) {
      for (const typed of [String(amount), `${amount / 1_000}k`, paperLabel(amount)]) {
        const result = settle(spec, typed, 20);
        expect(result, typed).toMatchObject({ status: "set", value: amount });
      }
      // And the box then shows what the button says.
      expect(display(spec, amount)).toBe(paperLabel(amount));
    }
    expect(PAPER_BALANCES.map(paperLabel)).toEqual(["$1K", "$10K", "$100K"]);
  });

  it("shows nothing that cannot be typed back to the same amount", () => {
    const amounts = [
      10, 10.01, 15, 20, 20.5, 99.99, 250, 999, 1_000, 1_001, 1_100, 1_250, 1_500, 9_999, 10_000, 12_300, 12_340,
      12_345, 12_345.67, 99_950, 100_000, 123_400, 999_900, 999_999, 999_999.99, 1_000_000, 1_000_500, 1_010_000,
      1_234_567, 1_250_000, 2_500_000, 9_990_000, 9_999_999.99, 10_000_000,
    ];
    for (const amount of amounts) {
      const shown = display(spec, amount);
      // Typed over a different balance, what the box showed gives the amount back.
      const other = amount === 20 ? 30 : 20;
      expect(settle(spec, shown, other), shown).toMatchObject({ status: "set", value: amount });
      // And typed over itself it is no change at all.
      expect(settle(spec, shown, amount), shown).toEqual({ status: "unchanged" });
    }
  });
});

describe("the short form of a paper balance", () => {
  it("prints the five amounts the way a card can carry them", () => {
    expect(paperLabel(20)).toBe("$20");
    expect(paperLabel(250)).toBe("$250");
    expect(paperLabel(1_500)).toBe("$1.5K");
    expect(paperLabel(12_345.67)).toBe("$12,345.67");
    expect(paperLabel(2_500_000)).toBe("$2.5M");
  });

  it("is short only where the short form is the number", () => {
    expect(paperLabel(1_000)).toBe("$1K");
    expect(paperLabel(12_300)).toBe("$12.3K");
    expect(paperLabel(999_900)).toBe("$999.9K");
    expect(paperLabel(1_000_000)).toBe("$1M");
    expect(paperLabel(1_250_000)).toBe("$1.25M");
    expect(paperLabel(10_000_000)).toBe("$10M");
    // One more digit than the short form holds: the amount itself, never a rounding of it.
    expect(paperLabel(1_250)).toBe("$1,250");
    expect(paperLabel(12_345)).toBe("$12,345");
    expect(paperLabel(1_234_567)).toBe("$1,234,567");
    expect(paperLabel(2_500_000.5)).toBe("$2,500,000.50");
    // Cents are kept, with both decimals, and whole dollars are said without them.
    expect(paperLabel(20.5)).toBe("$20.50");
    expect(paperLabel(10)).toBe("$10");
  });
});

describe("the paper balance a create sends", () => {
  const draft = (change: (d: BuilderDraft) => void): BuilderDraft => {
    const d = emptyDraft();
    change(d);
    return d;
  };

  it("is the amount chosen on a paper draft, whatever it is", () => {
    for (const usd of [20, 250, 1_500, 12_345.67, 2_500_000]) {
      expect(paperBalanceForCreate(draft((d) => (d.paperStartingUsd = usd)))).toBe(usd);
    }
  });

  it("is the funded amount on a funded draft, and never under the smallest paper balance", () => {
    const fundedWith = (amountUsd: number) =>
      paperBalanceForCreate(draft((d) => (d.funding = { mode: "fund", amountUsd, gasUsd: 0, split: null })));
    expect(fundedWith(25)).toBe(25);
    expect(fundedWith(10)).toBe(10);
    // Funding starts under the paper range: such a create used to send the funded amount,
    // which the server now refuses as a paper balance.
    expect(MIN_FUND_USD).toBeLessThan(PAPER_BALANCE_MIN_USD);
    expect(fundedWith(MIN_FUND_USD)).toBe(PAPER_BALANCE_MIN_USD);
    expect(fundedWith(7.5)).toBe(10);
    for (const amountUsd of [MIN_FUND_USD, 7.5, 10, 25, 5_000]) {
      expect(checkPaperStartingUsd(fundedWith(amountUsd)), String(amountUsd)).toBeNull();
    }
  });
});

describe("the words around the control", () => {
  it("names the range it takes, in the control's own short form", () => {
    expect(PAPER_BALANCE_HINT).toBe(
      "Pick one or type any amount from $10 to $10M. Fake money, real prices, real fills at real quotes.",
    );
    // Real-money trades close the balance as paper ones do, so "yet" is about either.
    expect(PAPER_BALANCE_OPEN_HINT).toBe(
      "It has not traded yet, so you can still change this. Pick one or type any amount from $10 to $10M.",
    );
  });

  it("says why a balance can no longer be changed, one sentence for each reason", () => {
    expect(PAPER_BALANCE_LOCKED_HINTS).toEqual({
      paper: "It has traded on paper, so its balance is part of its record.",
      live: "It has traded with real money, and its paper book counts those trades, so its balance is part of its record.",
    });
    // An agent that only ever traded real money is not told it traded on paper.
    expect(PAPER_BALANCE_LOCKED_HINTS.live).not.toContain("on paper");
  });

  it("says what the balance is for on an agent that trades real money", () => {
    expect(paperBalanceLabel()).toBe("Paper starting balance");
    expect(paperBalanceLabel("paper")).toBe("Paper starting balance");
    expect(paperBalanceLabel("live")).toBe("Paper balance, used if you switch back to paper");
  });

  it("never says reset", () => {
    for (const words of [
      PAPER_BALANCE_HINT,
      PAPER_BALANCE_OPEN_HINT,
      ...Object.values(PAPER_BALANCE_LOCKED_HINTS),
      paperBalanceLabel("live"),
      paperBalanceLabel("paper"),
    ]) {
      expect(words.toLowerCase()).not.toContain("reset");
    }
  });
});

/**
 * A draft is kept in the browser, and one saved before any amount could be typed carries
 * one of the three buttons' amounts, or no balance at all.
 */
describe("a browser draft saved before any amount could be typed", () => {
  it("still loads, with the balance it had", () => {
    for (const amount of PAPER_BALANCES) {
      const saved = JSON.parse(JSON.stringify({ ...emptyDraft(), name: "Old draft", paperStartingUsd: amount }));
      const restored = restoreDraft(emptyDraft(), saved as Partial<BuilderDraft>);
      expect(restored.name).toBe("Old draft");
      expect(restored.paperStartingUsd).toBe(amount);
      // The box shows it, and its button is the one lit.
      expect(display(spec, restored.paperStartingUsd)).toBe(paperLabel(amount));
      expect(PAPER_BALANCES.filter((preset) => preset === restored.paperStartingUsd)).toEqual([amount]);
      expect(paperBalanceForCreate(restored)).toBe(amount);
    }
  });

  it("loads on the starting balance when it says nothing about one", () => {
    const { paperStartingUsd: _dropped, ...withoutBalance } = emptyDraft();
    const restored = restoreDraft(emptyDraft(), { ...withoutBalance, name: "Older still" });
    expect(restored.name).toBe("Older still");
    expect(restored.paperStartingUsd).toBe(emptyDraft().paperStartingUsd);
  });

  it("keeps an amount typed since, and nothing the box could not hold", () => {
    const restore = (paperStartingUsd: unknown) =>
      restoreDraft(emptyDraft(), { paperStartingUsd } as Partial<BuilderDraft>).paperStartingUsd;
    expect(restore(12_345.67)).toBe(12_345.67);
    expect(restore(20)).toBe(20);
    expect(restore(10_000_000)).toBe(10_000_000);
    // Storage can hold anything; none of these is an amount the server would take.
    for (const junk of [0, 5, -100, 99_999_999, Number.NaN, null, "10000", {}, undefined]) {
      expect(restore(junk), String(junk)).toBe(10_000);
    }
  });
});
