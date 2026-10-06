/**
 * The repository is public. This reads every tracked file and fails if one of them
 * carries something shaped like a live credential, so a key pasted into a fixture, a
 * script or a doc is caught by `pnpm test` before it is pushed.
 *
 * It is a second net, not the first: GitHub's secret scanning and push protection stop a
 * known token at the push itself and cover far more vendors (see DEPLOY.md). A key that
 * has reached a public repository is burned whether or not it is later removed, so the
 * only real fix for a hit here is to revoke the key, then delete it.
 *
 * Fixtures stay possible. A stand-in is either short (every real key below is long) or
 * put together at run time, the way `redact.test.ts` does it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MAX_BYTES = 2_000_000;

function trackedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32_000_000 });
    return out.split("\0").filter(Boolean);
  } catch {
    // Not a git checkout (an exported tarball): nothing to list.
    return null;
  }
}

/** Shapes and lengths of real credentials. A short `sk-…` is a fixture; a long one is a key. */
const LIVE_SHAPES: ReadonlyArray<{ name: string; shape: RegExp }> = [
  { name: "an LLM provider key (sk-…)", shape: /\bsk-(?=[a-z_-]*[A-Z0-9])[A-Za-z0-9_-]{40,}/ },
  { name: "a Google API key", shape: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: "a Groq key", shape: /\bgsk_[A-Za-z0-9]{40,}/ },
  { name: "an xAI key", shape: /\bxai-[A-Za-z0-9]{40,}/ },
  { name: "a Hugging Face token", shape: /\bhf_[A-Za-z0-9]{30,}/ },
  { name: "a GitHub token", shape: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { name: "a Slack token", shape: /\bxox[abprs]-[A-Za-z0-9-]{24,}/ },
  { name: "an AWS access key id", shape: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a Stripe live key", shape: /\b[sr]k_live_[A-Za-z0-9]{20,}/ },
  { name: "a signed token (JWT)", shape: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: "a private key block", shape: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/ },
];

/** A variable whose value would be a secret, by its name. */
const SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|TOKEN|_KEY$|^ENCRYPTION_KEY$)/;
/** Names that end in KEY and are published on purpose. */
const PUBLIC_NAMES = new Set(["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY", "PRIVY_VERIFICATION_KEY"]);

const files = trackedFiles();

describe.skipIf(files === null)("no credential is tracked in this repository", () => {
  it("tracks no env file but the example", () => {
    const envFiles = (files ?? []).filter((file) => /(^|\/)\.env(\.|$)/.test(file));
    expect(envFiles).toEqual([".env.example"]);
  });

  it("tracks no key or certificate file", () => {
    const keyFiles = (files ?? []).filter((file) => /\.(pem|p12|pfx|key|keystore|jks)$/i.test(file) || /(^|\/)id_(rsa|ed25519)/.test(file));
    expect(keyFiles).toEqual([]);
  });

  it("leaves every secret in the example env file empty", () => {
    const filled: string[] = [];
    for (const line of readFileSync(path.join(ROOT, ".env.example"), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, name, value] = match;
      if (PUBLIC_NAMES.has(name) || name.startsWith("NEXT_PUBLIC_")) continue;
      if (SECRET_NAME.test(name) && value.trim() !== "") filled.push(name);
      // A connection string or an endpoint is fine; one with a password in it is not.
      if (/:\/\/[^\s/@:]+:[^\s/@]+@/.test(value)) filled.push(name);
    }
    expect(filled).toEqual([]);
  });

  it("has nothing shaped like a live credential in any tracked file", () => {
    const hits: string[] = [];
    for (const file of files ?? []) {
      const full = path.join(ROOT, file);
      let text: string;
      try {
        if (statSync(full).size > MAX_BYTES) continue;
        text = readFileSync(full, "utf8");
      } catch {
        // Deleted in the working tree, or a submodule entry: nothing to read.
        continue;
      }
      // Binary (an image, a font): not text to scan.
      if (text.includes("\u0000")) continue;
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        for (const { name, shape } of LIVE_SHAPES) {
          // The file and line only: a failing test must not print the key into a CI log.
          if (shape.test(lines[index])) hits.push(`${file}:${index + 1} looks like ${name}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
