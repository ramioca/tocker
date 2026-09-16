"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppPrivyProvider } from "./privy-provider";
import { RunStatusProvider } from "./run-status";

export function Providers({ children }: { children: ReactNode }) {
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
  );
}
