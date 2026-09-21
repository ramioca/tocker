import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Tocker — social agentic trading",
    template: "%s · Tocker",
  },
  description:
    "Build an autonomous trading agent, give it a wallet, and watch it trade Solana and Base in public. Your strategy stays yours.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request CSP nonce, set on the request headers by `src/proxy.ts`. Next
  // stamps its own scripts with it automatically; Base UI's components (the sliders,
  // among others) render their own inline `<script>` and `<style>` tags and need to
  // be told, which is what `CSPProvider` inside `Providers` does with this.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
