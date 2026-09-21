import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Providers } from "@/components/providers";

/** The sign-in page needs Privy and the session query; the landing page does not. */
export default async function LoginLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <Providers nonce={nonce}>{children}</Providers>;
}
