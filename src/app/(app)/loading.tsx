/**
 * Route-level loading. It mirrors the shape of a content page — a header block
 * and a column of rows — so the transition into real content is a swap rather
 * than a jump. Pulse only; nothing moves.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" role="status" aria-label="Loading">
      <div className="flex items-center gap-3">
        <span className="size-12 rounded-xl bg-muted/70 motion-safe:animate-pulse" aria-hidden />
        <div className="flex-1 space-y-2">
          <span className="block h-4 w-40 rounded bg-muted/70 motion-safe:animate-pulse" aria-hidden />
          <span className="block h-3 w-64 rounded bg-muted/60 motion-safe:animate-pulse" aria-hidden />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <span
            key={i}
            className="block h-20 rounded-xl bg-muted/60 motion-safe:animate-pulse"
            aria-hidden
          />
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className="block h-16 rounded-xl bg-muted/50 motion-safe:animate-pulse"
            aria-hidden
          />
        ))}
      </div>

      <span className="sr-only">Loading</span>
    </div>
  );
}
