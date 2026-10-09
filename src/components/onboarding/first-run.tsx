"use client";

/**
 * The first-run card: a new account chooses its username and avatar, is told in three
 * lines how an agent works, and is shown how one goes from a strategy, to paper, to
 * live. Once per account, decided by the server (`users.onboarded_at`); the gate
 * (`onboarding-gate.tsx`) mounts this.
 *
 * It opens over the app, on whichever page the person is on. The shell is Base UI's
 * Dialog: focus trap, scroll lock, focus return, and everything outside it inert. Its
 * backdrop dims and softly blurs the page, so the app is still recognisably there
 * (`backdrop.ts`, which the key prompt shares). The entrance is CSS transitions on the
 * dialog's starting and ending styles, for the same time on the backdrop and on the
 * popup itself (an ancestor below full opacity would take the popup's blur away), so the
 * two arrive and leave as one, and a close mid-entrance reverses from where it is.
 *
 * The card is the sign-in page's own (`auth-card`, in auth.css): width, padding, border,
 * radius, blur, shadow and top edge all come from that class, which is unlayered and
 * beats any utility. So nothing here sets one of them, and the two cards cannot drift
 * apart. `auth-card-app` beside it is the one difference, a fuller tint: the page behind
 * this card can be anything, and the card's own fill is what keeps its words readable.
 * Its top edge is a pseudo-element on the border, so the popup must never clip: a card
 * too tall for the screen scrolls in the wrapper inside it. The stylesheet is imported
 * here, because nothing else in the app attaches it.
 *
 * Three shapes (`firstRunPlan`): a new account must finish screen 1 and then sees
 * screens 2 and 3, either of which it may close; an account that already owns an agent
 * sees screen 1 alone and may put it off; a preview (`?onboarding=1`) is all three
 * screens with nothing saved.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import "@/components/auth/auth.css";
import type { AvatarChoice } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { completeOnboarding } from "@/server/actions/onboarding";
import { APP_BACKDROP } from "./backdrop";
import {
  BUILDER_PATH,
  BuildGhost,
  BuildScreen,
  ChooseGhost,
  ChooseScreen,
  EASE_OUT,
  Header,
  TourGhost,
  TourScreen,
  type Refusal,
  type Swap,
  type Via,
} from "./first-run-screens";
import {
  canClose,
  firstRunPlan,
  progress,
  screenAfter,
  type FirstRunMode,
  type FirstRunProfile,
  type FirstRunScreen,
} from "./gate-decision";
import {
  pageAfterRename,
  previewOutcome,
  saveOutcome,
  signInAgainHref,
  type Identity,
  type SaveOutcome,
} from "./save-outcome";

/**
 * Where the card sits. On a phone it is top-anchored, 72px down: clear of the app's 56px
 * top bar, which stays in view above it, and a card taller than usual grows downward.
 * From 640px it is in the middle of the screen. The card is one height for as long as it
 * is open (the stand-ins in its grid see to that), so centring it by layout moves
 * nothing from one screen to the next, and there is no measured height to keep in step
 * with the copy.
 */
const VIEWPORT = "fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[72px] pb-4 sm:items-center sm:p-6";

/** How long the card waits for a frame before it opens without one. */
const OPEN_WITHOUT_A_FRAME_MS = 250;

const SWAP = {
  from: ({ travel }: Swap) => ({ opacity: 0, transform: `translateX(${travel}px)` }),
  shown: ({ seconds }: Swap) => ({
    opacity: 1,
    transform: "translateX(0px)",
    transition: { duration: seconds, ease: EASE_OUT },
  }),
  gone: ({ travel, seconds }: Swap) => ({
    opacity: 0,
    transform: `translateX(${-travel}px)`,
    transition: { duration: seconds, ease: EASE_OUT },
  }),
};

