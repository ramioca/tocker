/**
 * Which ways of signing in this deploy offers.
 *
 * One list, read by the auth provider (what the vendor's own modal may show) and by the
 * sign-in card (which buttons exist at all). Each method is also a switch in the auth
 * vendor's dashboard, and a method that is off there fails the moment it is pressed, so
 * a method that is not in this list is not drawn: no button, no divider, no sentence
 * about it.
 *
 * Set it with `NEXT_PUBLIC_LOGIN_METHODS`, comma-separated, from `email`, `google`,
 * `twitter`, `passkey` and `wallet`. Unknown names are dropped; unset, empty or nothing
 * valid means the default. Keep it equal to what the dashboard has switched on.
 */

/** Every method the sign-in card knows how to draw, in the order it draws them. */
export const LOGIN_METHODS = ["email", "google", "twitter", "passkey", "wallet"] as const;

export type LoginMethod = (typeof LOGIN_METHODS)[number];

/** What the dashboard has switched on today: the emailed code and external wallets. */
export const DEFAULT_LOGIN_METHODS = "email,wallet";

function isLoginMethod(value: string): value is LoginMethod {
  return (LOGIN_METHODS as readonly string[]).includes(value);
}

function known(raw: string | null | undefined): LoginMethod[] {
  return (raw ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(isLoginMethod);
}

/**
 * The enabled methods, in the card's own order whatever order they were typed in.
 *
 * Email is always in the answer. Invitations are issued to an email address, so it is
 * the one method every invited person can use; a value that leaves it out would lock
 * out exactly the people the list exists for.
 */
export function parseLoginMethods(raw: string | null | undefined): LoginMethod[] {
  const asked = known(raw);
  const enabled = new Set<LoginMethod>(asked.length > 0 ? asked : known(DEFAULT_LOGIN_METHODS));
  enabled.add("email");
  return LOGIN_METHODS.filter((method) => enabled.has(method));
}

/**
 * Read as the literal `process.env.NEXT_PUBLIC_LOGIN_METHODS`: the bundler inlines
 * `NEXT_PUBLIC_` variables by that exact expression at build time, and a computed
 * lookup would be `undefined` in the browser. Changing it therefore needs a rebuild.
 */
export const ENABLED_LOGIN_METHODS: readonly LoginMethod[] = parseLoginMethods(
  process.env.NEXT_PUBLIC_LOGIN_METHODS,
);

export function loginMethodEnabled(method: LoginMethod): boolean {
  return ENABLED_LOGIN_METHODS.includes(method);
}
