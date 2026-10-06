import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AppToaster } from "@/components/providers/toaster";
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
  icons: { icon: "/icon.svg" },
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
  // Every page renders per request. The CSP (`src/proxy.ts`) is nonce-based, and Next
  // stamps its scripts with the nonce only while rendering a request: a page prerendered
  // at build time would ship scripts the browser refuses to run. Nothing else in this
  // layout reads the request, and a page is not required to (the landing page reads one
  // cookie, as a hint for its buttons, and could stop), so say it here.
  await connection();

  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* No client providers here: the landing page uses none of them, and they were a
            third of its script. The app and sign-in layouts mount them (see Providers). */}
        {children}
        <AppToaster />
        {/* Vercel Web Analytics: page views and visitors, first-party (/_vercel/insights),
            no cookies. The loader is a same-origin script, which the CSP already allows. */}
        <Analytics />
      </body>
    </html>
  );
}
