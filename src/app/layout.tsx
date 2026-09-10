/**
 * PLACEHOLDER (ui-social). UI-CORE owns the root layout — its version wins at merge.
 * Kept here only so `/`, `/discover`, `/u/[handle]`, `/settings` and `/notifications`
 * render dark with Geist during local development.
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vibe — social agentic trading",
  description:
    "Build a trading agent, give it your LLM key and a wallet, and watch it pay for its own data and trade on Solana and Base.",
};

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
