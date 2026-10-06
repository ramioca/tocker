/**
 * Where a visitor signs in, and who to reach when something is in the way.
 *
 * One place, because the landing page and the sign-in card both use it. A leaf module
 * with no imports: the landing page stays outside the auth providers and must be able
 * to read this without pulling any of them in.
 */

/** The founder's X account: who to DM when sign-in does not let you through. */
export const FOUNDER_X = { handle: "ramioca", href: "https://x.com/ramioca" } as const;

/** Sign-in, which is also sign-up: a new address makes an account. No `?next=`: from the landing page it ends in the app. */
export const LOGIN_HREF = "/login";
