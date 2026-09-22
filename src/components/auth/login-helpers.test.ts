import { describe, expect, it } from "vitest";
import {
  OTP_LENGTH,
  isCompleteOtp,
  isEmailish,
  loginErrorMessage,
  normalizeOtp,
  signInHref,
} from "./login-helpers";

describe("signInHref", () => {
  it("carries the current page back as next", () => {
    expect(signInHref("/agents/abc/settings")).toBe("/login?next=%2Fagents%2Fabc%2Fsettings");
  });

  it("encodes a path that carries its own query or hash", () => {
    expect(signInHref("/agents?tab=runs#risk")).toBe("/login?next=%2Fagents%3Ftab%3Druns%23risk");
  });

  it("never points back at itself", () => {
    expect(signInHref("/login")).toBe("/login");
    expect(signInHref("/login?next=%2Fhome")).toBe("/login");
  });

  it("falls back to a bare /login when there is no usable path", () => {
    expect(signInHref(null)).toBe("/login");
    expect(signInHref(undefined)).toBe("/login");
    expect(signInHref("")).toBe("/login");
    expect(signInHref("https://evil.com/")).toBe("/login");
  });

  it("leaves the landing page without a next, so sign-in lands in the app", () => {
    expect(signInHref("/")).toBe("/login");
  });
});

describe("isEmailish", () => {
  it("accepts the addresses people actually have", () => {
    for (const value of [
      "rami@tocker.xyz",
      "rami+agents@gmail.com",
      "r.a.m.i@sub.domain.co.uk",
      "o'brien@example.com",
      "rami_2@example-host.io",
      "ramí@exámple.com",
    ]) {
      expect(isEmailish(value), value).toBe(true);
    }
  });

  it("ignores whitespace around the address", () => {
    expect(isEmailish("  rami@tocker.xyz  ")).toBe(true);
    expect(isEmailish("rami@tocker.xyz\n")).toBe(true);
  });

  it("rejects the two typos people actually make", () => {
    expect(isEmailish("rami@tocker")).toBe(false); // no dot in the domain
    expect(isEmailish("rami.tocker.xyz")).toBe(false); // no @
  });

  it("rejects the rest of the obvious nonsense", () => {
    for (const value of [
      "",
      "   ",
      "@tocker.xyz",
      "rami@",
      "rami@.xyz",
      "rami@tocker.",
      "rami@tocker..xyz",
      "two words@tocker.xyz",
      "rami@tocker.xyz, evil@evil.com",
      "a@b",
    ]) {
      expect(isEmailish(value), value).toBe(false);
    }
  });

  it("rejects an address longer than the RFC allows", () => {
    expect(isEmailish(`${"a".repeat(400)}@tocker.xyz`)).toBe(false);
  });
});

describe("normalizeOtp", () => {
  it("keeps six digits", () => {
    expect(normalizeOtp("123456")).toBe("123456");
    expect(normalizeOtp("1234")).toBe("1234");
    expect(normalizeOtp("")).toBe("");
  });

  /** The reason this exists: every one of these is a real paste. */
  it.each([
    ["123 456", "spaced by the mail client"],
    ["123-456", "hyphenated"],
    [" 123456\n", "trailing newline"],
    ["Code: 123456", "pasted with its label"],
    ["1 2 3 4 5 6", "one space per digit"],
  ])("survives a paste of %s (%s)", (pasted) => {
    expect(normalizeOtp(pasted)).toBe("123456");
  });

  it("stops at six, so a long paste is not silently mangled from the front", () => {
    expect(normalizeOtp("12345678")).toBe("123456");
    expect(normalizeOtp("123 456 789")).toBe("123456");
  });

  it("drops anything that is not a digit", () => {
    expect(normalizeOtp("abc")).toBe("");
    expect(normalizeOtp("١٢٣٤٥٦")).toBe("");
  });

  it("knows when a code is complete", () => {
    expect(isCompleteOtp("123456")).toBe(true);
    expect(isCompleteOtp("123 456")).toBe(true);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(OTP_LENGTH).toBe(6);
  });
});

describe("loginErrorMessage", () => {
  it("turns an error code into a sentence", () => {
    expect(loginErrorMessage("invalid_credentials")).toBe("That code isn't right, or it has expired. Ask for a new one.");
    expect(loginErrorMessage("too_many_requests")).toBe("Too many attempts. Wait a minute, then try again.");
    expect(loginErrorMessage("passkey_not_allowed")).toBe("Passkeys aren't available here. Use your email instead.");
  });

  it("reads the code off an Error that carries one", () => {
    const err = Object.assign(new Error("Request failed with status 429"), {
      privyErrorCode: "too_many_requests",
    });
    expect(loginErrorMessage(err)).toBe("Too many attempts. Wait a minute, then try again.");
  });

  it("stays quiet when the person simply backed out", () => {
    expect(loginErrorMessage("exited_auth_flow")).toBeNull();
    expect(loginErrorMessage("oauth_user_denied")).toBeNull();
  });

  it("recognises the wrong-or-expired code by its message", () => {
    expect(loginErrorMessage(new Error("Invalid or expired verification code"))).toBe(
      "That code isn't right, or it has expired. Ask for a new one.",
    );
  });

  it("recognises a network failure in either browser's wording", () => {
    const offline = "Couldn't reach the network. Check your connection and try again.";
    expect(loginErrorMessage(new Error("Failed to fetch"))).toBe(offline);
    expect(loginErrorMessage(new Error("Load failed"))).toBe(offline);
    expect(loginErrorMessage(new TypeError("NetworkError when attempting to fetch resource."))).toBe(offline);
  });

  it("shows an unrecognised message as it came, punctuated", () => {
    expect(loginErrorMessage(new Error("This app is not accepting new users"))).toBe(
      "This app is not accepting new users.",
    );
    expect(loginErrorMessage(new Error("Already done."))).toBe("Already done.");
  });

  it("hides a message that is not a sentence", () => {
    const generic = "Something went wrong signing you in. Try again.";
    expect(loginErrorMessage(new Error('{"error":"bad_request","status":400}'))).toBe(generic);
    expect(loginErrorMessage(new Error("boom\n    at Object.<anonymous> (/src/x.ts:1:1)"))).toBe(generic);
    expect(loginErrorMessage(new Error("x".repeat(200)))).toBe(generic);
  });

  it("never returns an empty string for something it cannot read", () => {
    const generic = "Something went wrong signing you in. Try again.";
    expect(loginErrorMessage(null)).toBe(generic);
    expect(loginErrorMessage(undefined)).toBe(generic);
    expect(loginErrorMessage({})).toBe(generic);
    expect(loginErrorMessage(new Error(""))).toBe(generic);
  });
});
