import { cn } from "@/lib/utils";

export function SettingsSection({
  title,
  description,
  children,
  className,
  id,
  tone = "default",
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "default" | "danger";
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={cn(
        "rounded-2xl border bg-card p-5 sm:p-6",
        tone === "danger" ? "border-destructive/30" : "border-border/80",
        className,
      )}
    >
      {/* Focusable from script only: where focus lands when the last item in a section
          is removed, so it does not fall to <body>. */}
      <h2
        id={id ? `${id}-heading` : undefined}
        tabIndex={-1}
        className={cn("text-base font-medium tracking-tight outline-none", tone === "danger" && "text-destructive")}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
