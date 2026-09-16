import type { Metadata } from "next";
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

export default function LandingPage() {
  return <LiquidLanding />;
}
