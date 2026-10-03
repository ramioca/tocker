/**
 * Where a visitor is sent after signing in.
 *
 * `?next=` is attacker-controlled: an owner-only page bounces here with its own path,
 * but so does any link somebody posts. The old check was "starts with `/` and not with
 * `//`", which `/\evil.com` walks straight through — the WHATWG URL parser treats a
 * backslash as a slash for http(s), so the browser reads `/\evil.com` as the authority
 * `evil.com` and Next's hard navigation lands on `https://evil.com/`. A phishing page on
 * the far side of a real sign-in is the whole prize.
 *
 * So don't pattern-match the string: resolve it the way the browser will, against this
 * page's own origin, and refuse anything whose origin is not ours. Whatever survives is
 * returned as a path, never as an absolute URL, so the value handed to `router.replace`
 * and to Privy's `redirectTo` cannot carry an origin at all.
 */
export function safeNext(value: string | null | undefined, origin: string | null, fallback: string): string {
  if (!value || !origin) return fallback;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  // Path-only. `next=/login` would also loop the visitor back here forever.
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || url.pathname === "/login") return fallback;
  return path;
}
