"use client";

/**
 * The first-run card: a new account chooses its username and avatar, then is shown how
 * an agent goes from a strategy, to paper, to live. Once per account, decided by the
 * server (`users.onboarded_at`); the gate (`onboarding-gate.tsx`) mounts this and draws
 * the ground behind it.
 *
 * The card is the sign-in page's own (`auth-card`, in auth.css): width, padding, border,
 * radius, tint, blur, shadow and top edge all come from that class, which is unlayered
 * and beats any utility. So nothing here sets one of them, and the two cards cannot
 * drift apart. Its top edge is a pseudo-element on the border, so the popup must never
 * clip: a card too tall for the screen scrolls in the wrapper inside it.
 *
 * The shell is Base UI's Dialog: focus trap, scroll lock, focus return. There is no
 * backdrop, because the ground behind is opaque. The entrance is CSS transitions on the
 * dialog's starting and ending styles, on the popup itself (an ancestor below full
 * opacity would take its blur away), so a close mid-entrance reverses from where it is.
 *
 * Three shapes (`firstRunPlan`): a new account must finish screen 1 and then sees
 * screen 2; an account that already owns an agent sees screen 1 alone and may put it
 * off; a preview (`?onboarding=1`) is both screens with nothing saved.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { TYPE } from "@/components/agents/builder/look";
import { UserAvatar } from "@/components/common/user-avatar";
import type { AvatarChoice } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { completeOnboarding } from "@/server/actions/onboarding";
import {
  BUILDER_PATH,
  BuildGhost,
  BuildScreen,
  ChooseGhost,
  ChooseScreen,
  EASE_OUT,
  type Refusal,
  type Via,
} from "./first-run-screens";
import { firstRunPlan, type FirstRunMode, type FirstRunProfile } from "./gate-decision";
import {
  pageAfterRename,
  previewOutcome,
  saveOutcome,
  signInAgainHref,
  type Identity,
  type SaveOutcome,
} from "./save-outcome";

/**
 * Where the card sits: /login's own rule, so arriving from there only the card changes.
 * Top-anchored at every width: 72px down on a phone (the 64px bar and 8), and from 640px
 * where a card of its usual height would be centred, never closer than 24px to the bar
 * (which is 72px tall from 900px). A card that grows does so downward and nothing above
 * it moves. The length taken from 50dvh is half that usual height: 510px for the two
 * screens, 466px for the one an owner sees, as measured at 1440px in the app's own type.
 * If the copy or the type scale changes, measure again: a card that is off by a few
 * pixels sits that far from the middle, and nothing else changes. The wider breakpoint
 * is written in rem (900px) so that it sorts after `sm`, which is.
 */
const VIEWPORT = "fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[72px] pb-4 sm:px-6 sm:pb-6";
const TOP_TWO_SCREENS =
  "sm:pt-[max(88px,calc(50dvh_-_255px))] min-[56.25rem]:pt-[max(96px,calc(50dvh_-_255px))]";
const TOP_ONE_SCREEN =
  "sm:pt-[max(88px,calc(50dvh_-_233px))] min-[56.25rem]:pt-[max(96px,calc(50dvh_-_233px))]";

/** How long the card waits for a frame before it opens without one. */
const OPEN_WITHOUT_A_FRAME_MS = 250;

