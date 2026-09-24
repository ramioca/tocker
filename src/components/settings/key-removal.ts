/**
 * The pure half of the Account tab's remove-with-undo flow, outside the component so it
 * can be tested without React or the server action behind it.
 */

/** Puts `item` back at `index` (clamped to the list), unless it is already there. */
export function reinsert<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((entry) => entry.id === item.id)) return list;
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/** At most `max` characters, ending in an ellipsis when it had to cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
