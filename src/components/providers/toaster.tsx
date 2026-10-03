"use client";

import { Toaster } from "sonner";
import { cn } from "@/lib/utils";

/**
 * The one toaster, mounted by the root layout outside the other providers: toasts are
 * plain data (a title, a description, an action's label and callback), so it needs no
 * context, and the landing page's "Copy link" confirms through it too. Sonner is a few
 * kilobytes; the auth and query providers it used to sit inside are not, and they now
 * start in the layouts that need them.
 *
 * Bottom clearance is one variable so it can follow the app's chrome, and falls back to
 * Sonner's own 24px / 16px where there is none (the landing page, sign-in). Below `md`
 * it clears the phone tab bar — Sonner's mobile breakpoint is 600px, so both offsets
 * read it — and at any width it clears a docked run/approvals island, which would
 * otherwise sit on the same spot. The island rule chains both :has() so it outranks the
 * tab-bar one. A page with a sticky action bar on a phone (the builder's Create, an
 * agent's Save) lifts it past that bar and whatever is under it — otherwise the toast
 * explaining a failed save covers the button that retries it. That one reads the flag
 * the bar holds on <html> (src/hooks/root-flag.ts), and is important because it has to
 * win over the rules above.
 */
export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      closeButton
      richColors={false}
      offset={{ bottom: "var(--toast-bottom, 24px)" }}
      mobileOffset={{ bottom: "var(--toast-bottom, 16px)" }}
      className={cn(
        "max-md:[body:has([data-tab-bar])_&]:[--toast-bottom:calc(4.5rem+env(safe-area-inset-bottom))]",
        "max-md:[body:has([data-tab-bar]):has([data-run-island])_&]:[--toast-bottom:calc(8rem+env(safe-area-inset-bottom))]",
        "md:[body:has([data-run-island])_&]:[--toast-bottom:6rem]",
        "max-md:[html[data-sticky-actionbar]_&]:[--toast-bottom:calc(9rem+env(safe-area-inset-bottom))]!",
      )}
      toastOptions={{
        classNames: {
          // Near-opaque: at 75% the tab labels and page text read through the message.
          toast:
            "!bg-popover/95 !backdrop-blur-xl !text-popover-foreground !border-border/60 !rounded-xl !shadow-lg",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
    />
  );
}
