/**
 * Pages where the first-run key prompt stays closed. The builder asks for the key
 * itself, once, on its Brain step, after the visitor has seen what they are making; a
 * modal over it asked for a secret before anything else was on screen.
 *
 * Exact paths only: `/agents/new-thing` or an agent whose slug starts with "new" is a
 * different page.
 */
const SUPPRESSED_PATHS: readonly string[] = ["/agents/new"];

export function onboardingSuppressedOn(pathname: string): boolean {
  return SUPPRESSED_PATHS.includes(pathname);
}
