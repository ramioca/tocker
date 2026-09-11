/**
 * The Petri mark: a dish seen from above. Faint colonies are everything the
 * agent looked at; the violet ones are what it decided to back.
 *
 * Decorative and static — no motion, it renders on every screen.
 */
export function PetriMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <circle cx="16" cy="16" r="14.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="22" cy="17" r="1.15" fill="currentColor" opacity="0.3" />
      <circle cx="10.5" cy="19.5" r="1.35" fill="currentColor" opacity="0.26" />
      <circle cx="15" cy="16.2" r="0.9" fill="currentColor" opacity="0.22" />
      <circle cx="13.2" cy="22" r="0.8" fill="currentColor" opacity="0.18" />
      <circle cx="19.5" cy="14" r="0.7" fill="currentColor" opacity="0.24" />
      <circle cx="11.5" cy="12" r="2.8" fill="var(--primary)" />
      <circle cx="17.5" cy="20.5" r="2.1" fill="var(--primary)" />
      <circle cx="20" cy="10.5" r="1.5" fill="var(--primary)" />
    </svg>
  );
}

/** Mark plus wordmark, for headers and the sidebar. */
export function PetriLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <PetriMark size={size} />
      <span className="text-sm font-semibold tracking-tight">petri</span>
    </span>
  );
}
