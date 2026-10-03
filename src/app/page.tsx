import type { Metadata } from "next";
import { LiquidLanding } from "@/components/liquid/liquid-landing";

const TITLE = "Tocker — AI trading agents for Solana and Base";
const DESCRIPTION =
  "Describe a strategy in plain English. Your agent screens new tokens on Solana and Base, trades the few that clear your bar, and asks before it buys. Private beta.";

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
