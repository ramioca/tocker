/**
 * Secrets do not belong in text people read.
 *
 * A saved LLM key is encrypted and never selected into a payload, so it cannot leak from
 * where it is stored. What can carry a credential is text that somebody else wrote and
 * the app keeps or shows as it stands:
 *
 *  - a provider's error (`Incorrect API key provided: sk-proj-…`, an RPC client that
 *    prints the node URL with the operator's key in it, a database driver that prints
 *    its connection string);
 *  - what a model writes in public (a rationale, a note, a run summary), which can quote
 *    whatever its owner pasted into the strategy;
 *  - a public field somebody pasted a key into by mistake.
 *
 * Two things are removed: the values of this deployment's own secrets, wherever they
 * appear, and anything shaped like a credential. This module is pure and reads no secret
 * it is not handed, so it is safe to import anywhere (in a browser bundle the server's
 * variables are simply absent).
 *
 * Not covered, on purpose: a bare wallet private key. In base58 or hex it is the same
 * shape as a transaction signature, and those are printed on every receipt.
 */

export const REDACTED = "[redacted]";

/** Said when public text is refused because a credential is in it. */
export const SECRET_IN_PUBLIC_TEXT =
  "That looks like an API key or token. This text is public, so it was not saved. Remove it and try again.";

/**
 * Credentials recognisable by their own shape. The `sk-` rule takes asterisks because a
 * provider's refusal echoes the key half masked, first and last characters intact.
 */
const KEY_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  // Anthropic, OpenAI, OpenRouter, and the vendors that copied the prefix. A key has a
  // digit or a capital in it (or the mask's asterisks); a hyphenated name does not.
  /\bsk-(?=[a-z_-]*[A-Z0-9*])[A-Za-z0-9_*-]{12,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // A signed token: three base64url parts, the first of which is a JSON header.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/**
 * Credentials recognisable by where they sit; the first group is kept. The first two ask
 * for a digit in the value, which a token has and a word in a sentence ("Bearer
 * authentication is required") does not.
 */
const KEYED_VALUES: readonly RegExp[] = [
  /(\b(?:Bearer|Basic)\s+)(?=[A-Za-z._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(\b(?:x-api-key|api[-_]?key|apikey|authorization)["']?\s*[:=]\s*["']?)(?!(?:Bearer|Basic)\b)(?=[A-Za-z._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi,
  /([?&](?:api[-_]?key|apikey|key|token|access[-_]?token|secret|auth)=)[^&\s"'<>)\\]+/gi,
  // user:password@host in any URL.
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:"']*:)[^\s/@"']+(?=@)/gi,
];

/**
 * The variables whose values must never be printed. A URL is listed when a provider puts
 * its key in the address (an RPC endpoint) or the password is part of it (the database).
 */
const SECRET_ENV = [
  "ENCRYPTION_KEY",
  "PRIVY_APP_SECRET",
  "PRIVY_AUTHORIZATION_PRIVATE_KEY",
  "CRON_SECRET",
  "JUPITER_API_KEY",
  "VAPID_PRIVATE_KEY",
  "DATABASE_URL",
  "SOLANA_RPC_URL",
  "BASE_RPC_URL",
] as const;

/** Shorter than this and a value is a word ("postgres", "dev"), not something to hunt for. */
const MIN_SECRET_CHARS = 12;

/**
 * Pure: the parts of one variable's value that are the secret. For a plain value that is
 * all of it. For a URL it is the password, the query values and any long opaque path
 * segment, so the host stays readable in an error ("could not reach mainnet.helius…").
 */
export function secretParts(value: string | undefined): string[] {
  const raw = value?.trim() ?? "";
  if (raw.length < MIN_SECRET_CHARS) return [];
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return [raw];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [raw];
  }
  const parts = new Set<string>();
  // As written and decoded: an error may print either.
  for (const candidate of [url.password, safeDecode(url.password)]) parts.add(candidate);
  for (const candidate of url.searchParams.values()) parts.add(candidate);
  for (const segment of url.pathname.split("/")) if (/^[A-Za-z0-9_-]{16,}$/.test(segment)) parts.add(segment);
  return [...parts].filter((part) => part.length >= MIN_SECRET_CHARS);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

let ownSecrets: string[] | null = null;

function secretsOf(env: Record<string, string | undefined>): string[] {
  if (env === process.env && ownSecrets) return ownSecrets;
  // Longest first, so a secret that contains another is removed whole.
  const parts = [...new Set(SECRET_ENV.flatMap((name) => secretParts(env[name])))].sort((a, b) => b.length - a.length);
  if (env === process.env) ownSecrets = parts;
  return parts;
}

/** Text with this deployment's secrets and anything shaped like a credential removed. */
export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const secret of secretsOf(env)) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const shape of KEY_SHAPES) out = out.replace(shape, REDACTED);
  for (const keyed of KEYED_VALUES) out = out.replace(keyed, `$1${REDACTED}`);
  return out;
}

const MAX_DEPTH = 12;

/**
 * {@link redactSecrets} over every string inside a JSON-shaped value. Keys are left as
 * they are, and anything that is not a string, an array or a plain object is returned
 * untouched.
 */
export function redactDeep<T>(value: T, env: Record<string, string | undefined> = process.env, depth = 0): T {
  if (typeof value === "string") return redactSecrets(value, env) as T;
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, env, depth + 1)) as T;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, env, depth + 1);
  return out as T;
}

/**
 * Whether text carries something shaped like a credential. For refusing it at the door
 * of a field that is public, or stored unencrypted, before it is saved.
 */
export function looksLikeSecret(text: string | null | undefined): boolean {
  if (!text) return false;
  return [...KEY_SHAPES, KEYED_VALUES[0]].some((shape) => {
    shape.lastIndex = 0;
    const found = shape.test(text);
    shape.lastIndex = 0;
    return found;
  });
}

/**
 * A database error, for a log. Drizzle's own message is the whole statement followed by
 * every bound parameter, which for a key table means the encrypted key and for others
 * means whatever the user typed. This keeps what explains the failure (the driver's
 * code and sentence) and drops the parameters.
 */
export function dbErrorForLog(err: unknown): string {
  if (!(err instanceof Error)) return redactSecrets(String(err)).slice(0, 300);
  const cause = (err as { cause?: unknown }).cause;
  const source = cause instanceof Error ? cause : err;
  const code = (source as { code?: unknown }).code;
  const sentence = /^Failed query:/i.test(source.message) ? "query failed" : source.message;
  return redactSecrets(`${source.name}${typeof code === "string" ? ` ${code}` : ""}: ${sentence}`).slice(0, 300);
}
