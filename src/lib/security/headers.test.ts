import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce, securityHeaders } from "./headers";

function directive(policy: string, name: string): string {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${policy}`);
  return found;
}

describe("contentSecurityPolicy", () => {
  const prod = contentSecurityPolicy({ nonce: "NONCE", isDev: false });

  it("carries the request nonce and strict-dynamic", () => {
    expect(directive(prod, "script-src")).toContain("'nonce-NONCE'");
    expect(directive(prod, "script-src")).toContain("'strict-dynamic'");
  });

  it("never allows unsafe-eval in production", () => {
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
  });

  /** React rebuilds server stacks with eval in dev; without this the app 500s on every error. */
  it("allows unsafe-eval in development only", () => {
    const dev = contentSecurityPolicy({ nonce: "NONCE", isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  /**
   * Privy renders login and wallet UIs in an iframe from auth.privy.io and its SDK
   * calls the same hosts. Drop these and login silently does nothing.
   */
  it("lets Privy's iframe load and its SDK connect", () => {
    expect(directive(prod, "frame-src")).toContain("https://auth.privy.io");
    expect(directive(prod, "frame-src")).toContain("https://*.privy.io");
    expect(directive(prod, "connect-src")).toContain("https://auth.privy.io");
  });

  /** The WebGPU shader compiles WGSL and spawns workers from blob URLs. */
  it("permits wasm compilation and blob workers for the shader", () => {
    expect(directive(prod, "script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive(prod, "worker-src")).toContain("blob:");
  });

  it("clamps the dangerous directives", () => {
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
  });

  /** Token logos and social avatars are arbitrary third-party URLs. */
  it("allows third-party images but not third-party script", () => {
    expect(directive(prod, "img-src")).toContain("https:");
    expect(directive(prod, "script-src")).not.toContain(" https:");
  });

  it("upgrades insecure requests in production only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ nonce: "N", isDev: true })).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  it("sends HSTS only from a production TLS origin", () => {
    const names = (opts: { isDev: boolean; isHttps: boolean }) =>
      securityHeaders({ nonce: "N", ...opts }).map(([k]) => k);

    expect(names({ isDev: false, isHttps: true })).toContain("strict-transport-security");
    // localhost: an HSTS entry for `localhost` would break every other http project
    expect(names({ isDev: true, isHttps: false })).not.toContain("strict-transport-security");
    expect(names({ isDev: false, isHttps: false })).not.toContain("strict-transport-security");
  });

  it("always sets the cheap, unconditional headers", () => {
    const headers = new Map(securityHeaders({ nonce: "N", isDev: true, isHttps: false }));
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("permissions-policy")).toContain("payment=()");
  });
});

describe("createNonce", () => {
  it("is unpredictable per call", () => {
    const seen = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(seen.size).toBe(50);
  });
});
