"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
            {/*
              Bottom clearance is one variable so it can follow the app's chrome, and
              falls back to Sonner's own 24px / 16px where there is none (the landing
              page, sign-in). Below `md` it clears the phone tab bar — Sonner's mobile
              breakpoint is 600px, so both offsets read it — and at any width it clears
              a docked run/approvals island, which would otherwise sit on the same spot.
              The island rule chains both :has() so it outranks the tab-bar one.
            */}
            <Toaster
              theme="dark"
              position="bottom-right"
              closeButton
              richColors={false}
              offset={{ bottom: "var(--toast-bottom, 24px)" }}
              mobileOffset={{ bottom: "var(--toast-bottom, 16px)" }}
              className={cn(
                "max-md:[body:has([data-tab-bar])_&]:[--toast-bottom:calc(4.5rem+env(safe-area-inset-bottom))]",
                "max-md:[body:has([data-tab-bar]):has([data-run-island])_&]:[--toast-bottom:calc(8rem+env(safe-area-inset-bottom))]",
                "md:[body:has([data-run-island])_&]:[--toast-bottom:6rem]",
              )}
              toastOptions={{
                classNames: {
                  // Near-opaque: at 75% the tab labels and page text read through the message.
                  toast:
                    "!bg-popover/95 !backdrop-blur-xl !text-popover-foreground !border-border/60 !rounded-xl !shadow-lg",
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