export function FirstRun({
  mode,
  profile,
  ownsAgent,
  onClosed,
}: {
  mode: FirstRunMode;
  /** The account as it was when the flow opened. The gate keeps it still. */
  profile: FirstRunProfile;
  ownsAgent: boolean;
  /** The card's exit has finished, and the gate can take it out of the tree. */
  onClosed: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const reduce = Boolean(useReducedMotion());

  // Read once. The refresh after a save re-renders the layout, and a card that is open
  // must not change shape because the count behind it did.
  const [plan] = useState(() => firstRunPlan(mode, ownsAgent));

  const [opened, setOpened] = useState(false);
  const [closed, setClosed] = useState(false);
  const [screen, setScreen] = useState<FirstRunScreen>(1);
  const [screens, setScreens] = useState(plan.screens);
  const [via, setVia] = useState<Via>("pointer");
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // A save failed outright at least once: from then on the card can be put off.
  const [failed, setFailed] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  // The page the card was over when "Create your first agent" was pressed.
  const [goingFrom, setGoingFrom] = useState<string | null>(null);
  const [leaving, startLeaving] = useTransition();

  // The card stays until the builder is the page under it, so a slow connection never
  // drops the person on the page they were leaving. If the navigation ends somewhere
  // else (the builder sent them on), that is arriving too. One that ends where it began
  // has failed: the button comes back, and can be pressed again.
  const arrived = goingFrom !== null && (pathname === BUILDER_PATH || (!leaving && pathname !== goingFrom));
  const open = opened && !closed && !arrived;
  const going = goingFrom !== null && (leaving || arrived);
  // Screen 1 has no way out for a new account, until a save has failed on it. The
  // screens after it can always be closed: the name is saved by then.
  const closable = canClose(plan, screen, failed);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whatever had focus when the app (not the person) opened this; usually nothing.
  const returnFocus = useRef<HTMLElement | null>(null);

  // Opened a frame after it mounts, not open from the first render: a dialog that
  // mounts open has no entrance to play, and one that is open while the page hydrates
  // has a portal the server never drew. A page that is given no frames (a tab in the
  // background, an embedded preview) is opened by the timer instead, so the card is
  // there when the person comes back to it.
  const shown = useRef(false);
  useEffect(() => {
    const show = () => {
      // Once. The frame and the timer both call this, and the second call would take the
      // card's own field for what had focus before the card.
      if (shown.current) return;
      shown.current = true;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpened(true);
    };
    const frame = requestAnimationFrame(show);
    const timer = window.setTimeout(show, OPEN_WITHOUT_A_FRAME_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  // With a mouse there is a keyboard beside it: start in the field, with the name
  // selected, so typing replaces it. On touch that would raise the keyboard over a card
  // nobody has read yet, so focus goes to the title instead.
  const initialFocus = useCallback((): HTMLElement | null => {
    const input = inputRef.current;
    if (input && window.matchMedia("(pointer: fine)").matches) {
      input.select();
      return input;
    }
    return titleRef.current;
  }, []);

  // There is no trigger to hand focus back to. Return it to what had it, and when that
  // was nothing, to the start of the page's content rather than dropping it on <body>.
  const finalFocus = useCallback((): HTMLElement | null => {
    const previous = returnFocus.current;
    if (previous && previous !== document.body && previous.isConnected) return previous;
    return document.getElementById("main");
  }, []);

  /**
   * The name and the avatar are public now, and the page behind still shows the old
   * ones. None of this is waited for. The session query and every cached feed and
   * comment list hold the old name, so the whole cache is marked stale, not one key.
   * The move comes before the refresh: Next lets a navigation discard a refresh that is
   * still on its way, but queues a refresh behind a navigation.
   */
  function showEverywhere(next: Identity) {
    const moved = pageAfterRename(pathname, profile.handle, next.handle);
    if (moved) router.replace(moved);
    router.refresh();
    void queryClient.invalidateQueries();
  }

  /** On to the screen after `from`, or out of the card when it was the last. */
  function goOn(from: FirstRunScreen, of: 1 | 3, pressed: Via) {
    const next = screenAfter(of, from);
    if (next === null) {
      setClosed(true);
      return;
    }
    setVia(pressed);
    setScreen(next);
  }

  async function save(handle: string, avatar: AvatarChoice, pressed: Via) {
    if (saving) return;
    setRefusal(null);
    let outcome: SaveOutcome;
    if (plan.saves) {
      setSaving(true);
      outcome = saveOutcome(await completeOnboarding({ handle, avatar }).catch(() => "threw" as const));
    } else {
      outcome = previewOutcome(handle, avatar);
    }

    if (outcome.kind === "sign-in") {
      // Still "Saving…" while the sign-in page loads: there is nothing to press here.
      router.replace(signInAgainHref(pathname, window.location.search));
      return;
    }
    setSaving(false);
    if (outcome.kind === "refused") {
      setRefusal({ under: outcome.under, sentence: outcome.sentence, focus: outcome.focus });
      if (outcome.wayOut) setFailed(true);
      return;
    }

    setIdentity(outcome.identity);
    if (plan.saves) showEverywhere(outcome.identity);
    if (outcome.then === "screen-2") {
      // The server's answer decides, not the count this card opened with.
      setScreens(3);
      goOn(1, 3, pressed);
    } else {
      setClosed(true);
    }
  }

  function build() {
    if (pathname === BUILDER_PATH) {
      setClosed(true);
      return;
    }
    setGoingFrom(pathname);
    startLeaving(() => router.push(BUILDER_PATH));
  }

  const fromKeys = via === "keyboard";
  const swap: Swap = { travel: reduce || fromKeys ? 0 : 12, seconds: fromKeys ? 0 : reduce ? 0.15 : 0.2 };
  const person = { handle: identity?.handle ?? profile.handle, avatarSeed: identity?.avatarSeed ?? null, avatarUrl: profile.avatarUrl };
  // Null for the one screen an owner sees: there is nothing to count.
  const steps = progress(screens, screen);

  return (
    <Dialog.Root
      open={open}
      modal
      disablePointerDismissal={!closable}
      onOpenChange={(next, details) => {
        if (next) return;
        // Escape, a press outside and focus leaving all ask to close. Screen 1 refuses
        // them for a new account, and every screen does while a save is on its way.
        if (!closable || saving) {
          details.cancel();
          return;
        }
        setClosed(true);
      }}
      onOpenChangeComplete={(next) => {
        if (!next && opened) onClosed();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(APP_BACKDROP, "duration-[240ms] data-ending-style:duration-[160ms]")} />
        <Dialog.Viewport className={VIEWPORT}>
          <Dialog.Popup
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              "auth-card auth-card-app flex max-h-full flex-col outline-none",
              "transition-[opacity,scale] duration-[240ms] ease-[var(--ease-out-strong)] data-ending-style:duration-[160ms]",
              "data-ending-style:opacity-0 data-starting-style:opacity-0",
              "motion-safe:data-ending-style:scale-[0.96] motion-safe:data-starting-style:scale-[0.96]",
            )}
          >
            {/* The scroller, for a screen shorter than the card. It covers the card's
                padding as well as its content, so the ring around a selected avatar or a
                focused field is never cut off short of the card's own edge, and the chrome
                button's glow, which reaches 45px past the button, has the padding to fall
                in: held to the content alone it overhung by a pixel, and the card could
                be scrolled by that pixel. Nothing scrolls sideways: a screen on its way
                in starts 12px to the right. */}
            <div
              className="-mx-5 -mt-5 -mb-6 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-5 pb-6 sm:-m-8 sm:p-8"
              onKeyDown={(event) => {
                // Enter held down presses once. From the keyboard a screen is simply
                // there, with its button focused, so a key held a moment too long on one
                // screen would press the next one's button as well.
                if (event.key === "Enter" && event.repeat) event.preventDefault();
              }}
            >
              {steps ? <Header steps={steps} person={screen > 1 ? person : null} swap={swap} /> : null}

              <div className={cn("grid flex-1 grid-cols-[minmax(0,1fr)]", steps && "mt-5")}>
                {screens === 3 ? (
                  <>
                    <ChooseGhost />
                    <TourGhost />
                    <BuildGhost />
                  </>
                ) : null}
                <AnimatePresence mode="wait" initial={false} custom={swap}>
                  <motion.div
                    key={screen}
                    custom={swap}
                    variants={SWAP}
                    initial="from"
                    animate="shown"
                    exit="gone"
                    className="col-start-1 row-start-1 flex min-w-0 flex-col"
                  >
                    {screen === 1 ? (
                      <ChooseScreen
                        profile={profile}
                        preview={mode === "preview"}
                        shared={screens === 3}
                        saving={saving}
                        refusal={refusal}
                        notNow={failed || (mode === "real" && !plan.required)}
                        titleRef={titleRef}
                        inputRef={inputRef}
                        onEdit={(what) =>
                          // A new avatar does not answer a refused name: that stays said.
                          setRefusal((now) => (what === "avatar" && now?.under === "field" ? now : null))
                        }
                        onSubmit={(handle, avatar, pressed) => void save(handle, avatar, pressed)}
                        onNotNow={() => setClosed(true)}
                      />
                    ) : screen === 2 ? (
                      <TourScreen
                        handle={person.handle}
                        animate={!reduce && !fromKeys}
                        onNext={(pressed) => goOn(2, 3, pressed)}
                        onSkip={() => setClosed(true)}
                      />
                    ) : (
                      <BuildScreen
                        // Read before the button is pressed: once the builder arrives the
                        // card is on its way out, and must not redraw itself as it goes.
                        onBuilder={goingFrom === null && pathname === BUILDER_PATH}
                        going={going}
                        animate={!reduce && !fromKeys}
                        onGo={build}
                        onNotNow={() => setClosed(true)}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
