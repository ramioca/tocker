import type { ActionResult } from "@/server/types";

/** What a caller shows when the action never answered: the network or the server threw. */
export const UNREACHABLE = "Could not reach Tocker. Nothing changed.";

/**
 * Call a server action from the client without letting a throw escape.
 *
 * A server action rejects, rather than resolving `{ ok: false }`, when the request never
 * lands (offline, a deploy mid-flight, a 500 from the framework). Unguarded, that
 * rejection skips the caller's rollback and surfaces as an unhandled error. Folding it
 * into the same failure shape means every call site has one path to handle.
 */
export async function safeAction<T>(
  call: () => Promise<ActionResult<T>>,
  error: string = UNREACHABLE,
): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error };
  }
}
