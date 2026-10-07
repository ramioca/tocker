import { describe, expect, it } from "vitest";
import { onboardingSuppressedOn } from "./suppress";

describe("onboardingSuppressedOn", () => {
  it("keeps the key prompt off the builder", () => {
    expect(onboardingSuppressedOn("/agents/new")).toBe(true);
  });

  it("leaves it alone everywhere else", () => {
    expect(onboardingSuppressedOn("/agents")).toBe(false);
    expect(onboardingSuppressedOn("/agents/new-thing")).toBe(false);
    expect(onboardingSuppressedOn("/agents/abc/settings")).toBe(false);
    expect(onboardingSuppressedOn("/home")).toBe(false);
    expect(onboardingSuppressedOn("/agents/new/")).toBe(false);
    expect(onboardingSuppressedOn("")).toBe(false);
  });
});
