"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppPrivyProvider } from "./privy-provider";
import { RunStatusProvider } from "./run-status";

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  // One client per browser session, created lazily so it is never shared
  // between requests on the server.
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
      proxy sets, read in the root layout.
    */
    <CSPProvider nonce={nonce}>
    <QueryClientProvider client={queryClient}>
      <AppPrivyProvider>
        <RunStatusProvider>
          <TooltipProvider delay={350} closeDelay={100}>
            {children}
            <Toaster
              theme="dark"
              position="bottom-right"
              closeButton
              richColors={false}
              toastOptions={{
                classNames: {
                  toast:
                    "!bg-popover/75 !backdrop-blur-xl !text-popover-foreground !border-border/60 !rounded-xl !shadow-lg",
                  description: "!text-muted-foreground",
                  actionButton: "!bg-primary !text-primary-foreground",
                },
              }}
            />
          </TooltipProvider>
        </RunStatusProvider>
      </AppPrivyProvider>
    </QueryClientProvider>
    </CSPProvider>
  );
}
