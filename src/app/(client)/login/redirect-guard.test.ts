import { describe, expect, it } from "vitest";
import { claimHardRedirect, mayHardRedirect } from "./redirect-guard";

const NOW = 1_800_000_000_000;

/** `sessionStorage`, as much of it as the guard uses. */
function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("mayHardRedirect", () => {
  it("allows the first run in a tab", () => {
    expect(mayHardRedirect(null, NOW)).toBe(true);
  });

  it("refuses a second run inside a minute", () => {
    expect(mayHardRedirect(String(NOW), NOW)).toBe(false);
    expect(mayHardRedirect(String(NOW - 5_000), NOW)).toBe(false);
    expect(mayHardRedirect(String(NOW - 59_999), NOW)).toBe(false);
  });

  it("allows another run once a minute has passed", () => {
    expect(mayHardRedirect(String(NOW - 60_000), NOW)).toBe(true);
    expect(mayHardRedirect(String(NOW - 3_600_000), NOW)).toBe(true);
  });

  /** Unknown is treated as "just ran": refusing strands one status line, allowing could loop. */
  it("refuses when the stored value is not a timestamp", () => {
    expect(mayHardRedirect("", NOW)).toBe(false);
    expect(mayHardRedirect("  ", NOW)).toBe(false);
    expect(mayHardRedirect("yes", NOW)).toBe(false);
    expect(mayHardRedirect("NaN", NOW)).toBe(false);
    expect(mayHardRedirect("Infinity", NOW)).toBe(false);
  });

  it("is not held off for hours by a clock that was set back", () => {
    expect(mayHardRedirect(String(NOW + 30_000), NOW)).toBe(false);
    expect(mayHardRedirect(String(NOW + 3_600_000), NOW)).toBe(true);
  });
});

describe("claimHardRedirect", () => {
  it("records the run it allows, so the next one is refused", () => {
    const storage = fakeStorage();
    expect(claimHardRedirect(storage, NOW)).toBe(true);
    expect([...storage.values.values()]).toEqual([String(NOW)]);
    // The reload it causes lands back here five seconds later: no second run.
    expect(claimHardRedirect(storage, NOW + 5_000)).toBe(false);
    expect(claimHardRedirect(storage, NOW + 30_000)).toBe(false);
    expect(claimHardRedirect(storage, NOW + 60_000)).toBe(true);
  });

  it("does not move the record when it refuses", () => {
    const storage = fakeStorage();
    claimHardRedirect(storage, NOW);
    claimHardRedirect(storage, NOW + 45_000);
    // Measured from the run that happened, not from the attempt that was refused.
    expect(claimHardRedirect(storage, NOW + 61_000)).toBe(true);
  });

  it("refuses when there is no storage to record the run in", () => {
    expect(claimHardRedirect(null, NOW)).toBe(false);
  });

  it("refuses when storage throws on read or on write", () => {
    const unreadable = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(claimHardRedirect(unreadable, NOW)).toBe(false);

    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(claimHardRedirect(full, NOW)).toBe(false);
  });
});
