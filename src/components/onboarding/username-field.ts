/**
 * The first-run screen's username field, outside the component so it can be tested:
 * what the field holds, what the one line under it says, whether Continue may be
 * pressed and what it reads. No React, and nothing here asks the server anything:
 * `use-handle-check.ts` does, on the timing `scheduleCheck` keeps, and hands the answer
 * to `answered`.
 *
 * It is "username" wherever a person reads it and "handle" in code (`src/lib/handles.ts`).
 */
import { cleanHandle } from "@/components/settings/handle-filter";
import { HANDLE_INVALID, HANDLE_TAKEN, handleProblem, type HandleStatus } from "@/lib/handles";
import { HANDLE_RESERVED } from "@/lib/reserved-handles";

/** How long after the last keystroke the name is checked. */
export const CHECK_DELAY_MS = 350;
export const USERNAME_MAX = 20;
/** Where a profile lives, shown under the field as the name is typed. */
export const ADDRESS_PREFIX = "tocker.xyz/u/";

/**
 * The line under the address. Each is one line at a phone's width: 44 characters at
 * most, which `username-field.test.ts` holds them to.
 */
export const STATUS = {
  picked: "Picked for you. Keep it or type your own.",
  /** A preview is shown to an account that chose its name long ago. */
  pickedPreview: "Keep it or type your own.",
  short: "At least 2 characters",
  checking: "Checking…",
  available: "Available",
  dropped: "Letters, numbers and _ only",
  unknown: "Could not check. You can still continue.",
} as const;

/** What a check said about one name. `unknown` is a check that could not be made. */
export interface CheckAnswer {
  handle: string;
  status: HandleStatus | "unknown";
}

export interface UsernameField {
  /** The account's username when the screen opened. Keeping it is always allowed. */
  current: string;
  /** What the field holds: lowercase letters, digits and underscores, 20 at most. */
  value: string;
  /** The last keystroke had a character taken out. Said until the next one. */
  dropped: boolean;
  /** The last answer kept. It counts only while it is about the name in the field. */
  answer: CheckAnswer | null;
  /** The sentence a save was refused with, for the name in the field. Gone on the next keystroke. */
  refused: string | null;
}

export function startField(current: string): UsernameField {
  return { current, value: current, dropped: false, answer: null, refused: null };
}

/**
 * A keystroke or a paste. A leading "@" is dropped without a word, since that is how
 * people write a username; anything else that is not a letter, a digit or an underscore
 * is dropped and said (`dropped`).
 *
 * Typing over a name a save has just refused also forgets what a check said of that
 * name. The check called it available and the save found it taken, so typed back in it
 * is asked about again, not shown with the old tick.
 */
export function typed(field: UsernameField, raw: string): UsernameField {
  const { value, removed } = cleanHandle(raw.replace(/^@+/, ""));
  const answer = field.refused !== null && field.answer?.handle === field.value ? null : field.answer;
  return { ...field, value: value.slice(0, USERNAME_MAX), dropped: removed.length > 0, answer, refused: null };
}

/**
 * A check came back. One that is about a name no longer in the field is dropped: the
 * person typed on while it was on its way, and the newer name gets its own answer.
 */
export function answered(field: UsernameField, answer: CheckAnswer): UsernameField {
  return answer.handle === field.value ? { ...field, answer } : field;
}

/** A save refused the name in the field, with this sentence. */
export function refusedSave(field: UsernameField, sentence: string): UsernameField {
  return { ...field, refused: sentence };
}

export type FieldKind =
  | "untouched"
  | "short"
  | "reserved"
  | "invalid"
  | "checking"
  | "available"
  | "taken"
  | "unknown"
  | "refused";

export interface FieldView {
  kind: FieldKind;
  /** The one line under the address. */
  text: string;
  tone: "muted" | "positive" | "destructive";
  /** The mark at the end of the field. */
  glyph: "none" | "checking" | "ok" | "error";
  /**
   * How a screen reader gets the line. `status`: a verdict, read out when it changes.
   * `alert`: a refused save. `quiet`: a hint that is there to be read but is not
   * announced, or every keystroke would be narrated.
   */
  said: "quiet" | "status" | "alert";
  /** The field is marked invalid. */
  invalid: boolean;
  /** Continue may be pressed. */
  canContinue: boolean;
}

