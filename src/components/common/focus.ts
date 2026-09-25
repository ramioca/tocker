/**
 * Focus ring for a Spectrum MorphButton, most of which are white pills on the dark theme.
 * The button's own is a 1px neutral-300 ring on a white 2px offset, which blends into the
 * pill's edge, so keyboard focus on Run now, Save or Approve could not be seen.
 *
 * The `dark:` half is spelled out because the button's `dark:focus-visible:ring-neutral-300`
 * is a separate utility: tailwind-merge only replaces it with another `dark:` ring colour.
 */
export const MORPH_FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
