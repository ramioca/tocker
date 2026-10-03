import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";

/**
 * The client providers (auth, the query cache, run status, tooltips) for every route
 * that uses them: the app (`(app)/`) and sign-in (`login/`). The route group adds nothing
 * to the URL; it exists so the two share this layout, and the landing page, which sits
 * outside it, ships none of their code.
 *
 * It has to be one shared layout, not one per tree. A layout persists across client
 * navigations between the routes under it, so sign-in's `router.replace(next)` keeps the
 * same Privy instance, with its modal and any post-login work it is still doing (creating
 * the embedded Solana wallet), and the same query cache. Separate copies would tear that
 * down mid-flight and boot Privy again on arrival.
 */
export default async function ClientLayout({ children }: { children: ReactNode }) {
  // The per-request CSP nonce, set on the request headers by `src/proxy.ts`. Base UI's
  // sliders, tabs and selects render their own inline <script>/<style> and need it;
  // `CSPProvider` inside `Providers` hands it to them.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <Providers nonce={nonce}>{children}</Providers>;
}
