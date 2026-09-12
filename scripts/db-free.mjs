// Preflight for drizzle-kit commands: refuse to open the embedded PGlite database
// while another live process (usually `pnpm dev`) holds it. See src/db/pglite-lock.ts.
import fs from "node:fs";
import path from "node:path";

const url = (process.env.DATABASE_URL || "pglite://./.pglite").trim();
if (!url.startsWith("pglite://")) process.exit(0);
const dir = url.replace("pglite://", "") || "./.pglite";
if (dir.startsWith("memory://")) process.exit(0);

let pid = null;
try {
  pid = Number.parseInt(fs.readFileSync(`${path.resolve(dir)}.lock`, "utf8").trim(), 10);
} catch {
  process.exit(0);
}
let alive = false;
try {
  process.kill(pid, 0);
  alive = true;
} catch (err) {
  alive = err.code === "EPERM";
}
if (!alive) process.exit(0);

console.error(
  `The embedded dev database (${dir}) is open in process ${pid}, most likely \`pnpm dev\`.\n` +
    "Stop it before running this command: PGlite is single-process, and a second process silently loses writes.",
);
process.exit(1);
