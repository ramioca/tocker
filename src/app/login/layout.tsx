import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";

/**
 * Sign-in runs Privy's headless hooks and the session query, so it needs the same client
 * providers as the app. They start here and in `(app)/layout.tsx` rather than in the root
 * layout, so the landing page ships none of their code. Leaving this page for the app
 * mounts the app's own copy; Privy restores the session from its storage, exactly as on
 * a fresh load of any app page.
 */
export default async function LoginLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce from `src/proxy.ts`, for Base UI's inline <script>/<style>.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <Providers nonce={nonce}>{children}</Providers>;
}
