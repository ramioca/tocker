/**
 * What to tell an owner when "Run one tick" could not start or be followed. The route
 * answers with short codes ("unauthorized", "forbidden") meant for code, and a platform
 * 502 answers with an HTML page — shown verbatim, those read as the app breaking. Only a
 * 409 carries a sentence written for people, so only that one is passed through.
 */
export const RUN_UNREACHABLE = "Couldn't reach Tocker. Check your connection and try again.";

export function runErrorMessage(
  status: number,
  body: { error?: unknown } | null,
  fallback = "The run didn't start. Try again in a minute.",
): string {
  if (status === 401) return "Your session ended — sign in again.";
  if (status === 403 || status === 404) return "This agent isn't yours or no longer exists.";
  if (status === 409 && typeof body?.error === "string" && body.error.trim() !== "") return body.error;
  return fallback;
}