function kindOf(field: UsernameField): FieldKind {
  const { current, value, answer, refused } = field;
  if (refused !== null) return "refused";
  // Its own name is never a problem, whatever today's rules say about it.
  if (value === current) return "untouched";
  if (value.length < 2) return "short";
  const problem = handleProblem(value, current);
  if (problem) return problem;
  if (answer && answer.handle === value) return answer.status;
  // No answer about this name yet: the check is waiting out its delay, or on its way.
  return "checking";
}

const VIEWS: Record<Exclude<FieldKind, "untouched" | "refused">, Omit<FieldView, "kind">> = {
  short: { text: STATUS.short, tone: "muted", glyph: "none", said: "quiet", invalid: false, canContinue: false },
  reserved: { text: HANDLE_RESERVED, tone: "destructive", glyph: "error", said: "status", invalid: true, canContinue: false },
  invalid: { text: HANDLE_INVALID, tone: "destructive", glyph: "error", said: "status", invalid: true, canContinue: false },
  // Continue stays open while a check runs: the save checks again.
  checking: { text: STATUS.checking, tone: "muted", glyph: "checking", said: "quiet", invalid: false, canContinue: true },
  available: { text: STATUS.available, tone: "positive", glyph: "ok", said: "status", invalid: false, canContinue: true },
  taken: { text: HANDLE_TAKEN, tone: "destructive", glyph: "error", said: "status", invalid: true, canContinue: false },
  unknown: { text: STATUS.unknown, tone: "muted", glyph: "none", said: "status", invalid: false, canContinue: true },
};

/**
 * What the field shows. `preview` only changes the untouched line: "Picked for you" is
 * true of an account that never chose its name, which a preview's account did.
 */
export function fieldView(field: UsernameField, preview = false): FieldView {
  const kind = kindOf(field);
  if (kind === "refused") {
    return {
      kind,
      text: field.refused ?? "",
      tone: "destructive",
      glyph: "error",
      said: "alert",
      invalid: true,
      canContinue: false,
    };
  }
  const view: FieldView =
    kind === "untouched"
      ? {
          kind,
          text: preview ? STATUS.pickedPreview : STATUS.picked,
          tone: "muted",
          glyph: "none",
          said: "quiet",
          invalid: false,
          canContinue: true,
        }
      : { kind, ...VIEWS[kind] };
  // A character that vanished is said in the line's place, or it reads as a broken
  // field. Not over a reason Continue is closed: that one the person has to see.
  if (field.dropped && view.tone !== "destructive") {
    return { ...view, text: STATUS.dropped, tone: "muted", said: "status" };
  }
  return view;
}

/**
 * Whether to ask the server about the name in the field: only one that differs from the
 * account's own, that the rules allow, and that has no verdict yet. A check that could
 * not be made is asked again the next time the field changes.
 */
export function wantsCheck(field: UsernameField): boolean {
  const { current, value, answer, refused } = field;
  if (refused !== null || value === current || value.length < 2) return false;
  if (handleProblem(value, current)) return false;
  return !(answer && answer.handle === value && answer.status !== "unknown");
}

/**
 * One check of one name: wait out the delay, ask, pass the answer on. It returns the way
 * to call it off, which every keystroke does to the check before it: the timer if it has
 * not fired, and the answer if it has, which then lands and is passed to nobody.
 *
 * `ask` resolves to what the server said, or to null when it would not say (signed out,
 * out of allowance, the database down). That and a call that fails are both answered
 * `unknown`, about the name that was asked: Continue stays open, and the save checks again.
 */
export function scheduleCheck(
  name: string,
  ask: (name: string) => Promise<{ handle: string; status: HandleStatus } | null>,
  onAnswer: (answer: CheckAnswer) => void,
  delayMs: number = CHECK_DELAY_MS,
): () => void {
  let live = true;
  const pass = (answer: CheckAnswer) => {
    if (live) onAnswer(answer);
  };
  const timer = setTimeout(() => {
    ask(name).then(
      (said) => pass(said ?? { handle: name, status: "unknown" }),
      () => pass({ handle: name, status: "unknown" }),
    );
  }, delayMs);
  return () => {
    live = false;
    clearTimeout(timer);
  };
}

/** What the button reads. It names the account it is about to make public. */
export function continueLabel(field: UsernameField, view: FieldView, saving: boolean): string {
  if (saving) return "Saving…";
  return view.canContinue ? `Continue as @${field.value}` : "Continue";
}

/** The name as the address line shows it. */
export function addressName(field: UsernameField): string {
  return field.value || "…";
}
