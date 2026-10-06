/**
 * The last resort after sign-in, and the reason it cannot loop.
 *
 * `LoginFlow` forwards a signed-in visitor with a client navigation. If that navigation
 * never lands (the router is wedged, the page data never arrives) the visitor is left
 * looking at "Taking you back…" for good. So after a few seconds it falls back to a
 * full page load of the same path.
 *
 * A full load is also the one thing here that could repeat on its own: if the
 * destination ever sent the browser straight back to /login, each arrival would fire it
 * again. So every run is written down first, in `sessionStorage` (this tab only, and it
 * survives the reload it is about to cause), and a second run inside a minute is
 * refused. When the record cannot be read or written, the answer is no: a status line
 * that stays put is a nuisance, a reload loop is an outage.
 */

/** How long the client navigation gets before the full page load takes over. */
export const HARD_REDIRECT_AFTER_MS = 5_000;

const HARD_REDIRECT_KEY = "tocker:login-hard-redirect";
const HARD_REDIRECT_COOLDOWN_MS = 60_000;

/** May the fallback run at `now`, given what the last run stored? */
export function mayHardRedirect(lastRun: string | null, now: number): boolean {
  if (lastRun === null) return true;
  const at = Number(lastRun);
  // Something else wrote here, or the value is damaged. Unknown counts as "just ran".
  if (lastRun.trim() === "" || !Number.isFinite(at)) return false;
  // `abs`, so a clock that was set back does not hold the fallback off for hours.
  return Math.abs(now - at) >= HARD_REDIRECT_COOLDOWN_MS;
}

/**
 * Record a run and say whether it may go ahead. Call it immediately before the full
 * page load, and only load when it returns true.
 */
export function claimHardRedirect(storage: Pick<Storage, "getItem" | "setItem"> | null, now: number): boolean {
  if (!storage) return false;
  try {
    if (!mayHardRedirect(storage.getItem(HARD_REDIRECT_KEY), now)) return false;
    storage.setItem(HARD_REDIRECT_KEY, String(now));
    return true;
  } catch {
    // Storage blocked or full: the run could not be recorded, so it does not happen.
    return false;
  }
}
