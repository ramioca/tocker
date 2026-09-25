/**
 * Apple keyboards: the palette is ⌘K there, and only ⌘K. On a Mac, Ctrl+K is the
 * system's "delete to end of line" in every text field, so it is not ours to take.
 * Answers false during a server render, where there is no keyboard to ask about.
 */
export const isApplePlatform = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
