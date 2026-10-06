import { LOGIN_HREF } from "@/lib/contact";
import { CreateAgentLink } from "./create-agent-link";

/** The signed-in home. It does the real session check and sends a stale cookie to sign-in. */
export const APP_HREF = "/home";

/** Where "Create your agent" goes: the builder, through sign-in when there is no session. */
const NEW_AGENT_HREF = "/agents/new";

/**
 * The page's primary action (hero and close): "Create your agent", in the app's
 * liquid-metal "New agent" chrome. With a session cookie it opens the builder; without
 * one it goes to sign-in, where a new email address makes an account, and lands in
 * the builder after. A server component around one small client island.
 */
export function AppLink({ hasSession, className }: { hasSession: boolean; className?: string }) {
  const href = hasSession ? NEW_AGENT_HREF : `${LOGIN_HREF}?next=${encodeURIComponent(NEW_AGENT_HREF)}`;
  return <CreateAgentLink href={href} className={className} />;
}
