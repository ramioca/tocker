import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The sign-in card runs the auth hooks and cannot be rendered here, so it is read as
 * text. What is guarded is the part of its contract a restyle can lose without anyone
 * noticing: the ids and attributes the browser, a password manager and a screen reader
 * rely on, and the keys that make each step mount fresh.
 */
const SOURCE = readFileSync(new URL("./sign-in-card.tsx", import.meta.url), "utf8");
const PROVIDER = readFileSync(new URL("../providers/privy-provider.tsx", import.meta.url), "utf8");

const count = (needle: string) => SOURCE.split(needle).length - 1;

describe("the sign-in card's fields", () => {
  it("keeps the email and code inputs addressable", () => {
    expect(SOURCE).toContain('id="signin-email"');
    expect(SOURCE).toContain('htmlFor="signin-email"');
    expect(SOURCE).toContain('id="signin-code"');
    expect(SOURCE).toContain('htmlFor="signin-code"');
  });

  it("keeps the code a single field the phone can fill from a text message", () => {
    expect(SOURCE).toContain('autoComplete="one-time-code"');
    expect(SOURCE).toContain('inputMode="numeric"');
    // A pasted code can carry spaces; a length cap would cut it before it is cleaned.
    expect(SOURCE).not.toContain("maxLength");
  });

  it("keeps each submit button disabled on the form's own condition", () => {
    expect(SOURCE).toContain("<MetalSubmit disabled={!isEmailish(email) || busy}>");
    expect(SOURCE).toContain("<MetalSubmit disabled={!isCompleteOtp(code) || submittingCode}>");
  });
});

describe("the sign-in card's announcements", () => {
  it("keeps one error line, always mounted, tied to the fields", () => {
    expect(count('id="signin-error"')).toBe(1);
    expect(SOURCE).toMatch(/role="alert"\s+className=/);
    expect(count('aria-describedby={error ? "signin-error" : undefined}')).toBe(2);
    expect(SOURCE).toContain("<ErrorLine message={error} />");
  });

  it("keeps both status lines", () => {
    expect(count('role="status"')).toBe(2);
  });
});

describe("the sign-in card's structure", () => {
  it("keys each step, so it mounts fresh and takes focus", () => {
    expect(SOURCE).toContain("key={stage}");
    expect(SOURCE).toContain('key="not-invited"');
  });

  it("picks its implementation once, at module load", () => {
    expect(SOURCE).toContain("const Impl = PRIVY_APP_ID ? PrivySignInCard : UnavailableSignInCard");
  });

  it("takes nothing from the landing and listens for no animation event", () => {
    expect(SOURCE).not.toContain("@/components/liquid/");
    // The card's entrance usually ends before hydration; see login-flow.tsx.
    expect(SOURCE).not.toContain("onAnimationEnd");
  });

  it("has the same title as the vendor's modal", () => {
    expect(SOURCE).toContain('title="Sign in to Tocker"');
    expect(PROVIDER).toContain('landingHeader: "Sign in to Tocker"');
  });
});
