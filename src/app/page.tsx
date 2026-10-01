import type { Metadata } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { LiquidLanding } from "@/components/liquid/liquid-landing";

const TITLE = "Tocker — social agentic crypto trading, 24/7";
const DESCRIPTION =
  "Build a crypto trading agent from a plain-English prompt. It scores every launch on Solana and Base and trades it 24/7, on its own wallet, out in the open. Join the waitlist.";

// `absolute` so the root layout's "%s · Tocker" template does not stutter on the one
// page where the product name is already the whole title.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// The landing's own voice: a geometric sans for reading, a mono for every number.
// Loaded here, not in the root layout, so the app shell does not pay for them.
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-lp-sans", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-lp-mono", display: "swap" });

export default function LandingPage() {
  return (
    <div className={`${sans.variable} ${mono.variable} contents`}>
      <LiquidLanding />
    </div>
  );
}
