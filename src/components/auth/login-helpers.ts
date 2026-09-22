/**
 * The pure rules behind the sign-in card.
 *
 * They live outside the component because each of them is a small thing that is easy
 * to get subtly wrong and impossible to notice: an address rejected for a legal
 * character, a pasted code silently truncated, an auth failure shown to a person as
 * `invalid_credentials`. Tested in `login-helpers.test.ts`.
 */

/**
 * The link to sign-in, with the current page to come back to.
 *
 * Every signed-out call to action goes through here so the round trip is built the
 * same way everywhere. Three rules: the path is encoded, so a page whose own URL
 * carries a query survives being put inside one; `/login` itself is never the
 * destination (that is a loop, and `safeNext` refuses it on the far side anyway); and
 * neither is `/`, because the landing page has a destination of its own — signing in
 * from there is meant to land in the app, not back on the marketing page.
 */
export function signInHref(pathname: string | null | undefined): string {
  const path = pathname?.trim();
  if (!path || path === "/" || !path.startsWith("/")) return "/login";
  if (path === "/login" || path.startsWith("/login?")) return "/login";
  return `/login?next=${encodeURIComponent(path)}`;
}

/** Digits in a one-time code. */
export const OTP_LENGTH = 6;

/** How long before "Resend code" wakes up. Long enough that the first mail arrives. */
export const RESEND_DELAY_MS = 30_000;

/**
 * Permissive, RFC-ish: `local@label.tld`, at least one dot in the domain, no spaces
 * and none of the characters that only appear in a quoted local part.
 *
 * Deliberately not a "real" RFC 5322 regex. The only job here is to keep the Continue
 * button from firing a request that cannot succeed, and to catch the two typos people
 * actually make — a missing `@`, and a domain with no dot. Anything stricter starts
 * rejecting valid addresses (`+` tags, apostrophes, non-ASCII domains), and the
 * authoritative answer arrives a second later anyway: the code either lands in the
 * inbox or it does not.
 */
