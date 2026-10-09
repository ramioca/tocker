"use client";

/**
 * The two screens of the first-run card: choose a username and avatar, then build a
 * first agent. `first-run.tsx` owns the dialog, the save and what follows it; these draw
 * what is inside the card and hold only what the person is typing.
 *
 * Each screen is a `<form>` whose submit is the chrome button, so Enter in the field
 * does what the button does. Both end in the same footer (the button, then a 44px quiet
 * row), pinned to the bottom of a card that is the same height on both, so the two
 * buttons sit on the same pixels and nothing moves when one screen replaces the other.
 */
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { motion } from "motion/react";
import { ArrowRight, Check, CircleAlert, FlaskConical, Loader2, Zap } from "lucide-react";
import { IconTile, PartIcon, TYPE } from "@/components/agents/builder/look";
import { MetalSubmit } from "@/components/auth/metal-submit";
import { ModeBadge } from "@/components/common/mode-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { AvatarPicker } from "@/components/profile/avatar-picker";
import { previewUser, savedAvatar } from "@/components/settings/profile-model";
import { Input } from "@/components/ui/input";
import { randomSeed, type AvatarChoice } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { FirstRunProfile } from "./gate-decision";
import { useHandleCheck } from "./use-handle-check";
import {
  ADDRESS_PREFIX,
  USERNAME_MAX,
  addressName,
  answered,
  continueLabel,
  fieldView,
  refusedSave,
  startField,
  typed,
  wantsCheck,
  type CheckAnswer,
  type FieldView,
  type UsernameField,
} from "./username-field";

/** The builder, where the second screen's button goes. */
export const BUILDER_PATH = "/agents/new";

/**
 * How a screen was left. From the keyboard the next one is simply there, the builder's
 * own rule: an animation after a key press reads as lag.
 */
export type Via = "pointer" | "keyboard";

/** A save that did not go through: where its sentence belongs, and where the keyboard goes back to. */
export interface Refusal {
  under: "field" | "tiles";
  sentence: string;
  focus: "field" | "button";
}

export const CHOOSE = {
  title: "Choose your name and avatar",
  helper: "This is how people see you on Tocker.",
  label: "Username",
  quiet: "You can change both later in Settings.",
} as const;

export const BUILD = {
  title: "Build your first agent",
  helper: "It trades for you, by rules you set.",
  primary: "Create your first agent",
} as const;

export const NOT_NOW = "Not now";

/** One line each: where an agent starts, and where it can go. */
export const BUILD_STEPS = [
  { title: "Give it a strategy", body: "Pick a preset or write your own." },
  { title: "Start on paper", body: "It trades by itself with fake money at real prices." },
  {
    title: "Go live when you are ready",
    body: "Fund it and it does the same with real money, inside limits you set.",
  },
] as const;

/** `--ease-out-strong`, for the motion library, which takes numbers. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/**
 * Everything on the first screen between its two lines of text and its footer, at the
 * height it adds up to: the field block (20px above it on a phone, 24 from 640px; a row
 * of 68, then 72; 8; the address and the status at 18 each), then 20px and the 44px
 * avatars, then 6px and an 18px line that is empty until a save has something to say.
 * The screen holds its content in a box of exactly this height when it shares the card
 * with the second screen, and its stand-in below is the same box, empty, so the two
 * cannot disagree about how tall the first screen is.
 */
const CHOOSE_BLOCK = "h-[220px] sm:h-[228px]";
/**
 * The footer both screens end in, as a box of one height: 16px, the button under its own
 * 12px, the 44px quiet row. `mt-auto` is what pins it to the bottom of the card. The
 * height is written out, and the stand-ins below are given the same box, so what the
 * card measures and what it shows cannot differ by a pixel of button.
 */
const FOOTER = "mt-auto h-[116px] shrink-0 pt-4";

/* --- the footer ---------------------------------------------------------------- */

/**
 * The quiet action under the button. The sign-in card's own (its `QuietButton`, which
 * it does not export): 12px muted text whose pseudo-element makes the target 44px tall,
 * the height of the row it sits in, without moving anything.
 */
function QuietButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring relative rounded-sm text-xs text-muted-foreground transition-colors duration-150 after:absolute after:-inset-x-3 after:-inset-y-3.5 after:content-[''] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** The button, then the quiet row. */
function Footer({ button, quiet }: { button: ReactNode; quiet: ReactNode }) {
  return (
    <div className={FOOTER}>
      {button}
      <div className="flex h-11 items-center justify-center text-center text-xs leading-4 text-muted-foreground">
        {quiet}
      </div>
    </div>
  );
}

/** The submit a form's own button is, read off the click that pressed it. */
function viaOfSubmit(event: MouseEvent<HTMLFormElement>): Via | null {
  const target = event.target instanceof Element ? event.target.closest('button[type="submit"]') : null;
  if (!target) return null;
  // Enter in a field reaches the form as a click on its submit button with no detail,
  // exactly as a key press on the button itself does.
  return event.detail === 0 ? "keyboard" : "pointer";
}

/* --- screen 1 ------------------------------------------------------------------ */

type FieldAction =
  // `refused` is the sentence showing under the field as the key is pressed, if a save
  // put one there: the card holds it, not this reducer, so the keystroke brings it along.
  | { type: "typed"; raw: string; refused: string | null }
  | { type: "answered"; answer: CheckAnswer };

function fieldReducer(field: UsernameField, action: FieldAction): UsernameField {
  if (action.type === "answered") return answered(field, action.answer);
  return typed(action.refused === null ? field : refusedSave(field, action.refused), action.raw);
}

const TONE: Record<FieldView["tone"], string> = {
  muted: "text-muted-foreground",
  positive: "text-positive",
  destructive: "text-destructive",
};

/** The three ways the one status line is said share one grid cell, so it is always 18px. */
const LINE_CELL = "col-start-1 row-start-1 min-w-0 truncate";

/**
 * Screen 1. The username is the account's own and an avatar is already selected, so the
 * button is live from the first frame and one press is enough.
 */
