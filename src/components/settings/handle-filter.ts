/**
 * The Handle field's input filter, outside the component so it can be tested. Handles
 * are letters, numbers and underscores, lowercased; anything else typed or pasted is
 * dropped — and named, so it doesn't just vanish without a word.
 */

// Said as words: a screen reader at its default punctuation level skips a lone "-" or ".".
const NAMED: Record<string, string> = { " ": "spaces", "-": "hyphens", ".": "dots" };

/** The handle as it will be kept, and each distinct character dropped from `raw`. A case change is not a drop. */
export function cleanHandle(raw: string): { value: string; removed: string[] } {
  const removed: string[] = [];
  for (const ch of raw) {
    if (!/[a-zA-Z0-9_]/.test(ch) && !removed.includes(ch)) removed.push(ch);
  }
  return { value: raw.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase(), removed };
}

/** "Hyphens and dots aren’t allowed in handles", or null when nothing was dropped. */
export function removedNote(removed: string[]): string | null {
  if (removed.length === 0) return null;
  const names = [...new Set(removed.map((ch) => NAMED[/\s/.test(ch) ? " " : ch] ?? `“${ch}”`))];
  const shown = names.length > 3 ? [...names.slice(0, 2), "other symbols"] : names;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  // Only a single quoted character is singular; the named ones are already plural.
  const singular = shown.length === 1 && !Object.values(NAMED).includes(shown[0]);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${singular ? "isn’t" : "aren’t"} allowed in handles`;
}
