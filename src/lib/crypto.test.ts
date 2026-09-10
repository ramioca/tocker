import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

let encryptSecret: typeof import("./crypto").encryptSecret;
let decryptSecret: typeof import("./crypto").decryptSecret;
let last4: typeof import("./crypto").last4;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const mod = await import("./crypto");
  encryptSecret = mod.encryptSecret;
  decryptSecret = mod.decryptSecret;
  last4 = mod.last4;
});

describe("crypto", () => {
  it("round-trips a secret", () => {
    const plain = "sk-ant-api03-abcdefghijklmnop";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("round-trips unicode", () => {
    const plain = "clé-🔐-秘密";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("produces a different blob each time (random iv)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("uses the iv|tag|ciphertext layout", () => {
    const blob = encryptSecret("hello");
    const buf = Buffer.from(blob, "base64");
    // 12 iv + 16 tag + 5 ciphertext
    expect(buf.length).toBe(12 + 16 + 5);
  });

  it("rejects tampered ciphertext", () => {
    const blob = encryptSecret("hello world");
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const blob = encryptSecret("hello world");
    const buf = Buffer.from(blob, "base64");
    buf[13] ^= 0xff;
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  it("rejects short blobs and empty input", () => {
    expect(() => decryptSecret("")).toThrow();
    expect(() => decryptSecret(Buffer.alloc(10).toString("base64"))).toThrow();
    expect(() => encryptSecret("")).toThrow();
  });

  it("rejects a wrong-length key", async () => {
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.ENCRYPTION_KEY = prev;
  });

  it("exposes last4", () => {
    expect(last4("sk-ant-1234")).toBe("1234");
  });
});
