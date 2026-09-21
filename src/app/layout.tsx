import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

/**
 * The root layout is deliberately thin: fonts, global CSS, the dark class.
 * The app's provider tree (Privy, react-query, Base UI's CSP provider, the
 * toaster) is mounted by `(app)/layout.tsx` and `login/layout.tsx`, so the
 * logged-out landing page ships none of it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
