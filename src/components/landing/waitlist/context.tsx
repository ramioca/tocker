"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { WaitlistModal } from "./modal";

/**
 * Open state for the waitlist modal. Any CTA on the page calls
 * `useWaitlist().open()`; the modal itself lives in ./modal.tsx.
 */
type WaitlistCtx = { open: () => void; isOpen: boolean };
const Ctx = createContext<WaitlistCtx>({ open: () => {}, isOpen: false });
export const useWaitlist = () => useContext(Ctx);

export function WaitlistProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    // Return focus to whatever opened the modal, after the exit animation starts.
    const el = triggerRef.current;
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }, []);

  return (
    <Ctx.Provider value={{ open, isOpen }}>
      {children}
      <WaitlistModal open={isOpen} onClose={close} />
    </Ctx.Provider>
  );
}
