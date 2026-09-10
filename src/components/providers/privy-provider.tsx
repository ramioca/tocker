"use client";
import type { ReactNode } from "react";

/** OWNER: foundation. Wraps PrivyProvider with embedded-wallet config (see SPEC.md → Auth flow). */
export function AppPrivyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
