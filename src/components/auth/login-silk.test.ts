import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The login backdrop borrows one module from the landing and nothing else: no landing
 * class to style against, no second import that would pull landing CSS onto /login.
 * Read as text; none of these files can be rendered in this environment.
 */
const SILK = readFileSync(new URL("./login-silk.tsx", import.meta.url), "utf8");
const SHELL = readFileSync(new URL("./login-shell.tsx", import.meta.url), "utf8");
const BACKDROP = readFileSync(new URL("./login-backdrop.tsx", import.meta.url), "utf8");

const liquidImports = (source: string) =>
  [...source.matchAll(/["']@\/components\/liquid\/([^"']+)["']/g)].map((match) => match[1]);

describe("the login backdrop's use of the landing", () => {
  it("imports only the silk's canvas module from the landing", () => {
    expect(new Set(liquidImports(SILK))).toEqual(new Set(["hero-shader-canvas"]));
    expect(liquidImports(SHELL)).toEqual([]);
    expect(liquidImports(BACKDROP)).toEqual([]);
  });

  it("uses no landing class name", () => {
    expect(SILK).not.toContain("lp-");
    expect(SHELL).not.toContain("lp-");
    expect(BACKDROP).not.toContain("lp-");
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

describe("the backdrop, in a file of its own", () => {
  it("is one component in one file, drawn by the shell", () => {
    expect(SHELL).toContain('import { LoginBackdrop } from "./login-backdrop"');
    expect(SHELL).toContain("<LoginBackdrop />");
    expect(SHELL).not.toContain("function LoginBackdrop");
  });

  it("brings its own stylesheet, so it is styled wherever it is drawn", () => {
    expect(BACKDROP).toContain('import "./auth.css"');
  });

  it("has no hooks of its own, so the server can draw it on /login", () => {
    expect(BACKDROP).not.toMatch(/^\s*["']use client["']/);
    expect(BACKDROP).not.toMatch(/\buse[A-Z]\w*\(/);
  });

  it("keeps the layers back to front: poster, silk, scrim", () => {
    const order = ["auth-bg-poster", "<LoginSilk />", "auth-bg-scrim"].map((part) => BACKDROP.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