/** One screen gives way to the next: how far each travels and for how long. */
interface Swap {
  travel: number;
  seconds: number;
}

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
  onReady,
  onOpen,
  onClosing,
  onClosed,
}: {
  mode: FirstRunMode;
  /** The account as it was when the flow opened. The gate keeps it still. */
  profile: FirstRunProfile;
  ownsAgent: boolean;
  /** The card's code has arrived and it is about to open. */
  onReady: () => void;
  /** The card is opening: from here its dialog has the keyboard. */
  onOpen: () => void;
  /** The card has started to close: the ground behind it fades with it. */
  onClosing: () => void;
  /** The card's exit has finished. */
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
  const [screen, setScreen] = useState<1 | 2>(1);
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
  const gone = opened && !open;
  // Screen 1 has no way out for a new account, until a save has failed on it.
  const dismissible = screen === 2 || !plan.required || failed;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Whatever had focus when the app (not the person) opened this; usually nothing.
  const returnFocus = useRef<HTMLElement | null>(null);

  // Opened a frame after it mounts, not open from the first render: a dialog that
  // mounts open has no entrance to play, and one that is open while the page hydrates
  // has a portal the server never drew. A page that is given no frames (a tab in the
  // background, an embedded preview) is opened by the timer instead, so nobody comes
  // back to the ground with no card on it.
  const shown = useRef(false);
  useEffect(() => {
    onReady();
    const show = () => {
      // Once. Run again (a parent handing in a new `onReady`), it would take the card's
      // own field for what had focus before the card.
      if (shown.current) return;
      shown.current = true;
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpened(true);
      // In the same breath: the gate keeps every key from the page until it hears this,
      // and a card that opened without saying so could not be typed in.
      onOpen();
    };
    const frame = requestAnimationFrame(show);
    const timer = window.setTimeout(show, OPEN_WITHOUT_A_FRAME_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [onReady, onOpen]);

  useEffect(() => {
    if (gone) onClosing();
  }, [gone, onClosing]);

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
      setScreens(2);
      setVia(pressed);
      setScreen(2);
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

  return (
    <Dialog.Root
      open={open}
      modal
      disablePointerDismissal={!dismissible}
      onOpenChange={(next, details) => {
        if (next) return;
        // Escape, a press outside and focus leaving all ask to close. Screen 1 refuses
        // them for a new account, and every screen does while a save is on its way.
        if (!dismissible || saving) {
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
        <Dialog.Viewport className={cn(VIEWPORT, screens === 2 ? TOP_TWO_SCREENS : TOP_ONE_SCREEN)}>
          <Dialog.Popup
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              "auth-card flex max-h-full flex-col outline-none",
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
            <div className="-mx-5 -mt-5 -mb-6 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-5 pt-5 pb-6 sm:-m-8 sm:p-8">
              {screens === 2 ? <Header screen={screen} person={person} swap={swap} /> : null}

              <div className={cn("grid flex-1 grid-cols-[minmax(0,1fr)]", screens === 2 && "mt-5")}>
                {screens === 2 ? (
                  <>
                    <ChooseGhost />
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
                        shared={screens === 2}
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
                    ) : (
                      <BuildScreen
                        handle={person.handle}
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

/**
 * The row above the title, 24px tall: two pips and a count on the left and, once the
 * first screen is done, the person as they now appear, where the account menu will
 * show them. There is no close button: screen 1 has nothing to close to, and screen 2
 * says "Not now" in words.
 */
function Header({
  screen,
  person,
  swap,
}: {
  screen: 1 | 2;
  person: { handle: string; avatarSeed: string | null; avatarUrl: string | null };
  swap: Swap;
}) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3">
      {/* The silk, one half on each pip. Decorative: the count beside them is in words. */}
      <span aria-hidden className="flex shrink-0 gap-1">
        <span className="h-1 w-6 rounded-full bg-[linear-gradient(90deg,#3d6bff,#7a5cff)]" />
        <span className="h-1 w-6 overflow-hidden rounded-full bg-white/[0.12]">
          <span
            className={cn(
              "block h-full origin-left rounded-full bg-[linear-gradient(90deg,#7a5cff,#ff3dcb)]",
              "transition-[scale] duration-300 ease-[var(--ease-out-strong)] motion-reduce:transition-none",
              swap.seconds === 0 && "transition-none",
              screen === 2 ? "scale-x-100" : "scale-x-0",
            )}
          />
        </span>
      </span>
      <p className={cn(TYPE.kicker, "shrink-0")}>
        <span aria-hidden>{screen} of 2</span>
        <span className="sr-only">Step {screen} of 2</span>
      </p>
      {screen === 2 ? (
        <motion.div
          // Arrives with the second screen, once the first has gone.
          initial={swap.travel === 0 ? false : { opacity: 0, transform: "scale(0.9)" }}
          animate={{ opacity: 1, transform: "scale(1)" }}
          transition={{ duration: 0.2, delay: swap.seconds, ease: EASE_OUT }}
          className="ml-auto flex min-w-0 origin-right items-center gap-2"
        >
          <UserAvatar user={person} px={24} className="size-6" />
          <span className={cn(TYPE.heading, "truncate")}>@{person.handle}</span>
        </motion.div>
      ) : null}
    </div>
  );
}
