/**
 * Where the library lives: the `Textpilot` folder inside the user's
 * Documents directory, on every platform.
 *
 * The app's whole point is that a note is a file the user owns, so the
 * root is a normal, visible folder - not an app-data directory. The
 * value is resolved once at startup; `TEXTPILOT_DIR` overrides it so
 * development (and tests) can point somewhere harmless.
 *
 * `Documents` is a real filesystem location on all three platforms, but
 * Linux may redirect it through XDG user directories, so that case asks
 * the OS before assuming `~/Documents`.
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The folder the app owns inside Documents. */
export const LIBRARY_FOLDER_NAME = "Textpilot";

/** The library root for this machine, honoring `TEXTPILOT_DIR`. */
export function resolveLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TEXTPILOT_DIR?.trim();
  if (override) return resolve(override);
  return join(documentsDirectory(), LIBRARY_FOLDER_NAME);
}

/** The user's Documents directory, best-effort for the current OS. */
function documentsDirectory(): string {
  if (process.platform === "linux") {
    const xdg = xdgDocumentsDirectory();
    if (xdg !== null) return xdg;
  }
  return join(homedir(), "Documents");
}

/**
 * Ask `xdg-user-dir` where Documents actually is. A machine without the
 * tool, or one that never configured XDG dirs, prints `$HOME` - treated
 * as "not configured" and left to the `~/Documents` default.
 */
function xdgDocumentsDirectory(): string | null {
  const result = spawnSync("xdg-user-dir", ["DOCUMENTS"], { encoding: "utf8" });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const directory = result.stdout.trim();
  if (directory.length === 0 || directory === homedir()) return null;
  return directory;
}
