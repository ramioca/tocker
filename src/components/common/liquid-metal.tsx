"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  MetalFx,
  getSharedPreset,
  setSharedPresetMode,
  useMetalBend,
  type MetalFxProps,
} from "metal-fx";
import { cn } from "@/lib/utils";

/**
 * MetalFx with the signature interactions wired in: the chrome ring dents and
 * liquefies toward the pointer (spring physics), and the idle flow runs fast
 * enough to read as liquid rather than chrome paint.
 *
 * The wrapper is split in two on purpose.
 *
 * `MetalFx` decides WebGL2 support *during render*, so the server emits its plain
 * fallback and the client's first render emits the canvas root. That is a hydration
 * mismatch on every page that shows one — React discards the whole `(app)` layout
 * and re-renders it on the client. `LiquidMetal` therefore renders the library's own
 * fallback markup until hydration has finished and only then mounts the real thing,
 * so the server HTML and the first client render agree.
 *
 * The bend hook and the idle tuning live in the inner component so their effects run
 * once the ref already points at the canvas root, not at the fallback div.
 *
 * (The engine's teardown bug — a lost-context event from a torn-down renderer marking
 * its successor lost, which left the ring blank under StrictMode and on route swaps —
 * is fixed in `patches/metal-fx*.patch`, not here. The same patch raises the ring's
 * hard-coded 15 fps frame cap to 30.)
 */
export function LiquidMetal(props: MetalFxProps) {
  const hydrated = useSyncExternalStore(subscribeNever, getClientSnapshot, getServerSnapshot);
  if (!hydrated) {
    const { children, className, style } = props;
    return (
      <div
        className={cn("metal-fx-fallback", className)}
        data-metal-fx-unsupported=""
        style={{ display: "inline-flex", ...style }}
      >
        {children}
      </div>
    );
  }
  return <LiquidMetalLive {...props} />;
}

function LiquidMetalLive(props: MetalFxProps) {
  const ref = useRef<HTMLDivElement>(null);
  useMetalBend(ref);
  useLivelyIdle();
  return <MetalFx ref={ref} {...props} />;
}

const subscribeNever = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * The stock presets idle at speed 1 — chrome that reads as a still photo. This
 * pushes the same preset back into the shared renderer with the flow sped up a
 * little, so the liquid visibly runs along the ring at rest without racing. What
 * makes it read as *smooth* is not the speed but the frame cap: the engine
 * hard-codes 15 fps for the ring, which the metal-fx patch raises to 30. Tuning
 * is global by design (every instance shares one GL program); the guard keeps N
 * mounts from re-pushing. Child effects run first, so the engine normally exists
 * by the time this runs; the RAF retry covers the case where it does not.
 */
const IDLE_FLOW_SPEED = 1.5;

function useLivelyIdle() {
  useEffect(() => {
    let cancelled = false;
    const tune = () => {
      if (cancelled) return;
      const base = getSharedPreset();
      if (!base) {
        requestAnimationFrame(tune);
        return;
      }
      if (base.speed >= IDLE_FLOW_SPEED) return;
      setSharedPresetMode({ ...base, speed: IDLE_FLOW_SPEED });
    };
    tune();
    return () => {
      cancelled = true;
    };
  }, []);
}
