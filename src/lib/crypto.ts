/**
 * Symmetric encryption for user-supplied secrets (LLM API keys).
 *
 * OWNER: foundation. This is a placeholder implementation written by the runtime
 * workstream so the agent run loop can decrypt LLM keys before the branches are
 * merged. The wire format is the one documented in `src/db/schema.ts`:
 *
 *   base64( iv(12 bytes) | authTag(16 bytes) | ciphertext )
 *
 * `ENCRYPTION_KEY` is a base64-encoded 32-byte key (`openssl rand -base64 32`).
 * If foundation ships its own `src/lib/crypto.ts`, keep this format.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("ENCRYPTION_KEY missing (32 bytes, base64 — see .env.example)");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
  return buf;
}

/** Encrypts a UTF-8 string to `base64(iv|tag|ciphertext)`. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/** Decrypts a `base64(iv|tag|ciphertext)` blob produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) throw new Error("Malformed encrypted payload");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last 4 characters of a secret, for display. Never logs the secret itself. */
export function last4(secret: string): string {
  return secret.slice(-4);
}
