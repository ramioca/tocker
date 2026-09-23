import { Check } from "lucide-react";
import { FEES_COVERED_SENTENCE } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";

/**
 * "Network fees are covered by Tocker." — one quiet line under anything that moves money.
 *
 * It answers the question a new user has without asking it ("do I need SOL too?") and
 * then gets out of the way: small, muted, a tiny check rather than an info icon, because
 * it is reassurance, not a notice. No hooks and no motion, so it renders on the server
 * and inside client components alike.
 */
export function FeesCovered({
  className,
  children = FEES_COVERED_SENTENCE,
}: {
  className?: string;
  /** Override the sentence where the context needs it said differently. */
  children?: React.ReactNode;
}) {
  return (
    <p className={cn("flex items-center gap-1.5 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <Check aria-hidden strokeWidth={2.5} className="size-3 shrink-0 text-positive/80" />
      <span>{children}</span>
    </p>
  );
}
