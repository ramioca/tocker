"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppPrivyProvider } from "@/components/providers/privy-provider";

/**
 * NOTE: UI-CORE owns the final version of this file (it also mounts the toaster,
 * theme provider, etc). Foundation ships this minimal composition so auth works
 * standalone before the branches merge — keep UI-CORE's version at merge time,
 * but keep QueryClientProvider outside AppPrivyProvider: `useSession()` needs
 * react-query in both the Privy and the no-Privy path.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppPrivyProvider>{children}</AppPrivyProvider>
    </QueryClientProvider>
  );
}
