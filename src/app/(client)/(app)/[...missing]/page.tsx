import { notFound } from "next/navigation";

/**
 * A mistyped URL under the app keeps the shell: this catch-all sends every unmatched
 * path to `(app)/not-found.tsx`. Specific routes, /login, /api and public files still
 * win, because a catch-all only matches what nothing else does.
 */
export default function Missing() {
  notFound();
}
