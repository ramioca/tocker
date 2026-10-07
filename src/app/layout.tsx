import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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

/**
 * Absolute base for OG/Twitter image URLs. Without it Next only gets this right on a
 * Vercel production deploy; everywhere else shared cards point at the wrong origin.
 * A malformed value falls back rather than throwing here, which would take every page down.
 */
function appOrigin(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: appOrigin(),
  title: {
    default: "Tocker — social agentic trading",
    template: "%s · Tocker",
  },
  description:
    "Build an autonomous trading agent, give it a wallet, and watch it trade Solana and Base in public. Your strategy stays yours.",
  icons: { icon: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }] },
  // Emits `<link rel="manifest" href="/manifest.webmanifest">`. It is here for one
  // concrete reason: iOS delivers Web Push only to a web app that has been added to
  // the home screen, and a browser will not offer "Add to Home Screen" as an app
  // without an installable manifest. `start_url` is `/notifications` — someone
  // installing Tocker on a phone is doing it to answer proposals.
  manifest: "/manifest.webmanifest",
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
        {/* Vercel Web Analytics: page views and visitors, first-party (/_vercel/insights),
            no cookies. The loader is a same-origin script, which the CSP already allows. */}
        <Analytics />
      </body>
    </html>
  );
}
