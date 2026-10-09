import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * auth.css is a global stylesheet that Next keeps attached after the visitor leaves
 * /login, so it must not be able to style anything but the login page, and it must not
 * lean on anything only the landing defines. It cannot be rendered here; it is read as
 * text, the way privy-provider.test.ts reads its component.
 */
const CSS = readFileSync(new URL("./auth.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selector: string;
  body: string;
}

/** Every style rule, at any depth of @media / @supports. Keyframe steps are not rules. */
function styleRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === "{") depth += 1;
      else if (css[close] === "}") depth -= 1;
      close += 1;
    }
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) rules.push(...styleRules(body));
    else if (!prelude.startsWith("@")) rules.push({ selector: prelude, body });
    i = close;
  }
  return rules;
}

const RULES = styleRules(CSS);

describe("auth.css stays on the login page", () => {
  it("finds the rules it is about to check", () => {
    expect(RULES.length).toBeGreaterThan(20);
    expect(RULES.some((rule) => rule.selector === ".auth-card")).toBe(true);
  });

  it("starts every selector with an auth- class", () => {
    for (const { selector } of RULES) {
      for (const part of selector.split(",")) {
        expect(part.trim(), selector).toMatch(/^\.auth-/);
      }
    }
  });

  it("names no landing class and no document-level selector", () => {
    expect(CSS).not.toMatch(/\.lp-/);
    for (const { selector } of RULES) {
      expect(selector).not.toMatch(/(^|[\s,>+~])(html|body|main|:root)\b/);
    }
  });

  it("uses no token that only the landing defines", () => {
    // Outside `.lp`, `--ease-out` exists only as a Tailwind theme key.
    expect(CSS).not.toMatch(/var\(--ease-out\s*[,)]/);
    expect(CSS).not.toMatch(/var\(--(fg|line)\b/);
    expect(CSS).not.toMatch(/var\(--(brand|r|glow)-/);
  });

  it("declares one custom property of its own, the card's reference height", () => {
    const themed = ["background", "foreground", "card", "card-foreground", "muted-foreground", "primary", "primary-foreground", "border", "input", "ring"];
    const declared = [...CSS.matchAll(/(?:^|[;{\s])--([a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    expect(declared.filter((name) => !themed.includes(name))).toEqual(["auth-card-h"]);
  });
});

describe("auth.css material and motion", () => {
  it("has a block for each preference the card answers", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(CSS).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(CSS).toMatch(/@media \(prefers-contrast: more\)/);
    expect(CSS).toMatch(/@media \(forced-colors: active\)/);
  });

  it("keeps every backdrop blur at 20px or less", () => {
    const blurs = [...CSS.matchAll(/backdrop-filter:\s*blur\((\d+(?:\.\d+)?)px\)/g)].map((match) => Number(match[1]));
    expect(blurs.length).toBeGreaterThan(0);
    for (const blur of blurs) expect(blur).toBeLessThanOrEqual(20);
  });

  it("gives every backdrop-filter its -webkit- twin in the same rule", () => {
    for (const { selector, body } of RULES) {
      const plain = body.match(/(?<!-webkit-)backdrop-filter:/g)?.length ?? 0;
      const prefixed = body.match(/-webkit-backdrop-filter:/g)?.length ?? 0;
      expect(prefixed, selector).toBe(plain);
    }
  });

  it("needs no fallback for its colours or its viewport units", () => {
    expect(CSS).not.toContain("color-mix(");
    const withLvh = RULES.filter((rule) => rule.body.includes("100lvh"));
    expect(withLvh.length).toBeGreaterThan(0);
    for (const { selector, body } of withLvh) {
      const vh = body.indexOf("100vh");
      expect(vh, selector).toBeGreaterThan(-1);
      expect(vh, selector).toBeLessThan(body.indexOf("100lvh"));
    }
  });

  it("animates the card itself, and only while the intro flag is on", () => {
    const animated = RULES.filter((rule) => /\banimation:/.test(rule.body));
    expect(animated.length).toBeGreaterThan(0);
    for (const { selector } of animated) expect(selector).toBe(".auth-main[data-intro] .auth-card");
  });
});

describe("the first-run card's fuller tint", () => {
  const own = RULES.filter((rule) => rule.selector === ".auth-card-app");
  const at = CSS.indexOf(".auth-card-app {");

  /** WCAG contrast of two sRGB colours. */
  const contrast = (a: number[], b: number[]) => {
    const luminance = (rgb: number[]) => {
      const [r, g, bl] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };

  it("is one rule that sets the tint and nothing else", () => {
    expect(own).toHaveLength(1);
    expect(own[0].body.trim()).toMatch(/^background-color: rgba\(10, 10, 11, 0\.\d+\);$/);
  });

  it("comes after every tint the card sets for itself, and before every fallback that must still win", () => {
    // One class each, so the later rule is the one that applies.
    const tints = [...CSS.matchAll(/\.auth-card \{[^}]*background-color: rgba\(10, 10, 11, 0\.8\d?\)/g)].map(
      (match) => match.index,
    );
    expect(tints).toHaveLength(2);
    for (const tint of tints) expect(at).toBeGreaterThan(tint);
    for (const fallback of [
      "@media (prefers-reduced-transparency: reduce)",
      "@media (prefers-contrast: more)",
      "@supports not",
    ]) {
      expect(CSS.indexOf(fallback)).toBeGreaterThan(at);
    }
  });

  it("keeps the card's words readable with a white page directly behind it and nothing dimming it", () => {
    const alpha = Number(/0\.\d+/.exec(own[0].body)?.[0]);
    const fill = [10, 10, 11].map((channel) => channel * alpha + 255 * (1 - alpha));
    // The app's muted text and its error red in the dark theme, as sRGB:
    // oklch(0.7 0.008 285) and oklch(0.68 0.2 22).
    expect(contrast([158, 158, 163], fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast([251, 87, 93], fill)).toBeGreaterThanOrEqual(4.5);
    // The sign-in card's own tints would not: they have the silk's scrim behind them.
    const thin = [10, 10, 11].map((channel) => channel * 0.8 + 255 * 0.2);
    expect(contrast([158, 158, 163], thin)).toBeLessThan(4.5);
  });

  it("is worn by the first-run card and not by the sign-in card", () => {
    const firstRun = readFileSync(new URL("../onboarding/first-run.tsx", import.meta.url), "utf8");
    const signIn = readFileSync(new URL("./sign-in-card.tsx", import.meta.url), "utf8");
    expect(firstRun).toContain('"auth-card auth-card-app ');
    expect(signIn).not.toContain("auth-card-app");
  });
});
