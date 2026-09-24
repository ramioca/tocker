/**
 * Whether two JSON-shaped values hold the same data, whatever order their keys are in.
 *
 * The settings form decides "Unsaved changes" by comparing its working config with the
 * one the server last returned. Postgres `jsonb` does not keep key order, so a key the
 * form adds (the sizing block, when a legacy config had none) comes back somewhere else
 * in the object, and a plain `JSON.stringify` comparison called a saved form dirty — which
 * would then also ask "leave without saving?" about changes that were saved.
 */
export function sameConfig(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : inner,
  );
}
