/**
 * Central application configuration.
 *
 * One place for the values every entry point and module needs. Paths are
 * resolved against the project root so the app behaves the same no matter
 * which directory it was started from.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLibraryRoot } from "./documents-dir.ts";

/** The project root: the directory that holds `src/`. */
export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const DEFAULT_PORT = 3000;

/**
 * Resolve `PORT` into a port this process can actually bind.
 *
 * A malformed value is reported through `ignoredPortEnv` rather than
 * thrown at import time: a typo in the environment should not keep the
 * app from starting, but it should not be silently swallowed either.
 */
function resolvePort(): { port: number; ignored: string | null } {
  const raw = process.env.PORT?.trim();
  if (!raw) return { port: DEFAULT_PORT, ignored: null };
  const port = Number(raw);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return { port, ignored: null };
  }
  return { port: DEFAULT_PORT, ignored: raw };
}

const resolvedPort = resolvePort();

/** Set when `PORT` was present but unusable and was ignored. */
export const ignoredPortEnv: string | null = resolvedPort.ignored;

/**
 * The URL prefix the backend answers on.
 *
 * Shared because the dev server mounts its proxy on it, and anything
 * else that claims a URL prefix - notably a directory in the renderer,
 * which becomes one for the modules inside it - has to stay clear of it.
 */
export const API_PREFIX = "/api";

export const appConfig = {
  name: "Textpilot",
  identifier: "dev.textpilot.app",
  version: "0.1.0",

  server: {
    host: "127.0.0.1",
    port: resolvedPort.port,
  },

  logging: {
    /** Minimum level that reaches the transports. */
    level: "info" as LogLevel,
    /** Overwritten at the start of every run. */
    file: join(projectRoot, "logs", "app.log"),
  },

  data: {
    /**
     * The library: the user's `Textpilot` folder, where every document is
     * a `.md` file and every app folder a real directory. Overridable
     * with `TEXTPILOT_DIR` so development and tests stay out of the way.
     */
    root: resolveLibraryRoot(),
    /**
     * Pre-library locations, read once to import old work into the
     * library. Nothing writes here any more.
     */
    legacy: {
      /** The single-note era's file. */
      note: join(projectRoot, "data", "note.json"),
      /** One JSON file per document, before documents became .md files. */
      documents: join(projectRoot, "data", "documents"),
      /** The single file that held every folder. */
      folders: join(projectRoot, "data", "folders.json"),
    },
  },
};

export type LogLevel = "debug" | "info" | "warn" | "error";
