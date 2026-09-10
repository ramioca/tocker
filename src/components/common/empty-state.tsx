import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Empty is a state, not an accident. Every list gets a title that says what is
 * missing and, where there is one, the single action that fills it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="grid size-10 place-items-center rounded-lg bg-muted/60 text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something broke on the way here",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm font-mono text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
