import { LOGIN_HREF } from "@/lib/contact";
import { CreateAgentLink } from "./create-agent-link";

/** Where "Create your agent" goes: the builder, through sign-in when there is no session. */
const NEW_AGENT_HREF = "/agents/new";

/** The builder with a session; sign-in first (then the builder) without one. */
export const createAgentHref = (hasSession: boolean) =>
  hasSession ? NEW_AGENT_HREF : `${LOGIN_HREF}?next=${encodeURIComponent(NEW_AGENT_HREF)}`;

/**
 * The page's primary action (hero and close): "Create your agent", in the app's
 * liquid-metal "New agent" chrome. With a session cookie it opens the builder; without
 * one it goes to sign-in, where a new email address makes an account, and lands in
 * the builder after. A server component around one small client island.
 */
export function AppLink({ hasSession, className }: { hasSession: boolean; className?: string }) {
  return <CreateAgentLink href={createAgentHref(hasSession)} className={className} />;
}
