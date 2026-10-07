/**
 * Which rows of the agent card to tint after one update.
 *
 * The tint points at what one choice rewrote: a strategy preset or a posture changes
 * several rows at once. One row changing is somebody typing or dragging, and there is
 * nothing to point at. Nor is there when the whole draft was swapped (`wholesale`: a
 * saved draft restored on arrival, Start over, its Undo): every row is new then, and
 * the user chose none of them just now.
 */
export function rowsToTint(
  ids: readonly string[],
  before: readonly string[],
  after: readonly string[],
  wholesale: boolean,
): string[] {
  if (wholesale) return [];
  const changed = ids.filter((_, index) => before[index] !== after[index]);
  return changed.length >= 2 ? changed : [];
}
