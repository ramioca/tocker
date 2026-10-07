import { describe, expect, it } from "vitest";
import { shouldLoadSilk, type SilkEnv } from "./login-silk-gate";

/** A device the silk is meant for; each test changes one thing about it. */
const capable: SilkEnv = { reducedMotion: false, hasWebGPU: true };

describe("shouldLoadSilk", () => {
  it("loads the silk where WebGPU exists and nothing else is reported", () => {
    expect(shouldLoadSilk(capable)).toBe(true);
    expect(
      shouldLoadSilk({ ...capable, saveData: undefined, deviceMemory: undefined, hardwareConcurrency: undefined }),
    ).toBe(true);
  });

  it("keeps the poster for a visitor who asked for less motion", () => {
    expect(shouldLoadSilk({ ...capable, reducedMotion: true })).toBe(false);
  });

  it("keeps the poster without WebGPU", () => {
    expect(shouldLoadSilk({ ...capable, hasWebGPU: false })).toBe(false);
  });

  it("keeps the poster with data saver on", () => {
    expect(shouldLoadSilk({ ...capable, saveData: true })).toBe(false);
    expect(shouldLoadSilk({ ...capable, saveData: false })).toBe(true);
  });

  it("keeps the poster under 4 GB of memory, and not at 4", () => {
    expect(shouldLoadSilk({ ...capable, deviceMemory: 2 })).toBe(false);
    expect(shouldLoadSilk({ ...capable, deviceMemory: 4 })).toBe(true);
    expect(shouldLoadSilk({ ...capable, deviceMemory: 8 })).toBe(true);
  });

  it("keeps the poster under 4 cores, and not at 4", () => {
    expect(shouldLoadSilk({ ...capable, hardwareConcurrency: 2 })).toBe(false);
    expect(shouldLoadSilk({ ...capable, hardwareConcurrency: 4 })).toBe(true);
  });

  it("lets one failing reading keep the poster whatever the others say", () => {
    expect(shouldLoadSilk({ ...capable, deviceMemory: 8, hardwareConcurrency: 2 })).toBe(false);
    expect(shouldLoadSilk({ ...capable, deviceMemory: 2, hardwareConcurrency: 16 })).toBe(false);
  });
});
