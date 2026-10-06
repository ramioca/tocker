/**
 * Names nobody can take as a handle, and words a display name cannot carry.
 *
 * A handle is the name on every post, comment and notification ("@support commented on
 * your post" lands in a stranger's inbox with the first line of the comment under it).
 * On a product that holds money, an account must not be able to present itself as the
 * product, as its staff, or as the founder the sign-in card tells people to message.
 *
 * A leaf module: its one import is `contact`, which imports nothing. That is what lets
 * the profile form say the same sentence before the round trip that `updateProfile`
 * says after it, and lets sign-up (`src/lib/auth.ts`, server-only) use the same list.
 *
 * Refusal only. Nothing here renames an account that already holds one of these names;
 * `updateProfile` lets such an account keep saving its profile under the handle it has.
 */
import { FOUNDER_X } from "@/lib/contact";

const RESERVED: ReadonlySet<string> = new Set([
  // The product, and the provider whose name is on the sign-in window.
  "tocker",
  "tockerxyz",
  "privy",
  // Words that read as staff.
  "support",
  "help",
  "admin",
  "administrator",
  "team",
  "staff",
  "official",
  "security",
  "mod",
  "moderator",
  "system",
  "root",
  // The founder's handle has one source, so a change there is a change here.
  FOUNDER_X.handle.toLowerCase(),
]);

/** Said under the handle field, by the form and by the action alike. */
export const HANDLE_RESERVED = "That handle is reserved";

/**
 * Is this handle one nobody may take?
 *
 * Case does not matter, and neither do the two cheapest disguises: underscores anywhere
 * and digits at either end, so `Support`, `_support`, `sup_port` and `support1` are all
 * `support`. Anything that starts with the product's name is reserved outright
 * (`tocker_team`, `tockersupport`).
 */
export function isReservedHandle(handle: string): boolean {
  const bare = handle
    .trim()
    .toLowerCase()
    .replace(/_/g, "")
    .replace(/^\d+|\d+$/g, "");
  return RESERVED.has(bare) || bare.startsWith("tocker");
}

const STAFF_WORDS = /tocker|official|support|admin/i;

/** Said under the display-name field. Names the four words, so nobody has to guess. */
export const DISPLAY_NAME_RESERVED = "Display names can't include Tocker, official, support or admin";

/**
 * Does this display name read as the product or its staff?
 *
 * A display name is free text shown beside the handle, so "Tocker Support" does the
 * same job as the handle `support`. NFKC folds full-width and other compatibility
 * letters to plain ones and the invisible joiners are dropped first, so neither hides a
 * word. A look-alike from another alphabet still passes: this is a tripwire for the
 * obvious case, not a confusables table.
 */
export function isStaffLikeName(name: string): boolean {
  const plain = name.normalize("NFKC").replace(/[​-‍⁠﻿]/g, "");
  return STAFF_WORDS.test(plain);
}
