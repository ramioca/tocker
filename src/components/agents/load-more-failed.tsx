/**
 * Where "Load more" was, when the next page failed. The rows above it stay: they
 * loaded fine, and a failed cursor is no reason to take them away. Same shape as the
 * feed's older-posts row.
 */
export function LoadMoreFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-center gap-3 py-1">
      <p className="text-xs text-muted-foreground">Couldn&rsquo;t load older {what}.</p>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
      >
        Retry
      </button>
    </div>
  );
}
