"use client";

import { useSyncExternalStore } from "react";

/**
 * A single shared clock for everything that shows elapsed or relative time.
 *
 * `useSyncExternalStore` is the right shape here: the current time is external
 * state, its snapshot is allowed to read the clock, and the server snapshot
 * keeps the first paint from disagreeing with itself. One timer serves every
 * subscriber instead of one interval per timestamp in a forty-card feed.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      for (const current of listeners) current();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshotSecond = () => Math.floor(Date.now() / 1_000) * 1_000;
const snapshotHalfMinute = () => Math.floor(Date.now() / 30_000) * 30_000;

/** Ticks once a second. For elapsed counters. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshotSecond, snapshotSecond);
}

/** Ticks every 30 seconds. For relative labels, which change far more slowly. */
export function useCoarseNow(): number {
  return useSyncExternalStore(subscribe, snapshotHalfMinute, snapshotHalfMinute);
}