const EMAIL_SHAPE = /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(?:\.[^\s@.,;:<>()[\]\\"]+)+$/;

/** Is this plausibly an email address? Whitespace around it is ignored. */
export function isEmailish(value: string): boolean {
  const email = value.trim();
  // `a@b.c` is the shortest thing that can be true; 320 is the RFC's ceiling.
  if (email.length < 5 || email.length > 320) return false;
  return EMAIL_SHAPE.test(email);
}

/**
 * Keep the digits, drop everything else, stop at six.
 *
 * This is what makes the code field paste-friendly. Mail clients and password managers
 * hand over "123 456", "123-456" or a code with a trailing newline, and a `maxLength`
 * on the input would truncate the raw string *before* the separators come out — a
 * pasted "123 456" would land as "12345". Normalising instead of constraining means
 * every one of those forms arrives as `123456`.
 */
export function normalizeOtp(value: string): string {
  return value.replace(/[^0-9]+/g, "").slice(0, OTP_LENGTH);
}

/** A complete code, ready to submit. */
export function isCompleteOtp(value: string): boolean {
  return normalizeOtp(value).length === OTP_LENGTH;
}

/**
 * Authentication failures, in plain English.
 *
 * Two shapes arrive here. The `onError` callbacks are handed a bare error *code*
 * string (`"invalid_credentials"`, `"exited_auth_flow"`, …); the rejected promises and
 * the `state.error` fields carry an `Error` whose message is whatever the auth API
 * said, sometimes with the code hanging off a `privyErrorCode` property. Both are
 * matched, code first, then a few message shapes that have no distinct code of their
 * own — a wrong OTP and an expired one come back as the same sentence.
 *
 * Returns `null` when the person simply backed out (closed the provider tab, dismissed
 * the passkey sheet). That is not a failure and an error line under the form saying so
 * is noise — the form is right there, unchanged, ready for another go.
 */
export function loginErrorMessage(err: unknown): string | null {
  const code = errorCode(err);
  if (code && code in BY_CODE) return BY_CODE[code];
  if (code && SILENT_CODES.has(code)) return null;

  const message = errorMessage(err);
  if (!message) return GENERIC;

  const lower = message.toLowerCase();
  for (const [needle, plain] of BY_MESSAGE) {
    if (lower.includes(needle)) return plain;
  }

  // Nothing recognised. Show what it actually said rather than inventing a reason —
  // but only if it reads like a sentence and not like a stack trace or a blob of JSON,
  // which tells the person nothing and makes the card look broken.
  if (message.length <= 160 && !message.includes("\n") && !message.trimStart().startsWith("{")) {
    return message.endsWith(".") || message.endsWith("!") || message.endsWith("?") ? message : `${message}.`;
  }
  return GENERIC;
}

const GENERIC = "Something went wrong signing you in. Try again.";

/** Codes that mean "the person changed their mind", which is not an error. */
const SILENT_CODES = new Set([
  "exited_auth_flow",
  "exited_link_flow",
  "exited_update_flow",
  "user_exited_set_password_flow",
  "oauth_user_denied",
]);

const BY_CODE: Record<string, string> = {
  invalid_credentials: "That code isn't right, or it has expired. Ask for a new one.",
  invalid_data: "That didn't look right. Check the address and try again.",
  too_many_requests: "Too many attempts. Wait a minute, then try again.",
  client_request_timeout: "That took too long. Check your connection and try again.",
  allowlist_rejected: "This address isn't on the list for Tocker yet.",
  disallowed_login_method: "That way of signing in isn't available here.",
  disallowed_plus_email: "Addresses with a + tag aren't accepted. Use your plain address.",
  user_does_not_exist: "No account for that yet.",
  passkey_not_allowed: "Passkeys aren't available here. Use your email instead.",
  linked_to_another_user: "That's already linked to another account.",
  max_accounts_reached: "You've reached the limit on linked accounts.",
  invalid_captcha: "The bot check didn't pass. Try again.",
  captcha_timeout: "The bot check timed out. Try again.",
  session_storage_unavailable: "Your browser is blocking storage for this site, so sign-in can't finish.",
  oauth_account_suspended: "That account is suspended with its provider.",
  oauth_unexpected: "That provider didn't complete the sign-in. Try again.",
  unknown_auth_error: GENERIC,
};

/** Message shapes with no code of their own, longest/most specific first. */
const BY_MESSAGE: Array<[string, string]> = [
  ["invalid or expired verification code", "That code isn't right, or it has expired. Ask for a new one."],
  ["verification code", "That code isn't right, or it has expired. Ask for a new one."],
  ["expired", "That code has expired. Ask for a new one."],
  ["failed to fetch", "Couldn't reach the network. Check your connection and try again."],
  ["network", "Couldn't reach the network. Check your connection and try again."],
  ["load failed", "Couldn't reach the network. Check your connection and try again."],
  ["timed out", "That took too long. Check your connection and try again."],
  ["not allowed", "Your browser blocked that. Try your email instead."],
  ["notallowederror", "Your browser blocked that. Try your email instead."],
  ["no credentials", "No passkey found for this device. Use your email instead."],
  ["aborted", "That was cancelled."],
];

/** The error code, whether it arrived on its own or riding on an Error. */
function errorCode(err: unknown): string | null {
  if (typeof err === "string") {
    const value = err.trim();
    // A code is a bare snake_case token; anything with a space is a message.
    return value && !value.includes(" ") ? value.toLowerCase() : null;
  }
  if (err && typeof err === "object") {
    const carried = (err as { privyErrorCode?: unknown }).privyErrorCode;
    if (typeof carried === "string" && carried) return carried.toLowerCase();
  }
  return null;
}

function errorMessage(err: unknown): string | null {
  if (typeof err === "string") return err.trim() || null;
  if (err instanceof Error) return err.message.trim() || null;
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message.trim() || null;
  }
  return null;
}
