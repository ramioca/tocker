import Avatar from "boring-avatars";
import { agentPalette } from "@/components/common/agent-avatar";

/**
 * An agent's mark on the landing: the same marble avatar the app draws
 * (AgentAvatar's boring-avatars marble and palette), from one of the builder's
 * preset seeds (AVATAR_SEEDS in components/agents/builder/types.ts). Plain SVG,
 * so it renders on the server. Decorative: the agent's name is always written beside it.
 */
export function AgentMark({
  seed,
  size = "sm",
  className,
}: {
  seed: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span className={className ? `lp-agentmark ${className}` : "lp-agentmark"} data-size={size} aria-hidden>
      <Avatar variant="marble" name={seed} colors={agentPalette(seed)} square size="100%" />
    </span>
  );
}
