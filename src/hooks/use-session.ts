"use client";
import type { Session } from "@/server/types";

export interface UseSession {
  /** false until Privy has hydrated — render skeletons, not the logged-out state */
  ready: boolean;
  session: Session | null;
  login: () => void;
  logout: () => Promise<void>;
}

/** OWNER: foundation. Wraps Privy's usePrivy + our /api/me user row. */
export function useSession(): UseSession {
  return { ready: false, session: null, login: () => {}, logout: async () => {} };
}
