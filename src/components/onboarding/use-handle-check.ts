"use client";

import { useEffect } from "react";
import { checkHandle } from "@/server/actions/onboarding";
import { scheduleCheck, type CheckAnswer } from "./username-field";

/** The server's answer, or null when it would not give one. */
async function askServer(name: string) {
  const result = await checkHandle(name);
  return result.ok ? result.data : null;
}

/**
 * Asks the server whether a username is free, a moment after the person stops typing.
 *
 * `wanted` is the field's own rule for a name worth asking about (`wantsCheck`), and it
 * is false while a save is on its way: Next sends server actions one at a time, so a
 * check started then would only hold up the save's answer.
 *
 * The delay, and dropping the answer to a name the person has typed past, are
 * `scheduleCheck`'s (`username-field.ts`); `answered` drops a stale answer a second
 * time, by the name it carries.
 *
 * `onAnswer` must keep its identity between renders (a reducer's dispatch does).
 */
export function useHandleCheck(name: string, wanted: boolean, onAnswer: (answer: CheckAnswer) => void): void {
  useEffect(() => {
    if (!wanted) return;
    return scheduleCheck(name, askServer, onAnswer);
  }, [name, wanted, onAnswer]);
}
