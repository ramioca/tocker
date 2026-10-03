"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppPrivyProvider } from "./privy-provider";
import { RunStatusProvider } from "./run-status";

/**
 * The app's client providers: the CSP nonce for Base UI, the query cache, Privy, run
 * status and tooltips.
 *
 * Mounted once by `src/app/(client)/layout.tsx`, the layout the app and /login share, and
 * deliberately not by the root layout: Privy, its wallet connectors, viem and the query
 * client were a third of the landing page's script, for a page that uses none of them.
 * Sharing one layout keeps a single instance across sign-in and every navigation between
 * /login and the app. A new route that calls `useSession`, `useQuery`, `useRunStatus` or
 * renders a Base UI control belongs under `src/app/(client)/`; do not mount a second copy
 * in another layout. The toaster is not in here; the root layout mounts it (`./toaster`)
 * for every page.
 */
export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  // One client per mount of this tree, created lazily so it is never shared between
  // requests on the server. /login and the app share the mount, so they share the cache;
  // leaving for the landing page, which sits outside it, and coming back starts a new one.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    /*
      Base UI's slider, select and friends emit their own inline <script>/<style>
      during SSR. The app's CSP (src/proxy.ts) is nonce-based with no
      'unsafe-inline', so without this they are blocked outright — verified in a
      browser, not assumed. The nonce comes from the `x-nonce` request header the
      proxy sets, read by the layout that mounts this.
    */
    <CSPProvider nonce={nonce}>
    <QueryClientProvider client={queryClient}>
      <AppPrivyProvider>
        <RunStatusProvider>
          <TooltipProvider delay={350} closeDelay={100}>
            {children}
          </TooltipProvider>
        </RunStatusProvider>
      </AppPrivyProvider>
    </QueryClientProvider>
    </CSPProvider>
  );
}