export function ChooseScreen({
  profile,
  preview,
  shared,
  saving,
  refusal,
  notNow,
  titleRef,
  inputRef,
  onEdit,
  onSubmit,
  onNotNow,
}: {
  profile: FirstRunProfile;
  /** A preview says "Keep it", not "Picked for you": its account chose its name long ago. */
  preview: boolean;
  /** The card also holds the second screen, so this one keeps to a fixed height. */
  shared: boolean;
  saving: boolean;
  refusal: Refusal | null;
  /** "Not now" is offered in the quiet row: to an owner from the start, to anyone after a failed save. */
  notNow: boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  /**
   * The name or the avatar was changed, so a refusal about it no longer describes what
   * is on screen. A new avatar does not answer a refused name.
   */
  onEdit: (what: "name" | "avatar") => void;
  onSubmit: (handle: string, avatar: AvatarChoice, via: Via) => void;
  onNotNow: () => void;
}) {
  const id = useId();
  const [typedField, dispatch] = useReducer(fieldReducer, profile.handle, startField);
  // Made here, in a dialog the server never renders: a random avatar drawn on both sides
  // would differ. Never made from the username, which may be the front of an email.
  const [start] = useState(() => {
    const choice: AvatarChoice = savedAvatar(profile) ?? { kind: "seed", seed: randomSeed() };
    return { choice, pinned: choice.kind === "seed" ? choice.seed : null };
  });
  const [avatar, setAvatar] = useState(start.choice);
  const via = useRef<Via>("pointer");

  const field = refusal?.under === "field" ? refusedSave(typedField, refusal.sentence) : typedField;
  const view = fieldView(field, preview);
  // One identity for the life of the screen: the check's effect is keyed on it.
  const onAnswer = useCallback((answer: CheckAnswer) => dispatch({ type: "answered", answer }), []);
  // No check while a save is on its way: the save checks the name itself.
  useHandleCheck(field.value, wantsCheck(field) && !saving, onAnswer);

  // Back from a save that did not go through. The field and the button were disabled
  // while it ran, which takes focus off whichever had it. A refused choice puts it in the
  // field, with the name selected so typing replaces it; anything else, on the button,
  // because the same choice is worth sending again.
  const wasSaving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (saving) {
      wasSaving.current = true;
      return;
    }
    if (!wasSaving.current) return;
    wasSaving.current = false;
    if (refusal?.focus === "field") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refusal) {
      formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
  }, [saving, refusal, inputRef]);

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-1 flex-col"
      onClickCapture={(event) => {
        via.current = viaOfSubmit(event) ?? via.current;
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (view.canContinue && !saving) onSubmit(field.value, avatar, via.current);
      }}
    >
      <Dialog.Title ref={titleRef} tabIndex={-1} className={cn(TYPE.display, "outline-none")}>
        {CHOOSE.title}
      </Dialog.Title>
      <Dialog.Description className={cn(TYPE.body, "mt-1.5")}>{CHOOSE.helper}</Dialog.Description>

      <div className={shared ? CHOOSE_BLOCK : undefined}>
        <div className="mt-5 flex items-center gap-4 sm:mt-6">
          {/* Not animated: a person may click through many avatars, and each is simply there. */}
          <UserAvatar
            user={previewUser({ handle: field.value, avatar }, profile)}
            px={72}
            className="size-16 sm:size-[72px]"
          />
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-name`} className={cn(TYPE.caption, "block text-muted-foreground")}>
              {CHOOSE.label}
            </label>
            <div className="relative mt-1.5">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground md:text-sm"
              >
                @
              </span>
              <Input
                ref={inputRef}
                id={`${id}-name`}
                value={field.value}
                maxLength={USERNAME_MAX}
                disabled={saving}
                aria-invalid={view.invalid || undefined}
                aria-describedby={`${id}-address ${id}-status`}
                // A public name, not a sign-in: nothing a password manager should fill
                // or offer to save.
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                data-1p-ignore
                data-lpignore="true"
                onChange={(event) => {
                  dispatch({ type: "typed", raw: event.target.value, refused: field.refused });
                  onEdit("name");
                }}
                // The sign-in card's field: 44px, on the glass. The fill is set twice
                // because the input's own is a `dark:` class.
                className="h-11 rounded-[12px] bg-white/[0.04] pr-9 pl-7 dark:bg-white/[0.04]"
              />
              <FieldGlyph glyph={view.glyph} />
            </div>
          </div>
        </div>

        {/* Under the row, at the card's full width, and always there: nothing below moves
            when a verdict arrives. */}
        <p id={`${id}-address`} className={cn(TYPE.caption, "mt-2 truncate text-muted-foreground")}>
          {ADDRESS_PREFIX}
          <span className="text-foreground">{addressName(field)}</span>
        </p>
        <div id={`${id}-status`} className={cn(TYPE.caption, "grid h-[18px] grid-cols-[minmax(0,1fr)]")}>
          {/* Verdicts only, so they are read out when they change. "Checking…" and the
              hints are drawn beside this node, or every keystroke would be narrated. */}
          <p role="status" aria-live="polite" className={cn(LINE_CELL, TONE[view.tone])}>
            {view.said === "status" ? view.text : null}
          </p>
          {view.said === "quiet" ? <p className={cn(LINE_CELL, TONE[view.tone])}>{view.text}</p> : null}
          <p role="alert" className={cn(LINE_CELL, TONE.destructive)}>
            {view.said === "alert" ? view.text : null}
          </p>
        </div>

        <div className="mt-5">
          <AvatarPicker
            photoUrl={profile.avatarUrl}
            pinnedSeed={start.pinned}
            value={avatar}
            onChange={(choice) => {
              setAvatar(choice);
              onEdit("avatar");
            }}
            disabled={saving}
            handle={field.value || profile.handle}
          />
          {/* Always there, 18px tall, so a save that fails moves nothing. Measured without
              it, the sentence had 4px between the selected avatar's ring and the button. */}
          <p role="alert" className={cn(TYPE.caption, "mt-1.5 h-[18px] truncate text-destructive")}>
            {refusal?.under === "tiles" ? refusal.sentence : null}
          </p>
        </div>
      </div>

      <Footer
        button={
          <MetalSubmit disabled={!view.canContinue || saving}>
            {saving ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> : null}
            <span className="min-w-0 truncate">{continueLabel(field, view, saving)}</span>
          </MetalSubmit>
        }
        quiet={
          notNow ? (
            <QuietButton onClick={onNotNow} disabled={saving}>
              {NOT_NOW}
            </QuietButton>
          ) : (
            <p>{CHOOSE.quiet}</p>
          )
        }
      />
    </form>
  );
}

/**
 * The mark at the end of the field. All three are always in the tree, so each arrives
 * and leaves as a transition that can be interrupted; the tick also grows into place,
 * as the builder's own does.
 */
function FieldGlyph({ glyph }: { glyph: FieldView["glyph"] }) {
  const slot =
    "col-start-1 row-start-1 size-3.5 transition-[opacity,scale] duration-150 ease-[var(--ease-out-strong)]";
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center">
      <Loader2
        className={cn(
          slot,
          "text-muted-foreground",
          glyph === "checking" ? "opacity-100 motion-safe:animate-spin" : "opacity-0",
        )}
      />
      <Check
        strokeWidth={3}
        className={cn(
          slot,
          "text-positive motion-reduce:scale-100",
          glyph === "ok" ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      />
      <CircleAlert className={cn(slot, "text-destructive", glyph === "error" ? "opacity-100" : "opacity-0")} />
    </span>
  );
}

/* --- screen 2 ------------------------------------------------------------------ */

/**
 * Screen 2: an agent going from a strategy, to paper, to live, and one button to the
 * builder. It can be closed freely, and is not shown again.
 */
export function BuildScreen({
  handle,
  onBuilder,
  going,
  animate,
  onGo,
  onNotNow,
}: {
  /** The username just saved, said to a screen reader before the helper. */
  handle: string;
  /** The page behind the card is the builder already: the button only has to close the card. */
  onBuilder: boolean;
  /** The builder is on its way. The card stays until it is there. */
  going: boolean;
  /** The steps arrive in order. Off after a key press, and for anyone who asked for less motion. */
  animate: boolean;
  onGo: () => void;
  onNotNow: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // The one thing to do here is press the button, so it has focus when the screen arrives.
    formRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    // Asked for now, so the press that follows has less to wait for.
    if (!onBuilder) router.prefetch(BUILDER_PATH);
  }, [onBuilder, router]);

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!going) onGo();
      }}
    >
      <Dialog.Title className={TYPE.display}>{BUILD.title}</Dialog.Title>
      <Dialog.Description className={cn(TYPE.body, "mt-1.5")}>
        <span className="sr-only">You are @{handle} now. </span>
        {BUILD.helper}
      </Dialog.Description>

      <BuildSteps animate={animate} className="mt-5 sm:mt-6" />

      <Footer
        button={
          <MetalSubmit disabled={going}>
            {BUILD.primary}
            {going ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="size-4" aria-hidden />
            )}
          </MetalSubmit>
        }
        // On the builder there is nothing to put off: the button closes the card in
        // place. The row stays, so the button is where Continue was.
        quiet={onBuilder ? null : <QuietButton onClick={onNotNow}>{NOT_NOW}</QuietButton>}
      />
    </form>
  );
}

/** The line from one step's tile down to the next. Decorative. */
const CONNECTOR = "absolute top-[38px] -bottom-1 left-4 origin-top";

/**
 * Three rows, drawn in three states so "paper now, live later" is a picture before it is
 * a sentence: done-able now, where you start (lit), and later (dashed, dimmed).
 *
 * Each heading is centred on its 32px tile, and the text of one row ends 16px above the
 * heading of the next.
 */
export function BuildSteps({ animate, className }: { animate: boolean; className?: string }) {
  // Rows rise in order; each connector then draws down from its tile.
  const row = (index: number) =>
    animate
      ? {
          initial: { opacity: 0, transform: "translateY(6px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.24, delay: index * 0.05, ease: EASE_OUT },
        }
      : { initial: false as const };
  const line = (delay: number) =>
    animate
      ? {
          initial: { transform: "scaleY(0)" },
          animate: { transform: "scaleY(1)" },
          transition: { duration: 0.3, delay, ease: EASE_OUT },
        }
      : { initial: false as const };

  return (
    <ol className={cn("flex flex-col gap-2.5", className)}>
      <motion.li {...row(0)} className="relative flex gap-3">
        <IconTile tone="blue">
          <PartIcon part="strategy" />
        </IconTile>
        <motion.span
          aria-hidden
          {...line(0.08)}
          className={cn(CONNECTOR, "w-px bg-[linear-gradient(180deg,#3d6bff,#7a5cff)]")}
        />
        <StepText title={BUILD_STEPS[0].title} body={BUILD_STEPS[0].body} />
      </motion.li>

      <motion.li {...row(1)} className="relative flex gap-3">
        {/* Lit: this is where an agent starts. The ring and the builder's 3px halo. */}
        <IconTile
          tone="violet"
          className="shadow-[0_0_0_3px_rgb(122_92_255/0.12)] ring-1 ring-[#7a5cff]/60"
        >
          <FlaskConical strokeWidth={1.75} />
        </IconTile>
        <motion.span
          aria-hidden
          {...line(0.13)}
          className={cn(CONNECTOR, "w-0 border-l border-dashed border-white/20")}
        />
        <StepText
          title={BUILD_STEPS[1].title}
          body={BUILD_STEPS[1].body}
          badge={<ModeBadge mode="paper" className="leading-[14px]" />}
        />
      </motion.li>

      <motion.li {...row(2)} className="relative flex gap-3">
        {/* Later: an empty, dashed tile, and everything on the row a step quieter. */}
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-white/25 text-muted-foreground"
        >
          <Zap className="size-4" strokeWidth={1.75} />
        </span>
        <StepText
          title={BUILD_STEPS[2].title}
          body={BUILD_STEPS[2].body}
          later
          badge={<ModeBadge mode="live" className="leading-[14px] opacity-60" />}
        />
      </motion.li>
    </ol>
  );
}

function StepText({
  title,
  body,
  badge,
  later = false,
}: {
  title: string;
  body: string;
  badge?: ReactNode;
  later?: boolean;
}) {
  return (
    // 6px down, so the 20px heading sits on the middle of the 32px tile.
    <div className="min-w-0 flex-1 pt-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className={cn(TYPE.heading, later ? "text-foreground/70" : "text-foreground")}>{title}</p>
        {/* The heading already says paper or live. */}
        {badge ? (
          <span aria-hidden className="flex shrink-0">
            {badge}
          </span>
        ) : null}
      </div>
      <p className={cn(TYPE.small, "text-pretty text-muted-foreground")}>{body}</p>
    </div>
  );
}

/* --- stand-ins ----------------------------------------------------------------- */

/**
 * A screen's shape with nothing in it to see, hear or reach. The card lays both of these
 * out under whichever screen is showing, in the same grid cell, so it is always as tall
 * as the taller screen at this width: the card is one height, and it is measured by the
 * browser rather than written down as a number that a change of copy would make wrong.
 */
function Ghost({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden inert className="invisible col-start-1 row-start-1 flex min-w-0 flex-col">
      {children}
    </div>
  );
}

export function ChooseGhost() {
  return (
    <Ghost>
      <p className={TYPE.display}>{CHOOSE.title}</p>
      <p className={cn(TYPE.body, "mt-1.5")}>{CHOOSE.helper}</p>
      <div className={CHOOSE_BLOCK} />
      <div className={FOOTER} />
    </Ghost>
  );
}

export function BuildGhost() {
  return (
    <Ghost>
      <p className={TYPE.display}>{BUILD.title}</p>
      <p className={cn(TYPE.body, "mt-1.5")}>{BUILD.helper}</p>
      <BuildSteps animate={false} className="mt-5 sm:mt-6" />
      <div className={FOOTER} />
    </Ghost>
  );
}
