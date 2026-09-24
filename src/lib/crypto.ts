/**
 * Symmetric encryption for secrets at rest (user LLM API keys).
 *
 * Format: base64( iv(12) | tag(16) | ciphertext ) with AES-256-GCM.
 * Key: `ENCRYPTION_KEY` — 32 raw bytes, base64 encoded (`openssl rand -base64 32`).
 */
// The encryption key and every plaintext LLM key pass through here: never in a client bundle.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY missing (32 bytes base64 — see .env.example)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

/** Encrypt a UTF-8 string. Returns base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) throw new Error("encryptSecret: empty value");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypt a blob produced by {@link encryptSecret}. Throws if tampered with. */
export function decryptSecret(blob: string): string {
  if (typeof blob !== "string" || blob.length === 0) throw new Error("decryptSecret: empty value");
  const buf = Buffer.from(blob, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error("decryptSecret: malformed blob");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last 4 characters of a secret, for display ("sk-…AbC9"). */
export function last4(secret: string): string {
  return secret.slice(-4);
}
