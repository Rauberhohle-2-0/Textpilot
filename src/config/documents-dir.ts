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
import { isAbsolute, join, resolve } from "node:path";

/** The folder the app owns inside Documents. */
export const LIBRARY_FOLDER_NAME = "Textpilot";

/** The library root for this machine, honoring `TEXTPILOT_DIR`. */
export function resolveLibraryRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TEXTPILOT_DIR?.trim();
  if (override) return assertSafeLibraryRoot(resolve(override));
  return join(documentsDirectory(), LIBRARY_FOLDER_NAME);
}

/**
 * Refuse overrides that would put destructive operations (notably
 * recursive folder delete) somewhere catastrophic: the filesystem
 * root, the user's home, or the Documents folder itself. The library
 * must be a dedicated directory, not a scope the app shares with the
 * rest of the system. Throws at startup so a bad env fails fast.
 */
export function assertSafeLibraryRoot(resolved: string): string {
  const home = homedir();
  const documents = join(home, "Documents");
  const forbidden = new Set([resolve("/"), home, documents]);
  if (forbidden.has(resolved)) {
    throw new Error(
      `TEXTPILOT_DIR must be a dedicated library folder, not ${resolved}`,
    );
  }
  if (!isAbsolute(resolved)) {
    throw new Error(`TEXTPILOT_DIR must be an absolute path: ${resolved}`);
  }
  return resolved;
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
