/**
 * Whether /login loads the live silk, or keeps the painted poster under it.
 *
 * The rule is the landing's (`liquid/hero-shader.tsx`), restated here as a pure function
 * so the two cannot drift apart unnoticed: the silk needs WebGPU, is not shown to a
 * visitor who asked for less motion, and is not worth its cost on a device that would
 * rather keep the poster (data saver on, little memory, few cores).
 */
export interface SilkEnv {
  reducedMotion: boolean;
  hasWebGPU: boolean;
  /** The three below are only reported by some browsers; unreported counts as fine. */
  saveData?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/** Below this many gigabytes, or this many cores, the device keeps the poster. */
const MIN_DEVICE_MEMORY_GB = 4;
const MIN_CORES = 4;

export function shouldLoadSilk(env: SilkEnv): boolean {
  if (env.reducedMotion || !env.hasWebGPU) return false;
  if (env.saveData) return false;
  if (env.deviceMemory !== undefined && env.deviceMemory < MIN_DEVICE_MEMORY_GB) return false;
  return !(env.hardwareConcurrency !== undefined && env.hardwareConcurrency < MIN_CORES);
}

/** Reads the browser. Client only: call it from an effect, never while rendering. */
export function readSilkEnv(reducedMotion: boolean): SilkEnv {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    reducedMotion,
    hasWebGPU: "gpu" in nav,
    saveData: nav.connection?.saveData,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  };
}
