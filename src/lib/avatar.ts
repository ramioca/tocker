/**
 * A person's avatar: the generated ones they can pick, and the one photo the app will show.
 *
 * A leaf module, with no React and nothing from the server: the picker, `UserAvatar` and
 * the actions that save a choice all read the same rules.
 */

/**
 * Only what `randomSeed` makes. A seed is in every feed payload that shows its owner, so
 * it must not be able to carry a message, and never the handle it replaced.
 */
export const AVATAR_SEED_RE = /^[a-z0-9]{10}$/;

/**
 * Which avatar to keep: the account's own photo, or one of the generated ones. What the
 * picker holds and what the first-run save is sent.
 */
export type AvatarChoice = { kind: "photo" } | { kind: "seed"; seed: string };

/** Said under the tiles when a save refuses the avatar it was sent. */
export const AVATAR_REFUSED = "That avatar is not available. Pick another.";

const SEED_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const SEED_LENGTH = 10;

/** A new seed. `rand` is injectable so a test can repeat it; it answers in [0, 1). */
export function randomSeed(rand: () => number = Math.random): string {
  let seed = "";
  for (let i = 0; i < SEED_LENGTH; i += 1) {
    seed += SEED_CHARS[Math.min(SEED_CHARS.length - 1, Math.floor(rand() * SEED_CHARS.length))];
  }
  return seed;
}

/**
 * `count` different seeds for the picker's tiles. `pinned` (the saved choice, or the
 * tile that is selected when the rest are re-rolled) comes first and is kept as it is.
 */
export function avatarTiles(pinned: string | null, count: number, rand: () => number = Math.random): string[] {
  const seeds: string[] = pinned !== null && count > 0 ? [pinned] : [];
  // A repeat is one chance in 36^10 per draw. The bound is for a `rand` that is stuck.
  for (let tries = 0; seeds.length < count && tries < count * 20; tries += 1) {
    const seed = randomSeed(rand);
    if (!seeds.includes(seed)) seeds.push(seed);
  }
  return seeds;
}

/** Where X serves profile photos. No other host's image is ever put on a page. */
const PHOTO_HOST = "pbs.twimg.com";
/** A path made of the characters X's own paths use, so the URL can sit inside `url("…")`. */
const PHOTO_PATH_RE = /^\/[A-Za-z0-9/_.~%-]+$/;
const SIZED_RE = /_normal(\.[A-Za-z0-9]+)$/;

/**
 * The address a person's photo is loaded from when it is drawn `px` CSS pixels wide, or
 * null when the stored link is not one the app will show.
 *
 * This is the only way a photo reaches a page. `users.avatar_url` came from the sign-in
 * provider, and every viewer's browser fetches whatever it says, so it is shown only
 * when it is https on X's image host; the query and fragment are dropped. X names its
 * sizes in the file name: `_normal` is 48px, `_bigger` 73px, `_200x200` what it says. A
 * small avatar keeps the small file. A link without the suffix is used as it is.
 */
export function photoAt(url: string | null | undefined, px: number): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.host !== PHOTO_HOST) return null;
  if (parsed.username || parsed.password) return null;
  if (!PHOTO_PATH_RE.test(parsed.pathname)) return null;
  const size = px > 36 ? "_200x200" : px > 24 ? "_bigger" : "_normal";
  return `https://${PHOTO_HOST}${parsed.pathname.replace(SIZED_RE, `${size}$1`)}`;
}

/**
 * What `UserAvatar` draws for a person at `px` CSS pixels: the seed of the generated
 * avatar, and the photo laid over it, if any.
 *
 * A picked avatar wins and no photo is loaded. Without one, the photo is shown when the
 * stored link is one the app will show (`photoAt`), over the avatar made from the
 * username, which is all that is drawn when there is no photo or its link is dead.
 */
export function avatarFor(
  user: { handle: string; avatarSeed?: string | null; avatarUrl?: string | null },
  px: number,
): { seed: string; photo: string | null } {
  if (user.avatarSeed) return { seed: user.avatarSeed, photo: null };
  return { seed: user.handle, photo: photoAt(user.avatarUrl, px) };
}
