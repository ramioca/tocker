import Avatar from "boring-avatars";
import { avatarFor } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { agentPalette } from "./agent-avatar";

/**
 * The drawing a person gets. The agents' own family (`AgentAvatar`), so a feed of both
 * reads as one product, and the shape tells them apart: round is a person, the rounded
 * square an agent. One constant, so trying another variant is a one-line change.
 */
export const USER_AVATAR_VARIANT = "marble";

/**
 * A person, everywhere a person is drawn: the avatar they picked, else their photo, else
 * the one made from their username (`avatarFor` decides which).
 *
 * The photo is a background layer over the generated avatar, not an `<img>`. A
 * background that fails to load paints nothing, so a dead link (an X photo since
 * replaced) leaves the generated one showing: no broken image and no client code, which
 * keeps this usable from a server component.
 *
 * Always decorative: the name beside it says who it is.
 */
export function UserAvatar({
  user,
  px,
  className,
}: {
  user: { handle: string; avatarSeed?: string | null; avatarUrl?: string | null };
  /** The largest CSS size it is drawn at. It only picks the photo's resolution. */
  px: number;
  /** The box, as a literal size class: "size-9", or "size-16 sm:size-24". */
  className: string;
}) {
  const { seed, photo } = avatarFor(user, px);

  return (
    <span
      aria-hidden
      className={cn(
        // `align-top`: inside a plain button or a line of text, an inline box on the
        // baseline leaves room under it for descenders, and the row grows by that much.
        "relative inline-grid shrink-0 overflow-hidden rounded-full align-top",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-white/10",
        className,
      )}
    >
      {/* Square, and cut round by the box: the photo over it is cut by the same edge. */}
      <Avatar
        variant={USER_AVATAR_VARIANT}
        name={seed}
        colors={agentPalette(seed)}
        square
        size="100%"
        className="block size-full"
      />
      {photo ? (
        // `photoAt` only answers an https address on X's image host, made of characters
        // that cannot close the quotes it is written into.
        <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${photo}")` }} />
      ) : null}
    </span>
  );
}
