import { LoginBackdrop } from "@/components/auth/login-backdrop";
import { TockerMark } from "@/components/brand/tocker-mark";
import { cn } from "@/lib/utils";

/**
 * What a new account sees behind the first-run card: the sign-in page's own backdrop and
 * lockup, drawn over the whole app.
 *
 * It is opaque, so the app is not seen behind the card, and it is the gate that draws it
 * (`onboarding-gate.tsx`), not the card: the card's code arrives later, and this is a
 * few lines that are already on every page. So on a full load it is in the server's HTML,
 * and arriving from /login it is in the first commit, with the poster and lockup the
 * person was just looking at. The silk is not carried over: this is a new mount, so it
 * starts again and fades back in over the poster.
 *
 * Decorative throughout. The lockup is not a link here: the way on is the card.
 *
 * `fixed` means the viewport as long as no ancestor has a transform; the app shell gives
 * `<main>` none. `leaving` fades it out with the card, and the gate takes it away when
 * the fade ends, which also stops the silk.
 */
export function FirstRunGround({
  leaving,
  onGone,
}: {
  leaving: boolean;
  /** The fade has ended. */
  onGone: () => void;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-[99] isolate bg-black",
        "transition-opacity duration-[160ms] ease-[var(--ease-out-strong)]",
        // Gone to the pointer the moment it starts to leave: the page under it is live again.
        leaving && "pointer-events-none opacity-0",
      )}
      onTransitionEnd={(event) => {
        // The silk and the poster inside run transitions of their own, and those bubble.
        if (leaving && event.target === event.currentTarget) onGone();
      }}
    >
      <LoginBackdrop />
      <div className="auth-top">
        <span className="auth-brand">
          <TockerMark height={24} className="auth-brand-mark" />
          <span className="auth-brand-word">tocker</span>
        </span>
      </div>
    </div>
  );
}
