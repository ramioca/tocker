/**
 * Single-process guard for the embedded dev database.
 *
 * PGlite is one Postgres instance inside one process. It does not stop a second
 * process from opening the same data directory, and when that happens writes are
 * silently lost and the directory can end up unreadable ("Aborted()"). Verified:
 * a row written by a second process disappeared the moment the first one closed.
 *
 * So we take an exclusive lock file next to the data directory. A lock held by a
 * live process fails fast with an explanation; a lock left by a process that died
 * (Ctrl-C, kill -9) is detected by PID and replaced. Postgres users never touch this.
 */
import fs from "node:fs";
import path from "node:path";

export function lockPathFor(dir: string): string {
  return `${path.resolve(dir)}.lock`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** PID holding the lock, if the file exists and names one. */
export function lockHolder(dir: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPathFor(dir), "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** PID of a *live* other process holding the lock, or null when the directory is free. */
export function liveLockHolder(dir: string): number | null {
  const pid = lockHolder(dir);
  if (pid === null || pid === process.pid) return null;
  return isAlive(pid) ? pid : null;
}

export function lockedMessage(dir: string, pid: number): string {
  return [
    `The embedded dev database (${dir}) is already open in process ${pid}, most likely \`pnpm dev\`.`,
    "PGlite is single-process: a second process silently loses writes and can corrupt the database.",
    "Stop that process first, or set DATABASE_URL to Postgres (`docker compose up -d`) to run scripts alongside the server.",
    "`pnpm tick` talks to the running server over HTTP and is safe to run next to it.",
  ].join("\n");
}

export function acquirePgliteLock(dir: string): void {
  const file = lockPathFor(dir);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      process.once("exit", () => {
        try {
          if (lockHolder(dir) === process.pid) fs.unlinkSync(file);
        } catch {
          // best effort; a stale lock is recovered by PID on the next open
        }
      });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = lockHolder(dir);
      if (holder === process.pid) return;
      if (holder !== null && isAlive(holder)) throw new Error(lockedMessage(dir, holder));
      try {
        fs.unlinkSync(file); // stale: the holder is gone
      } catch {
        // raced with another process cleaning it up; retry
      }
    }
  }
  throw new Error(`Could not lock the embedded dev database at ${dir}.`);
}
