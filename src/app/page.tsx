import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { META } from "@/components/landing/content";

// `absolute` so the root layout's "%s · Tocker" template does not stutter on the one
// page where the product name is already the whole title.
export const metadata: Metadata = {
  title: { absolute: META.title },
  description: META.description,
  openGraph: { title: META.ogTitle, description: META.ogDescription, type: "website" },
  twitter: { card: "summary_large_image", title: META.ogTitle, description: META.ogDescription },
};

export default function Landing() {
  return <LandingPage />;
}
