import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The login backdrop borrows one module from the landing and nothing else: no landing
 * class to style against, no second import that would pull landing CSS onto /login.
 * Read as text; neither file can be rendered in this environment.
 */
const SILK = readFileSync(new URL("./login-silk.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./login-shell.tsx", import.meta.url), "utf8");

const liquidImports = (source: string) =>
  [...source.matchAll(/["']@\/components\/liquid\/([^"']+)["']/g)].map((match) => match[1]);

describe("the login backdrop's use of the landing", () => {
  it("imports only the silk's canvas module from the landing", () => {
    expect(new Set(liquidImports(SILK))).toEqual(new Set(["hero-shader-canvas"]));
    expect(liquidImports(SHELL)).toEqual([]);
  });

  it("uses no landing class name", () => {
    expect(SILK).not.toContain("lp-");
    expect(SHELL).not.toContain("lp-");
  });

  it("loads the canvas with a plain import, behind the gate", () => {
    // next/dynamic would fetch the chunk at hydration whatever the gate says.
    expect(SILK).not.toContain("next/dynamic");
    expect(SILK).toMatch(/import\("@\/components\/liquid\/hero-shader-canvas"\)/);
    expect(SILK).toMatch(/if \(!shouldLoadSilk\(readSilkEnv\(reduced\)\)\) return;/);
  });

  it("keeps the shell a server component that owns the stylesheet", () => {
    expect(SHELL).not.toMatch(/^\s*["']use client["']/);
    expect(SHELL).toContain('import "./auth.css"');
    expect(SHELL).toContain('aria-label="Tocker home"');
  });
});
