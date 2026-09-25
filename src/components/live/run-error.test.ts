import { describe, expect, it } from "vitest";
import { runErrorMessage } from "./run-error";

describe("runErrorMessage", () => {
  it("never shows the route's codes", () => {
    expect(runErrorMessage(401, { error: "unauthorized" })).toBe("Your session ended — sign in again.");
    expect(runErrorMessage(403, { error: "forbidden" })).toBe("This agent isn't yours or no longer exists.");
    expect(runErrorMessage(404, { error: "not found" })).toBe("This agent isn't yours or no longer exists.");
  });

  it("passes a 409's sentence through", () => {
    expect(runErrorMessage(409, { error: "This agent is still a draft. Activate it first." })).toBe(
      "This agent is still a draft. Activate it first.",
    );
  });

  it("falls back for anything else, including an unreadable body", () => {
    expect(runErrorMessage(502, null)).toBe("The run didn't start. Try again in a minute.");
    expect(runErrorMessage(409, null)).toBe("The run didn't start. Try again in a minute.");
    expect(runErrorMessage(500, null, "Lost track")).toBe("Lost track");
  });
});
