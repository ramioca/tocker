/**
 * An agent's mark on the landing: its initials on a quiet square, the same for
 * every agent on the page (the hero's, the console's, the feed's), so colour
 * stays with P&L. Decorative: the agent's name is always written beside it.
 */
export function AgentMark({ name, size = "sm", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
  return (
    <span className={className ? `lp-agentmark ${className}` : "lp-agentmark"} data-size={size} aria-hidden>
      {initials}
    </span>
  );
}
